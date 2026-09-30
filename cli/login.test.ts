import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer, type Server } from "node:http"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { deviceName, helperFor, login, logout } from "./login.mjs"
import { storedToken, tokenOf } from "./site.mjs"

/**
 * `oj login` against a stand-in for the site's three routes (PlaySite
 * src/index.tsx, "login by link"), with HOME, OJ_HOME and git's global config
 * in a temporary folder so nothing on this machine is touched.
 */

const TOKEN = "oja_" + "a".repeat(32)
let server: Server
let dir = ""
let decision: "pending" | "allow" | "deny" = "allow"
const seen: Array<{ path: string, body: any, auth?: string }> = []

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-login-"))
    decision = "allow"
    seen.length = 0
    server = createServer(async (req, res) => {
        let text = ""
        for await (const c of req) text += c
        const body = text ? JSON.parse(text) : {}
        seen.push({ path: req.url!, body, auth: req.headers.authorization })
        const send = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)) }
        if (req.url === "/api/login") return send(200, { code: "WDJB-MJHT", url: "http://site/device?code=WDJB-MJHT", poll: "p".repeat(32), interval: 0, expiresIn: 5 })
        if (req.url === "/api/login/poll") {
            if (decision === "pending") return send(202, { status: "pending" })
            if (decision === "deny") return send(403, { error: "Cancelled on the site." })
            return send(200, { token: TOKEN, handle: "owner", expiresAt: 1 })
        }
        if (req.url === "/api/logout") return send(200, { ok: true })
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

describe("oj login", () => {
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
        vi.stubEnv("OJ_TOKEN", "ojp_env")
        expect(tokenOf(dir)).toBe("ojp_env")

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

    it("fails when the person cancels, and stores nothing", async () => {
        decision = "deny"
        const said: string[] = []
        expect(await login(dir, { print: () => {}, say: (l: string) => said.push(l) })).toBe(1)
        expect(said).toContain("Cancelled on the site.")
        expect(storedToken(dir)).toBeNull()
    })

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("keeps the token in the sketch's .oj/ when home cannot be written", async () => {
        const locked = path.join(dir, "locked")
        fs.mkdirSync(locked, { mode: 0o500 })
        vi.stubEnv("OJ_HOME", path.join(locked, "home"))
        const sketch = path.join(dir, "sketch")
        fs.mkdirSync(sketch)
        expect(await login(sketch, quiet)).toBe(0)
        expect(fs.readFileSync(path.join(sketch, ".oj", "token"), "utf8").trim()).toBe(TOKEN)
        expect(storedToken(sketch)).toBe(TOKEN)
    })

    it("logs out on the site and here", async () => {
        await login(dir, quiet)
        expect(await logout(dir, { say: () => {} })).toBe(0)
        expect(seen.at(-1)).toMatchObject({ path: "/api/logout", auth: `Bearer ${TOKEN}` })
        expect(storedToken(dir)).toBeNull()
        expect(gitPassword(process.env.OJ_SITE!)).not.toBe(TOKEN)
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
