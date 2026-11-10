import { describe, it, expect } from "vitest"
import check from "./mesh-material.playtest.mjs"

/** A game whose screenshots' middle pixel is `pixels[what was last shown or changed]`. */
function fake(pixels: Record<string, number[]>) {
    let shown = ""
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.meshMaterial")) return "object"
            if (code.includes("tilted: true")) shown = "glossy tilted"
            else if (code.includes("soften")) shown = "softened"
            else if (code.includes("deepColor")) shown = "deep"
            else if (code.includes("floor: 0.25")) shown = "shallow"
            else if (code.includes("show({})")) shown = "rough"
            else if (code.includes("show({ roughness")) shown = "glossy"
            else if (code.includes("show({ metallic")) shown = "metal"
            else if (code.includes("change({ roughness: 0.15")) shown = "made glossy after"
            else if (code.includes("color")) shown = "made red after"
            else if (code.includes("getImageData")) return JSON.stringify(pixels[shown])
            else throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
            return undefined
        },
    }
}

const GOOD = {
    rough: [90, 90, 90],
    glossy: [200, 200, 200],
    metal: [40, 40, 40],
    "made glossy after": [201, 200, 199],
    "made red after": [150, 20, 20],
    shallow: [140, 140, 140],
    softened: [40, 40, 40],
    deep: [160, 30, 30],
    "glossy tilted": [100, 100, 100],
}

describe("the mesh-material playtest", () => {
    it("passes a quad that glints, darkens as metal, and changes after it is made", async () => {
        await expect(check(fake(GOOD) as any)).resolves.toBeUndefined()
    })

    it("fails a glossy quad without a highlight, as every mesh drew on 1.7", async () => {
        await expect(check(fake({ ...GOOD, glossy: GOOD.rough, "made glossy after": GOOD.rough }) as any)).rejects.toThrow("no highlight")
    })

    it("fails a metal quad that still scatters", async () => {
        await expect(check(fake({ ...GOOD, metal: GOOD.rough }) as any)).rejects.toThrow("still scattering light")
    })

    it("fails a roughness or a colour set after creation that drew nothing", async () => {
        await expect(check(fake({ ...GOOD, "made glossy after": GOOD.rough }) as any)).rejects.toThrow("made glossy after it was made")
        await expect(check(fake({ ...GOOD, "made red after": GOOD.rough }) as any)).rejects.toThrow("made red after it was made")
    })

    it("fails a softened quad that does not fade at the shore, and deep water that stays its colour", async () => {
        await expect(check(fake({ ...GOOD, softened: GOOD.shallow }) as any)).rejects.toThrow("no fade at the shore")
        await expect(check(fake({ ...GOOD, deep: GOOD.shallow }) as any)).rejects.toThrow("3 m deep under a red deepColor")
    })

    it("fails a normal map that bends nothing", async () => {
        await expect(check(fake({ ...GOOD, "glossy tilted": GOOD.glossy }) as any)).rejects.toThrow("the normal map bent nothing")
    })

    it("fails when nothing was lit, rather than measuring black", async () => {
        await expect(check(fake({ rough: [0, 0, 0], glossy: [0, 0, 0], metal: [0, 0, 0], "made glossy after": [0, 0, 0], "made red after": [0, 0, 0], shallow: [0, 0, 0], softened: [0, 0, 0], deep: [0, 0, 0], "glossy tilted": [0, 0, 0] }) as any)).rejects.toThrow("nothing was lit")
    })
})
