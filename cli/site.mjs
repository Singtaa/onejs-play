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

/** The sid in a clone URL, or null. */
export function sidFromRemote(url) {
    const match = /\/g\/([a-z0-9]{12})\.git\/?$/.exec(url ?? "")
    return match ? match[1] : null
}

/** The @handle/name in a clone URL made from the address bar, lowercased, or null. */
export function addressFromRemote(url) {
    const match = /\/(@[A-Za-z0-9-]+\/[A-Za-z0-9-]+)\.git\/?$/.exec(url ?? "")
    return match ? match[1].toLowerCase() : null
}

/**
 * This folder's game, read from its origin remote. A /g/<sid>.git clone names
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

/** Where `ojplay new` clones to: the name as a folder, made safe. */
export function folderFor(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return path.resolve(slug === "" ? "cart" : slug)
}
