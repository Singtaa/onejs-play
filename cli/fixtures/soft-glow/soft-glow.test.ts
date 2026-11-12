import { describe, it, expect } from "vitest"
import check from "./soft-glow.playtest.mjs"

type Bands = { seam: number, floor: number, body: number }

/** A game whose screenshot reads `readings["<blend> cut"]` or `["<blend> soft"]`, for the glow last shown. */
function fake(readings: Record<string, Bands>) {
    let shown = ""
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.softGlow")) return "object"
            if (code.includes("getContext(\"webgpu\")")) return "webgpu"
            if (code.includes("getImageData")) return JSON.stringify(readings[shown])
            const asked = code.match(/show\((.*)\)$/)
            if (!asked) throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
            const { blend, soften } = JSON.parse(asked[1]!)
            shown = `${blend} ${soften === 0 ? "cut" : "soft"}`
            return undefined
        },
    }
}

const BLENDS = ["alpha", "add", "premultiplied", "premultipliedTexture"]
const CUT: Bands = { seam: 140, floor: 100, body: 140 }
const SOFT: Bands = { seam: 104, floor: 100, body: 140 }
const all = (cut: Bands, soft: Bands) => Object.fromEntries(BLENDS.flatMap((b) => [[`${b} cut`, cut], [`${b} soft`, soft]]))

describe("the soft glow playtest", () => {
    it("passes a glow that ends in a hard line without soften and fades into the floor with it", async () => {
        await expect(check(fake(all(CUT, SOFT)) as any)).resolves.toBeUndefined()
    })

    it("fails a softened glow that is still cut off at the floor, naming the blend", async () => {
        await expect(check(fake({ ...all(CUT, SOFT), "add soft": CUT }) as any)).rejects.toThrow("add: softened, the quad just above the floor is still 1.00 of its body (a hard cut at the floor)")
    })

    it("fails a soften that fades the whole glow", async () => {
        await expect(check(fake({ ...all(CUT, SOFT), "premultipliedTexture soft": { seam: 101, floor: 100, body: 110 } }) as any)).rejects.toThrow("premultipliedTexture: softened, its body adds 10.0 levels where unsoftened it adds 40.0")
    })

    it("fails rather than measuring nothing: no glow, no cut to see, or an unlit floor", async () => {
        const none = { seam: 100, floor: 100, body: 100 }
        await expect(check(fake(all(none, none)) as any)).rejects.toThrow("no glow drawn")
        await expect(check(fake(all(SOFT, SOFT)) as any)).rejects.toThrow("no hard cut to see")
        const dark = { seam: 0, floor: 0, body: 0 }
        await expect(check(fake(all(dark, dark)) as any)).rejects.toThrow("it was not lit")
    })
})
