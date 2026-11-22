import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/*
 * start() with the network and Chrome replaced: what it must close when a step
 * after the launch fails. Its own file because vi.mock replaces the module for
 * every test in the file.
 */
const fake = vi.hoisted(() => ({
    server: { url: "http://127.0.0.1:1/", close: vi.fn(), pageAskedAt: () => null },
    browser: { navigate: vi.fn(), close: vi.fn(), listeners: new Set() },
}))

vi.mock("./local.mjs", async (original) => ({
    ...await original<typeof import("./local.mjs")>(),
    ensureRuntime: vi.fn(async () => "/runtime"),
    serve: vi.fn(async () => fake.server),
}))

vi.mock("./chrome.mjs", async (original) => ({
    ...await original<typeof import("./chrome.mjs")>(),
    launch: vi.fn(async () => fake.browser),
}))

const { start, loadScript } = await import("./run.mjs")

const STARTER = path.resolve(import.meta.dirname, "../examples/starter")

describe("starting a game", () => {
    // Seen as "CDP Page.navigate did not answer in 30s": the run exited 1 and
    // left headless Chrome running, with its profile, for good.
    it("closes the browser and the server when the page does not load", async () => {
        fake.browser.navigate.mockRejectedValueOnce(new Error("CDP Page.navigate did not answer in 30s"))
        await expect(start(STARTER, { runtime: "1.0.51" })).rejects.toThrow(/Page.navigate did not answer in 30s; Chrome never asked the local server for the page/)
        expect(fake.browser.close).toHaveBeenCalledOnce()
        expect(fake.server.close).toHaveBeenCalledOnce()
    })
})

describe("a navigate that failed", () => {
    it("says whether the page was ever asked for, and when it was answered", async () => {
        const { pageRequestSaid } = await import("./run.mjs")
        expect(pageRequestSaid(null, 1000)).toBe("Chrome never asked the local server for the page")
        expect(pageRequestSaid(1400, 1000)).toBe("the local server answered the page 0.4 s after the navigate, and Chrome did not commit it")
    })
})

// A capture costs about eleven of the cart's frames, and a frame on software
// drawing costs its pixels: on windows-latest the occlusion fixture took 38 to
// 164 s at 960x540 against the sweep's 180 s. A playtest can ask for less.
describe("a playtest's window", () => {
    const dirs: string[] = []
    afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
    const script = (source: string) => {
        // The long form of the temp path, as in bake.test.ts: Windows hands out an 8.3
        // one (RUNNER~1), whose ~ reaches the script's file URL as %7E, which vitest cannot load.
        const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "oj-playtest-window-"))
        dirs.push(dir)
        fs.writeFileSync(path.join(dir, "t.playtest.mjs"), source)
        return { dir, file: "t.playtest.mjs" }
    }

    it("is the [width, height] its script exports, and none when it exports none", async () => {
        const asked = script("export const window = [480, 270]\nexport default async function () {}\n")
        expect((await loadScript(asked.file, asked.dir)).window).toEqual([480, 270])
        const plain = script("export default async function () {}\n")
        expect((await loadScript(plain.file, plain.dir)).window).toBeUndefined()
    })

    it("refuses a window that is not two whole sizes above 0, before a browser starts", async () => {
        for (const bad of ["[480]", "[480, 0]", "[480.5, 270]", "\"480,270\""]) {
            const s = script(`export const window = ${bad}\nexport default async function () {}\n`)
            await expect(loadScript(s.file, s.dir)).rejects.toThrow("t.playtest.mjs's window must be [width, height] in CSS pixels")
        }
    })
})
