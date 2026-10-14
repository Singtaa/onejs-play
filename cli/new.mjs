/**
 * A cart that starts on this machine (Sai, 14 Oct 2026: "make ojplay new
 * local-first"). `ojplay new` writes the starter into a fresh git repository
 * with no account and no network; the first `ojplay push` makes the cart on
 * the site and sends it this history.
 *
 * The site makes that cart empty. Its usual create commits the starter, and
 * a history begun here could never fast forward onto that commit; an agent
 * login cannot force main either. So the first push asks for an empty cart
 * (`empty: true` on POST /api/games) and creates main on it from nothing,
 * which the site builds as it builds any push.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { init } from "./init.mjs"
import { login, pointAtLogin } from "./login.mjs"
import { addressFromRemote, describePush, folderFor, git, sidFromRemote, siteOrigin, status, tokenOf, uncommitted } from "./site.mjs"
import { isStarterFile, starterText, starterWithName } from "../build/starter.mjs"
import { COMMAND } from "../build/command.mjs"

const STARTER = path.join(import.meta.dirname, "..", "examples", "starter")

/** The starter's files, as the site's New writes them. */
export function starterFiles() {
    return fs.readdirSync(STARTER).filter(isStarterFile).sort()
        .map((name) => ({ name, text: starterText(fs.readFileSync(path.join(STARTER, name), "utf8")) }))
}

function run(args, cwd) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" })
    if (result.error) throw new Error(`git is needed for a cart, and it did not run: ${result.error.message}`)
    return result
}

/**
 * `ojplay new <name>`: the starter named `name`, in a new repository at
 * folderFor(name) under `parent`, with init's tooling ignored and one
 * commit. Answers an exit code.
 */
export function newCart(parent, name, { say }) {
    if (!name) throw new Error(`${COMMAND} new <name>`)
    run(["--version"])
    const dir = folderFor(name, parent)
    const shown = path.relative(parent, dir) || "."
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
        say(`${shown} already exists and is not empty; pick another name, or set that folder up with ${COMMAND} init`)
        return 1
    }
    fs.mkdirSync(dir, { recursive: true })
    const files = starterWithName(starterFiles(), name)
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.text)
    // The repository first, so init puts the tooling in .git/info/exclude and
    // the cart stays its starter's files, the same shape the site makes.
    const made = run(["init", "-q"], dir)
    if (made.status !== 0) throw new Error(`git init in ${shown} failed: ${made.stderr.trim()}`)
    run(["symbolic-ref", "HEAD", "refs/heads/main"], dir)
    init(dir)
    run(["add", "--", ...files.map((f) => f.name)], dir)
    const commit = run(["commit", "-q", "-m", "New cart"], dir)
    say(`made ${shown} (a git repo), on this machine only`)
    if (commit.status !== 0) {
        if (!/tell me who you are|empty ident|unable to auto-detect/i.test(commit.stderr)) {
            throw new Error(`git commit in ${shown} failed: ${commit.stderr.trim()}`)
        }
        say(`git: nothing committed: git does not know who you are. git config --global user.name "Your Name" and user.email you@example.com, then git add -A && git commit -m "New cart"`)
    }
    say(`${COMMAND} push puts it on ${new URL(siteOrigin()).host}`)
    say(`next: cd ${shown} && npm install && ${COMMAND} run --watch`)
    return 0
}

/** POST /api/games for an empty cart: { status, body }, the 409 for a taken name included. */
export async function createEmpty(name, bearer) {
    const response = await fetch(`${siteOrigin()}/api/games`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ name, empty: true }),
    })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { throw new Error(`${response.status} from the site: ${text.slice(0, 200)}`) }
    return { status: response.status, body }
}

/**
 * The first `ojplay push` of a cart made here. Answers null when this is not
 * one, because origin is a cart on the site and the push is the usual one;
 * else the exit code. `signIn` is the login it runs when there is none.
 */
export async function firstPush(root, { say, signIn = (dir) => login(dir) }) {
    if (run(["rev-parse", "--git-dir"], root).status !== 0) {
        say(`this folder is not a git repository: git init && git add -A && git commit -m "New cart", then ${COMMAND} push`)
        return 1
    }
    const origin = run(["remote", "get-url", "origin"], root)
    const remote = origin.status === 0 ? origin.stdout.trim() : ""
    if (remote !== "") {
        if (sidFromRemote(remote) !== null || addressFromRemote(remote) !== null) return null
        say(`origin is ${remote}, not ${new URL(siteOrigin()).host}. To keep that remote and put the cart on the site too: git remote rename origin github, then ${COMMAND} push`)
        return 1
    }
    if (run(["rev-parse", "--verify", "-q", "refs/heads/main"], root).status !== 0) {
        say(`nothing is committed on main yet: git add -A && git commit -m "New cart", then ${COMMAND} push`)
        return 1
    }
    const manifest = path.join(root, "oj.json")
    if (!fs.existsSync(manifest)) throw new Error(`no oj.json in ${root}: ${COMMAND} push sends a cart`)
    const declared = JSON.parse(fs.readFileSync(manifest, "utf8")).name
    const name = typeof declared === "string" && declared.trim() !== "" ? declared.trim() : path.basename(root)

    let bearer = tokenOf(root)
    if (!bearer) {
        say(`${path.basename(root)} is not on ${new URL(siteOrigin()).host} yet, and putting it there needs a login`)
        const code = await signIn(root)
        if (code !== 0) return code
        bearer = tokenOf(root)
    }

    const made = await createEmpty(name, bearer)
    if (made.status === 409) {
        const where = made.body.url ? ` at ${siteOrigin()}${made.body.url}` : ""
        say(`you already have a cart called "${made.body.name ?? name}",${where}`)
        say("nothing was made or pushed. Rename it in oj.json, commit, and push again")
        return 1
    }
    if (made.status !== 200) throw new Error(made.body.error ?? `${made.status} from the site`)
    say(`made ${made.body.url.replace(/^\//, "")} on ${new URL(siteOrigin()).host} (private)`)

    // Origin before the push, so a push that fails (the network, a file the
    // site refuses) is retried by an ordinary ojplay push.
    run(["remote", "add", "origin", made.body.clone], root)
    pointAtLogin(root)
    const left = uncommitted(root)
    const code = git(["push", "-u", "origin", "main"], { cwd: root, bearer })
    if (code !== 0) return code
    const said = describePush(null, await status(made.body.sid, { bearer }), left)
    for (const line of said.lines) say(line)
    return said.code
}
