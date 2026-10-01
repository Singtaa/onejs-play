/**
 * A cloned cart's files, copied to where OneJS looks for them.
 *
 * The site keeps a cart's files at their own names in the repository
 * (`glow.png`, `art/bg.png`), so that is where a clone puts them. OneJS reads a
 * JSRunner project's files from `<working dir>/assets/` in the editor, and a
 * player build copies that folder into StreamingAssets. So a clone in a Unity
 * project runs, but `assetUrl("glow.png")` finds nothing.
 *
 * `ojp init --unity` puts `assetsPlugin()` in the build it writes, and the
 * plugin copies the files across at the start of every build: `npm run build`,
 * and each rebuild `npm run watch` makes on save. `assets/` is in the clone's
 * info/exclude, so git never sees the copies, and the site refuses a
 * top-level `assets` folder in a cart, so no file of the cart's can be in
 * the way.
 *
 * The files are chosen by the site's own rule (resolveAsset): what the site
 * would serve here is what reaches Unity. `.oj/`, the catalog's cover art, and
 * every other dot folder are left behind. A copy whose file has left the cart is removed, but only one
 * this wrote: the names it wrote are kept in node_modules, so a file somebody
 * put in `assets/` by hand is never touched.
 */
import fs from "node:fs"
import path from "node:path"
import { RESERVED_ASSET_FOLDER, isAssetName, resolveAsset } from "./assets.mjs"
import { PACKAGE } from "../build/command.mjs"

/** The names the last sync wrote, relative to the working directory. */
const RECORD = path.join("node_modules", ".cache", "onejs-play", "unity-assets.json")

/** The cart's files the site would serve, by name, walked the way a push is. */
function cartAssets(root) {
    const names = []
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
            if (prefix === "" && entry.name === RESERVED_ASSET_FOLDER) continue
            const rel = prefix + entry.name
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + "/")
            else if (entry.isFile() && isAssetName(rel) && resolveAsset(root, rel).file !== undefined) names.push(rel)
        }
    }
    walk(root, "")
    return names.sort()
}

function readRecord(root) {
    try {
        const names = JSON.parse(fs.readFileSync(path.join(root, RECORD), "utf8"))
        return Array.isArray(names) ? names.filter((n) => typeof n === "string") : []
    } catch {
        return []
    }
}

/**
 * Brings `<root>/assets/` up to date with the cart's files. Returns the names
 * copied and removed, both empty when nothing changed.
 */
export function syncAssets(root) {
    root = path.resolve(root)
    const into = path.join(root, RESERVED_ASSET_FOLDER)
    const names = cartAssets(root)
    const copied = []
    for (const name of names) {
        const from = path.join(root, ...name.split("/"))
        const to = path.join(into, ...name.split("/"))
        const source = fs.statSync(from)
        const copy = fs.existsSync(to) ? fs.statSync(to) : null
        // Within a millisecond: utimes goes through a Date and a float of
        // seconds, so the copy's time can land a hair either side of the source's.
        if (copy !== null && copy.size === source.size && Math.abs(copy.mtimeMs - source.mtimeMs) < 1) continue
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.copyFileSync(from, to)
        // The source's time on the copy, so the next build can tell it is current.
        fs.utimesSync(to, source.atime, source.mtime)
        copied.push(name)
    }
    const kept = new Set(names)
    const removed = []
    for (const name of readRecord(root)) {
        if (kept.has(name) || name.split("/").includes("..")) continue
        const stale = path.join(into, ...name.split("/"))
        if (!fs.existsSync(stale)) continue
        fs.rmSync(stale)
        removed.push(name)
        // Folders this emptied go too, up to assets/ itself.
        for (let dir = path.dirname(stale); dir !== into && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir)
    }
    fs.mkdirSync(path.dirname(path.join(root, RECORD)), { recursive: true })
    fs.writeFileSync(path.join(root, RECORD), JSON.stringify(names))
    return { copied, removed }
}

/**
 * The esbuild plugin `ojp init --unity` adds to a clone's build. It syncs before
 * each build and says so only when something changed; a sync that fails fails
 * the build, since the cart would otherwise run without its files.
 */
export function assetsPlugin() {
    return {
        name: "oj-assets",
        setup(build) {
            const root = build.initialOptions.absWorkingDir ?? process.cwd()
            build.onStart(() => {
                try {
                    const { copied, removed } = syncAssets(root)
                    if (copied.length + removed.length > 0) {
                        console.log(`[oj] assets/: ${[...copied.map((n) => `+${n}`), ...removed.map((n) => `-${n}`)].join(" ")}`)
                    }
                } catch (e) {
                    return { errors: [{ text: `[oj] could not copy the cart's files into assets/: ${e.message}` }] }
                }
            })
        },
    }
}

/**
 * The template's build, pointed at the cart's entry, with the plugin that
 * copies the cart's files into assets/ (assetsPlugin, above).
 *
 * The template names index.tsx, which is every cart's entry unless its
 * oj.json says otherwise. A template whose entry no longer matches the
 * pattern is left naming index.tsx, which is right for nearly every cart.
 * One with no plugins list is refused instead: the cart would build and run
 * without its files, and nothing would say why. The container's scaffold gate
 * runs this against OneJS's real template, so a reshaped one fails there first;
 * it lives here, beside the plugin, because this file imports nothing the
 * gate would have to install.
 */
export function buildConfig(template, entry) {
    let text = entry === "index.tsx" ? template
        : template.replace(/entryPoints:\s*\[\s*"index\.tsx"\s*\]/, `entryPoints: ["${entry}"]`)
    const plugins = /^([ \t]*)plugins:\s*\[[ \t]*\r?\n/m.exec(text)
    if (plugins === null) {
        throw new Error("OneJS's esbuild.config.mjs template has no plugins list for the step that copies the cart's files into assets/. "
            + `Update ${PACKAGE} (npx ${PACKAGE}@latest init --unity), or report it if this is the latest.`)
    }
    const indent = plugins[1] + "    "
    const at = plugins.index + plugins[0].length
    text = text.slice(0, at)
        + `${indent}// The cart's files, copied into assets/ where OneJS looks for them\n${indent}assetsPlugin(),\n`
        + text.slice(at)
    return `import { assetsPlugin } from "${PACKAGE}/unity"\n${text}`
}
