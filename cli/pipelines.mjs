/**
 * A game's pipeline set, from a run on this machine's GPU to the site.
 *
 * From runtime 1.8 the container compiles the pipelines a game is about to draw
 * before it starts, which is what keeps a player's first visit from freezing
 * while the browser compiles them one at a time. The game's own are in a set
 * the site serves from the game's origin, recorded where the game already runs
 * on its author's GPU: the site's editor, and here (PlaySite/docs/proposals/
 * pipeline-sets.md). Nothing here is a command or a file in the game's folder,
 * and nothing is printed: a set that never reaches the site leaves the game
 * loading as it would without one.
 *
 * `ojplay run` and `ojplay test --gpu` keep the set a run recorded, under
 * OJ_HOME, tagged with the commit the folder was at, and only when the folder
 * was that commit (no uncommitted change), since the site serves a set only for
 * the source it was recorded from. `ojplay push` sends the one for the commit it
 * pushed. The next run here is served the newest kept set, as the site would.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { home } from "./local.mjs"
import { readFromSite, tipOf, uncommitted } from "./site.mjs"

const KEY = /^[0-9a-f]{32}$/
const SHA = /^[0-9a-f]{40}$/
/** Sets kept per game folder; one per commit run, so a handful covers what push could still want. */
const KEEP = 12

/** Where this machine keeps the sets recorded from the game in `root`. */
export function setsDir(root) {
    return path.join(home(), "pipelines", crypto.createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 16))
}

/** The commit the folder is exactly, or null: changes outside `.oj/`, which is ojplay's own, mean it is not one. */
export function cleanCommit(root) {
    const tip = tipOf(root)
    if (tip === null || !SHA.test(tip)) return null
    return uncommitted(root).some((p) => !p.startsWith(".oj/")) ? null : tip
}

/** Keeps `set` as the one recorded at `commit`. Ignores anything not shaped like a set. */
export function keepSet(root, set, commit) {
    if (!set || !KEY.test(String(set.key)) || !Array.isArray(set.pipes) || set.pipes.length === 0 || !SHA.test(String(commit))) return null
    const dir = setsDir(root)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${commit}.${set.key}.json.gz`)
    fs.writeFileSync(file + ".part", zlib.gzipSync(JSON.stringify(set), { level: 9 }))
    fs.renameSync(file + ".part", file)
    const kept = fs.readdirSync(dir).filter((f) => f.endsWith(".json.gz")).map((f) => path.join(dir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    for (const old of kept.slice(KEEP)) fs.rmSync(old, { force: true })
    return file
}

/** The newest kept set for container `key`, gzipped, or null: what this machine's server answers at /pipelines/. */
export function newestSet(root, key) {
    const dir = setsDir(root)
    if (!KEY.test(key) || !fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(`.${key}.json.gz`)).map((f) => path.join(dir, f))
    if (files.length === 0) return null
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    return fs.readFileSync(files[0])
}

/** The kept sets recorded at `commit`, parsed. */
export function setsAt(root, commit) {
    const dir = setsDir(root)
    if (!SHA.test(String(commit)) || !fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((f) => f.startsWith(`${commit}.`) && f.endsWith(".json.gz"))
        .map((f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8")))
}

/**
 * Reads the set the running page recorded and keeps it, before the browser
 * goes. Quiet and bounded: a page that is gone, or a container with no
 * recorder, keeps nothing.
 */
export async function keepRecorded(game, { waitMs = 3000 } = {}) {
    if (!game?.server?.record) return null
    const commit = cleanCommit(game.root)
    if (commit === null) return null
    try {
        const said = await Promise.race([
            game.browser.eval("globalThis.__ojLocal && globalThis.__ojLocal.pipelines ? globalThis.__ojLocal.pipelines() : 'null'"),
            new Promise((resolve) => setTimeout(() => resolve("null"), waitMs)),
        ])
        return keepSet(game.root, JSON.parse(typeof said === "string" ? said : "null"), commit)
    } catch {
        return null
    }
}

/**
 * Sends the sets kept for the commit just pushed. Quiet: the push has already
 * said what it did, and a set that does not arrive costs nothing but its use.
 * Resolves to how many arrived.
 */
export async function sendSets({ root, site, sid, bearer, commit }) {
    let sent = 0
    for (const set of setsAt(root, commit)) {
        try {
            const response = await readFromSite(`${site}/api/games/${sid}/pipelines/${set.key}`, {
                method: "PUT",
                headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
                body: JSON.stringify({ commit, set }),
            })
            if (response.ok) sent++
        } catch {
            // Offline, or the site is older than sets: the next push sends it.
        }
    }
    return sent
}
