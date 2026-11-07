import { PATH_BUDGET, pathBudget, type PathBudget } from "../budget"

const REFRESH = 1000 / 60

/** Feeds the budget each interval in turn, returning the count after each. */
function feed(b: PathBudget, intervals: (number | null)[]): number[] {
    return intervals.map((ms) => b.frame(ms))
}

const times = (n: number, ms: number | null) => Array.from({ length: n }, () => ms)

/**
 * A vsync'd GPU with `spare` paths of room a frame: a frame's interval is one
 * refresh while the count `lag` frames back fits, two when it does not. Runs
 * `frames` frames and returns the count each frame asked for.
 */
function vsync(b: PathBudget, spare: number, frames: number, lag = 1, hitchAt: number[] = []): number[] {
    const asked: number[] = []
    let interval: number | null = null
    for (let f = 0; f < frames; f++) {
        asked.push(b.frame(interval))
        const shown = asked[f - lag + 1] ?? asked[0]!
        interval = hitchAt.includes(f) || shown > spare ? 2 * REFRESH : REFRESH
    }
    return asked
}

describe("the bake's path budget", () => {
    it("traces the smallest count through the warm-up, then starts from the warm-up's baseline", () => {
        const b = pathBudget()
        const counts = feed(b, times(PATH_BUDGET.warmup, REFRESH))
        expect(counts.slice(0, -1)).toEqual(times(PATH_BUDGET.warmup - 1, PATH_BUDGET.min))
        expect(counts.at(-1)).toBe(PATH_BUDGET.start)
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
    })

    it("takes a bake that starts on the first frame, with no interval yet, without counting that frame", () => {
        const b = pathBudget()
        expect(b.frame(null)).toBe(PATH_BUDGET.min)
        expect(b.baselineMs).toBeNull()
        // The null frame is not one of the warm-up's: ten real intervals still follow it.
        const counts = feed(b, times(PATH_BUDGET.warmup, REFRESH))
        expect(counts.at(-2)).toBe(PATH_BUDGET.min)
        expect(counts.at(-1)).toBe(PATH_BUDGET.start)
    })

    it("drops the warm-up's first frames, which compile the bake's shaders", () => {
        const b = pathBudget()
        // Kept: 10 to 17 ms, whose median is 14. With the two long ones it would be 15.
        const kept = Array.from({ length: PATH_BUDGET.warmup - PATH_BUDGET.dropped }, (_, k) => 10 + k)
        feed(b, [...times(PATH_BUDGET.dropped, 900), ...kept])
        expect(b.baselineMs).toBe(14)
    })

    it("lowers a baseline the load inflated once frames run faster, and grows from there", () => {
        const b = pathBudget()
        // A bake started on frame 1: its whole warm-up is the load's long frames.
        feed(b, times(PATH_BUDGET.warmup, 60))
        expect(b.baselineMs).toBe(60)
        feed(b, times(PATH_BUDGET.recent, REFRESH))
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
        // A frame at the old baseline is far over the new one, so it halves.
        const before = b.paths
        expect(b.frame(60)).toBe(Math.floor(before / 2))
    })

    it("does not lower the baseline for one short frame", () => {
        const b = pathBudget()
        feed(b, times(PATH_BUDGET.warmup, REFRESH))
        feed(b, [...times(PATH_BUDGET.recent - 1, REFRESH), 4, ...times(PATH_BUDGET.recent - 1, REFRESH)])
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
    })

    it("never raises the baseline, so the bake's own cost does not become it", () => {
        const b = pathBudget()
        feed(b, times(PATH_BUDGET.warmup, REFRESH))
        feed(b, times(3 * PATH_BUDGET.recent, REFRESH + 3))
        expect(b.baselineMs).toBeCloseTo(REFRESH, 6)
    })

    it("grows while frames stay within 2 ms of the baseline, holds to 4 ms, and halves past it", () => {
        const b = pathBudget()
        feed(b, times(PATH_BUDGET.warmup, REFRESH))
        expect(b.frame(REFRESH + 1.9)).toBe(Math.floor(PATH_BUDGET.start * PATH_BUDGET.grow))
        const held = b.paths
        expect(b.frame(REFRESH + 3.9)).toBe(held)
        expect(b.frame(REFRESH + 4.1)).toBe(Math.floor(held / 2))
    })

    it("halves once for one overflow, though the GPU's queue shows it for a frame or two more", () => {
        const b = pathBudget()
        feed(b, times(PATH_BUDGET.warmup, REFRESH))
        feed(b, times(4, REFRESH))
        const before = b.paths
        const counts = feed(b, times(1 + PATH_BUDGET.settle, 2 * REFRESH))
        expect(counts).toEqual(times(1 + PATH_BUDGET.settle, Math.floor(before / 2)))
    })

    it("settles under a vsync overflow instead of climbing back into it", () => {
        const spare = 200_000
        for (const lag of [1, 2, 3]) {
            const asked = vsync(pathBudget(), spare, 600, lag)
            const late = asked.slice(300)
            // At most one overflow a relax period once settled, and most of the room used.
            const over = late.filter((n) => n > spare).length
            expect(over, `lag ${lag}`).toBeLessThanOrEqual(Math.ceil(300 / PATH_BUDGET.relaxAfter) * lag)
            const mean = late.reduce((s, n) => s + n, 0) / late.length
            expect(mean, `lag ${lag}`).toBeGreaterThan(0.5 * spare)
        }
    })

    it("keeps a ceiling below the count that overflowed, and raises it after a steady run", () => {
        const b = pathBudget()
        feed(b, times(PATH_BUDGET.warmup, REFRESH))
        for (let f = 0; f < 100 && b.paths < 100_000; f++) b.frame(REFRESH)
        expect(b.paths).toBeGreaterThanOrEqual(100_000)
        const overflowed = b.paths
        b.frame(2 * REFRESH)
        feed(b, times(PATH_BUDGET.settle, REFRESH))
        const ceiling = Math.floor(overflowed * PATH_BUDGET.ceilingShare)
        const counts = feed(b, times(PATH_BUDGET.relaxAfter - 1, REFRESH))
        expect(Math.max(...counts)).toBe(ceiling)
        // A hitch from elsewhere does not hold the rest of the bake down.
        feed(b, times(PATH_BUDGET.relaxAfter * 3, REFRESH))
        expect(b.paths).toBeGreaterThan(overflowed)
    })

    it("stays between the floor and the cap, and ignores an interval it cannot read", () => {
        const slow = pathBudget()
        feed(slow, times(PATH_BUDGET.warmup, REFRESH))
        feed(slow, times(40, 100))
        expect(slow.paths).toBe(PATH_BUDGET.min)
        const fast = pathBudget()
        feed(fast, times(PATH_BUDGET.warmup + 100, REFRESH))
        expect(fast.paths).toBe(PATH_BUDGET.max)
        for (const bad of [NaN, 0, -5, Infinity, null]) {
            const b = pathBudget()
            feed(b, times(PATH_BUDGET.warmup + PATH_BUDGET.recent, REFRESH))
            const at = b.paths
            expect(b.frame(bad), String(bad)).toBe(at)
            expect(b.baselineMs, String(bad)).toBeCloseTo(REFRESH, 6)
            expect(b.frame(REFRESH), String(bad)).toBe(Math.floor(at * PATH_BUDGET.grow))
        }
    })
})
