/**
 * The site, from a terminal: which game this folder is, what the site says
 * about it, creating one, and pushing with a token and no prompt.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"

export const DEFAULT_SITE = "https://play.onejs.com"

export function siteOrigin() {
    return (process.env.OJ_SITE ?? DEFAULT_SITE).replace(/\/$/, "")
}

/** The token, from OJ_TOKEN. Throws with the fix when absent. */
export function token() {
    const value = process.env.OJ_TOKEN
    if (!value) throw new Error("Set OJ_TOKEN to a personal access token from " + siteOrigin() + "/manage.")
    return value
}

/** The sid in a clone URL, or null. */
export function sidFromRemote(url) {
    const match = /\/g\/([a-z0-9]{12})\.git\/?$/.exec(url ?? "")
    return match ? match[1] : null
}

/** This folder's game, read from its origin remote. */
export function sidOf(root) {
    const result = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" })
    const sid = sidFromRemote((result.stdout ?? "").trim())
    if (sid === null) {
        throw new Error("This folder is not a clone of a game on " + siteOrigin() + ". Pass --sid, or clone one first.")
    }
    return sid
}

async function json(response) {
    const text = await response.text()
    try {
        return JSON.parse(text)
    } catch {
        throw new Error(`${response.status} from the site: ${text.slice(0, 200)}`)
    }
}

/** GET /api/games/<sid>: head, live, buildError and the rest. */
export async function status(sid, { bearer } = {}) {
    const headers = bearer ? { authorization: `Bearer ${bearer}` } : {}
    const response = await fetch(`${siteOrigin()}/api/games/${sid}`, { headers })
    const body = await json(response)
    if (!response.ok) throw new Error(body.error ?? `${response.status} from the site`)
    return body
}

/** GET /api/version: what the site runs, including the runtime pin. */
export async function version() {
    const response = await fetch(`${siteOrigin()}/api/version`)
    return json(response)
}

/** POST /api/games: a new game from the starter, answered with its sid and clone URL. */
export async function create(name, bearer) {
    const response = await fetch(`${siteOrigin()}/api/games`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ name }),
    })
    const body = await json(response)
    if (!response.ok) throw new Error(body.error ?? `${response.status} from the site`)
    return body
}

/**
 * Runs git with the token supplied through a one-shot credential helper, so
 * nothing is stored on disk and nothing prompts. Output passes through:
 * the `remote:` lines are where a push's build result arrives.
 */
export function git(args, { cwd, bearer } = {}) {
    const helper = bearer ? ["-c", `credential.helper=!f() { echo username=oj; echo password=${bearer}; }; f`] : []
    const result = spawnSync("git", [...helper, ...args], { cwd, stdio: "inherit" })
    return result.status ?? 1
}

/** Where `oj new` clones to: the name as a folder, made safe. */
export function folderFor(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return path.resolve(slug === "" ? "game" : slug)
}
