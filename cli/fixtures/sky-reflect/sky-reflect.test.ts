import { describe, it, expect, vi } from "vitest"
import check from "./sky-reflect.playtest.mjs"

type Seen = { middle: number[], upper: number[] }

/**
 * A game whose screenshots are named by whether the sky was last asked to reflect, so their bytes
 * differ by state, and whose pixels are `asked` or `unasked` accordingly. `drift` makes the second
 * unasked screenshot differ from the first.
 */
function fake(unasked: Seen, asked: Seen, drift = false) {
    let reflect = false
    let unaskedShots = 0
    const pixels: Record<string, Seen> = {}
    return {
        browser: {
            send: async () => {
                const name = reflect ? "asked" : `unasked${drift ? unaskedShots++ : ""}`
                pixels[Buffer.from(name).toString("base64")] = reflect ? asked : unasked
                return { data: Buffer.from(name).toString("base64") }
            },
        },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.skyReflect")) return "object"
            if (code.includes("getContext(\"webgpu\")")) return "webgl2"
            if (code.includes("show(true)")) { reflect = true; return undefined }
            if (code.includes("show(false)")) { reflect = false; return undefined }
            const m = code.match(/base64,([A-Za-z0-9+/=]+)/)
            if (m) return JSON.stringify(pixels[m[1]])
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

const FLAT = { middle: [73, 73, 73], upper: [91, 91, 91] }
const SKY = { middle: [235, 176, 106], upper: [154, 159, 220] }

describe("the sky-reflect playtest", () => {
    vi.spyOn(console, "log").mockImplementation(() => {})

    it("passes a ball that shows the horizon at its middle and the sky above, and draws as before when not asked", async () => {
        await expect(check(fake(FLAT, SKY) as any)).resolves.toBeUndefined()
    })

    it("fails a ball that reflects the flat average when asked, as every runtime before 1.8 drew it", async () => {
        await expect(check(fake(FLAT, FLAT) as any)).rejects.toThrow("not the orange horizon")
        await expect(check(fake(FLAT, FLAT) as any)).rejects.toThrow("not the blue sky")
    })

    it("fails a ball whose sky is upside down", async () => {
        await expect(check(fake(FLAT, { middle: SKY.upper, upper: SKY.middle }) as any)).rejects.toThrow("not the orange horizon")
    })

    it("fails a scene that does not draw the same bytes once reflections are turned off again", async () => {
        await expect(check(fake(FLAT, SKY, true) as any)).rejects.toThrow("does not draw the bytes it drew before")
    })

    it("fails when nothing was lit, rather than measuring black", async () => {
        const black = { middle: [0, 0, 0], upper: [0, 0, 0] }
        await expect(check(fake(black, black) as any)).rejects.toThrow("nothing was lit")
    })
})
