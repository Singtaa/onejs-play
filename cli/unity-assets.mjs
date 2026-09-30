/**
 * A cloned sketch's files, copied to where OneJS looks for them.
 *
 * The site keeps a sketch's files at their own names in the repository
 * (`glow.png`, `art/bg.png`), so that is where a clone puts them. OneJS reads a
 * JSRunner project's files from `<working dir>/assets/` in the editor, and a
 * player build copies that folder into StreamingAssets. So a clone in a Unity
 * project runs, but `assetUrl("glow.png")` finds nothing.
 *
 * `oj init --unity` puts `assetsPlugin()` in the build it writes, and the
 * plugin copies the files across at the start of every build: `npm run build`,
 * and each rebuild `npm run watch` makes on save. `assets/` is in the clone's
 * info/exclude, so git never sees the copies, and the site refuses a
 * top-level `assets` folder in a sketch, so no file of the sketch's can be in
 * the way.
 *
 * The files are chosen by the site's own rule (resolveAsset): what the site
 * would serve here is what reaches Unity. `.oj/`, the catalog's cover art, and
 * every other dot folder are left behind. A copy whose file has left the sketch is removed, but only one
 * this wrote: the names it wrote are kept in node_modules, so a file somebody
 * put in `assets/` by hand is never touched.
 */
import fs from "node:fs"
import path from "node:path"
import { RESERVED_ASSET_FOLDER, isAssetName, resolveAsset } from "./assets.mjs"

/** The names the last sync wrote, relative to the working directory. */
const RECORD = path.join("node_modules", ".cache", "onejs-play", "unity-assets.json")

/** The sketch's files the site would serve, by name, walked the way a push is. */
function sketchAssets(root) {
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
 * Brings `<root>/assets/` up to date with the sketch's files. Returns the names
 * copied and removed, both empty when nothing changed.
 */
export function syncAssets(root) {
    root = path.resolve(root)
    const into = path.join(root, RESERVED_ASSET_FOLDER)
    const names = sketchAssets(root)
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
 * The esbuild plugin `oj init --unity` adds to a clone's build. It syncs before
 * each build and says so only when something changed; a sync that fails fails
 * the build, since the sketch would otherwise run without its files.
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
                    return { errors: [{ text: `[oj] could not copy the sketch's files into assets/: ${e.message}` }] }
                }
            })
        },
    }
}
