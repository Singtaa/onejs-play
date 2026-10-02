import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer, type Server } from "node:http"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { deviceName, helperFor, installId, login, logout } from "./login.mjs"
import { mine, storedToken, tokenOf } from "./site.mjs"
import { COMMAND } from "../build/command.mjs"

/**
 * `ojplay login` against a stand-in for the site's three routes (PlaySite
 * src/index.tsx, "login by link"), with HOME, OJ_HOME and git's global config
 * in a temporary folder so nothing on this machine is touched.
 */

const TOKEN = "oja_" + "a".repeat(32)
let server: Server
let dir = ""
let decision: "pending" | "allow" | "deny" = "allow"
/** A decision for one login, by its poll secret, over the default above. */
const decisions = new Map<string, "pending" | "allow" | "deny">()
const CODES = ["WDJB-MJHT", "BCDF-GHJK", "LMNP-QRST"]
let started = 0
const seen: Array<{ path: string, body: any, auth?: string }> = []

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-login-"))
    decision = "allow"
    decisions.clear()
    started = 0
    seen.length = 0
    server = createServer(async (req, res) => {
        let text = ""
        for await (const c of req) text += c
        const body = text ? JSON.parse(text) : {}
        seen.push({ path: req.url!, body, auth: req.headers.authorization })
        const send = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)) }
        if (req.url === "/api/login") {
            const code = CODES[started++ % CODES.length]
            return send(200, { code, url: `http://site/device?code=${code}`, poll: code.toLowerCase().replace("-", "").padEnd(32, "p"), interval: 0, expiresIn: 5 })
        }
        if (req.url === "/api/login/poll") {
            const decided = decisions.get(body.poll) ?? decision
            if (decided === "pending") return send(202, { status: "pending" })
            if (decided === "deny") return send(403, { error: "Cancelled on the site." })
            return send(200, { token: TOKEN, handle: "owner", expiresAt: 1 })
        }
        if (req.url === "/api/logout") return send(200, { ok: true })
        if (req.url === "/api/me/carts") {
            if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "This agent login was replaced by a newer login from the same install. Run npx ojplay login again." })
            return send(200, { handle: "owner", carts: [{ sid: "abcdefabcdef", name: "Hidden", public: false }, { sid: "bcdefabcdefa", name: "Shown", public: true }] })
        }
        send(404, {})
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    vi.stubEnv("OJ_SITE", `http://127.0.0.1:${(server.address() as { port: number }).port}`)
    vi.stubEnv("OJ_HOME", path.join(dir, "home"))
    vi.stubEnv("HOME", dir)
    vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(dir, "gitconfig"))
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1")
    vi.stubEnv("OJ_TOKEN", "")
})

afterEach(() => {
    server.close()
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
})

const quiet = { say: () => {}, print: () => {} }

/** What git would send the site for a URL on it, asked the way git asks. */
function gitPassword(url: string): string | null {
    const u = new URL(url)
    const out = spawnSync("git", ["credential", "fill"], {
        input: `protocol=${u.protocol.replace(":", "")}\nhost=${u.host}\npath=g/abcdefabcdef.git\n\n`,
        encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    return /^password=(.*)$/m.exec(out.stdout ?? "")?.[1] ?? null
}

describe("ojplay login", () => {
    it("prints the link, collects the token on Allow, keeps it 0600, and hands it to git for the site only", async () => {
        const printed: string[] = []
        expect(await login(dir, { name: "claude on test", say: () => {}, print: (l: string) => printed.push(l) })).toBe(0)
        expect(printed).toEqual(["Open http://site/device?code=WDJB-MJHT and press Allow (code WDJB-MJHT)."])
        expect(seen[0]).toMatchObject({ path: "/api/login", body: { device: "claude on test" } })

        const file = path.join(dir, "home", "token")
        expect(fs.readFileSync(file, "utf8").trim()).toBe(TOKEN)
        if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600)
        expect(storedToken(dir)).toBe(TOKEN)
        expect(tokenOf(dir)).toBe(TOKEN)
        vi.stubEnv("OJ_TOKEN", "ojplay_env")
        expect(tokenOf(dir)).toBe("ojplay_env")

        // git asks the helper for this site, and nobody else gets the token.
        expect(gitPassword(process.env.OJ_SITE!)).toBe(TOKEN)
        expect(gitPassword("https://github.com")).not.toBe(TOKEN)
    })

    it("can print and exit, and collect later with --wait", async () => {
        decision = "pending"
        expect(await login(dir, { wait: false, ...quiet })).toBe(0)
        expect(storedToken(dir)).toBeNull()
        decision = "allow"
        expect(await login(dir, { resume: true, ...quiet })).toBe(0)
        expect(storedToken(dir)).toBe(TOKEN)
        // The pending login is used up.
        expect(await login(dir, { resume: true, ...quiet })).toBe(1)
    })

    it("keeps two logins started at once apart, and collects the one named by its code", async () => {
        decision = "pending"
        const printed: string[] = []
        const said: string[] = []
        const log = { say: (l: string) => said.push(l), print: (l: string) => printed.push(l) }
        expect(await login(dir, { wait: false, ...log })).toBe(0)
        expect(await login(dir, { wait: false, ...log })).toBe(0)
        expect(printed.map((l) => /code (\S+)\)/.exec(l)?.[1])).toEqual(["WDJB-MJHT", "BCDF-GHJK"])
        expect(said).toContain(`then: ${COMMAND} login --wait BCDF-GHJK`)

        // Two are waiting, so --wait alone does not guess which.
        said.length = 0
        expect(await login(dir, { resume: true, ...log })).toBe(1)
        expect(said).toEqual([`2 logins are waiting (WDJB-MJHT, BCDF-GHJK); say which: ${COMMAND} login --wait <code>`])

        // The first one's person presses Allow; the second's has not yet.
        decisions.set("wdjbmjhtpppppppppppppppppppppppp", "allow")
        expect(await login(dir, { resume: true, code: "wdjb-mjht", ...quiet })).toBe(0)
        expect(storedToken(dir)).toBe(TOKEN)

        // The second is still waiting, and now it is the only one.
        decisions.set("bcdfghjkpppppppppppppppppppppppp", "deny")
        said.length = 0
        expect(await login(dir, { resume: true, ...log })).toBe(1)
        expect(said).toEqual(["Cancelled on the site."])
        expect(await login(dir, { resume: true, code: "BCDF-GHJK", ...log })).toBe(1)
        expect(said.at(-1)).toBe(`no login with code BCDF-GHJK is waiting; run ${COMMAND} login first`)
    })

    it("fails when the person cancels, and stores nothing", async () => {
        decision = "deny"
        const said: string[] = []
        expect(await login(dir, { print: () => {}, say: (l: string) => said.push(l) })).toBe(1)
        expect(said).toContain("Cancelled on the site.")
        expect(storedToken(dir)).toBeNull()
    })

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("keeps the token in the cart's .oj/ when home cannot be written", async () => {
        const locked = path.join(dir, "locked")
        fs.mkdirSync(locked, { mode: 0o500 })
        vi.stubEnv("OJ_HOME", path.join(locked, "home"))
        const cart = path.join(dir, "cart")
        fs.mkdirSync(cart)
        expect(await login(cart, quiet)).toBe(0)
        expect(fs.readFileSync(path.join(cart, ".oj", "token"), "utf8").trim()).toBe(TOKEN)
        expect(storedToken(cart)).toBe(TOKEN)
    })

    it("says who is logged in, and starts no new link, when the stored login still works", async () => {
        await login(dir, quiet)
        fs.rmSync(path.join(dir, "gitconfig"), { force: true })
        started = 0
        const printed: string[] = []
        const said: string[] = []
        expect(await login(dir, { wait: false, say: (l: string) => said.push(l), print: (l: string) => printed.push(l) })).toBe(0)
        expect(started).toBe(0)
        expect(seen.at(-1)).toMatchObject({ path: "/api/me/carts", auth: `Bearer ${TOKEN}` })
        expect(printed).toEqual(["Already logged in as owner. git clone, pull and push work for its carts."])
        expect(said).toEqual([`To log in as someone else: ${COMMAND} logout, then ${COMMAND} login`])
        // The git helper is put back if it went missing.
        expect(gitPassword(process.env.OJ_SITE!)).toBe(TOKEN)
    })

    it("starts a new link when the stored login is refused", async () => {
        fs.mkdirSync(path.join(dir, "home"), { recursive: true })
        fs.writeFileSync(path.join(dir, "home", "token"), "oja_" + "b".repeat(32) + "\n")
        const printed: string[] = []
        expect(await login(dir, { say: () => {}, print: (l: string) => printed.push(l) })).toBe(0)
        expect(printed).toEqual(["Open http://site/device?code=WDJB-MJHT and press Allow (code WDJB-MJHT)."])
        expect(storedToken(dir)).toBe(TOKEN)
    })

    it("logs out on the site and here", async () => {
        await login(dir, quiet)
        expect(await logout(dir, { say: () => {} })).toBe(0)
        expect(seen.at(-1)).toMatchObject({ path: "/api/logout", auth: `Bearer ${TOKEN}` })
        expect(storedToken(dir)).toBeNull()
        expect(gitPassword(process.env.OJ_SITE!)).not.toBe(TOKEN)
    })
})

describe("which install this is", () => {
    it("sends one id per install with every login, kept beside the token", async () => {
        await login(dir, quiet)
        // A working login answers "already logged in"; one that is gone logs in again.
        fs.rmSync(path.join(dir, "home", "token"))
        await login(dir, quiet)
        const sent = seen.filter((s) => s.path === "/api/login").map((s) => s.body.install)
        expect(sent).toHaveLength(2)
        expect(sent[0]).toMatch(/^[a-z0-9]{32}$/)
        expect(sent[1]).toBe(sent[0])
        expect(fs.readFileSync(path.join(dir, "home", "install"), "utf8").trim()).toBe(sent[0])
        // Another home is another install, so neither login replaces the other.
        vi.stubEnv("OJ_HOME", path.join(dir, "home2"))
        expect(installId(dir)).not.toBe(sent[0])
    })
})

describe("oj list", () => {
    it("asks for the account's own carts with the token, and passes on why a refused token is refused", async () => {
        const { handle, carts } = await mine(TOKEN)
        expect(handle).toBe("owner")
        expect(carts.map((g: { name: string }) => g.name)).toEqual(["Hidden", "Shown"])
        await expect(mine("oja_" + "b".repeat(32))).rejects.toThrow("replaced by a newer login from the same install")
    })
})

describe("oj logout and ~/.gitconfig", () => {
    const before = [
        "[user]",
        "\tname = Somebody",
        "[credential]",
        "\thelper = osxkeychain",
        '[credential "https://github.com"]',
        "\tusername = somebody",
        "",
    ].join("\n")

    it("takes out exactly the block login put in, and nothing else", async () => {
        const file = path.join(dir, "gitconfig")
        fs.writeFileSync(file, before)
        await login(dir, quiet)
        expect(fs.readFileSync(file, "utf8")).toContain(`[credential "${process.env.OJ_SITE}"]`)
        await logout(dir, { say: () => {} })
        expect(fs.readFileSync(file, "utf8")).toBe(before)
    })

    it("keeps anything of the person's own in the site's section", async () => {
        const file = path.join(dir, "gitconfig")
        const mineToo = before + `[credential "${process.env.OJ_SITE}"]\n\tusername = me\n`
        fs.writeFileSync(file, mineToo)
        await login(dir, quiet)
        await logout(dir, { say: () => {} })
        expect(fs.readFileSync(file, "utf8")).toBe(mineToo)
    })
})

describe("what the Allow page shows", () => {
    it("names the agent and the machine", () => {
        expect(deviceName({ CLAUDECODE: "1" }, "sai-mbp.local")).toBe("claude on sai-mbp")
        expect(deviceName({ CODEX_SANDBOX: "seatbelt" }, "studio")).toBe("codex on studio")
        expect(deviceName({}, "box")).toBe("oj on box")
    })

    it("quotes the token file's path for the shell git runs the helper in", () => {
        expect(helperFor("/Users/o'neil/.onejs-play/token")).toContain(`'/Users/o'\\''neil/.onejs-play/token'`)
    })
})
