import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Shipping Files says textures are cached by URL, so a second component asking
 * for the same file does not pay for the bytes again. Nothing cached them: every
 * useTexture mount fetched and decoded a new texture.
 */
let fetches = 0
let fail = false
vi.mock("onejs-unity/assets", () => ({
    loadImageAsync: async (url: string) => {
        fetches++
        if (fail) throw new Error(`no ${url}`)
        return { url, n: fetches }
    },
    loadTextAsync: async () => "",
}))

const { loadTexture, setAssetBase } = await import("../asset")

describe("loadTexture", () => {
    beforeEach(() => { fetches = 0; fail = false; setAssetBase("https://abc123.onejsusercontent.com/assets") })

    it("fetches a file once however many ask for it", async () => {
        const [a, b] = await Promise.all([loadTexture("glow.png"), loadTexture("./glow.png")])
        expect(a).toBe(b)
        expect(await loadTexture("glow.png")).toBe(a)
        expect(fetches).toBe(1)
    })

    it("asks again after a failure, so a file added later loads", async () => {
        fail = true
        await expect(loadTexture("late.png")).rejects.toThrow()
        fail = false
        await expect(loadTexture("late.png")).resolves.toBeTruthy()
        expect(fetches).toBe(2)
    })

    it("starts over when the host changes, which is every Run", async () => {
        await loadTexture("glow.png")
        setAssetBase("https://abc123.onejsusercontent.com/assets")
        await loadTexture("glow.png")
        expect(fetches).toBe(2)
    })
})
