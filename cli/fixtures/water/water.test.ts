import { describe, it, expect } from "vitest"
import check from "./water.playtest.mjs"

type Patch = { red: number, grey: number, samples: number[] }
type Look = { near: Patch, far: Patch, band: Patch }

const LOOKS = ["plain", "red", "foam", "still", "still later", "swell", "swell later", "plain again"] as const

const flat = (red: number, grey: number, sample = grey): Patch => ({ red, grey, samples: [sample, sample, sample, sample] })

/** A game whose screenshots read `looks`, one look a screenshot, in the playtest's order. */
function fake(looks: Record<(typeof LOOKS)[number], Look>) {
    let shot = 0
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.water")) return "object"
            if (code.includes("getImageData")) {
                const l = looks[LOOKS[shot++]!]
                return JSON.stringify([l.near, l.far, l.band])
            }
            if (code.includes("globalThis.water.set(")) return undefined
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

const PLAIN: Look = { near: flat(40, 50), far: flat(30, 40), band: flat(30, 40) }
const RED: Look = { near: flat(50, 52), far: flat(80, 57), band: flat(85, 58) }
const GOOD = {
    plain: PLAIN,
    red: RED,
    foam: { ...RED, band: flat(200, 190) },
    still: RED,
    "still later": RED,
    swell: { ...RED, far: flat(80, 57, 60) },
    "swell later": { ...RED, far: flat(80, 57, 50) },
    "plain again": PLAIN,
}

describe("the water playtest", () => {
    it("passes water that reflects more far than near, foams at the wall, and swells", async () => {
        await expect(check(fake(GOOD) as any)).resolves.toBeUndefined()
    })

    it("fails a host that draws no reflection, rather than measuring nothing", async () => {
        await expect(check(fake({ ...GOOD, red: PLAIN, foam: PLAIN, still: PLAIN, "still later": PLAIN }) as any)).rejects.toThrow("no reflection drawn")
    })

    it("fails a reflection that is as strong near as far", async () => {
        await expect(check(fake({ ...GOOD, red: { ...RED, near: flat(90, 60) } }) as any)).rejects.toThrow("it does not reflect more the lower it is seen")
    })

    it("fails foam that never shows, or spreads past the shore", async () => {
        await expect(check(fake({ ...GOOD, foam: RED }) as any)).rejects.toThrow("no foam")
        await expect(check(fake({ ...GOOD, foam: { ...GOOD.foam, far: flat(80, 120) } }) as any)).rejects.toThrow("the foam spread past the shore")
    })

    it("fails still water that moves, a swell that does not, and a plain that does not come back", async () => {
        await expect(check(fake({ ...GOOD, "still later": { ...RED, far: flat(80, 57, 70) } }) as any)).rejects.toThrow("still water changed")
        await expect(check(fake({ ...GOOD, "swell later": GOOD.swell }) as any)).rejects.toThrow("it did not move")
        await expect(check(fake({ ...GOOD, "plain again": RED }) as any)).rejects.toThrow("plain again")
    })
})
