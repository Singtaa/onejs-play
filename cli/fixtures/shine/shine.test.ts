import { describe, it, expect } from "vitest"
import check from "./shine.playtest.mjs"

type Squares = { left: number, right: number }

/** A game whose screenshot reads `readings[state]` for the state last shown. */
function fake(readings: Record<string, Squares>) {
    let shown = ""
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.shine")) return "object"
            if (code.includes("getContext(\"webgpu\")")) return "webgpu"
            if (code.includes("getImageData")) return JSON.stringify(readings[shown])
            const asked = code.match(/show\((.*)\)$/)
            if (!asked) throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
            shown = JSON.parse(asked[1]!)
            return shown
        },
    }
}

const PLAIN = { left: 100, right: 90 }
const GOOD = { plain: PLAIN, shone: { left: 101, right: 160 }, zero: { left: 101, right: 91 } }

describe("the shine playtest", () => {
    it("passes a shine on the square facing up and none on the one facing the camera", async () => {
        await expect(check(fake(GOOD) as any)).resolves.toBeUndefined()
    })

    it("fails no shine at all", async () => {
        await expect(check(fake({ ...GOOD, shone: PLAIN }) as any)).rejects.toThrow("the square facing up gained 0.0 levels with the picture (no shine drawn)")
    })

    it("fails a shine that ignores which way a surface faces", async () => {
        await expect(check(fake({ ...GOOD, shone: { left: 170, right: 160 } }) as any)).rejects.toThrow("the square facing the camera moved 70.0 levels")
    })

    it("fails an actor's share of 0 that still shines", async () => {
        await expect(check(fake({ ...GOOD, zero: GOOD.shone }) as any)).rejects.toThrow("at actor.shine 0 the square facing up is 70.0 levels off")
    })

    it("fails rather than measuring nothing when the squares are not lit", async () => {
        const dark = { left: 0, right: 0 }
        await expect(check(fake({ plain: dark, shone: dark, zero: dark }) as any)).rejects.toThrow("they were not drawn lit")
    })
})
