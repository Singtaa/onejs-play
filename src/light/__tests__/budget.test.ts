import { TILE_BUDGET, tileBudget, type TileBudget } from "../budget"
import RECORDED from "./budget-runs.json"
import { replay, tilePaths, type RecordedRun } from "./replay"

const REFRESH = 1000 / 60

/** Feeds the budget each interval in turn, returning the count after each. */
function feed(b: TileBudget, intervals: (number | null)[]): number[] {
    return intervals.map((ms) => b.frame(ms))
}

const times = (n: number, ms: number | null) => Array.from({ length: n }, () => ms)
const grown = (n: number) => Math.max(n + 1, Math.floor(n * TILE_BUDGET.grow))

/**
 * A vsync'd GPU with `spare` tiles of room a frame: a frame's interval is one
 * refresh while the count `lag` frames back fits, two when it does not. Runs
 * `frames` frames and returns the count each frame asked for.
 */
function vsync(b: TileBudget, spare: number, frames: number, lag = 1): number[] {
    const asked: number[] = []
    let interval: number | null = null
    for (let f = 0; f < frames; f++) {
        asked.push(b.frame(interval))
        const shown = asked[f - lag + 1] ?? asked[0]!
        interval = shown > spare ? 2 * REFRESH : REFRESH
    }
    return asked
}

/** A budget past its warm-up and `growths` growths, with the counts it asked. */
function ramped(growths: number): [TileBudget, number[]] {
    const b = tileBudget()
    return [b, feed(b, times(TILE_BUDGET.warmup + growths, REFRESH))]
}

/** A budget whose count has run clean, held, for longer than its lag: a slow frame now is a hitch. */
function held(): [TileBudget, number] {
    const [b] = ramped(6)
    // Between the grow and shrink lines: the count holds.
    feed(b, times(TILE_BUDGET.lagFrames + 1, REFRESH + 3))
    return [b, b.tiles]
}

describe("the bake's tile budget", () => {
    it("traces one tile through the warm-up, then grows from the warm-up's baseline", () => {
        const b = tileBudget()
        expect(feed(b, times(TILE_BUDGET.warmup, REFRESH))).toEqual(times(TILE_BUDGET.warmup, TILE_BUDGET.min))
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
        expect(b.frame(REFRESH)).toBe(grown(TILE_BUDGET.min))
    })

    it("takes a bake that starts on the first frame, with no interval yet, without counting that frame", () => {
        const b = tileBudget()
        expect(b.frame(null)).toBe(TILE_BUDGET.min)
        expect(b.baselineMs).toBeNull()
        // The null frame is not one of the warm-up's: ten real intervals still follow it.
        feed(b, times(TILE_BUDGET.warmup - 1, REFRESH))
        expect(b.baselineMs).toBeNull()
        b.frame(REFRESH)
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
    })

    it("drops the warm-up's first frames, which compile the bake's shaders", () => {
        const b = tileBudget()
        // Kept: 10 to 17 ms, whose median is 14. With the two long ones it would be 15.
        const kept = Array.from({ length: TILE_BUDGET.warmup - TILE_BUDGET.dropped }, (_, k) => 10 + k)
        feed(b, [...times(TILE_BUDGET.dropped, 900), ...kept])
        expect(b.baselineMs).toBe(14)
    })

    it("lowers a baseline the load inflated once frames run faster", () => {
        const b = tileBudget()
        // A bake started on frame 1: its whole warm-up is the load's long frames.
        feed(b, times(TILE_BUDGET.warmup, 60))
        expect(b.baselineMs).toBe(60)
        feed(b, times(TILE_BUDGET.recent, REFRESH))
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
        // A frame at the old baseline, right after growing, is far over the new one: it halves.
        const before = b.tiles
        expect(b.frame(60)).toBe(Math.floor(before / 2))
    })

    it("does not lower the baseline for one short frame", () => {
        const b = tileBudget()
        feed(b, times(TILE_BUDGET.warmup, REFRESH))
        feed(b, [...times(TILE_BUDGET.recent - 1, REFRESH), 4, ...times(TILE_BUDGET.recent - 1, REFRESH)])
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
    })

    it("never raises the baseline, so the bake's own cost does not become it", () => {
        const b = tileBudget()
        feed(b, times(TILE_BUDGET.warmup, REFRESH))
        feed(b, times(3 * TILE_BUDGET.recent, REFRESH + 3))
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
    })

    it("grows while frames stay within 2 ms of the baseline, holds to 4 ms, and halves past it", () => {
        const [b] = ramped(4)
        const at = b.tiles
        expect(b.frame(REFRESH + 1.9)).toBe(grown(at))
        expect(b.frame(REFRESH + 3.9)).toBe(grown(at))
        expect(b.frame(REFRESH + 4.1)).toBe(Math.floor(grown(at) / 2))
    })

    it("halves an overflow at once and keeps a ceiling below the count it was at", () => {
        const [b] = ramped(8)
        const ceiling = Math.floor(b.tiles * TILE_BUDGET.ceilingShare)
        b.frame(2 * REFRESH)
        const after = feed(b, times(TILE_BUDGET.relaxAfter - 1, REFRESH))
        expect(Math.max(...after)).toBe(ceiling)
    })

    it("halves once for one overflow, however many frames the GPU's queue shows it for", () => {
        const [b] = ramped(4)
        const before = b.tiles
        const counts = feed(b, times(TILE_BUDGET.recoverFrames, 2 * REFRESH))
        expect(counts).toEqual(times(TILE_BUDGET.recoverFrames, Math.floor(before / 2)))
    })

    it("halves again when frames stay over the line that many frames after a halving", () => {
        const [b] = ramped(4)
        const before = b.tiles
        const counts = feed(b, times(TILE_BUDGET.recoverFrames + 1, 2 * REFRESH))
        expect(counts.at(-1)).toBe(Math.floor(Math.floor(before / 2) / 2))
    })

    it("halves at once for the next overflow once a frame has come back inside the line", () => {
        const [b] = ramped(6)
        const before = b.tiles
        feed(b, [2 * REFRESH, REFRESH])
        const regrown = grown(Math.floor(before / 2))
        expect(b.tiles).toBe(regrown)
        expect(b.frame(2 * REFRESH)).toBe(Math.floor(regrown / 2))
    })

    it("holds for a hitch, a slow frame at a count that ran clean through its lag, and goes on growing after it", () => {
        const [b, at] = held()
        expect(b.frame(2 * REFRESH)).toBe(at)
        expect(b.frame(REFRESH)).toBe(grown(at))
    })

    it("takes hitches a clean frame apart as hitches, each held", () => {
        const [b, at] = held()
        for (let k = 0; k < 3; k++) {
            expect(b.frame(2 * REFRESH), `hitch ${k}`).toBe(at)
            feed(b, times(TILE_BUDGET.lagFrames + 1, REFRESH + 3))
        }
        expect(b.tiles).toBe(at)
    })

    it("halves for a second slow frame after a hitch, but leaves the ceiling where it was", () => {
        const [b, at] = held()
        feed(b, [2 * REFRESH, 2 * REFRESH])
        expect(b.tiles).toBe(Math.floor(at / 2))
        // An overflow's ceiling would stop it below the count it was at; this climbs past it.
        feed(b, times(10, REFRESH))
        expect(b.tiles).toBeGreaterThan(at)
    })

    it("takes the same slow pair again, at the count it halved or above, as an overflow: a queue deeper than its window", () => {
        const [b, at] = held()
        feed(b, [2 * REFRESH, 2 * REFRESH])
        while (b.tiles < at) b.frame(REFRESH)
        feed(b, times(TILE_BUDGET.lagFrames + 1, REFRESH + 3))
        const again = b.tiles
        feed(b, [2 * REFRESH, 2 * REFRESH])
        const after = feed(b, times(TILE_BUDGET.relaxAfter - 1, REFRESH))
        expect(Math.max(...after)).toBe(Math.floor(again * TILE_BUDGET.ceilingShare))
    })

    it("raises the ceiling a tile after a steady run, so a GPU with room is found again", () => {
        const [b] = ramped(8)
        const ceiling = Math.floor(b.tiles * TILE_BUDGET.ceilingShare)
        b.frame(2 * REFRESH)
        feed(b, times(10 + TILE_BUDGET.relaxAfter, REFRESH))
        expect(b.tiles).toBe(ceiling + 1)
        feed(b, times(TILE_BUDGET.relaxAfter, REFRESH))
        expect(b.tiles).toBe(ceiling + 2)
    })

    it("settles under a vsync overflow instead of climbing back into it", () => {
        const spare = 12
        for (const lag of [1, 2, 3]) {
            const asked = vsync(tileBudget(), spare, 600, lag)
            const late = asked.slice(300)
            // At most one overflow a relax period once settled, and most of the room used.
            const over = late.filter((n) => n > spare).length
            expect(over, `lag ${lag}`).toBeLessThanOrEqual(Math.ceil(300 / TILE_BUDGET.relaxAfter) * lag)
            const mean = late.reduce((s, n) => s + n, 0) / late.length
            expect(mean, `lag ${lag}`).toBeGreaterThan(0.5 * spare)
        }
    })

    it("stays between the floor and the cap, and ignores an interval it cannot read", () => {
        const slow = tileBudget()
        feed(slow, times(TILE_BUDGET.warmup, REFRESH))
        feed(slow, times(40, 100))
        expect(slow.tiles).toBe(TILE_BUDGET.min)
        const fast = tileBudget()
        feed(fast, times(TILE_BUDGET.warmup + 100, REFRESH))
        expect(fast.tiles).toBe(TILE_BUDGET.max)
        for (const bad of [NaN, 0, -5, Infinity, null]) {
            const b = tileBudget()
            feed(b, times(TILE_BUDGET.warmup + TILE_BUDGET.recent, REFRESH))
            const at = b.tiles
            expect(b.frame(bad), String(bad)).toBe(at)
            expect(b.baselineMs, String(bad)).toBeCloseTo(REFRESH, 6)
            expect(b.frame(REFRESH), String(bad)).toBe(grown(at))
        }
    })
})

describe("the tile budget on the recorded bakes", () => {
    const runs = RECORDED.runs as RecordedRun[]
    const run = (prefix: string) => runs.find((r) => r.name.startsWith(prefix))!
    /** The budget, answering paths: what the bake loop hands StepBake, in the bake's tiles. */
    const replayed = (r: RecordedRun, cap: number) => {
        const b = tileBudget()
        const paths = tilePaths(RECORDED.bake)
        return replay({ frame: (ms) => b.frame(ms) * paths, get baselineMs() { return b.baselineMs } }, RECORDED.bake, r, lag, cap)
    }
    // Each run is replayed on a queue of 1 to 3 frames: the recordings fit every one, and a
    // budget tuned to one lag passed its replay while the browser, at another, ran it slower.
    let lag = 0

    it("bakes the 60 Hz run faster than the path budget did at every lag, for a few frames over the line where it finds the GPU's room", () => {
        for (const gpu of run("60 Hz").gpus) {
            lag = gpu.lag
            const now = replayed(run("60 Hz"), gpu.cap)
            const at = `lag ${gpu.lag}, cap ${gpu.cap}`
            expect(now.ms, at).toBeLessThan(0.9 * gpu.old.ms)
            expect(now.over, at).toBeLessThanOrEqual(gpu.old.over + 4)
        }
    })

    it("bakes the 120 Hz run faster at every lag, for at most one more frame over the line", () => {
        for (const gpu of run("120 Hz").gpus) {
            lag = gpu.lag
            const now = replayed(run("120 Hz"), gpu.cap)
            const at = `lag ${gpu.lag}, cap ${gpu.cap}`
            expect(now.ms, at).toBeLessThan(0.95 * gpu.old.ms)
            expect(now.over, at).toBeLessThanOrEqual(gpu.old.over + 1)
        }
    })

    it("bakes the phone's run faster at any lag and room it could have had, and in under half the time from four tiles", () => {
        const tile = tilePaths(RECORDED.bake)
        for (const gpu of run("Phone").gpus) {
            lag = gpu.lag
            const now = replayed(run("Phone"), gpu.cap)
            const at = `lag ${gpu.lag}, ${gpu.cap / tile} tiles`
            expect(now.ms, at).toBeLessThan(gpu.cap >= 4 * tile ? 0.5 * gpu.old.ms : gpu.old.ms)
            if (gpu.cap >= 4 * tile) expect(now.over, at).toBeLessThanOrEqual(gpu.old.over)
        }
    })
})
