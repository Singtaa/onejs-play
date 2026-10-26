import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { authorLines, noreplyAuthor, ownsRepository, setAuthor } from "./author.mjs"

/**
 * A cart's commits carry the account's handle at a no-reply address, never
 * the machine's own git identity (author.mjs). Every repository here is a
 * temporary one, and git's global config is a file in the same folder, so the
 * tests can also show the global identity is never touched.
 */

const SITE = "https://play.onejs.com"
const OJ = path.resolve(import.meta.dirname, "oj.mjs")
let dir = ""
let globalConfig = ""

const env = () => ({
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    OJ_HOME: path.join(dir, "oj-home"),
    // The copy under test, not a hand-off to another one.
    npm_command: "exec",
})
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", env: env() })
const local = (repo: string, key: string) => git(repo, "config", "--local", "--get", key).stdout.trim()
const repo = (name: string) => {
    const at = path.join(dir, name)
    fs.mkdirSync(at, { recursive: true })
    git(at, "init", "-q")
    return at
}
const account = (handle: string) => async () => ({ handle, carts: [] })

beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "oj-author-")))
    globalConfig = path.join(dir, "gitconfig")
    fs.writeFileSync(globalConfig, "[user]\n\tname = Real Person\n\temail = real.person@example.test\n")
    process.env.GIT_CONFIG_GLOBAL = globalConfig
    process.env.GIT_CONFIG_NOSYSTEM = "1"
})

afterEach(() => {
    delete process.env.GIT_CONFIG_GLOBAL
    delete process.env.GIT_CONFIG_NOSYSTEM
    fs.rmSync(dir, { recursive: true, force: true })
})

describe("noreplyAuthor", () => {
    it("keeps the handle as written and lowercases the address", () => {
        expect(noreplyAuthor("Singtaa", SITE)).toEqual({ name: "Singtaa", email: "singtaa@users.noreply.play.onejs.com" })
    })

    it("takes the domain from the site, leaving out a port", () => {
        expect(noreplyAuthor("bench", "http://localhost:8799").email).toBe("bench@users.noreply.localhost")
    })
})

describe("ownsRepository", () => {
    it("is true only at the top of a repository", () => {
        const top = repo("cart")
        const inner = path.join(top, "sub")
        fs.mkdirSync(inner)
        const plain = path.join(dir, "plain")
        fs.mkdirSync(plain)
        expect(ownsRepository(top)).toBe(true)
        expect(ownsRepository(inner)).toBe(false)
        expect(ownsRepository(plain)).toBe(false)
    })
})

describe("setAuthor", () => {
    it("writes the author to the repository, not to git's global config", () => {
        const cart = repo("cart")
        const before = fs.readFileSync(globalConfig, "utf8")
        setAuthor(cart, noreplyAuthor("Singtaa", SITE), SITE)
        expect(local(cart, "user.name")).toBe("Singtaa")
        expect(local(cart, "user.email")).toBe("singtaa@users.noreply.play.onejs.com")
        expect(fs.readFileSync(globalConfig, "utf8")).toBe(before)
    })

    it("makes the next commit carry the no-reply address as author and committer", () => {
        const cart = repo("cart")
        setAuthor(cart, noreplyAuthor("Singtaa", SITE), SITE)
        fs.writeFileSync(path.join(cart, "index.tsx"), "export {}\n")
        git(cart, "add", "-A")
        git(cart, "commit", "-q", "-m", "First")
        expect(git(cart, "log", "-1", "--format=%an <%ae> %cn <%ce>").stdout.trim())
            .toBe("Singtaa <singtaa@users.noreply.play.onejs.com> Singtaa <singtaa@users.noreply.play.onejs.com>")
    })

    it("replaces an address it gave out before, after a rename", () => {
        const cart = repo("cart")
        setAuthor(cart, noreplyAuthor("old-name", SITE), SITE)
        setAuthor(cart, noreplyAuthor("NewName", SITE), SITE)
        expect(local(cart, "user.email")).toBe("newname@users.noreply.play.onejs.com")
    })

    it("leaves an address a person set in the repository", () => {
        const cart = repo("cart")
        git(cart, "config", "--local", "user.email", "me@studio.test")
        const said = setAuthor(cart, noreplyAuthor("Singtaa", SITE), SITE)
        expect(local(cart, "user.email")).toBe("me@studio.test")
        expect(said).toContain("left alone")
    })
})

describe("authorLines", () => {
    it("sets the account's author in a cart's own repository", async () => {
        const cart = repo("cart")
        const said = await authorLines(cart, "token", { account: account("Singtaa"), origin: SITE })
        expect(local(cart, "user.email")).toBe("singtaa@users.noreply.play.onejs.com")
        expect(said).toEqual(["git: commits here are by Singtaa <singtaa@users.noreply.play.onejs.com>, not this machine's git identity"])
    })

    it("sets nothing in a folder inside another repository, such as a Unity project", async () => {
        const project = repo("project")
        const cart = path.join(project, "Pop")
        fs.mkdirSync(cart)
        expect(await authorLines(cart, "token", { account: account("Singtaa"), origin: SITE })).toEqual([])
        expect(local(project, "user.email")).toBe("")
    })

    it("sets nothing without an account, and says how to set it", async () => {
        const cart = repo("cart")
        const said = await authorLines(cart, null, { account: account("Singtaa"), origin: SITE })
        expect(local(cart, "user.email")).toBe("")
        expect(said.join("\n")).toMatch(/login, then .* init/)
    })

    it("sets nothing when the site cannot say who the account is", async () => {
        const cart = repo("cart")
        const failing = async () => { throw new Error("401 from the site") }
        const said = await authorLines(cart, "token", { account: failing, origin: SITE })
        expect(local(cart, "user.email")).toBe("")
        expect(said.join("\n")).toContain("401 from the site")
    })
})

describe("ojplay init in a clone", () => {
    let server: Server
    let site = ""

    beforeEach(async () => {
        server = createServer((req, res) => {
            res.writeHead(req.url === "/api/me/carts" ? 200 : 404, { "content-type": "application/json" })
            res.end(JSON.stringify(req.url === "/api/me/carts" ? { handle: "Singtaa", carts: [] } : { error: "not here" }))
        })
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        const address = server.address()
        site = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
    })

    afterEach(async () => {
        await new Promise((resolve) => server.close(resolve))
    })

    // spawnSync would block the stand-in site's event loop, so the CLI runs asynchronously.
    const run = (cwd: string, extra: Record<string, string>) => new Promise<{ code: number, stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [OJ, "init"], { cwd, env: { ...env(), OJ_SITE: site, ...extra } })
        let stderr = ""
        child.stderr.on("data", (d) => { stderr += d })
        child.on("close", (code) => resolve({ code: code ?? 1, stderr }))
    })

    it("commits as the account's no-reply address and leaves the global identity alone", async () => {
        const cart = repo("cart")
        fs.writeFileSync(path.join(cart, "oj.json"), "{ \"name\": \"Pop\" }\n")
        const before = fs.readFileSync(globalConfig, "utf8")
        const { code, stderr } = await run(cart, { OJ_TOKEN: "oja_" + "a".repeat(32) })
        expect(code, stderr).toBe(0)
        expect(local(cart, "user.email")).toBe("singtaa@users.noreply.127.0.0.1")
        expect(stderr).toContain("not this machine's git identity")
        expect(fs.readFileSync(globalConfig, "utf8")).toBe(before)
    })

    it("sets nothing with no login, and says so", async () => {
        const cart = repo("cart")
        fs.writeFileSync(path.join(cart, "oj.json"), "{ \"name\": \"Pop\" }\n")
        const { code, stderr } = await run(cart, { OJ_TOKEN: "" })
        expect(code, stderr).toBe(0)
        expect(local(cart, "user.email")).toBe("")
        expect(stderr).toContain("this machine's git identity")
    })
})
