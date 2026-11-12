import { describe, it, expect } from "vitest"
import check from "./mesh-effects.playtest.mjs"

/**
 * A game whose screenshots' middle pixel is `pixels[the look last shown]`, told apart by what it
 * shows; the flipbook's three reads are `pixels.flipbook`, `"flipbook later"` and `"flipbook last"`.
 */
function fake(pixels: Record<string, number[]>) {
    let shown = ""
    let flipReads = 0
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.meshEffects")) return "object"
            if (code.includes("getImageData")) {
                if (shown !== "flipbook") return JSON.stringify(pixels[shown])
                return JSON.stringify(pixels[["flipbook", "flipbook later", "flipbook last"][flipReads++]!])
            }
            if (code.includes("meshEffects.lower(")) {
                shown = "moved over"
                return undefined
            }
            if (!code.includes("meshEffects.show(")) throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
            const fog = code.includes("fog")
            if (code.includes("premultipliedTexture")) shown = "multiplied half"
            else if (code.includes("halfPixels")) shown = "straight half"
            else if (code.includes("premultiplied")) shown = fog ? "adding in fog" : code.includes("#00ff0000") ? "adding" : code.includes("#00ff0080") ? "halfway" : "covering"
            else if (code.includes("light")) shown = code.includes("#800000") ? "own ambient" : code.includes("[0,1,0]") ? "own light below" : "own light"
            else if (code.includes("waterline")) shown = code.includes(`"y":-1`) ? "over" : code.includes(`"strength":0.5`) ? "half under" : "under"
            else if (code.includes("bare")) shown = fog ? "floor in fog" : "floor"
            else if (code.includes("flash")) shown = "flashed"
            else if (code.includes(`"add"`)) shown = fog ? "added in fog" : "added"
            else if (code.includes("flipbook")) shown = "flipbook"
            else if (code.includes("pixels")) shown = "pixels"
            else if (code.includes("unlit")) shown = "unlit"
            else shown = "lit"
            return undefined
        },
    }
}

const GOOD = {
    lit: [0, 0, 0],
    flashed: [128, 128, 128],
    unlit: [255, 255, 255],
    pixels: [255, 0, 0],
    // Linear 0.6 and 0.4, 0.2 and 0.8, 0.9 and 0.1 of red and blue, in sRGB.
    flipbook: [203, 0, 170],
    "flipbook later": [124, 0, 231],
    "flipbook last": [243, 0, 89],
    floor: [128, 128, 128],
    added: [174, 174, 174],
    "floor in fog": [0, 0, 192],
    "added in fog": [0, 0, 192],
    covering: [0, 255, 0],
    adding: [128, 255, 128],
    // The floor's 128 is 0.216 in linear light; half of it is 0.108, or 92.
    halfway: [92, 255, 92],
    "adding in fog": [0, 0, 192],
    // Red 0.502 plus half the floor, 0.108, in linear light is 205; red whole plus it is 255.
    "straight half": [205, 92, 92],
    "multiplied half": [255, 92, 92],
    "own light": [128, 128, 128],
    // A seventeenth of 128's 0.216 in linear light.
    "own light below": [30, 30, 30],
    "own ambient": [128, 0, 0],
    under: [255, 0, 0],
    over: [255, 255, 255],
    "half under": [255, 188, 188],
    "moved over": [255, 255, 255],
}

describe("the mesh-effects playtest", () => {
    it("passes a quad drawn unlit, under a picture from bytes, and added over the floor, faded out by fog", async () => {
        await expect(check(fake(GOOD) as any)).resolves.toBeUndefined()
    })

    it("fails a flash that adds nothing", async () => {
        await expect(check(fake({ ...GOOD, flashed: GOOD.lit }) as any)).rejects.toThrow("the flash was not added")
    })

    it("fails an unlit quad that is still lit, as a mesh drew before unlit", async () => {
        await expect(check(fake({ ...GOOD, unlit: GOOD.lit }) as any)).rejects.toThrow("still lit")
    })

    it("fails a picture made from bytes that drew nothing, as tex.pixels did alone", async () => {
        await expect(check(fake({ ...GOOD, pixels: GOOD.unlit }) as any)).rejects.toThrow("the picture did not draw")
    })

    it("fails a flipbook that steps to a colour neither frame has, or does not play", async () => {
        await expect(check(fake({ ...GOOD, "flipbook later": [255, 0, 255] }) as any)).rejects.toThrow("not the two cross-faded")
        await expect(check(fake({ ...GOOD, "flipbook later": GOOD.flipbook, "flipbook last": GOOD.flipbook }) as any)).rejects.toThrow("the flipbook did not play")
    })

    it("fails an added quad that covers the floor instead, or adds in sRGB", async () => {
        await expect(check(fake({ ...GOOD, added: [128, 128, 128] }) as any)).rejects.toThrow("not added")
        await expect(check(fake({ ...GOOD, added: [255, 255, 255] }) as any)).rejects.toThrow("not added")
    })

    it("fails an added quad that fog turns toward its colour, adding the fog again", async () => {
        await expect(check(fake({ ...GOOD, "added in fog": [0, 0, 255] }) as any)).rejects.toThrow("the fog did not fade it out")
    })

    it("fails a premultiplied quad that blends by its alpha, ignores the alpha, multiplies its colour by it, or fogs its added part", async () => {
        await expect(check(fake({ ...GOOD, covering: [128, 255, 128] }) as any)).rejects.toThrow("not laid over it")
        await expect(check(fake({ ...GOOD, adding: [128, 128, 128] }) as any)).rejects.toThrow("not its whole green added")
        await expect(check(fake({ ...GOOD, halfway: [128, 255, 128] }) as any)).rejects.toThrow("not half the floor's light kept")
        await expect(check(fake({ ...GOOD, "adding in fog": [0, 255, 192] }) as any)).rejects.toThrow("the fog did not fade it out")
        await expect(check(fake({ ...GOOD, "straight half": [255, 92, 92] }) as any)).rejects.toThrow("not its red times its alpha")
        await expect(check(fake({ ...GOOD, "multiplied half": [205, 92, 92] }) as any)).rejects.toThrow("not its red whole")
    })

    it("fails an actor light that does not light it, lights it from the wrong side, or loses its ambient", async () => {
        await expect(check(fake({ ...GOOD, "own light": [0, 0, 0] }) as any)).rejects.toThrow("not that grey")
        await expect(check(fake({ ...GOOD, "own light below": [128, 128, 128] }) as any)).rejects.toThrow("not a seventeenth")
        await expect(check(fake({ ...GOOD, "own ambient": [0, 0, 0] }) as any)).rejects.toThrow("not that red")
    })

    it("fails a waterline that tints nothing, tints above it, mixes in sRGB, or is lost when only y moves", async () => {
        await expect(check(fake({ ...GOOD, under: GOOD.unlit }) as any)).rejects.toThrow("not red")
        await expect(check(fake({ ...GOOD, over: GOOD.under }) as any)).rejects.toThrow("not white")
        await expect(check(fake({ ...GOOD, "half under": [255, 128, 128] }) as any)).rejects.toThrow("halfway in linear light")
        await expect(check(fake({ ...GOOD, "moved over": [255, 188, 188] }) as any)).rejects.toThrow("by { y } alone")
    })

    it("fails a lit scene, or a fog that is not on, rather than measuring nothing", async () => {
        await expect(check(fake({ ...GOOD, lit: [200, 200, 200] }) as any)).rejects.toThrow("the scene is lit")
        await expect(check(fake({ ...GOOD, "floor in fog": GOOD.floor, "added in fog": GOOD.added }) as any)).rejects.toThrow("the fog is not on")
    })
})
