import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { serve } from "./local.mjs"
import { cleanCommit, keepRecorded, keepSet, newestSet, sendSets, setsAt, setsDir } from "./pipelines.mjs"

/**
 * A game's pipeline set between a run here and the site (pipelines.mjs): kept
 * only for a run of an exact commit, served back to the next run, sent for the
 * commit a push pushed, and never a file in the game's folder.
 */

const KEY = "0123456789abcdef0123456789abcdef"
const SET = { v: 1, key: KEY, modules: { 1: { code: "@vertex fn v() {}" } }, bgls: {}, layouts: {}, pipes: [{ vertex: { module: { $ref: 1 }, entryPoint: "v" } }] }

let home = ""
let root = ""
const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" })

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-home-"))
    vi.stubEnv("OJ_HOME", home)
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-cart-"))
    git("init", "-q")
    git("config", "user.email", "t@example.test")
    git("config", "user.name", "t")
    fs.writeFileSync(path.join(root, "index.tsx"), "export {}")
    git("add", ".")
    git("commit", "-q", "-m", "first")
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const tip = () => git("rev-parse", "HEAD").stdout.trim()

describe("which runs keep a set", () => {
    it("is a run of exactly a commit: an edit makes the folder no commit, and ojplay's own .oj/ does not", () => {
        expect(cleanCommit(root)).toBe(tip())
        fs.mkdirSync(path.join(root, ".oj"))
        fs.writeFileSync(path.join(root, ".oj", "run.png"), "x")
        expect(cleanCommit(root)).toBe(tip())
        fs.writeFileSync(path.join(root, "index.tsx"), "export const edited = 1")
        expect(cleanCommit(root)).toBe(null)
    })

    it("keeps it outside the game's folder, and reads it back for the commit and the container", () => {
        const file = keepSet(root, SET, tip())!
        expect(file.startsWith(setsDir(root))).toBe(true)
        expect(file.startsWith(root)).toBe(false)
        expect(setsAt(root, tip())).toEqual([SET])
        expect(JSON.parse(zlib.gunzipSync(newestSet(root, KEY)!).toString())).toEqual(SET)
        expect(newestSet(root, "ffffffffffffffffffffffffffffffff")).toBe(null)
    })

    it("keeps nothing that is not a set, or not of a commit", () => {
        expect(keepSet(root, null, tip())).toBe(null)
        expect(keepSet(root, { ...SET, pipes: [] }, tip())).toBe(null)
        expect(keepSet(root, { ...SET, key: "../../x" }, tip())).toBe(null)
        expect(keepSet(root, SET, "HEAD")).toBe(null)
        expect(fs.existsSync(setsDir(root))).toBe(false)
    })

    it("reads the page's recording when the run recorded, and not otherwise", async () => {
        const browser = { eval: vi.fn(async () => JSON.stringify(SET)) }
        expect(await keepRecorded({ root, browser, server: { record: false } })).toBe(null)
        expect(browser.eval).not.toHaveBeenCalled()
        expect(await keepRecorded({ root, browser, server: { record: true } })).not.toBe(null)
        expect(setsAt(root, tip())).toEqual([SET])
    })

    it("gives up on a page that does not answer, keeping nothing", async () => {
        const browser = { eval: () => new Promise(() => {}) }
        expect(await keepRecorded({ root, browser, server: { record: true } }, { waitMs: 20 })).toBe(null)
    })
})

describe("what push sends", () => {
    it("is the sets kept for the commit it pushed, by the token, and nothing for another commit", async () => {
        keepSet(root, SET, tip())
        const fetch = vi.fn(async () => new Response("{}", { status: 200 }))
        vi.stubGlobal("fetch", fetch)
        expect(await sendSets({ root, site: "https://site.example", sid: "abc", bearer: "tok", commit: tip() })).toBe(1)
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe(`https://site.example/api/games/abc/pipelines/${KEY}`)
        expect(init.method).toBe("PUT")
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok")
        expect(JSON.parse(String(init.body))).toEqual({ commit: tip(), set: SET })
        expect(await sendSets({ root, site: "https://site.example", sid: "abc", bearer: "tok", commit: "f".repeat(40) })).toBe(0)
    })

    it("says nothing and fails nothing when the site is unreachable", async () => {
        keepSet(root, SET, tip())
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed") }))
        expect(await sendSets({ root, site: "https://site.example", sid: "abc", bearer: "tok", commit: tip() })).toBe(0)
    })
})

describe("the local server", () => {
    it("serves a game's set where the game's origin does, and turns the recorder on only when asked", async () => {
        const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-rt-"))
        const bytes = zlib.gzipSync(JSON.stringify(SET))
        const server = await serve({ runtime, root, manifest: { name: "t" }, bundle: () => "", record: true, pipelines: (key: string) => key === KEY ? bytes : null })
        const plain = await serve({ runtime, root, manifest: { name: "t" }, bundle: () => "" })
        try {
            const got = await fetch(`${server.url}pipelines/${KEY}.json.gz`)
            expect(got.status).toBe(200)
            expect(Buffer.from(await got.arrayBuffer())).toEqual(bytes)
            // None is 204, not 404, which Chrome would log as an error and ojplay fail the run for.
            expect((await fetch(`${server.url}pipelines/ffffffffffffffffffffffffffffffff.json.gz`)).status).toBe(204)
            expect((await fetch(`${plain.url}pipelines/${KEY}.json.gz`)).status).toBe(204)
            const page = await (await fetch(server.url)).text()
            expect(page.indexOf("__ojRecordPipelines = true")).toBeGreaterThan(-1)
            expect(page.indexOf("__ojRecordPipelines = true")).toBeLessThan(page.indexOf("PlayContainer.loader.js"))
            const plainPage = await (await fetch(plain.url)).text()
            expect(plainPage).not.toContain("__ojRecordPipelines")
            // Every page says this server serves sets, so the container asks it; it asks no host that does not.
            expect(plainPage.indexOf("__ojGameSets = true")).toBeGreaterThan(-1)
            expect(plainPage.indexOf("__ojGameSets = true")).toBeLessThan(plainPage.indexOf("PlayContainer.loader.js"))
        } finally {
            server.close()
            plain.close()
        }
    })
})
