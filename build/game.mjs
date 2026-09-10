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

/**
 * An absolute path to hand esbuild as its working directory.
 *
 * The tree is virtual and every path in it is POSIX and rooted at "/", so this
 * value is never used to reach a real file: it only has to satisfy esbuild's
 * insistence that the working directory be absolute. "/" satisfies it under
 * the wasm build a Worker uses and on POSIX Node, and fails on Windows Node,
 * where the native binary rejects it with `The working directory "/" is not an
 * absolute path` and the whole build dies before a plugin runs.
 *
 * Deliberately no `node:path`: this module is imported by the Worker, which
 * has no such builtin, which is also why it carries its own dirname/normalize.
 */
function esbuildWorkingDir() {
    const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/"
    const drive = /^([A-Za-z]:)[\\/]/.exec(cwd)
    return drive ? `${drive[1]}\\` : "/"
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
    const fromTree = (p) => {
        const key = normalize(p)
        if (key in tree) return tree[key]
        const parts = key.split("/").filter((part) => part !== "")
        for (let i = 0; i < parts.length; i++) {
            const suffix = "/" + parts.slice(i).join("/")
            if (suffix in tree) return tree[suffix]
        }
        return undefined
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
                const base = args.resolveDir === "" ? dirname(args.importer) : args.resolveDir
                const resolved = normalize(`${base}/${args.path}`)
                for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`]) {
                    if (candidate in tree) return { path: candidate, namespace: "src" }
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

    const result = await esbuild.build({
        stdin: { contents: tree["/" + entry], resolveDir: "/", sourcefile: entry, loader: "tsx" },
        bundle: true,
        write: false,
        // IIFE with a global name is what lets JSRunner find onPlay and onStop.
        format: "iife",
        globalName: "__exports",
        jsx: "automatic",
        absWorkingDir: esbuildWorkingDir(),
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
            resolver,
        ],
    })

    return {
        code: result.outputFiles[0].text,
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
