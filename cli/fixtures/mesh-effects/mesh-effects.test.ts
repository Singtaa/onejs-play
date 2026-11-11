import { describe, it, expect } from "vitest"
import check from "./mesh-effects.playtest.mjs"

/** A game whose screenshots' middle pixel is `pixels[the look last shown]`, told apart by what it shows. */
function fake(pixels: Record<string, number[]>) {
    let shown = ""
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.meshEffects")) return "object"
            if (code.includes("getImageData")) return JSON.stringify(pixels[shown])
            if (!code.includes("meshEffects.show(")) throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
            const fog = code.includes("fog")
            if (code.includes("bare")) shown = fog ? "floor in fog" : "floor"
            else if (code.includes(`"add"`)) shown = fog ? "added in fog" : "added"
            else if (code.includes("pixels")) shown = "pixels"
            else if (code.includes("unlit")) shown = "unlit"
            else shown = "lit"
            return undefined
        },
    }
}

const GOOD = {
    lit: [0, 0, 0],
    unlit: [255, 255, 255],
    pixels: [255, 0, 0],
    floor: [128, 128, 128],
    added: [174, 174, 174],
    "floor in fog": [0, 0, 192],
    "added in fog": [0, 0, 192],
}

describe("the mesh-effects playtest", () => {
    it("passes a quad drawn unlit, under a picture from bytes, and added over the floor, faded out by fog", async () => {
        await expect(check(fake(GOOD) as any)).resolves.toBeUndefined()
    })

    it("fails an unlit quad that is still lit, as a mesh drew before unlit", async () => {
        await expect(check(fake({ ...GOOD, unlit: GOOD.lit }) as any)).rejects.toThrow("still lit")
    })

    it("fails a picture made from bytes that drew nothing, as tex.pixels did alone", async () => {
        await expect(check(fake({ ...GOOD, pixels: GOOD.unlit }) as any)).rejects.toThrow("the picture did not draw")
    })

    it("fails an added quad that covers the floor instead, or adds in sRGB", async () => {
        await expect(check(fake({ ...GOOD, added: [128, 128, 128] }) as any)).rejects.toThrow("not added")
        await expect(check(fake({ ...GOOD, added: [255, 255, 255] }) as any)).rejects.toThrow("not added")
    })

    it("fails an added quad that fog turns toward its colour, adding the fog again", async () => {
        await expect(check(fake({ ...GOOD, "added in fog": [0, 0, 255] }) as any)).rejects.toThrow("the fog did not fade it out")
    })

    it("fails a lit scene, or a fog that is not on, rather than measuring nothing", async () => {
        await expect(check(fake({ ...GOOD, lit: [200, 200, 200] }) as any)).rejects.toThrow("the scene is lit")
        await expect(check(fake({ ...GOOD, "floor in fog": GOOD.floor, "added in fog": GOOD.added }) as any)).rejects.toThrow("the fog is not on")
    })
})
