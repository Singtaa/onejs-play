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

/**
 * The token: the one in the clone URL (`https://oj:<token>@`), which is how a
 * sketch is handed to an agent, else OJ_TOKEN. Null when neither has one.
 *
 * The URL's comes first because git pushes with it whatever else is set, so
 * status and push then ask as the same caller. It is only used when the
 * remote is the site oj is talking to, so OJ_SITE pointed somewhere else never
 * carries it there.
 */
export function tokenOf(root) {
    return (root === undefined ? null : tokenFromRemote(remoteOf(root))) ?? (process.env.OJ_TOKEN || null)
}

/** tokenOf, or a throw with the fix. */
export function token(root) {
    const value = tokenOf(root)
    if (!value) {
        throw new Error("Set OJ_TOKEN to an access token from " + siteOrigin() + "/manage/tokens, or clone with the token in the URL.")
    }
    return value
}

/** The password in a clone URL of this site, or null. */
export function tokenFromRemote(url) {
    let parsed
    try {
        parsed = new URL(url ?? "")
    } catch {
        return null
    }
    if (parsed.origin !== siteOrigin() || parsed.password === "") return null
    return decodeURIComponent(parsed.password)
}

/** The sid in a clone URL, or null. */
export function sidFromRemote(url) {
    const match = /\/g\/([a-z0-9]{12})\.git\/?$/.exec(url ?? "")
    return match ? match[1] : null
}

/** This folder's origin remote, or "" when it has none. */
function remoteOf(root) {
    const result = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" })
    return (result.stdout ?? "").trim()
}

/** This folder's game, read from its origin remote. */
export function sidOf(root) {
    const sid = sidFromRemote(remoteOf(root))
    if (sid === null) {
        throw new Error("This folder is not a clone of a sketch on " + siteOrigin() + ". Pass --sid, or clone one first.")
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
 * The git options that supply the token through a one-shot credential helper.
 *
 * `-c credential.helper=...` APPENDS to the helpers git already has, and the
 * ones it already has run first: Git for Windows ships Git Credential Manager
 * in the system config, macOS ships osxkeychain. Found on Windows, where a
 * push printed "fatal: Cannot prompt because user interactivity has been
 * disabled" twice before ours was reached. An empty helper resets the list,
 * so it goes first. Measured with GIT_TRACE on `git credential fill`: without
 * the reset osxkeychain ran, with it only ours did.
 */
export function credentialArgs(bearer) {
    return ["-c", "credential.helper=", "-c", `credential.helper=!f() { echo username=oj; echo password=${bearer}; }; f`]
}

/**
 * Runs git with the token supplied through a one-shot credential helper, so
 * nothing is stored on disk and nothing prompts. Output passes through:
 * the `remote:` lines are where a push's build result arrives.
 */
export function git(args, { cwd, bearer } = {}) {
    const helper = bearer ? credentialArgs(bearer) : []
    const result = spawnSync("git", [...helper, ...args], { cwd, stdio: "inherit" })
    return result.status ?? 1
}

/** Where `oj new` clones to: the name as a folder, made safe. */
export function folderFor(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return path.resolve(slug === "" ? "game" : slug)
}
