/**
 * A game folder as the site sees it: the source tree, the manifest, the entry,
 * and a build of it with the same builder the site runs on publish.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { buildGame, formatBuildErrors } from "../build/game.mjs"

/**
 * What the site builds. The same set as ALLOWED in the site's limits.
 *
 * Two copies, because a published npm package cannot import the Worker's
 * source. PlaySite's own test imports THIS one and compares, so the drift is
 * caught where both are reachable rather than by a game that builds from a
 * clone and is refused on publish.
 */
export const SOURCE = /\.(tsx?|jsx?|json|uss|css|sl|txt|md|svg|html)$/i

/** The file a game builds from when its manifest does not say. */
const INDEX = /^index\.(tsx?|jsx?)$/i

/**
 * Reads the tree the site would build: every source file under the root,
 * names relative with forward slashes. Dot-led entries are skipped because
 * the site's name rule refuses them anyway, and it keeps a local `.oj/`
 * output folder and `.git` out of the upload; node_modules is refused by
 * the site outright.
 */
export function readTree(root) {
    const files = []
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue
            const rel = prefix + entry.name
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + "/")
            else if (entry.isFile() && SOURCE.test(entry.name)) {
                files.push({ name: rel, text: fs.readFileSync(path.join(dir, entry.name), "utf8") })
            }
        }
    }
    walk(root, "")
    return files
}

export function manifestOf(files) {
    const file = files.find((f) => f.name.toLowerCase() === "oj.json")
    if (file === undefined) return {}
    try {
        const parsed = JSON.parse(file.text)
        return typeof parsed === "object" && parsed !== null ? parsed : {}
    } catch (error) {
        throw new Error(`oj.json is not valid JSON: ${error.message}`, { cause: error })
    }
}

/** The file to build from: the manifest's `entry`, else the index. Refuses a manifest that names a missing file, as the site does. */
export function entryOf(files, manifest) {
    const declared = manifest.entry
    if (typeof declared === "string" && declared !== "") {
        if (!files.some((f) => f.name === declared)) throw new Error(`oj.json names entry ${declared}, which is not in the tree`)
        return declared
    }
    const index = files.find((f) => INDEX.test(f.name))
    if (index === undefined) throw new Error("A game needs an index.tsx (or index.ts / index.js) to start from, or an entry in oj.json.")
    return index.name
}

/** The stage the container is told about, in the shape the sandbox document sends. */
export function stageOf(manifest) {
    const stage = manifest.stage ?? {}
    const size = Array.isArray(stage.size) && stage.size.length === 2 ? stage.size : [600, 600]
    return { size, fit: typeof stage.fit === "string" ? stage.fit : "letterbox" }
}

/**
 * esbuild, resolved from the game's own node_modules (it is a peer of this
 * package, so a game that runs `oj build` has it beside onejs-play), and
 * failing with a sentence rather than a module-not-found stack.
 */
async function loadEsbuild() {
    try {
        return await import("esbuild")
    } catch (error) {
        throw new Error("esbuild is not installed. Add it to devDependencies (npm install -D esbuild) to build locally.", { cause: error })
    }
}

/**
 * Builds the game at `root`. Resolves to `{ code, warnings, entry, files }`;
 * rejects with an Error whose `lines` are `file:line:column: text`.
 */
export async function build(root, options = {}) {
    const files = readTree(root)
    const manifest = manifestOf(files)
    const entry = options.entry ?? entryOf(files, manifest)
    const esbuild = await loadEsbuild()
    // The tailwind plugin announces every generation on stdout. That is a
    // line per build in a watch loop, saying nothing a person acts on, and
    // the plugin ships from onejs-unity without a switch for it.
    const log = console.log
    console.log = (...args) => { if (!String(args[0]).startsWith("[tailwind-uss]")) log(...args) }
    try {
        // The native binary judges absWorkingDir by the host's rules, so "/"
        // (which the wasm build and every POSIX host accept, and which is what
        // buildGame defaults to) is refused on Windows and the build dies
        // before a plugin runs. The tree is virtual, so any absolute path will
        // do: the filesystem root is absolute everywhere Node runs.
        const result = await buildGame(esbuild, files, entry, {
            workingDir: path.parse(process.cwd()).root || "/",
        })
        return { ...result, entry, files, manifest }
    } catch (error) {
        const lines = formatBuildErrors(error)
        throw Object.assign(new Error(lines.join("\n"), { cause: error }), { lines })
    } finally {
        console.log = log
    }
}

/** `tsc --noEmit` from the game's own install, with its output passed through. Returns the exit code. */
export function typecheck(root) {
    const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc")
    if (!fs.existsSync(bin)) {
        throw new Error("typescript is not installed here. Run npm install first.")
    }
    const result = spawnSync(bin, ["--noEmit"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
    return result.status ?? 1
}
