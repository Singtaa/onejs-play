/**
 * Bundling a game from a tree of files, with no filesystem.
 *
 * One builder for every place a game is built: the Worker on publish and on
 * Run, the `oj` command line on a developer's machine, and the script that
 * compiles the shipped games. They differ only in which esbuild they hand in
 * (the browser build of esbuild-wasm in the Worker, the native binary in
 * Node), so the esbuild instance is a parameter and nothing here touches a
 * disk or a global.
 *
 * Each piece of the path is load-bearing, and was established by the spike
 * in Tools/worker-build-spike:
 *
 *   a virtual filesystem, because a Worker has no disk;
 *   the onejs-unity plugins reading through the fs-provider seam, which is the
 *   only reason they run somewhere with no disk;
 *   externals resolved by a plugin rather than esbuild's `external`, because
 *   IIFE output turns those into an internal __require that throws at runtime.
 *
 * esbuild transforms code, it does not run it, so a hostile tree cannot
 * execute anything here. What protects players from a hostile game is the
 * per-game origin it is served on, not this file.
 */

import { setFsProvider } from "onejs-unity/fs-provider"
import { ussModulesPlugin } from "onejs-unity/esbuild/uss-modules"
import { tailwindPlugin } from "onejs-unity/esbuild/tailwind"
import { slPlugin } from "onejs-unity/esbuild/sl"
import DEFAULT_EXTERNALS from "./externals.json" with { type: "json" }
import { ANYWHERE } from "./command.mjs"

/**
 * Modules the container provides, which must not be bundled into a game.
 *
 * Keeping the reconciler out is the difference between a 9 KB game and a
 * 900 KB one, and it is what makes the shared runtime worth having. One list,
 * in externals.json beside this file, checked against the container's own
 * table by the site's externals test. Two builders kept separate copies once,
 * and the copy the site ran missed onejs-ui for a week after the container
 * started carrying it.
 */
export const EXTERNALS = DEFAULT_EXTERNALS

const dirname = (path) => {
    const at = path.lastIndexOf("/")
    return at <= 0 ? "/" : path.slice(0, at)
}

/** The tree is POSIX; a working directory esbuild echoes back may not be. */
const toPosix = (path) => path.replace(/\\/g, "/")

/**
 * A used cart's key: its address and what pins it, in a shape a URL path and
 * a folder name can both carry (`@singtaa/lightning@1.2.0`, and
 * `@koma/rain@3f2a91c07b44` for a commit pin, whose `#` cannot be in a path).
 * The key is where its files sit in the tree, in the asset URLs its scoped oj
 * makes, and in a Unity project's assets folder (PlaySite docs/carts.md §3).
 */
export function cartKey(address, pin) {
    return `${address.toLowerCase()}@${pin.startsWith("#") ? pin.slice(1) : pin}`
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const ADDRESS = /^@[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/

/**
 * What is wrong with one oj.json dependency, in a sentence that says what to
 * write instead, or null when it is an exact version or a `#` commit pin.
 * Exact, because a use moves only when its author asks: a range names the
 * version inside it. The site warns in these same words (PlaySite
 * `ojWarnings`, held to them by a test there).
 */
export function pinProblem(address, pin) {
    if (!ADDRESS.test(address)) return `"${address}" should be a cart's address, like "@singtaa/lightning".`
    if (typeof pin === "string" && (VERSION.test(pin) || /^#[0-9a-f]{12}$/.test(pin))) return null
    const inside = typeof pin === "string" ? /(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/.exec(pin) : null
    return inside !== null
        ? `"${pin}" for ${address} is a range. Use "${inside[0]}"; ojplay update moves it.`
        : `${JSON.stringify(pin)} for ${address} should be a version, like "1.2.0".`
}

/**
 * oj.json's `dependencies`, split into the carts to build with and the
 * entries that are not a cart pin, each with the sentence that says so.
 *
 * Only an address with an exact version or a `#` commit is a cart pin. The
 * rest are skipped, not refused: the key meant nothing to a build until
 * carts could be used, so a cart that carried, say, npm names there must not
 * stop building on its next save. The editor and a push still warn with the
 * same sentence, and importing a skipped address refuses with it.
 */
export function cartPins(deps) {
    const pins = [], skipped = {}, problems = []
    if (deps === undefined || deps === null) return { pins, skipped, problems }
    if (typeof deps !== "object" || Array.isArray(deps)) {
        problems.push(`"dependencies" should name each cart with its version, like { "@singtaa/lightning": "1.2.0" }.`)
        return { pins, skipped, problems }
    }
    for (const [address, pin] of Object.entries(deps)) {
        const problem = pinProblem(address, pin)
        if (problem === null) pins.push([address, pin])
        else { skipped[address.toLowerCase()] = problem; problems.push(problem) }
    }
    return { pins, skipped, problems }
}

/** "@singtaa/lightning 1.2.0", or "@koma/rain #3f2a91c07b44", for a sentence. */
export const cartLabel = (key) => {
    const at = key.lastIndexOf("@")
    const pin = key.slice(at + 1)
    return `${key.slice(0, at)} ${pin.includes(".") ? pin : "#" + pin}`
}

/** `@handle/name`, optionally followed by a path inside that cart. */
const CART_IMPORT = /^(@[A-Za-z0-9-]+\/[A-Za-z0-9-]+)(?:\/(.+))?$/

/**
 * What a used cart gets when it imports "oj": the container's oj, with every
 * function that takes one of the cart's own file names reading that name
 * inside the cart's folder. These six are all of them: each one resolves
 * through `assetUrl`, so prefixing the name is the whole of the scoping, and
 * a flipbook's sidecar is still the sibling it always was. A full URL or a
 * rooted path passes through, as `assetUrl` passes it.
 */
export const SCOPED = ["assetUrl", "loadTexture", "useTexture", "loadSheet", "useFlipbook", "audio"]

export function scopedOj(key) {
    return `import * as oj from "oj"
export * from "oj"
const scope = (name) => typeof name !== "string" || name === "" || name.includes("://") || name.startsWith("/") || /^[A-Za-z]:[\\\\/]/.test(name)
    ? name : ${JSON.stringify(key + "/")} + name.replace(/^\\.\\//, "").replace(/^assets\\//, "")
export const assetUrl = (name) => oj.assetUrl(scope(name))
export const loadTexture = (name) => oj.loadTexture(scope(name))
export const useTexture = (name) => oj.useTexture(scope(name))
export const loadSheet = (name) => oj.loadSheet(scope(name))
export const useFlipbook = (ref, name) => oj.useFlipbook(ref, scope(name))
export const audio = { ...oj.audio, load: (name) => oj.audio.load(scope(name)) }
`
}

/** Resolves "." and ".." inside a POSIX path, so a relative import cannot escape. */
export function normalize(path) {
    const out = []
    for (const part of path.split("/")) {
        if (part === "" || part === ".") continue
        if (part === "..") out.pop()
        else out.push(part)
    }
    return "/" + out.join("/")
}

/**
 * Builds a game.
 *
 * `esbuild` is an initialised esbuild module (wasm or native). `files` is the
 * tree as `{ name, text }` pairs, names relative to the game root with forward
 * slashes; `entry` names the file to start from. Resolves to `{ code,
 * warnings }` and rejects with esbuild's own error, whose `errors[]` carry
 * `text` and a `location` with `file`, `line` and `column`.
 */
export async function buildGame(esbuild, files, entry, options = {}) {
    const externals = options.externals ?? EXTERNALS
    /**
     * What to hand esbuild as `absWorkingDir`. Never used to reach a real file:
     * the tree is virtual and rooted at "/", so this only has to satisfy
     * esbuild's insistence that the value be absolute.
     *
     * Which values are absolute depends on the esbuild that was handed in, not
     * on the host OS. esbuild-wasm is compiled for js/wasm and judges paths as
     * POSIX, so it takes "/" and REFUSES "C:\" even on Windows; the native
     * binary on Windows does the exact opposite. Since the caller is the one
     * that chose the esbuild, the caller states this, and the default suits
     * every wasm caller (the Worker, the spike) by construction.
     */
    const workingDir = options.workingDir ?? "/"

    const tree = {}
    for (const file of files) tree["/" + file.name] = file.text
    if (!(("/" + entry) in tree)) throw new Error(`the entry ${entry} is not in the tree`)

    /*
     * The carts this one uses, fetched by the caller: `uses` maps each address
     * in its oj.json to a key, and `carts` holds each key's files, its
     * `exports` file and its own `uses`. Every used cart's files join the tree
     * under its key. A cart's own names can never start with "@" (the site's
     * name rule), so nothing collides, and the same key used twice is one
     * folder, so identical versions share one copy.
     */
    const carts = options.carts ?? { uses: {}, carts: {} }
    for (const [key, cart] of Object.entries(carts.carts)) {
        for (const file of cart.files) tree[`/${key}/${file.name}`] = file.text
    }
    /** The used cart a path in the tree belongs to, or null for the cart being built. */
    const cartOf = (p) => {
        const parts = toPosix(p).split("/")
        const key = parts[1]?.startsWith("@") ? `${parts[1]}/${parts[2]}` : null
        return key !== null && key in carts.carts ? key : null
    }

    /**
     * Finds a file in the tree given a path a consumer built for us.
     *
     * An exact hit first, then the LONGEST matching suffix, because a consumer
     * may join our path onto a working directory we do not control. Tailwind's
     * scanner joins every content path onto `process.cwd()`, which inside a
     * Worker is not "/", so our "/ui/Panel.tsx" arrives here as something like
     * "/somewhere/ui/Panel.tsx".
     *
     * The fallback used to be the BASENAME alone, which rescued a file at the
     * root and could never rescue one in a folder: a Tailwind class used in
     * ui/Panel.tsx generated no rule, and the element rendered unstyled with
     * nothing to read. Found by building one game with a class in the root
     * and one with the same class a directory down.
     */
    const keyInTree = (p) => {
        const key = normalize(toPosix(p))
        if (key in tree) return key
        const parts = key.split("/").filter((part) => part !== "")
        for (let i = 0; i < parts.length; i++) {
            const suffix = "/" + parts.slice(i).join("/")
            if (suffix in tree) return suffix
        }
        return undefined
    }
    const fromTree = (p) => {
        const key = keyInTree(p)
        return key === undefined ? undefined : tree[key]
    }
    const listing = () => Object.keys(tree).map((name) => ({
        name: name.slice(1), isDirectory: () => false, isFile: () => true,
    }))

    // The uss-modules and tailwind plugins read files through this seam rather
    // than node:fs, which is what lets them run with no disk at all.
    setFsProvider({
        existsSync: (p) => fromTree(p) !== undefined,
        statSync: (p) => ({ isDirectory: () => false, isFile: () => fromTree(p) !== undefined }),
        mkdirSync: () => {},
        writeFileSync: () => {},
        readdirSync: listing,
        promises: {
            readFile: async (p) => {
                const text = fromTree(p)
                if (text === undefined) throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" })
                return text
            },
            writeFile: async () => {},
            readdir: async () => listing(),
        },
    })

    const resolver = {
        name: "game-tree",
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                // The scoped oj's own import of the real one.
                if (args.namespace === "cart-oj") return { path: args.path, namespace: "ext" }
                // A whole cart's stand-in importing its entry.
                if (args.namespace === "cart-whole") {
                    const entryPath = normalize(args.path)
                    return entryPath in tree ? { path: entryPath, namespace: "src" } : { errors: [{ text: `${cartLabel(args.importer)} has no ${entryPath.slice(args.importer.length + 2)}` }] }
                }
                const owner = args.namespace === "src" ? cartOf(args.importer) : null
                if (args.path === "oj" && owner !== null) return { path: owner, namespace: "cart-oj" }
                if (externals.includes(args.path)) return { path: args.path, namespace: "ext" }
                const wanted = CART_IMPORT.exec(args.path)
                if (wanted !== null) {
                    const address = wanted[1].toLowerCase()
                    const key = (owner === null ? carts.uses : carts.carts[owner].uses)[address]
                    if (key === undefined) {
                        const skipped = (owner === null ? carts.skipped : carts.carts[owner].skipped)?.[address]
                        return { errors: [{ text: skipped !== undefined && owner === null ? skipped : owner === null
                            ? `${address} is not in this cart's oj.json dependencies. Add it with: ${ANYWHERE} add ${address}`
                            : `${cartLabel(owner)} imports ${address}, which its oj.json does not list. Its author has to add it; or pin a different version of ${owner.slice(0, owner.lastIndexOf("@"))}.` }] }
                    }
                    const cart = carts.carts[key]
                    if (cart === undefined) return { errors: [{ text: `${cartLabel(key)} was not fetched for this build.` }] }
                    const inside = wanted[2] ?? cart.exports
                    // A whole cart, one with no `exports`: `import "@x/y"`
                    // runs its entry, which mounts it (Tachi, 1 Oct: adding
                    // a sample and seeing it run is the first thing a new
                    // user tries). A named import from it is refused below,
                    // in finishErrors, naming the bare import.
                    if (typeof inside !== "string" || inside === "") return { path: key, namespace: "cart-whole" }
                    const resolved = normalize(`/${key}/${inside}`)
                    for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`]) {
                        if (candidate in tree && candidate.startsWith(`/${key}/`)) return { path: candidate, namespace: "src" }
                    }
                    return { errors: [{ text: `${cartLabel(key)} has no ${inside}` }] }
                }
                // Only relative imports resolve. A bare specifier is a package
                // the platform does not provide, and saying so beats a build
                // that silently omits it.
                if (!args.path.startsWith(".")) {
                    return { errors: [{ text: `"${args.path}" is not available here. A game may import only its own files, plus ${externals.filter((e) => !e.includes("/")).join(", ")}.` }] }
                }
                // The base arrives however esbuild chose to express it. With a
                // non-"/" absWorkingDir it rejoins our virtual resolveDir onto
                // that directory, so on Windows this is "C:\" and the importer
                // is "C:\index.tsx". keyInTree strips whatever prefix it added,
                // the same way fromTree already does for Tailwind's cwd join.
                const base = args.resolveDir === "" ? dirname(toPosix(args.importer)) : toPosix(args.resolveDir)
                const resolved = normalize(`${base}/${args.path}`)
                // A relative import stays inside the cart it is written in: a
                // used cart cannot reach the using cart's files or another
                // cart's, and the using cart cannot reach into a used one
                // except by its address.
                const inCart = (key) => owner === null ? !key.startsWith("/@") : key.startsWith(`/${owner}/`)
                for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`]) {
                    const key = keyInTree(candidate)
                    if (key !== undefined && inCart(key)) return { path: key, namespace: "src" }
                }
                return { errors: [{ text: `cannot resolve ${args.path}` }] }
            })

            // A whole cart: its entry, run for what it does, exporting nothing.
            build.onLoad({ filter: /.*/, namespace: "cart-whole" }, (args) => ({
                // `export {}` makes it an ES module that exports nothing, so a
                // named import from it is an error rather than an undefined.
                contents: `import ${JSON.stringify(`/${args.path}/${carts.carts[args.path].entry ?? "index.tsx"}`)}\nexport {}`,
                loader: "js",
                resolveDir: "/",
            }))

            build.onLoad({ filter: /.*/, namespace: "cart-oj" }, (args) => ({
                contents: scopedOj(args.path),
                loader: "js",
                resolveDir: "/",
            }))

            // Not esbuild's `external`: its IIFE output turns that into an
            // internal __require that throws. A tiny CommonJS shim reading the
            // injected __ojExternals lets esbuild's interop serve whatever
            // named imports the game happens to use.
            build.onLoad({ filter: /.*/, namespace: "ext" }, (args) => ({
                contents: `module.exports = __ojExternals[${JSON.stringify(args.path)}]`,
                loader: "js",
            }))

            build.onLoad({ filter: /.*/, namespace: "src" }, (args) => ({
                contents: tree[args.path],
                loader: args.path.endsWith(".tsx") ? "tsx"
                    : args.path.endsWith(".ts") ? "ts"
                    : args.path.endsWith(".jsx") ? "jsx" : "js",
                resolveDir: dirname(args.path),
            }))
        },
    }

    /**
     * The shader manifest, if the game has any `.sl` files.
     *
     * Handed back rather than written: there is no disk here, and what it is
     * for is the eject, which happens somewhere else entirely. A game with no
     * `.sl` file gets an empty one, and the eject leaves it out.
     */
    let slManifest = null

    const result = await esbuild.build({
        stdin: { contents: tree["/" + entry], resolveDir: "/", sourcefile: entry, loader: "tsx" },
        bundle: true,
        write: false,
        // IIFE with a global name is what lets JSRunner find onPlay and onStop.
        format: "iife",
        globalName: "__exports",
        jsx: "automatic",
        absWorkingDir: workingDir,
        minify: true,
        target: "es2022",
        // Errors are returned, not printed: each caller reports them in its
        // own voice (a 422 body, a remote: line, a terminal).
        logLevel: "silent",
        plugins: [
            // EVERY file, not just the entry. Tailwind generates a rule only
            // for a class it has seen, and scanning the entry alone meant a
            // class used in ui/Panel.tsx generated nothing: the bundle carried
            // the className and the stylesheet had no such rule.
            tailwindPlugin({ content: Object.keys(tree) }),
            ussModulesPlugin({ generateTypes: false }),
            // Before the resolver, whose filter matches everything: esbuild
            // takes the first plugin that claims a path, and a `.sl` file has
            // to reach the loader rather than the tree.
            slPlugin({
                generateTypes: false,
                compiler: options.slCompiler ?? null,
                onManifest: (m) => { slManifest = m },
            }),
            resolver,
        ],
    }).catch((error) => { throw finishErrors(error) })

    return {
        code: result.outputFiles[0].text,
        slManifest,
        warnings: result.warnings.map((w) => w.text),
    }
}

/**
 * esbuild's own words where a cart's would say more. A named import from a
 * whole cart (one with no `exports`) reaches esbuild as "No matching export
 * in "cart-whole:@x/y@1.0.0" for import "Hud"", which names a namespace
 * nobody wrote; this says what to write instead.
 */
function finishErrors(error) {
    for (const e of Array.isArray(error?.errors) ? error.errors : []) {
        const whole = /^No matching export in "cart-whole:(@[^"]+)" for import "([^"]+)"$/.exec(e.text ?? "")
        if (whole === null) continue
        const address = whole[1].slice(0, whole[1].lastIndexOf("@"))
        e.text = `${cartLabel(whole[1])} is a whole cart: it exports nothing, so ${whole[2]} cannot come from it. import "${address}" runs it.`
    }
    return error
}

/**
 * esbuild's failure as lines a person or an agent can act on, one per error:
 * `file:line:column: text`, the shape compilers print and editors parse.
 */
export function formatBuildErrors(error) {
    const errors = Array.isArray(error?.errors) && error.errors.length > 0
        ? error.errors
        : [{ text: error?.message ?? String(error) }]
    return errors.map((e) => {
        const at = e.location
        const where = at ? `${at.file}:${at.line}:${at.column + 1}: ` : ""
        return `${where}${e.text}`
    })
}
