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
                if (externals.includes(args.path)) return { path: args.path, namespace: "ext" }
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
                for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`]) {
                    const key = keyInTree(candidate)
                    if (key !== undefined) return { path: key, namespace: "src" }
                }
                return { errors: [{ text: `cannot resolve ${args.path}` }] }
            })

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
            tailwindPlugin({ content: files.map((f) => "/" + f.name) }),
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
    })

    return {
        code: result.outputFiles[0].text,
        slManifest,
        warnings: result.warnings.map((w) => w.text),
    }
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
