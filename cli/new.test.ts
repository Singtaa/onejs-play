import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer, type Server } from "node:http"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { firstPush, newCart, starterFiles } from "./new.mjs"
import { starterWithName } from "../build/starter.mjs"
import { COMMAND } from "../build/command.mjs"

/**
 * Local-first carts (Sai, 14 Oct 2026): `ojplay new` makes one with no
 * account and no network, and its first `ojplay push` makes it on the site
 * and sends its history. The site is a stand-in for POST /api/games, GET
 * /api/games/<sid> and login by link; the cart's remote is a bare repository
 * at a path shaped like the site's clone URL, so git really pushes. HOME,
 * OJ_HOME and git's global config sit in a temporary folder.
 */

const TOKEN = "oja_" + "b".repeat(32)
const SID = "abcdefabcdef"
let dir = ""
let server: Server
let site = ""
let taken = false
const created: Array<{ body: any, auth?: string }> = []

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" })
const bare = () => path.join(dir, "c", `${SID}.git`)
const mainOf = (repo: string) => { const r = git(repo, "rev-parse", "--verify", "-q", "refs/heads/main"); return r.status === 0 ? r.stdout.trim() : null }

beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "oj-new-")))
    taken = false
    created.length = 0
    fs.writeFileSync(path.join(dir, "gitconfig"), "[user]\n\tname = Tester\n\temail = tester@example.test\n[init]\n\tdefaultBranch = trunk\n")
    fs.mkdirSync(path.dirname(bare()), { recursive: true })
    git(dir, "init", "-q", "--bare", bare())
    server = createServer(async (req, res) => {
        let text = ""
        for await (const c of req) text += c
        const send = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)) }
        if (req.method === "POST" && req.url === "/api/games") {
            created.push({ body: JSON.parse(text), auth: req.headers.authorization })
            if (taken) return send(409, { error: "You already have a cart called \"Pop Rocks\".", name: "Pop Rocks", sid: "bbbbbbbbbbbb", url: "/@owner/pop-rocks" })
            return send(200, { sid: SID, url: "/@owner/pop-rocks", clone: bare() })
        }
        if (req.url === `/api/games/${SID}`) {
            const head = mainOf(bare())
            return send(200, { sid: SID, url: `${site}/@owner/pop-rocks`, public: false, head, live: head, buildError: null })
        }
        if (req.url === "/api/login") return send(200, { code: "WDJB-MJHT", url: `${site}/device?code=WDJB-MJHT`, poll: "p".repeat(32), interval: 0, expiresIn: 5 })
        if (req.url === "/api/login/poll") return send(200, { token: TOKEN, handle: "owner", expiresAt: 1 })
        if (req.url === "/api/me/carts") return send(200, { handle: "owner", carts: [] })
        send(404, { error: "not here" })
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    site = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    vi.stubEnv("OJ_SITE", site)
    vi.stubEnv("OJ_HOME", path.join(dir, "home"))
    vi.stubEnv("HOME", dir)
    vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(dir, "gitconfig"))
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1")
    vi.stubEnv("GIT_TERMINAL_PROMPT", "0")
    vi.stubEnv("OJ_TOKEN", TOKEN)
})

afterEach(() => {
    server.close()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fs.rmSync(dir, { recursive: true, force: true })
})

const host = () => new URL(site).host

function made(name = "Pop Rocks") {
    const said: string[] = []
    const code = newCart(dir, name, { say: (l: string) => said.push(l) })
    return { code, said, cart: path.join(dir, "pop-rocks") }
}

async function push(root: string, signIn?: (dir: string) => Promise<number>) {
    const said: string[] = []
    const code = await firstPush(root, { say: (l: string) => said.push(l), ...(signIn ? { signIn } : {}) })
    return { code, said }
}

describe("ojplay new makes a cart on this machine", () => {
    it("writes the site's starter under the name, in a git repository on main with one commit, and says the three lines", () => {
        const { code, said, cart } = made()
        expect(code).toBe(0)
        expect(said).toEqual([
            "made pop-rocks (a git repo), on this machine only",
            `${COMMAND} push puts it on ${host()}`,
            `next: cd pop-rocks && npm install && ${COMMAND} run --watch`,
        ])
        for (const f of starterWithName(starterFiles(), "Pop Rocks")) expect(fs.readFileSync(path.join(cart, f.name), "utf8")).toBe(f.text)
        expect(JSON.parse(fs.readFileSync(path.join(cart, "oj.json"), "utf8")).name).toBe("Pop Rocks")
        expect(git(cart, "symbolic-ref", "HEAD").stdout.trim()).toBe("refs/heads/main")
        expect(git(cart, "log", "--format=%s").stdout.trim()).toBe("New cart")
        expect(git(cart, "ls-files").stdout.trim().split("\n")).toEqual(starterFiles().map((f) => f.name))
    })

    it("sets init's tooling up beside it, ignored, so the repository is the starter's files alone", () => {
        const { cart } = made()
        for (const name of ["package.json", "tsconfig.json", "env.d.ts"]) expect(fs.existsSync(path.join(cart, name)), name).toBe(true)
        expect(git(cart, "status", "--porcelain").stdout).toBe("")
        expect(fs.existsSync(path.join(cart, ".gitignore"))).toBe(false)
    })

    it("needs no network and no login", () => {
        vi.stubEnv("OJ_TOKEN", "")
        vi.stubEnv("OJ_SITE", "http://127.0.0.1:9")
        const fetch = vi.fn(() => { throw new Error("offline") })
        vi.stubGlobal("fetch", fetch)
        const { code, cart } = made()
        expect(code).toBe(0)
        expect(fetch).not.toHaveBeenCalled()
        expect(git(cart, "log", "--format=%s").stdout.trim()).toBe("New cart")
    })

    it("refuses a folder that is there and not empty, and leaves it alone", () => {
        fs.mkdirSync(path.join(dir, "pop-rocks"))
        fs.writeFileSync(path.join(dir, "pop-rocks", "notes.txt"), "mine")
        const { code, said } = made()
        expect(code).toBe(1)
        expect(said).toEqual([`pop-rocks already exists and is not empty; pick another name, or set that folder up with ${COMMAND} init`])
        expect(fs.readdirSync(path.join(dir, "pop-rocks"))).toEqual(["notes.txt"])
    })

    it("makes the cart but commits nothing when git does not know who you are, and says how to", () => {
        fs.writeFileSync(path.join(dir, "gitconfig"), "[user]\n\tuseConfigOnly = true\n")
        for (const name of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) vi.stubEnv(name, undefined as unknown as string)
        const { code, said, cart } = made()
        expect(code).toBe(0)
        expect(said[1]).toBe(`git: nothing committed: git does not know who you are. git config --global user.name "Your Name" and user.email you@example.com, then git add -A && git commit -m "New cart"`)
        expect(said).toHaveLength(4)
        expect(fs.existsSync(path.join(cart, "oj.json"))).toBe(true)
        expect(mainOf(cart)).toBe(null)
    })
})

describe("the first ojplay push makes the cart on the site", () => {
    it("asks for an empty cart, sets origin, pushes the history with an upstream, and says where it is live", async () => {
        const { cart } = made()
        fs.appendFileSync(path.join(cart, "index.tsx"), "// faster\n")
        git(cart, "commit", "-qam", "Faster dot")
        const { code, said } = await push(cart)
        expect(code).toBe(0)
        expect(created).toEqual([{ body: { name: "Pop Rocks", empty: true }, auth: `Bearer ${TOKEN}` }])
        expect(said[0]).toBe(`made @owner/pop-rocks on ${host()} (private)`)
        expect(said.at(-1)).toBe(`live: ${mainOf(cart)!.slice(0, 7)} at ${site}/@owner/pop-rocks`)
        expect(mainOf(bare())).toBe(mainOf(cart))
        expect(git(bare(), "log", "--format=%s", "main").stdout.trim().split("\n")).toEqual(["Faster dot", "New cart"])
        expect(git(cart, "remote", "get-url", "origin").stdout.trim()).toBe(bare())
        expect(git(cart, "rev-parse", "--abbrev-ref", "main@{upstream}").stdout.trim()).toBe("origin/main")
        // git pull and push work there without ojplay, from the login, never a stored token.
        expect(git(cart, "config", "--local", "--get-all", `credential.${site}.helper`).stdout).toContain("OJ_TOKEN")
        expect(fs.readFileSync(path.join(cart, ".git", "config"), "utf8")).not.toContain(TOKEN)
    })

    it("is the usual push from then on", async () => {
        const { cart } = made()
        await push(cart)
        expect(await push(cart)).toEqual({ code: null, said: [] })
        expect(created).toHaveLength(1)
    })

    it("logs in first when there is no login, then carries on", async () => {
        vi.stubEnv("OJ_TOKEN", "")
        const { cart } = made()
        const print = vi.spyOn(console, "log").mockImplementation(() => {})
        const err = vi.spyOn(console, "error").mockImplementation(() => {})
        try {
            const { code, said } = await push(cart)
            expect(code).toBe(0)
            expect(said[0]).toBe(`pop-rocks is not on ${host()} yet, and putting it there needs a login`)
            expect(print).toHaveBeenCalledWith(`Open ${site}/device?code=WDJB-MJHT and press Allow (code WDJB-MJHT).`)
            expect(said[1]).toBe(`made @owner/pop-rocks on ${host()} (private)`)
            expect(created[0].auth).toBe(`Bearer ${TOKEN}`)
        } finally {
            print.mockRestore()
            err.mockRestore()
        }
    })

    it("stops when the login does not finish, having made nothing", async () => {
        vi.stubEnv("OJ_TOKEN", "")
        const { cart } = made()
        expect((await push(cart, async () => 1)).code).toBe(1)
        expect(created).toEqual([])
    })

    it("refuses a name the account already has, naming that cart, and makes and pushes nothing", async () => {
        taken = true
        const { cart } = made()
        const { code, said } = await push(cart)
        expect(code).toBe(1)
        expect(said).toEqual([
            `you already have a cart called "Pop Rocks", at ${site}/@owner/pop-rocks`,
            "nothing was made or pushed. Rename it in oj.json, commit, and push again",
        ])
        expect(git(cart, "remote").stdout.trim()).toBe("")
        expect(mainOf(bare())).toBe(null)
    })

    it("leaves an origin that is not the site alone, and says how to keep both", async () => {
        const { cart } = made()
        git(cart, "remote", "add", "origin", "https://github.com/someone/pop-rocks.git")
        const { code, said } = await push(cart)
        expect(code).toBe(1)
        expect(said).toEqual([`origin is https://github.com/someone/pop-rocks.git, not ${host()}. To keep that remote and put the cart on the site too: git remote rename origin github, then ${COMMAND} push`])
        expect(created).toEqual([])
    })

    it("says what to do in a folder that is not a repository, or with nothing committed", async () => {
        const loose = path.join(dir, "loose")
        fs.mkdirSync(loose)
        fs.writeFileSync(path.join(loose, "oj.json"), "{}")
        expect((await push(loose)).said).toEqual([`this folder is not a git repository: git init && git add -A && git commit -m "New cart", then ${COMMAND} push`])
        git(loose, "init", "-q", "-b", "main")
        expect((await push(loose)).said).toEqual([`nothing is committed on main yet: git add -A && git commit -m "New cart", then ${COMMAND} push`])
        expect(created).toEqual([])
    })
})
