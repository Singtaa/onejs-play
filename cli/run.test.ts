import { describe, expect, it, vi } from "vitest"
import path from "node:path"

/*
 * start() with the network and Chrome replaced: what it must close when a step
 * after the launch fails. Its own file because vi.mock replaces the module for
 * every test in the file.
 */
const fake = vi.hoisted(() => ({
    server: { url: "http://127.0.0.1:1/", close: vi.fn() },
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

const { start } = await import("./run.mjs")

const STARTER = path.resolve(import.meta.dirname, "../examples/starter")

describe("starting a game", () => {
    // Seen as "CDP Page.navigate did not answer in 30s": the run exited 1 and
    // left headless Chrome running, with its profile, for good.
    it("closes the browser and the server when the page does not load", async () => {
        fake.browser.navigate.mockRejectedValueOnce(new Error("CDP Page.navigate did not answer in 30s"))
        await expect(start(STARTER, { runtime: "1.0.51" })).rejects.toThrow(/Page.navigate/)
        expect(fake.browser.close).toHaveBeenCalledOnce()
        expect(fake.server.close).toHaveBeenCalledOnce()
    })
})
