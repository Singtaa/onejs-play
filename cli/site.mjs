/**
 * The site, from a terminal: which game this folder is, what the site says
 * about it, creating one, and pushing with a token and no prompt.
 */
import { spawn, spawnSync } from "node:child_process"
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
 * A read from the site, asked a second time when the connection died under it.
 *
 * A pooled keep-alive connection can be gone by the time a request goes out
 * on it: closed by a proxy or a NAT with nothing sent, or closed by the site
 * in the same moment the request leaves. The request dies (ECONNRESET, or
 * "other side closed") and fetch does not try again. The pool has dropped the
 * dead connection by then, so asking again opens a fresh one. Only for
 * reads, which are safe to repeat (site-connection.test.ts).
 *
 * It was found the loudest way: git ran under spawnSync, so the event loop was
 * held through a whole push and the site's close of an idle connection was
 * never seen; the read after the push died on it, every time on Windows (CI,
 * 6 Nov 2026). `git` runs async now, which removes that cause (new.test.ts),
 * and this stays for the ones a running loop cannot see either.
 */
export async function readFromSite(url, init = {}) {
    try {
        return await fetch(url, init)
    } catch (error) {
        if (!droppedConnection(error)) throw error
        return fetch(url, init)
    }
}

/** Whether a fetch failed because its connection was closed under it, rather than the site being unreachable. */
export function droppedConnection(error) {
    return error instanceof TypeError && ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(error.cause?.code)
}

/**
 * The account's own carts, Unlisted and Private ones included: what "which
 * carts do I have" needs. A repo with two carts is two rows. The site's
 * public list leaves out every cart that is not Public.
 */
export async function mine(bearer) {
    const response = await readFromSite(`${siteOrigin()}/api/me/carts`, { headers: { authorization: `Bearer ${bearer}` } })
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
    if (address === null && remote === "" && fs.existsSync(path.join(root, "oj.json"))) {
        throw new Error(`This cart is not on ${siteOrigin()} yet: ${COMMAND} push puts it there.`)
    }
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
    const response = await readFromSite(`${siteOrigin()}/api/games/${sid}`, { headers })
    const body = await json(response)
    if (!response.ok) throw new Error(body.error ?? `${response.status} from the site`)
    return body
}

/** The site's carts that follow a branch: the ones a push of it moves. */
export function following(s, branch) {
    return (s.carts ?? []).filter((c) => c.ref?.kind === "branch" && c.ref.name === branch)
}

/** A cart's ref as its address names it: a branch or version, or a commit's first 12. */
const refWord = (ref) => ref.kind === "commit" ? ref.name.slice(0, 12) : ref.name

/**
 * A status from the site as the lines `ojplay status` prints: the repo, what
 * main last built, then each cart with what it runs and who can play it
 * (PlaySite docs/carts-and-repos.md).
 */
export function describeStatus(s) {
    const short = (sha) => String(sha).slice(0, 7)
    const built = s.main?.built ?? null
    const lines = [`${s.url} (${s.repoPublic ? "public" : "private"} repo)`]
    if (!built) lines.push(s.head ? "main: nothing built yet" : `main: nothing pushed yet, ${COMMAND} push sends main`)
    else lines.push(s.head === built ? `main: ${short(built)}, its tip` : `main: ${short(built)}`)
    if (s.head && s.head !== built) {
        if (s.main?.buildError) {
            lines.push(`tip of main: ${short(s.head)} did not build:`)
            for (const line of String(s.main.buildError).split("\n")) lines.push(`  ${line}`)
        } else {
            lines.push(`tip of main: ${short(s.head)} is still building`)
        }
    }
    for (const c of s.carts ?? []) {
        const runs = c.live ? short(c.live) : "nothing yet"
        lines.push(`cart ${c.address}: ${c.ref.kind} ${refWord(c.ref)}, ${c.visibility}, runs ${runs}`)
        // A branch cart's own failure; main's is said above.
        if (c.buildError && !(c.ref.kind === "branch" && c.ref.name === "main")) lines.push(`  did not build: ${String(c.buildError).split("\n")[0]}`)
    }
    return lines
}

/** The branch a clone is on, or null when its HEAD is detached. */
export function currentBranch(root) {
    const result = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "-q", "HEAD"], { encoding: "utf8" })
    return result.status === 0 ? result.stdout.trim() : null
}

/** The commit a clone's HEAD is at, or null. */
export function tipOf(root) {
    const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" })
    return result.status === 0 ? result.stdout.trim() : null
}

/**
 * What `ojplay push` says after pushing a branch other than main: `before`
 * is what that branch's cart ran before the push (null for a new branch),
 * `tip` the commit pushed, `s` the status after it. A push of a branch with
 * no cart makes it one, Unlisted. A push that did not build exits 1, as
 * main's does; main is never moved by it.
 */
export function describeBranchPush(branch, before, tip, s, left) {
    const short = (sha) => String(sha).slice(0, 7)
    const notCommitted = leftLines(left)
    const cart = following(s, branch)[0]
    if (before === tip) {
        if (left.length > 0) return { lines: ["nothing was pushed", ...notCommitted], code: 1 }
        return { lines: [cart ? `nothing new to push; ${branch} runs at ${cart.address}` : `nothing new to push on ${branch}`], code: 0 }
    }
    if (cart === undefined) return { lines: [`pushed ${branch}; it has no cart (the site said why above)`, ...notCommitted], code: 0 }
    if (cart.live !== tip) {
        const plays = cart.live ? `its cart still runs ${short(cart.live)}` : "its cart runs nothing yet"
        return { lines: [`the tip of ${branch} did not build; ${plays}`, ...String(cart.buildError ?? "").split("\n").filter((l) => l !== ""), ...notCommitted], code: 1 }
    }
    const main = s.main?.built ? `main is unchanged, at ${short(s.main.built)}` : "main is unchanged; nothing is built on it yet"
    return { lines: [`${branch}: ${short(tip)} at ${cart.address}`, main, ...notCommitted], code: 0 }
}

/** The lines naming what a push left behind, uncommitted: at most eight files. */
function leftLines(left) {
    const shown = left.length > 8 ? [...left.slice(0, 8), `and ${left.length - 8} more`] : left
    return left.length === 0 ? [] : [
        `not committed, so not pushed: ${shown.join(", ")}`,
        `commit them, then push again: git add -A && git commit -m "<what changed>"`,
    ]
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
    const notCommitted = leftLines(left)
    const built = s.main?.built ?? null
    // Each cart following main moved with it; with none, main built and nothing plays it.
    const where = (sha) => {
        if (!sha) return ["main: nothing built yet"]
        const carts = following(s, "main")
        return carts.length === 0 ? [`main: ${short(sha)}; no cart runs main`] : carts.map((c) => `live: ${short(sha)} at ${c.address}`)
    }
    if (s.head === head) {
        if (left.length > 0) return { lines: ["nothing was pushed", ...notCommitted], code: 1 }
        return { lines: built ? where(built).map((line) => `nothing new to push; ${line}`) : ["nothing new to push"], code: 0 }
    }
    if (s.main?.buildError && s.head !== built) {
        const running = built ? "main still runs " + short(built) : "nothing is running"
        return { lines: [`the tip did not build; ${running}`, ...String(s.main.buildError).split("\n"), ...notCommitted], code: 1 }
    }
    return { lines: [...where(built), ...notCommitted], code: 0 }
}

/** GET /api/version: what the site runs, including the runtime pin. */
export async function version() {
    const response = await readFromSite(`${siteOrigin()}/api/version`)
    return json(response)
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
 * the `remote:` lines are where a push's build result arrives. Answers its
 * exit code.
 *
 * Not spawnSync, though nothing here needs git's output: a push can take
 * longer than the site keeps an idle connection open, and with the event loop
 * held for the whole push, fetch never saw the site close it and sent the next
 * read down the dead connection (ECONNRESET on Windows, 6 Nov 2026). With the
 * loop running, the pool drops it itself (new.test.ts).
 */
export function git(args, { cwd, bearer } = {}) {
    const helper = bearer ? credentialArgs(bearer) : []
    return new Promise((resolve) => {
        const child = spawn("git", [...helper, ...args], { cwd, stdio: "inherit" })
        child.on("error", () => resolve(1))
        child.on("close", (code) => resolve(code ?? 1))
    })
}

/**
 * What `ojplay clone` clones, and into which folder: a cart's address
 * (@handle/name, or its page's URL), its sid, or its clone URL. The folder
 * is `into`, else the cart's name or sid. A cart's page is its game and its
 * editor is that address plus /edit (play.onejs.com, 14 Oct 2026), and the
 * editor is where somebody reading the code copies the URL from, so both are
 * taken.
 */
export function cloneSource(what, into) {
    const text = String(what ?? "").trim()
    const origin = /^https?:\/\//.test(text) ? new URL(text).origin : siteOrigin()
    const address = /^(?:https?:\/\/[^/]+\/)?(@[A-Za-z0-9-]+)\/([A-Za-z0-9-]+?)(?:\.git|\/edit)?\/?$/.exec(text)
    const sid = /^(?:https?:\/\/[^/]+\/[cg]\/)?([a-z0-9]{12})(?:\.git|\/edit)?\/?$/.exec(text)
    if (address) return { url: `${origin}/${address[1]}/${address[2]}.git`, dir: path.resolve(into ?? address[2]) }
    if (sid) return { url: `${origin}/c/${sid[1]}.git`, dir: path.resolve(into ?? sid[1]) }
    throw new Error(`${COMMAND} clone takes a cart's @handle/name, its sid or its clone URL, not "${text}"`)
}

/** Where `ojplay new` makes a cart: the name as a folder under `parent`, made safe. */
export function folderFor(name, parent = process.cwd()) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return path.resolve(parent, slug === "" ? "cart" : slug)
}
