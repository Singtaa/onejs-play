import { describe, it, expect, vi } from "vitest"
import check, { PEOPLE } from "./crowd.playtest.mjs"

/** A game whose main thread reads `ms.empty`, `ms.unseen` and `ms.updating` a frame in turn. */
const BACK = { before: { x: 640, y: 400 }, after: { x: 420, y: 400 }, pickedAfter: true, pickedBefore: false }

function fake(ms: { empty: number, unseen: number, updating: number }, { frames = 100, changed = PEOPLE, made = (n: number) => n, back = BACK as object } = {}) {
    let now: keyof typeof ms = "empty"
    return {
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.crowd")) return "object"
            const set = code.match(/crowd\.set\((.*)\)$/)
            if (set) {
                const count = JSON.parse(set[1]).count
                now = count === 0 ? "empty" : "unseen"
                return made(count)
            }
            if (code.includes("askReadBack")) return undefined
            if (code.includes("crowd.readBack !== null")) return true
            if (code.includes("crowd.readBack")) return JSON.stringify(back)
            if (code.includes("updateOffscreen")) { now = "updating"; return changed }
            if (code.includes("crowd.frames()")) return JSON.stringify({ count: frames, mean: 16.7, median: 16.7, main: frames === 0 ? -1 : ms[now], mainCount: frames })
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

describe("the crowd playtest", () => {
    vi.spyOn(console, "log").mockImplementation(() => {})

    it("passes an unseen crowd that costs a small share of one made to update off screen", async () => {
        await expect(check(fake({ empty: 0.2, unseen: 0.6, updating: 5.2 }) as any)).resolves.toBeUndefined()
    })

    it("fails when an unseen crowd costs what one made to update does, as before runtime 1.9", async () => {
        await expect(check(fake({ empty: 0.2, unseen: 5.1, updating: 5.2 }) as any)).rejects.toThrow("is being skinned or sampled again")
    })

    it("fails when the cost creeps half way back", async () => {
        await expect(check(fake({ empty: 0.2, unseen: 2.7, updating: 5.2 }) as any)).rejects.toThrow("is being skinned or sampled again")
    })

    it("fails a run where making them update costs nothing, which could not tell", async () => {
        await expect(check(fake({ empty: 0.2, unseen: 0.21, updating: 0.25 }) as any)).rejects.toThrow("cannot tell")
    })

    it("fails when the main thread's time was not read", async () => {
        await expect(check(fake({ empty: 0.2, unseen: 0.6, updating: 5.2 }, { frames: 0 }) as any)).rejects.toThrow("nothing was measured")
    })

    it("fails when a place read back in the frame that moved it is the old place", async () => {
        const ms = { empty: 0.2, unseen: 0.6, updating: 5.2 }
        await expect(check(fake(ms, { back: { ...BACK, after: BACK.before } }) as any)).rejects.toThrow("screenPoint saw the old place")
        await expect(check(fake(ms, { back: { ...BACK, pickedAfter: false } }) as any)).rejects.toThrow("did not find it")
        await expect(check(fake(ms, { back: { ...BACK, pickedBefore: true } }) as any)).rejects.toThrow("still found it")
        await expect(check(fake(ms, { back: { ...BACK, after: null } }) as any)).rejects.toThrow("nothing was read back")
    })

    it("fails when not every mesh was made to update, or not every person was made", async () => {
        await expect(check(fake({ empty: 0.2, unseen: 0.6, updating: 5.2 }, { changed: 3 }) as any)).rejects.toThrow("not the one meant")
        await expect(check(fake({ empty: 0.2, unseen: 0.6, updating: 5.2 }, { made: () => 7 }) as any)).rejects.toThrow("were made")
    })
})
