/**
 * Used carts in a OneJS app's own build (PlaySite docs/carts.md §4, step 6).
 *
 * A JSRunner app builds with OneJS's esbuild.config.mjs, from disk, not with
 * the site's builder. So the site's rules for a used cart come here as an
 * esbuild plugin, `cartsPlugin()`, added to that config the way
 * `assetsPlugin()` is (Tachi, 1 Oct, option b):
 *
 *   `~/oj.json` "dependencies" names the carts, the one spelling a cart uses;
 *   their source is in `~/.oj/carts/<key>/`, fetched by `ojp add`, and by
 *   the build itself when a fresh clone of the project lacks it;
 *   `@handle/name` resolves to that cart's `exports`, and a cart with none
 *   runs its entry on a bare import;
 *   inside a used cart, "oj" is the scoped oj, so `useTexture("glow.png")`
 *   reads `<key>/glow.png`, which is where its files are copied, under
 *   `~/assets/`, and so in a player's StreamingAssets.
 *
 * Without the scoping a bare alias would hand the cart the app's own
 * glow.png. Nothing here imports a package the scaffold gate would have to
 * install: only this package's own files and Node's.
 */
import fs from "node:fs"
import path from "node:path"
import { cartLabel, scopedOj } from "../build/game.mjs"
import { readUsedCarts } from "./game.mjs"
import { cartsDir, fetchUsed } from "./carts.mjs"
import { RESERVED_ASSET_FOLDER, isAssetName } from "./assets.mjs"

const CART_IMPORT = /^(@[A-Za-z0-9-]+\/[A-Za-z0-9-]+)(?:\/(.+))?$/
/** The keys the last sync copied into assets/, so only those are ever removed. */
const RECORD = path.join("node_modules", ".cache", "ojp", "unity-carts.json")

function manifestOf(root) {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(root, "oj.json"), "utf8"))
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

/** The key of the used cart `file` sits in, or null for the app's own files. */
function cartOfFile(root, file) {
    const rel = path.relative(cartsDir(root), file)
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null
    const [handle, named] = rel.split(path.sep)
    return handle !== undefined && named !== undefined ? `${handle}/${named}` : null
}

/** Every file a used cart ships that the site would serve, relative to its folder. */
function servable(dir, prefix = "") {
    const out = []
    for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) out.push(...servable(dir, rel))
        else if (isAssetName(rel)) out.push(rel)
    }
    return out
}

/**
 * Copies each used cart's files to `<root>/assets/<key>/`, and removes the
 * folder of a key this wrote before that nothing uses now. Answers the keys
 * copied and removed.
 */
export function syncCartAssets(root, keys) {
    const into = path.join(root, RESERVED_ASSET_FOLDER)
    const copied = []
    for (const key of keys) {
        const from = path.join(cartsDir(root), ...key.split("/"))
        const to = path.join(into, ...key.split("/"))
        let changed = false
        for (const name of servable(from)) {
            const source = path.join(from, ...name.split("/")), target = path.join(to, ...name.split("/"))
            if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(source).size
                && fs.readFileSync(target).equals(fs.readFileSync(source))) continue
            fs.mkdirSync(path.dirname(target), { recursive: true })
            fs.copyFileSync(source, target)
            changed = true
        }
        if (changed) copied.push(key)
    }
    let before = []
    try { before = JSON.parse(fs.readFileSync(path.join(root, RECORD), "utf8")) } catch { /* first sync */ }
    const removed = []
    for (const key of Array.isArray(before) ? before : []) {
        if (keys.includes(key) || typeof key !== "string" || !CART_IMPORT.test(key.slice(0, key.lastIndexOf("@")))) continue
        const stale = path.join(into, ...key.split("/"))
        if (!fs.existsSync(stale)) continue
        fs.rmSync(stale, { recursive: true, force: true })
        removed.push(key)
        const handleDir = path.dirname(stale)
        if (fs.existsSync(handleDir) && fs.readdirSync(handleDir).length === 0) fs.rmdirSync(handleDir)
    }
    fs.mkdirSync(path.dirname(path.join(root, RECORD)), { recursive: true })
    fs.writeFileSync(path.join(root, RECORD), JSON.stringify(keys))
    return { copied, removed }
}

/**
 * The esbuild plugin. Before each build it fetches what `.oj/carts` lacks
 * (failing in one line naming the cart and the command, when offline),
 * reads the used carts, and copies their files into assets/; then it
 * resolves their imports as the site's builder does.
 */
export function cartsPlugin() {
    return {
        name: "ojp-carts",
        setup(build) {
            // The real path: esbuild reports importers by theirs, and a
            // working folder reached through a symlink (macOS's /var is
            // /private/var) would otherwise match none of them.
            const root = fs.realpathSync(path.resolve(build.initialOptions.absWorkingDir ?? process.cwd()))
            let carts = { uses: {}, skipped: {}, carts: {} }

            build.onStart(async () => {
                const manifest = manifestOf(root)
                try {
                    await fetchUsed(root, manifest)
                    carts = readUsedCarts(root, manifest)
                    const { copied, removed } = syncCartAssets(root, Object.keys(carts.carts))
                    if (copied.length + removed.length > 0) {
                        console.log(`[ojp] assets/: ${[...copied.map((k) => `+${k}/`), ...removed.map((k) => `-${k}/`)].join(" ")}`)
                    }
                } catch (e) {
                    return { errors: [{ text: `[ojp] ${e.message}` }] }
                }
            })

            build.onResolve({ filter: CART_IMPORT }, async (args) => {
                if (args.namespace !== "file") return undefined
                const wanted = CART_IMPORT.exec(args.path)
                const address = wanted[1].toLowerCase()
                const owner = cartOfFile(root, args.importer)
                const scope = owner === null ? carts : carts.carts[owner]
                const key = scope?.uses?.[address]
                if (key === undefined) {
                    // An app's own import of a scoped npm package (@types,
                    // @babel) is not a cart: left to esbuild unless oj.json
                    // means it.
                    if (owner === null && !(address in (carts.skipped ?? {}))) return undefined
                    return { errors: [{ text: owner === null
                        ? carts.skipped[address]
                        : `${cartLabel(owner)} imports ${address}, which its oj.json does not list. Its author has to add it.` }] }
                }
                const cart = carts.carts[key]
                const dir = path.join(cartsDir(root), ...key.split("/"))
                const inside = wanted[2] ?? cart.exports
                if (typeof inside !== "string" || inside === "") return { path: key, namespace: "ojp-cart-whole", pluginData: { dir, entry: cart.entry ?? "index.tsx" } }
                const found = await build.resolve(`./${inside}`, { resolveDir: dir, kind: args.kind })
                if (found.errors.length > 0) return { errors: [{ text: `${cartLabel(key)} has no ${inside}` }] }
                return { path: found.path }
            })

            // A used cart's "oj" is the scoped one. Plugins see "oj" before
            // the config's alias does, so the scoped module's own import of
            // it, from its own namespace, falls through to that alias: the
            // real oj.
            build.onResolve({ filter: /^oj$/ }, (args) => {
                if (args.namespace !== "file") return undefined
                const owner = cartOfFile(root, args.importer)
                return owner === null ? undefined : { path: owner, namespace: "ojp-cart-oj" }
            })
            build.onLoad({ filter: /.*/, namespace: "ojp-cart-oj" }, (args) => ({ contents: scopedOj(args.path), loader: "js", resolveDir: root }))
            build.onLoad({ filter: /.*/, namespace: "ojp-cart-whole" }, (args) => ({
                contents: `import ${JSON.stringify("./" + args.pluginData.entry)}\nexport {}`,
                loader: "js",
                resolveDir: args.pluginData.dir,
            }))
        },
    }
}

/**
 * An app's esbuild.config.mjs with `cartsPlugin()` in it: the import beside
 * assetsPlugin's (or on its own), and the call first in the plugins list.
 * Unchanged when it is there already.
 */
export function withCartsPlugin(text) {
    if (/\bcartsPlugin\(\)/.test(text)) return text
    const plugins = /^([ \t]*)plugins:\s*\[[ \t]*\r?\n/m.exec(text)
    if (plugins === null) throw new Error("This app's esbuild.config.mjs has no plugins list to add the carts step to. Add cartsPlugin() from \"ojp/unity\" to it by hand.")
    const indent = plugins[1] + "    "
    const at = plugins.index + plugins[0].length
    text = text.slice(0, at) + `${indent}// The carts oj.json uses, resolved and scoped as on the site\n${indent}cartsPlugin(),\n` + text.slice(at)
    const assets = /^import \{ assetsPlugin \} from "ojp\/unity"/m
    return assets.test(text)
        ? text.replace(assets, `import { assetsPlugin, cartsPlugin } from "ojp/unity"`)
        : `import { cartsPlugin } from "ojp/unity"\n${text}`
}
