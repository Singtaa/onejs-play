/**
 * `ojplay build --unity`: a cart at a Unity project's root, built for OneJS.
 *
 * The contract is Specs/ROOT_CARTS.md §5.4a in the OneJS container, and OneJS
 * cart runners build against exactly it, so a change here is a change there
 * first:
 *
 *   `ojplay build --unity --out <dir> [--watch] [--production]`, run in the
 *   cart's folder, writes four files into <dir>: app.js.map.txt, app.sl.json
 *   and files.json, then app.js.txt last, through a temporary file and a
 *   rename, so a change to app.js.txt's time means the rest are from the same
 *   build. Exit 0 built, 1 the build failed, 2 usage. One stdout line per
 *   successful write: `[ojplay] built <dir>/app.js.txt`.
 *
 * The cart builds as the site builds it, with its own files and nothing
 * written inside it: the same import rule (its own files, the carts its
 * oj.json pins, and oj, react and onejs-ui), the used carts resolved and
 * scoped by cartsPlugin as in a OneJS app, and onejs-unity's Tailwind, USS
 * module and shader plugins with no declarations written beside the sources.
 * What differs is that oj, React and onejs-ui are bundled from the cart's
 * node_modules (ojplay init installs them), since a Unity project has no
 * container to provide them, and that a prologue tells oj and the loaders
 * where the cart's files are before the cart runs:
 *
 *   in the editor, the cart's own folder, with a used cart's files under
 *   .oj/carts, where ojplay add put them;
 *   in a player (--production), StreamingAssets/onejs/carts/<folder>, where
 *   the build copies what files.json lists.
 *
 * Compiled in rather than read from a global, because on WebGL every runner's
 * bundle shares one realm and a global would be the last runner's.
 */
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { setFsProvider, slPlugin, tailwindPlugin, ussModulesPlugin } from "onejs-unity/esbuild"
import { EXTERNALS, formatBuildErrors, notAvailable } from "../build/game.mjs"
import { BIN } from "../build/command.mjs"
import { entryOf, manifestOf, readTree, readUsedCarts } from "./game.mjs"
import { cartsPlugin, servable } from "./unity-carts.mjs"
import { cartAssets } from "./unity-assets.mjs"

/** The four files the build writes, by the names OneJS reads. */
export const OUTPUT = { bundle: "app.js.txt", map: "app.js.map.txt", shaders: "app.sl.json", files: "files.json" }

/** Where a player keeps every root cart's files, under StreamingAssets. */
export const PLAYER_CARTS = "onejs/carts"

/** Where, in a cart's folder, ojplay add keeps the carts it uses. */
const USED_CARTS = ".oj/carts"

/** files.json's version: OneJS refuses one it does not know. */
export const FILES_VERSION = 1

/** The prologue's module name, claimed by the plugin that writes it. */
const PROLOGUE = "ojplay-unity:prologue"

/** The manifest of a build with no shader programs, as slPlugin writes it. */
const NO_PROGRAMS = { version: 1, programs: [] }

/** A refusal that is the caller's to fix, not the cart's: exit 2. */
export class UsageError extends Error {}

/** `@handle/name` and an optional path inside it: a used cart, cartsPlugin's to resolve. */
const CART_IMPORT = /^@[A-Za-z0-9-]+\/[A-Za-z0-9-]+(?:\/.+)?$/

/** The folder Node would load `name` from for the cart at `root`, or null. */
function packageDir(root, name) {
    const require = createRequire(path.join(root, "package.json"))
    for (const dir of require.resolve.paths(name) ?? []) {
        const candidate = path.join(dir, name)
        if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
    }
    return null
}

/**
 * React and oj, each pinned to one copy, as onejs-unity's preset pins them
 * for a OneJS app. oj is the cart's own ojplay when it has one installed, else
 * this one's, which is the same copy whenever npm runs the cart's.
 */
function aliases(root) {
    const out = {}
    const react = packageDir(root, "react")
    if (react !== null) {
        out["react"] = react
        out["react/jsx-runtime"] = path.join(react, "jsx-runtime")
        out["react/jsx-dev-runtime"] = path.join(react, "jsx-dev-runtime")
    }
    out["oj"] = path.join(ojplayDir(root), "src", "index.ts")
    return out
}

function ojplayDir(root) {
    return packageDir(root, "ojplay") ?? path.join(import.meta.dirname, "..")
}

/**
 * Where a player copies this cart's files, under StreamingAssets: the folder's
 * own name, unencoded, since OneJS copies to a path and the prologue encodes
 * it only where StreamingAssets is a URL.
 */
export function playerBase(root) {
    return `${PLAYER_CARTS}/${path.basename(root)}`
}

/**
 * The prologue: oj's asset base, and onejs-unity's and onejs-react's, set
 * before the cart's entry runs. A loader package older than the base is left
 * on its own convention rather than failing the build.
 */
export function prologue(root, { production }) {
    const assetModule = path.join(ojplayDir(root), "src", "asset.ts").split(path.sep).join("/")
    const base = production
        ? `(() => {
    const streaming = globalThis.CS.UnityEngine.Application.streamingAssetsPath
    const parts = ${JSON.stringify(playerBase(root).split("/"))}
    return streaming.includes("://") ? streaming + "/" + parts.map(encodeURIComponent).join("/") : streaming + "/" + parts.join("/")
})()`
        : JSON.stringify(root)
    const options = JSON.stringify(production ? {} : { usedCarts: USED_CARTS })
    return `import { setAssetBase } from ${JSON.stringify(assetModule)}
import * as unityAssets from "onejs-unity/assets"
import * as react from "onejs-react"
const base = ${base}
setAssetBase(base, ${options})
if (typeof unityAssets["setAssetBase"] === "function") unityAssets["setAssetBase"](base, ${options})
if (typeof react["setImageBase"] === "function") react["setImageBase"](base, ${options})
`
}

/**
 * What a player copies: each of the cart's files the site would serve, and
 * each used cart's, from where it sits in the cart's folder to where the
 * player's asset base reads it (Specs/ROOT_CARTS.md §5.4a).
 */
export function filesManifest(root, usedKeys) {
    const files = cartAssets(root).map((name) => ({ from: name, to: name }))
    for (const key of usedKeys) {
        const dir = path.join(root, USED_CARTS, ...key.split("/"))
        if (!fs.existsSync(dir)) continue
        for (const name of servable(dir).sort()) files.push({ from: `${USED_CARTS}/${key}/${name}`, to: `${key}/${name}` })
    }
    return { version: FILES_VERSION, base: playerBase(root), files }
}

/**
 * The site's import rule, for the cart's own files and its used carts': a
 * bare import is oj, react or onejs-ui, or a used cart's address, and
 * anything else is refused in the site's words. The packages those import
 * from node_modules resolve as any package does.
 */
function siteImportRule(root) {
    const inside = (file) => {
        const rel = path.relative(root, file)
        return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.split(path.sep).includes("node_modules")
    }
    return {
        name: "ojplay-unity-imports",
        setup(build) {
            build.onResolve({ filter: /^[^./]/ }, (args) => {
                if (args.namespace !== "file" || !inside(args.importer)) return undefined
                if (EXTERNALS.includes(args.path) || CART_IMPORT.test(args.path)) return undefined
                return { errors: [{ text: notAvailable(args.path) }] }
            })
        },
    }
}

/** The prologue, as a module only this build can name. */
function prologuePlugin(root, production) {
    return {
        name: "ojplay-unity-prologue",
        setup(build) {
            build.onResolve({ filter: new RegExp(`^${PROLOGUE}$`) }, () => ({ path: PROLOGUE, namespace: "ojplay-unity" }))
            build.onLoad({ filter: /.*/, namespace: "ojplay-unity" }, () => ({ contents: prologue(root, { production }), loader: "js", resolveDir: root }))
        },
    }
}

/** A source map's sources as the cart's own paths, forward slashed, rather than relative to <dir>. */
function cartSources(text, root, out) {
    const map = JSON.parse(text)
    map.sources = map.sources.map((s) => (s.includes(":") && !/^[A-Za-z]:/.test(s) ? s : path.relative(root, path.resolve(out, s)).split(path.sep).join("/")))
    return JSON.stringify(map)
}

/** Writes `text` to `file` through a sibling temporary file and a rename, so a reader never sees half of it. */
function writeWhole(file, text) {
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, text)
    fs.renameSync(temporary, file)
}

/**
 * The esbuild options for the cart at `root`, writing into `out`. `report`
 * hears each build's outcome: `{ ok: true, bundle }` or `{ ok: false, lines }`.
 */
export function unityBuildOptions(root, out, { production = false, report = () => {} } = {}) {
    const files = readTree(root)
    const manifest = manifestOf(files)
    const entry = entryOf(files, manifest)
    let shaders = NO_PROGRAMS

    const writer = {
        name: "ojplay-unity-output",
        setup(build) {
            build.onEnd((result) => {
                if (result.errors.length > 0) {
                    report({ ok: false, lines: formatBuildErrors({ errors: result.errors }) })
                    return
                }
                const code = result.outputFiles.find((f) => !f.path.endsWith(".map"))
                const map = result.outputFiles.find((f) => f.path.endsWith(".map"))
                let used
                try {
                    used = Object.keys(readUsedCarts(root, manifestOf(readTree(root))).carts)
                } catch (error) {
                    report({ ok: false, lines: [`[${BIN}] ${error.message}`] })
                    return
                }
                fs.mkdirSync(out, { recursive: true })
                if (map !== undefined) fs.writeFileSync(path.join(out, OUTPUT.map), cartSources(map.text, root, out))
                fs.writeFileSync(path.join(out, OUTPUT.shaders), JSON.stringify(shaders, null, 1))
                fs.writeFileSync(path.join(out, OUTPUT.files), JSON.stringify(filesManifest(root, used), null, 4) + "\n")
                const bundle = path.join(out, OUTPUT.bundle)
                writeWhole(bundle, code.text)
                report({ ok: true, bundle })
            })
        },
    }

    return {
        absWorkingDir: root,
        stdin: {
            // The prologue first: an ES module's imports run in order, so oj
            // knows where the cart's files are before the cart asks for one.
            contents: `import ${JSON.stringify(PROLOGUE)}\nexport * from ${JSON.stringify("./" + entry)}\n`,
            resolveDir: root,
            sourcefile: "ojplay-unity-entry.js",
            loader: "js",
        },
        bundle: true,
        write: false,
        outfile: path.join(out, OUTPUT.bundle),
        // An IIFE, because QuickJS evaluates the bundle as a script. Exports
        // land on __exports, where JSRunner finds onPlay and onStop.
        format: "iife",
        globalName: "__exports",
        target: "es2022",
        jsx: "automatic",
        resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
        loader: { ".uss": "text" },
        sourcemap: "external",
        sourcesContent: true,
        minify: production,
        alias: aliases(root),
        define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
        logLevel: "silent",
        plugins: [
            // onejs-unity's plugins read through one process-wide seam, which
            // the site's builder points at its in-memory tree for each build
            // it runs. This build reads the disk, so it says so every time.
            { name: "ojplay-unity-disk", setup(build) { build.onStart(() => { setFsProvider(fs) }) } },
            cartsPlugin({ copyAssets: false }),
            prologuePlugin(root, production),
            tailwindPlugin({ content: ["./**/*.{tsx,ts,jsx,js}", `./${USED_CARTS}/**/*.{tsx,ts,jsx,js}`] }),
            ussModulesPlugin({ generateTypes: false }),
            slPlugin({ generateTypes: false, manifest: null, onManifest: (m) => { shaders = m } }),
            siteImportRule(root),
            // Last, so the shader manifest above is in hand when it writes.
            writer,
        ],
    }
}

/**
 * The command. Answers the exit code; with `watch` it answers only if the
 * first build cannot start, and otherwise keeps rebuilding until the process
 * ends. `say` takes stdout lines, `complain` stderr ones.
 */
export async function buildUnity(root, { out, production = false, watch = false, say = (l) => console.log(l), complain = (l) => console.error(l) } = {}) {
    if (typeof out !== "string" || out === "") throw new UsageError(`build --unity needs --out <folder>, where the four files go.`)
    root = fs.realpathSync(path.resolve(root))
    out = path.resolve(out)
    if (!fs.existsSync(path.join(root, "oj.json"))) {
        throw new UsageError(`No cart here: ${root} has no oj.json. Run build --unity in a cart's folder.`)
    }
    let options
    let built = false
    try {
        options = unityBuildOptions(root, out, {
            production,
            report: (r) => {
                built = r.ok
                if (r.ok) say(`[${BIN}] built ${r.bundle.split(path.sep).join("/")}`)
                else for (const line of r.lines) complain(line)
            },
        })
    } catch (error) {
        throw new UsageError(error.message)
    }
    // The shader and USS plugins name files relative to the process's folder,
    // and the Tailwind scan reads from it.
    process.chdir(root)
    const esbuild = await import("esbuild")
    // Tailwind announces every generation on stdout, where OneJS reads only
    // the built line: kept off it, as ojplay build keeps it off.
    const log = console.log
    console.log = (...args) => { if (!String(args[0]).startsWith("[tailwind-uss]")) log(...args) }
    if (watch) {
        const context = await esbuild.context(options)
        await context.watch()
        return new Promise(() => {})
    }
    try {
        await esbuild.build(options)
        return built ? 0 : 1
    } catch (error) {
        // A build that failed has printed its errors, each as file:line:column,
        // from the writer. One that never started (a bad option) has not.
        if (!Array.isArray(error?.errors) || error.errors.length === 0) complain(formatBuildErrors(error).join("\n"))
        return 1
    } finally {
        console.log = log
    }
}
