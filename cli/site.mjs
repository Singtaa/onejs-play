/**
 * The site, from a terminal: which game this folder is, what the site says
 * about it, creating one, and pushing with a token and no prompt.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { home } from "./local.mjs"
import { COMMAND } from "../build/command.mjs"

export const DEFAULT_SITE = "https://play.onejs.com"

export function siteOrigin() {
    return (process.env.OJ_SITE ?? DEFAULT_SITE).replace(/\/$/, "")
}

/** Where `ojplay login` keeps its token: home first, the cart's .oj/ when home cannot be written. */
export function tokenPaths(root) {
    return [path.join(home(), "token"), path.join(root, ".oj", "token")]
}

/** The token `ojplay login` stored, or null. */
export function storedToken(root = process.cwd()) {
    for (const file of tokenPaths(root)) {
        try {
            const text = fs.readFileSync(file, "utf8").trim()
            if (text !== "") return text
        } catch { /* not there */ }
    }
    return null
}

/** OJ_TOKEN when set, else what `ojplay login` stored, else null. */
export function tokenOf(root = process.cwd()) {
    return process.env.OJ_TOKEN || storedToken(root)
}

/** tokenOf, or a throw with the fix. */
export function token(root = process.cwd()) {
    const value = tokenOf(root)
    if (!value) throw new Error(`Not logged in. Run: ${COMMAND} login`)
    return value
}

/**
 * The account's own carts, private ones included: what "which carts do
 * I have" needs. The site's public list leaves out every private cart.
 */
export async function mine(bearer) {
    const response = await fetch(`${siteOrigin()}/api/me/carts`, { headers: { authorization: `Bearer ${bearer}` } })
    const body = await json(response)
    if (!response.ok) throw new Error(body.error ?? `${response.status} from the site`)
    return body
}

/** The sid in a clone URL, or null: /c/<sid>.git, or /g/<sid>.git from before 1 Oct 2026. */
export function sidFromRemote(url) {
    const match = /\/[cg]\/([a-z0-9]{12})\.git\/?$/.exec(url ?? "")
    return match ? match[1] : null
}

/** The @handle/name in a clone URL made from the address bar, lowercased, or null. */
export function addressFromRemote(url) {
    const match = /\/(@[A-Za-z0-9-]+\/[A-Za-z0-9-]+)\.git\/?$/.exec(url ?? "")
    return match ? match[1].toLowerCase() : null
}

/**
 * This folder's game, read from its origin remote. A /c/<sid>.git clone names
 * its sid; one made from the address bar names an address, which the account's
 * own list turns into a sid, so that form needs `bearer`.
 */
export async function sidOf(root, bearer) {
    const result = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" })
    const remote = (result.stdout ?? "").trim()
    const sid = sidFromRemote(remote)
    if (sid !== null) return sid
    const address = addressFromRemote(remote)
    if (address === null) {
        throw new Error("This folder is not a clone of a cart on " + siteOrigin() + ". Pass --sid, or clone one first.")
    }
    if (!bearer) throw new Error(`Finding which cart ${address} is needs a login. Run: ${COMMAND} login, or pass --sid.`)
    const { carts } = await mine(bearer)
    const found = carts.find((cart) => new URL(cart.url, siteOrigin()).pathname.toLowerCase() === "/" + address)
    if (!found) {
        throw new Error(`This account has no cart at ${address}. If it was renamed, ${COMMAND} list shows each cart's address and sid; pass --sid.`)
    }
    return found.sid
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

/** A status from the site as the lines `ojplay status` prints. */
export function describeStatus(s) {
    const short = (sha) => String(sha).slice(0, 7)
    const lines = [`${s.url} (${s.public ? "public" : "private"})`]
    if (!s.live) lines.push("live: nothing yet")
    else lines.push(s.head === s.live ? `live: ${short(s.live)}, the tip of main` : `live: ${short(s.live)}`)
    if (s.head && s.head !== s.live) {
        if (s.buildError) {
            lines.push(`tip of main: ${short(s.head)} did not build:`)
            for (const line of String(s.buildError).split("\n")) lines.push(`  ${line}`)
        } else {
            lines.push(`tip of main: ${short(s.head)} is still building`)
        }
    }
    return lines
}

/**
 * The changes in a clone that are not committed, as `git status --porcelain`
 * names them. Ignored files are not changes, so what `init` writes never
 * shows up here.
 */
export function uncommitted(root) {
    const result = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" })
    if (result.status !== 0) return []
    return result.stdout.split("\n").filter((line) => line !== "").map((line) => line.slice(3))
}

/**
 * What `ojplay push` says once git has pushed: `head` is the tip of main on
 * the site before the push, `s` the status after it, `left` what
 * uncommitted() found. Returns the lines and the exit code.
 *
 * `git push` with nothing new answers "Everything up-to-date" and exits 0,
 * so pushing edits nobody had committed looked like it worked while the
 * site went on serving the old commit (Ghost Hunt test, 5 Oct 2026).
 */
export function describePush(head, s, left) {
    const short = (sha) => String(sha).slice(0, 7)
    const shown = left.length > 8 ? [...left.slice(0, 8), `and ${left.length - 8} more`] : left
    const notCommitted = left.length === 0 ? [] : [
        `not committed, so not pushed: ${shown.join(", ")}`,
        `commit them, then push again: git add -A && git commit -m "<what changed>"`,
    ]
    if (s.head === head) {
        if (left.length > 0) return { lines: ["nothing was pushed", ...notCommitted], code: 1 }
        return { lines: [`nothing new to push; live: ${short(s.live)} at ${s.url}`], code: 0 }
    }
    if (s.buildError !== null && s.head !== s.live) {
        const running = s.live ? "still running " + short(s.live) : "nothing is running"
        return { lines: [`the tip did not build; ${running}`, ...String(s.buildError).split("\n"), ...notCommitted], code: 1 }
    }
    return { lines: [`live: ${short(s.live)} at ${s.url}`, ...notCommitted], code: 0 }
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

/**
 * What `ojplay clone` clones, and into which folder: a cart's address
 * (@handle/name, or its page's URL), its sid, or its clone URL. The folder
 * is `into`, else the cart's name or sid.
 */
export function cloneSource(what, into) {
    const text = String(what ?? "").trim()
    const origin = /^https?:\/\//.test(text) ? new URL(text).origin : siteOrigin()
    const address = /^(?:https?:\/\/[^/]+\/)?(@[A-Za-z0-9-]+)\/([A-Za-z0-9-]+?)(?:\.git)?\/?$/.exec(text)
    const sid = /^(?:https?:\/\/[^/]+\/[cg]\/)?([a-z0-9]{12})(?:\.git)?\/?$/.exec(text)
    if (address) return { url: `${origin}/${address[1]}/${address[2]}.git`, dir: path.resolve(into ?? address[2]) }
    if (sid) return { url: `${origin}/c/${sid[1]}.git`, dir: path.resolve(into ?? sid[1]) }
    throw new Error(`${COMMAND} clone takes a cart's @handle/name, its sid or its clone URL, not "${text}"`)
}

/** Where `ojplay new` clones to: the name as a folder, made safe. */
export function folderFor(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return path.resolve(slug === "" ? "cart" : slug)
}
