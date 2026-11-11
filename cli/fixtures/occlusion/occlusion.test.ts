import { describe, it, expect } from "vitest"
import check from "./occlusion.playtest.mjs"

type Reading = { strip: number, panel: number, spread?: number }

/** A game whose screenshot's strip and panel read `readings[the look last set]`. */
function fake(readings: Record<string, Reading>) {
    let shown = "host"
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.occlusion")) return "object"
            if (code.includes("getImageData")) {
                const r = readings[shown]!
                return JSON.stringify([{ mean: r.strip, spread: r.spread ?? 3 }, { mean: r.panel, spread: 1 }])
            }
            if (code.includes("set(false)")) shown = "off"
            else if (code.includes("intensity: 2")) shown = "darker"
            else if (code.includes("set(true)")) shown = "host again"
            else throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
            return undefined
        },
    }
}

const GOOD: Record<string, Reading> = {
    host: { strip: 150, panel: 180 },
    off: { strip: 179, panel: 180 },
    darker: { strip: 110, panel: 180 },
    "host again": { strip: 151, panel: 180 },
}

describe("the occlusion playtest", () => {
    it("passes occlusion that turns off, darkens, and comes back", async () => {
        await expect(check(fake(GOOD) as any)).resolves.toBeUndefined()
    })

    it("fails an off that leaves the corner dark", async () => {
        await expect(check(fake({ ...GOOD, off: GOOD.host! }) as any)).rejects.toThrow("off, the wall beside a timber is still")
    })

    it("fails an intensity that changes nothing, and a true that does not come back", async () => {
        await expect(check(fake({ ...GOOD, darker: GOOD.host! }) as any)).rejects.toThrow("the intensity did nothing")
        await expect(check(fake({ ...GOOD, "host again": GOOD.off! }) as any)).rejects.toThrow("set back to true")
    })

    it("fails a host that draws no occlusion, or an unlit wall, rather than measuring nothing", async () => {
        const flat = { strip: 180, panel: 180 }
        await expect(check(fake({ host: flat, off: flat, darker: flat, "host again": flat }) as any)).rejects.toThrow("no occlusion drawn")
        const dark = { strip: 0, panel: 0 }
        await expect(check(fake({ host: dark, off: dark, darker: dark, "host again": dark }) as any)).rejects.toThrow("the wall was not lit")
    })
})
