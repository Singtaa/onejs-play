import { describe, it, expect, vi } from "vitest"
import check, { PEOPLE, SLOW_FRAME_MS } from "./crowd.playtest.mjs"

/** A game whose main thread reads `ms.empty`, `ms.unseen` and `ms.updating` a frame in turn. */
const BACK = { before: { x: 640, y: 400 }, after: { x: 420, y: 400 }, pickedAfter: true, pickedBefore: false }

const SEAMS = { parts: ["trunk", "legs", "arms", "head"], joints: 20, clips: 10, own: ["person"], on: [0, 0.25, 0], off: [0, 1.78, 6], scale: 0.25, walking: { head: [0.02, 1.49, 6.22], off: [0.02, 1.74, 6.22] } }

function fake(ms: { empty: number, unseen: number, updating: number }, { frames = 100, mean = 16.7, changed = PEOPLE, made = (n: number) => n, back = BACK as object, seams = SEAMS as object } = {}) {
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
            if (code.includes("crowd.seams()")) return JSON.stringify(seams)
            if (code.includes("askReadBack")) return undefined
            if (code.includes("crowd.readBack !== null")) return true
            if (code.includes("crowd.readBack")) return JSON.stringify(back)
            if (code.includes("updateOffscreen")) { now = "updating"; return changed }
            if (code.includes("crowd.frames()")) return JSON.stringify({ count: frames, mean, median: mean, main: frames === 0 ? -1 : ms[now], mainCount: frames })
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

    it("passes a machine that draws too slowly to time, saying the cost was not compared", async () => {
        const log = vi.mocked(console.log)
        log.mockClear()
        // A GitHub runner on 11 Nov 2026: software drawing, the empty scene reading the most.
        await expect(check(fake({ empty: 38.027, unseen: 2.46, updating: 7.354 }, { mean: 150 }) as any)).resolves.toBeUndefined()
        expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.startsWith("INCONCLUSIVE COST:"))).toBe(true)
    })

    it("still fails a slow machine on everything that is not a timing", async () => {
        const slow = { mean: SLOW_FRAME_MS + 1 }, ms = { empty: 38, unseen: 2.5, updating: 7.4 }
        await expect(check(fake(ms, { ...slow, seams: { ...SEAMS, joints: 0 } }) as any)).rejects.toThrow("lists 0 joints")
        await expect(check(fake(ms, { ...slow, back: { ...BACK, pickedAfter: false } }) as any)).rejects.toThrow("did not find it")
        await expect(check(fake(ms, { ...slow, changed: 3 }) as any)).rejects.toThrow("not the one meant")
        await expect(check(fake(ms, { ...slow, frames: 0 }) as any)).rejects.toThrow("nothing was measured")
    })

    it("keeps both cost checks hard on a machine that can time", async () => {
        const at = { mean: SLOW_FRAME_MS }
        await expect(check(fake({ empty: 0.2, unseen: 5.1, updating: 5.2 }, at) as any)).rejects.toThrow("is being skinned or sampled again")
        await expect(check(fake({ empty: 38.027, unseen: 2.46, updating: 7.354 }, at) as any)).rejects.toThrow("cannot tell")
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

    it("fails when a part, a joint, a borrowed clip or a hat taken off, at rest or walking, reads wrong", async () => {
        const ms = { empty: 0.2, unseen: 0.6, updating: 5.2 }
        await expect(check(fake(ms, { seams: { ...SEAMS, parts: ["person"] } }) as any)).rejects.toThrow("the models' parts read")
        await expect(check(fake(ms, { seams: { ...SEAMS, joints: 0 } }) as any)).rejects.toThrow("lists 0 joints")
        await expect(check(fake(ms, { seams: { ...SEAMS, clips: 0 } }) as any)).rejects.toThrow("plays 0 of")
        await expect(check(fake(ms, { seams: { ...SEAMS, on: [0, 1.78, 6] } }) as any)).rejects.toThrow("from the head")
        await expect(check(fake(ms, { seams: { ...SEAMS, off: [0, 0.25, 0] } }) as any)).rejects.toThrow("was left at")
        await expect(check(fake(ms, { seams: { ...SEAMS, scale: 1 } }) as any)).rejects.toThrow("came off its head at 1")
        await expect(check(fake(ms, { seams: { ...SEAMS, walking: { head: [0.02, 1.49, 6.22], off: [0.02, 1.49, 6.22] } } }) as any)).rejects.toThrow("was left 0.000 m from the head")
        await expect(check(fake(ms, { seams: { ...SEAMS, walking: { head: [0, 1.53, 6], off: [0, 1.78, 6] } } }) as any)).rejects.toThrow("no pose was compared")
        await expect(check(fake(ms, { seams: { ...SEAMS, walking: undefined } }) as any)).rejects.toThrow("no reading was taken")
    })

    it("fails when not every mesh was made to update, or not every person was made", async () => {
        await expect(check(fake({ empty: 0.2, unseen: 0.6, updating: 5.2 }, { changed: 3 }) as any)).rejects.toThrow("not the one meant")
        await expect(check(fake({ empty: 0.2, unseen: 0.6, updating: 5.2 }, { made: () => 7 }) as any)).rejects.toThrow("were made")
    })
})
