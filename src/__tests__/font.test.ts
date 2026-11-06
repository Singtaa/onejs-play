import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A game's fonts: `loadFont(name)` hands back what `fontFamily` takes, built
 * by the container from the file's bytes (OneJS `Network.LoadFontFromUrl`),
 * one per file however many ask, and `preload` and `unload` take fonts as they
 * take pictures (Sai, 6 Nov 2026: names as on the board).
 */
vi.mock("onejs-unity/assets", () => ({
    loadImageAsync: async (url: string) => ({ url }),
    loadTextAsync: async () => "",
}))
vi.mock("../models", () => ({ loadModel: async () => ({}), forgetModel: async () => {} }))

const { setAssetBase, setAssetMap, loadFont, builtFont } = await import("../asset")
const { preload, unload } = await import("../preload")

const h = (c: string) => c.repeat(64)
let asked: string[] = []
let destroyed: unknown[] = []
let refuse = false

beforeEach(() => {
    asked = []
    destroyed = []
    refuse = false
    ;(globalThis as any).CS = {
        OneJS: { Network: { LoadFontFromUrl: async (url: string) => { asked.push(url); return refuse ? null : { font: url } } } },
        UnityEngine: { Object: { Destroy: (o: unknown) => destroyed.push(o) } },
    }
    setAssetBase("https://abc.onejsusercontent.com/assets")
    setAssetMap({ "fonts/Display.ttf": [h("a"), 300], "fonts/Body.otf": [h("b"), 200] })
})

describe("loadFont", () => {
    it("asks the container for the file's font, once however many ask", async () => {
        const [a, b] = await Promise.all([loadFont("fonts/Display.ttf"), loadFont("./fonts/Display.ttf")])
        expect(a).toBe(b)
        expect(a).toEqual({ font: `https://abc.onejsusercontent.com/assets/${h("a")}/fonts/Display.ttf` })
        expect(asked).toHaveLength(1)
    })

    it("rejects naming the file when it is not a font, and asks again next time", async () => {
        refuse = true
        await expect(loadFont("fonts/Display.ttf")).rejects.toThrow("could not load fonts/Display.ttf as a font")
        refuse = false
        await expect(loadFont("fonts/Display.ttf")).resolves.toBeTruthy()
        expect(asked).toHaveLength(2)
    })

    it("says what it needs on a OneJS without the loader", async () => {
        ;(globalThis as any).CS = {}
        await expect(loadFont("fonts/Display.ttf")).rejects.toThrow("needs a OneJS newer than 3.9.18")
    })

    it("starts over when the host changes, which is every Run", async () => {
        await loadFont("fonts/Display.ttf")
        setAssetBase("https://abc.onejsusercontent.com/assets")
        await loadFont("fonts/Display.ttf")
        expect(asked).toHaveLength(2)
    })
})

describe("a font already built", () => {
    it("is there for useFont's first render once preload or an earlier ask built it, and gone with unload or a new host", async () => {
        expect(builtFont("fonts/Display.ttf")).toBeNull()
        await preload(["fonts/Display.ttf"])
        const font = builtFont("fonts/Display.ttf")
        expect(font).toEqual({ font: `https://abc.onejsusercontent.com/assets/${h("a")}/fonts/Display.ttf` })
        expect(await loadFont("./fonts/Display.ttf")).toBe(font)
        await unload(["fonts/Display.ttf"])
        expect(builtFont("fonts/Display.ttf")).toBeNull()
        await loadFont("fonts/Display.ttf")
        setAssetBase("https://abc.onejsusercontent.com/assets")
        expect(builtFont("fonts/Display.ttf")).toBeNull()
    })

    it("is not one that failed", async () => {
        refuse = true
        await loadFont("fonts/Display.ttf").catch(() => {})
        expect(builtFont("fonts/Display.ttf")).toBeNull()
    })
})

describe("fonts in preload and unload", () => {
    it("preload builds the font, so its first use is instant", async () => {
        await preload(["fonts/"])
        expect(asked.sort()).toEqual([
            `https://abc.onejsusercontent.com/assets/${h("a")}/fonts/Display.ttf`,
            `https://abc.onejsusercontent.com/assets/${h("b")}/fonts/Body.otf`,
        ])
        await loadFont("fonts/Display.ttf")
        expect(asked).toHaveLength(2)
    })

    it("unload destroys the font, and the next use builds it again", async () => {
        const font = await loadFont("fonts/Display.ttf")
        await unload(["fonts/Display.ttf"])
        expect(destroyed).toEqual([font])
        await loadFont("fonts/Display.ttf")
        expect(asked).toHaveLength(2)
    })
})
