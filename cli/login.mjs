/**
 * `oj login` and `oj logout`: login by link.
 *
 * `oj login` asks the site for a link and prints it. The person opens it,
 * signed in, and presses Allow; the next poll collects a token of the site's
 * 'agent' kind (create, edit, push, rebuild; never delete, publish or the
 * account; main by fast forward only; 30 days). Nothing is pasted anywhere.
 *
 * The token is kept in ~/.onejs-play/token (OJ_HOME moves it), mode 0600.
 * Where that cannot be written, as in a sandbox that confines writes to the
 * working folder, it goes to .oj/token in the sketch, which git ignores.
 *
 * git gets it through a credential helper for the site's origin only, a
 * one-line shell function that reads the file, so a plain `git clone`,
 * `pull` and `push` of any of the account's sketches need nothing more, and
 * the helper does not depend on where npx happened to unpack this package.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { home } from "./local.mjs"
import { ignoreLocally } from "./init.mjs"
import { siteOrigin, storedToken, tokenPaths } from "./site.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** What the Allow page shows: which agent, on which machine. */
export function deviceName(env = process.env, host = os.hostname()) {
    const agent = env.CLAUDECODE ? "claude"
        : Object.keys(env).some((k) => k.startsWith("CODEX_")) ? "codex"
        : env.CURSOR_AGENT ? "cursor"
        : "oj"
    return `${agent} on ${host.replace(/\.local$/, "")}`
}

/** Writes the token where it can, 0600, and returns the file. */
function store(root, token) {
    const [homeFile, localFile] = tokenPaths(root)
    try {
        fs.mkdirSync(path.dirname(homeFile), { recursive: true })
        fs.writeFileSync(homeFile, token + "\n", { mode: 0o600 })
        fs.chmodSync(homeFile, 0o600)
        return homeFile
    } catch {
        fs.mkdirSync(path.dirname(localFile), { recursive: true })
        fs.writeFileSync(localFile, token + "\n", { mode: 0o600 })
        fs.chmodSync(localFile, 0o600)
        ignoreLocally(root, ".oj/\n")
        return localFile
    }
}

/**
 * The helper line git runs for the site's origin: the account name is
 * ignored by the site, the password is the file's contents. Single quotes
 * around the path, with any in it escaped, since git runs it through sh.
 */
export function helperFor(file) {
    const quoted = `'${file.split(path.sep).join("/").replace(/'/g, `'\\''`)}'`
    return `!f() { test "$1" = get && echo username=oj && printf 'password=%s\\n' "$(cat ${quoted})"; }; f`
}

/**
 * Makes git use `file` for the site's origin. The empty helper first resets
 * the list, so a keychain helper holding an old password cannot answer
 * before ours (the reason credentialArgs in site.mjs does the same). Global
 * config when it can be written, else this clone's, else the line to run.
 */
function configureGit(root, file) {
    const key = `credential.${siteOrigin()}.helper`
    for (const scope of [["--global"], ["--local"]]) {
        const cwd = scope[0] === "--local" ? root : undefined
        const reset = spawnSync("git", ["config", ...scope, "--replace-all", key, ""], { cwd, encoding: "utf8" })
        if (reset.status !== 0) continue
        const add = spawnSync("git", ["config", ...scope, "--add", key, helperFor(file)], { cwd, encoding: "utf8" })
        if (add.status === 0) return scope[0] === "--global" ? "git: every clone from " + siteOrigin() : "git: this clone"
    }
    return `git: could not be configured; run  git config --global credential.${siteOrigin()}.helper "${helperFor(file)}"`
}

async function post(pathname, body, headers = {}) {
    const response = await fetch(`${siteOrigin()}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    })
    const text = await response.text()
    let parsed = {}
    try { parsed = JSON.parse(text) } catch { parsed = { error: `${response.status} from the site: ${text.slice(0, 200)}` } }
    return { status: response.status, body: parsed }
}

/** Where a started login waits between `--no-wait` and `--wait`. */
const pendingFile = () => path.join(home(), "login.json")

/**
 * `oj login`. Prints the link, then waits for Allow unless `noWait`, in which
 * case `oj login --wait` collects it later. Returns an exit code.
 */
export async function login(root, { name, wait = true, resume = false, say = console.error, print = console.log } = {}) {
    let pending
    if (resume) {
        try { pending = JSON.parse(fs.readFileSync(pendingFile(), "utf8")) } catch { pending = null }
        if (pending === null || pending.site !== siteOrigin()) {
            say("no login is waiting; run oj login first")
            return 1
        }
    } else {
        const started = await post("/api/login", { device: name ?? deviceName() })
        if (started.status !== 200) {
            say(started.body.error ?? `${started.status} from the site`)
            return 1
        }
        pending = { site: siteOrigin(), poll: started.body.poll, interval: started.body.interval, until: Date.now() + started.body.expiresIn * 1000 }
        // stdout, one line: what an agent relays to the person.
        print(`Open ${started.body.url} and press Allow (code ${started.body.code}).`)
        if (!wait) {
            fs.mkdirSync(home(), { recursive: true })
            fs.writeFileSync(pendingFile(), JSON.stringify(pending), { mode: 0o600 })
            say("then: oj login --wait")
            return 0
        }
    }
    while (Date.now() < pending.until) {
        const polled = await post("/api/login/poll", { poll: pending.poll })
        if (polled.status === 202) {
            await sleep(pending.interval * 1000)
            continue
        }
        fs.rmSync(pendingFile(), { force: true })
        if (polled.status !== 200) {
            say(polled.body.error ?? `${polled.status} from the site`)
            return 1
        }
        const file = store(root, polled.body.token)
        say(`logged in as ${polled.body.handle}; token in ${file}`)
        say(configureGit(root, file))
        return 0
    }
    fs.rmSync(pendingFile(), { force: true })
    say("the link expired; run oj login again")
    return 1
}

/** `oj logout`: the site forgets the token, then this machine does. */
export async function logout(root, { say = console.error } = {}) {
    const token = storedToken(root)
    if (token !== null) {
        const out = await post("/api/logout", {}, { authorization: `Bearer ${token}` })
        if (out.status !== 200) say(`the site said: ${out.body.error ?? out.status}`)
    }
    for (const file of tokenPaths(root)) fs.rmSync(file, { force: true })
    const key = `credential.${siteOrigin()}.helper`
    spawnSync("git", ["config", "--global", "--unset-all", key], { encoding: "utf8" })
    spawnSync("git", ["config", "--local", "--unset-all", key], { cwd: root, encoding: "utf8" })
    say(token === null ? "was not logged in" : "logged out")
    return 0
}
