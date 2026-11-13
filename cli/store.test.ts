import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHash, randomBytes } from "node:crypto"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cached, formatPointer, isStored, parsePointer, prePush, setupStore, storeKey, STORE_MIN_BYTES, UNSTORE_STEP } from "./store.mjs"

/**
 * Stored files from a terminal, against the real git binary: the filter
 * process git starts, the hook it runs, and a stand-in for the site's LFS
 * batch endpoint that records what it was asked. The stand-in also serves
 * /c/<sid>.git itself through `git http-backend`, so a real `git push` to the
 * site's URL runs the whole path.
 */

const SID = "abcdefabcdef"
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex")
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" })

let dir = ""
let child: ChildProcess
let site = ""

/**
 * The site's LFS batch endpoint and store, in a child process: git runs the
 * filter, the filter asks this, and a stand-in in the test's own process
 * could not answer while spawnSync holds the event loop.
 */
const STAND_IN = `
const http = require("node:http")
const SID = ${JSON.stringify(SID)}
const held = new Map(), seen = []
let refuse = null, site = ""
const key = (oid, name) => { const b = name.slice(name.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d <= 0 ? oid : oid + b.slice(d).toLowerCase() }
const server = http.createServer((req, res) => {
    const parts = []
    req.on("data", (c) => parts.push(c))
    req.on("end", () => {
        const data = Buffer.concat(parts)
        const lfs = "/c/" + SID + ".git/info/lfs"
        if (req.url === "/_seen") return res.end(JSON.stringify(seen))
        if (req.url === "/_refuse") { refuse = data.toString(); return res.end() }
        if (req.url.startsWith("/_hold/")) { held.set(req.url.slice(7), data); return res.end() }
        if (req.url.startsWith("/_held/")) return res.end(held.get(req.url.slice(7)) ?? "")
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: data.toString("utf8").slice(0, 2000) })
        if (req.url === lfs + "/objects/batch") {
            const { operation, objects } = JSON.parse(data.toString())
            res.setHeader("content-type", "application/vnd.git-lfs+json")
            return res.end(JSON.stringify({ objects: objects.map((o) => {
                const k = key(o.oid, o.name)
                if (refuse !== null) return { ...o, error: { code: 422, message: refuse } }
                if (operation === "download") return { ...o, actions: { download: { href: site + "/store/" + k } } }
                if (held.has(k)) return o
                return { ...o, actions: { upload: { href: site + "/store/" + k, header: { "x-amz-checksum-sha256": "x" } }, verify: { href: site + lfs + "/verify" } } }
            }) }))
        }
        const stored = /^\\/store\\/(.+)$/.exec(req.url)
        if (stored && req.method === "PUT") { held.set(stored[1], data); return res.end() }
        if (stored && req.method === "GET") { const b = held.get(stored[1]); res.statusCode = b ? 200 : 404; return res.end(b ?? "") }
        if (req.url === lfs + "/verify") return res.end("{}")
        const [pathInfo, query = ""] = req.url.split("?")
        if (pathInfo.startsWith("/c/" + SID + ".git/")) {
            const cgi = require("node:child_process").spawn("git", ["http-backend"], { env: { ...process.env,
                GIT_PROJECT_ROOT: process.env.OJ_GIT_ROOT, GIT_HTTP_EXPORT_ALL: "1", REMOTE_USER: "t", REMOTE_ADDR: "127.0.0.1",
                PATH_INFO: pathInfo, QUERY_STRING: query, REQUEST_METHOD: req.method,
                CONTENT_TYPE: req.headers["content-type"] ?? "", HTTP_CONTENT_ENCODING: req.headers["content-encoding"] ?? "" } })
            const out = []
            cgi.stdout.on("data", (c) => out.push(c))
            cgi.stdin.end(data)
            return cgi.on("close", () => {
                const all = Buffer.concat(out)
                const end = all.indexOf("\\r\\n\\r\\n")
                for (const line of all.subarray(0, end).toString().split("\\r\\n")) {
                    const colon = line.indexOf(":")
                    const [k, v] = [line.slice(0, colon), line.slice(colon + 1).trim()]
                    if (k.toLowerCase() === "status") res.statusCode = Number(v.split(" ")[0])
                    else res.setHeader(k, v)
                }
                res.end(all.subarray(end + 4))
            })
        }
        res.statusCode = 404
        res.end()
    })
})
server.listen(0, "127.0.0.1", () => { site = "http://127.0.0.1:" + server.address().port; console.log(site) })
`

const control = async (p: string, data?: Buffer | string) => fetch(`${site}${p}`, { method: data === undefined ? "GET" : "POST", body: data })
const seen = async (): Promise<Array<{ method: string, url: string, auth?: string, body: string }>> => (await control("/_seen")).json()
const held = async (k: string) => Buffer.from(await (await control(`/_held/${k}`)).arrayBuffer())

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-store-"))
    process.env.OJ_HOME = path.join(dir, "home")
    process.env.OJ_TOKEN = "ojp_" + "a".repeat(32)
    child = spawn(process.execPath, ["-e", STAND_IN], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, OJ_GIT_ROOT: dir } })
    site = await new Promise<string>((resolve) => child.stdout!.once("data", (d) => resolve(d.toString().trim())))
})

afterEach(() => {
    child.kill()
    fs.rmSync(dir, { recursive: true, force: true })
    delete process.env.OJ_HOME
    delete process.env.OJ_TOKEN
})

function cart(name = "cart") {
    const root = path.join(dir, name)
    fs.mkdirSync(root)
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "t@example.test")
    git(root, "config", "user.name", "t")
    return root
}

describe("the rule", () => {
    it("stores a served asset type at 1 MB and up, and nothing else", () => {
        expect(isStored("ship.glb", STORE_MIN_BYTES)).toBe(true)
        expect(isStored("ship.glb", STORE_MIN_BYTES - 1)).toBe(false)
        expect(isStored("art/bg.PNG", STORE_MIN_BYTES)).toBe(true)
        expect(isStored("words.json", STORE_MIN_BYTES * 2)).toBe(false)
        expect(isStored("bg.webp", STORE_MIN_BYTES * 2)).toBe(false)
        expect(parsePointer(formatPointer({ sha256: sha("x"), size: 7 }))).toEqual({ sha256: sha("x"), size: 7 })
        expect(storeKey(sha("x"), "Music/Theme.OGG")).toBe(`${sha("x")}.ogg`)
    })
})

describe("git with ojplay as its filter", () => {
    it("commits a pointer for a big file, keeps the bytes, and puts them back in a clone", () => {
        const root = cart()
        const big = randomBytes(STORE_MIN_BYTES + 3)
        fs.writeFileSync(path.join(root, "ship.glb"), big)
        fs.writeFileSync(path.join(root, "pop.wav"), "small")
        setupStore(root)
        expect(git(root, "add", "-A").status).toBe(0)
        git(root, "commit", "-qm", "one")
        expect(parsePointer(git(root, "cat-file", "-p", "HEAD:ship.glb").stdout)).toEqual({ sha256: sha(big), size: big.length })
        expect(git(root, "cat-file", "-p", "HEAD:pop.wav").stdout).toBe("small")
        expect(fs.readFileSync(cached(sha(big))).equals(big)).toBe(true)
        expect(git(root, "status", "--porcelain").stdout).toBe("")

        // A plain git clone leaves the pointer, with CRLF where git converts line
        // endings as Windows' does; setting the clone up puts the file there.
        const copy = path.join(dir, "copy")
        git(dir, "clone", "-q", "-c", "core.autocrlf=true", root, copy)
        git(copy, "remote", "set-url", "origin", `${site}/c/${SID}.git`)
        const plain = fs.readFileSync(path.join(copy, "ship.glb"), "utf8")
        expect(plain).toContain("\r\n")
        expect(parsePointer(plain.replace(/\r\n/g, "\n"))).not.toBeNull()
        const said = setupStore(copy)
        expect(said.join("\n")).toContain("1 of 1 fetched")
        expect(fs.readFileSync(path.join(copy, "ship.glb")).equals(big)).toBe(true)
        expect(git(copy, "status", "--porcelain").stdout).toBe("")
    })

    it("fetches what the cache lacks through the cart's remote, and leaves a pointer whose bytes do not come", async () => {
        const root = cart()
        const big = randomBytes(STORE_MIN_BYTES)
        fs.writeFileSync(path.join(root, "ship.glb"), big)
        setupStore(root)
        git(root, "add", "-A")
        git(root, "commit", "-qm", "one")
        fs.rmSync(path.join(process.env.OJ_HOME!, "store"), { recursive: true })

        const bare = path.join(dir, "c", `${SID}.git`)
        git(dir, "clone", "-q", "--bare", root, bare)
        const copy = path.join(dir, "copy")
        git(dir, "clone", "-q", bare, copy)
        git(copy, "remote", "set-url", "origin", `${site}/c/${SID}.git`)
        expect(setupStore(copy).join("\n")).toContain("still pointers: ship.glb")

        await control(`/_hold/${storeKey(sha(big), "ship.glb")}`, big)
        fs.rmSync(path.join(copy, "ship.glb"))
        git(copy, "checkout", "--", "ship.glb")
        expect(fs.readFileSync(path.join(copy, "ship.glb")).equals(big)).toBe(true)
        expect((await seen()).some((r) => r.url.endsWith("/objects/batch") && r.auth === `Bearer ${process.env.OJ_TOKEN}`)).toBe(true)
    })
})

describe("the pre-push hook", () => {
    function pushed() {
        const root = cart()
        const big = randomBytes(STORE_MIN_BYTES + 1)
        fs.writeFileSync(path.join(root, "bg.png"), big)
        setupStore(root)
        git(root, "add", "-A")
        git(root, "commit", "-qm", "one")
        const head = git(root, "rev-parse", "HEAD").stdout.trim()
        return { root, big, stdin: `refs/heads/main ${head} refs/heads/main ${"0".repeat(40)}\n` }
    }

    it("sends the bytes the store lacks, then verifies, and sends nothing twice", async () => {
        const { root, big, stdin } = pushed()
        const said: string[] = []
        expect(await prePush(root, "origin", `${site}/c/${SID}.git`, stdin, { say: (l: string) => said.push(l) })).toBe(0)
        expect((await held(storeKey(sha(big), "bg.png"))).equals(big)).toBe(true)
        expect(said).toEqual(["assets: bg.png 1.0 MB, sent"])
        const log = await seen()
        const batch = JSON.parse(log.find((r) => r.url.endsWith("/objects/batch"))!.body)
        expect(batch).toMatchObject({ operation: "upload", objects: [{ oid: sha(big), size: big.length, name: "bg.png" }] })
        // A presigned URL is on another host and gets no token; this stand-in is the same host, so it does.
        expect(log.find((r) => r.method === "PUT")!.auth).toBe(`Bearer ${process.env.OJ_TOKEN}`)
        expect(log.some((r) => r.url.endsWith("/verify"))).toBe(true)

        said.length = 0
        expect(await prePush(root, "origin", `${site}/c/${SID}.git`, stdin, { say: (l: string) => said.push(l) })).toBe(0)
        expect(said).toEqual(["assets: bg.png 1.0 MB, already stored"])
    })

    it("stops the push when the site refuses a file, and says why", async () => {
        const { root, stdin } = pushed()
        await control("/_refuse", "bg.png is 120 MB; a stored file may be 100 MB.")
        const said: string[] = []
        expect(await prePush(root, "origin", `${site}/c/${SID}.git`, stdin, { say: (l: string) => said.push(l) })).toBe(1)
        expect(said.join("\n")).toContain("bg.png: bg.png is 120 MB")
    })

    it("refuses to push a pointer to a remote that is not the site, naming it", async () => {
        const { root, stdin } = pushed()
        const said: string[] = []
        expect(await prePush(root, "github", "https://github.com/someone/cart.git", stdin, { say: (l: string) => said.push(l) })).toBe(1)
        expect(said.join("\n")).toContain("https://github.com/someone/cart.git is not a play.onejs.com remote")
        expect(said.join("\n")).toContain("  bg.png")
        expect(await seen()).toEqual([])
    })

    it("tells a clone whose origin is the site to push there, since recommitting would only store the file again", async () => {
        const { root, stdin } = pushed()
        git(root, "remote", "add", "origin", `${site}/c/${SID}.git`)
        const said: string[] = []
        expect(await prePush(root, "github", "https://github.com/someone/cart.git", stdin, { say: (l: string) => said.push(l) })).toBe(1)
        expect(said.join("\n")).toContain("push them to the site")
        expect(said.join("\n")).not.toContain(UNSTORE_STEP)
    })

    it("lets a push with no pointer at its tip through to any remote", async () => {
        const root = cart()
        fs.writeFileSync(path.join(root, "pop.wav"), "small")
        setupStore(root)
        git(root, "add", "-A")
        git(root, "commit", "-qm", "one")
        const head = git(root, "rev-parse", "HEAD").stdout.trim()
        expect(await prePush(root, "github", "https://github.com/someone/cart.git", `refs/heads/main ${head} refs/heads/main ${"0".repeat(40)}\n`)).toBe(0)
        expect(await seen()).toEqual([])
    })

    it("sends a push to the site's own URL through git, and a clone of it gets the file (end to end)", async () => {
        const root = cart()
        const big = randomBytes(STORE_MIN_BYTES + 5)
        fs.writeFileSync(path.join(root, "ship.glb"), big)
        setupStore(root)
        git(root, "add", "-A")
        git(root, "commit", "-qm", "one")
        const bare = path.join(dir, "c", `${SID}.git`)
        fs.mkdirSync(path.dirname(bare))
        git(dir, "init", "-q", "-b", "main", "--bare", bare)
        git(root, "remote", "add", "origin", `${site}/c/${SID}.git`)

        const push = git(root, "push", "origin", "main")
        expect(push.status, push.stderr).toBe(0)
        expect(push.stderr).toContain("assets: ship.glb 1.0 MB, sent")
        expect((await held(storeKey(sha(big), "ship.glb"))).equals(big)).toBe(true)
        expect(parsePointer(git(bare, "cat-file", "-p", "main:ship.glb").stdout)).toEqual({ sha256: sha(big), size: big.length })

        fs.rmSync(path.join(process.env.OJ_HOME!, "store"), { recursive: true })
        const copy = path.join(dir, "copy")
        expect(git(dir, "clone", "-q", `${site}/c/${SID}.git`, copy).status).toBe(0)
        expect(setupStore(copy).join("\n")).toContain("1 of 1 fetched")
        expect(fs.readFileSync(path.join(copy, "ship.glb")).equals(big)).toBe(true)
    })
})

describe("a clone whose origin is not the site's (onejs-play #11)", () => {
    function elsewhere() {
        const bare = path.join(dir, "remote.git")
        git(dir, "init", "-q", "-b", "main", "--bare", bare)
        const root = cart()
        git(root, "remote", "add", "origin", bare)
        return { root, bare }
    }

    it("commits a big file whole, so the push carries it and a clone gets it", () => {
        const { root, bare } = elsewhere()
        expect(setupStore(root).join("\n")).toContain("origin is not a play.onejs.com remote, so files stay whole in git here")
        const big = randomBytes(2_000_000)
        fs.writeFileSync(path.join(root, "model.glb"), big)
        git(root, "add", "-A")
        git(root, "commit", "-qm", "add")
        expect(parsePointer(git(root, "cat-file", "-p", "HEAD:model.glb").stdout)).toBeNull()
        expect(git(root, "cat-file", "-s", "HEAD:model.glb").stdout.trim()).toBe(String(big.length))
        expect(fs.existsSync(cached(sha(big)))).toBe(false)
        expect(git(root, "status", "--porcelain").stdout).toBe("")

        expect(git(root, "push", "-q", "origin", "main").status).toBe(0)
        const copy = path.join(dir, "copy")
        git(dir, "clone", "-q", bare, copy)
        expect(fs.readFileSync(path.join(copy, "model.glb")).equals(big)).toBe(true)
    })

    it("refuses a real push of a pointer committed before origin was set, and the named step unsticks it", () => {
        const root = cart()
        const big = randomBytes(STORE_MIN_BYTES + 1)
        fs.writeFileSync(path.join(root, "bg.png"), big)
        setupStore(root)
        git(root, "add", "-A")
        git(root, "commit", "-qm", "one")
        expect(parsePointer(git(root, "cat-file", "-p", "HEAD:bg.png").stdout)).not.toBeNull()

        const bare = path.join(dir, "remote.git")
        git(dir, "init", "-q", "-b", "main", "--bare", bare)
        git(root, "remote", "add", "origin", bare)
        expect(setupStore(root).join("\n")).toContain(`bg.png is committed as a pointer, which a push to origin refuses; commit it whole: ${UNSTORE_STEP}`)

        const refused = git(root, "push", "-q", "origin", "main")
        expect(refused.status).not.toBe(0)
        expect(refused.stderr).toContain("  bg.png")
        expect(refused.stderr).toContain(UNSTORE_STEP)
        expect(git(bare, "rev-parse", "-q", "--verify", "main").status).not.toBe(0)

        const step = spawnSync("sh", ["-c", UNSTORE_STEP], { cwd: root, encoding: "utf8" })
        expect(step.status, step.stderr).toBe(0)
        expect(git(root, "cat-file", "-s", "HEAD:bg.png").stdout.trim()).toBe(String(big.length))
        expect(git(root, "push", "-q", "origin", "main").status).toBe(0)
        const copy = path.join(dir, "copy")
        git(dir, "clone", "-q", bare, copy)
        expect(fs.readFileSync(path.join(copy, "bg.png")).equals(big)).toBe(true)
        expect(fs.readFileSync(path.join(root, ".git", "hooks", "pre-push"), "utf8")).toContain("pre-push \"$@\"")
    })
})
