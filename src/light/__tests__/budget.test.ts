import { PATH_BUDGET, pathBudget, type PathBudget } from "../budget"
import RECORDED from "./budget-runs.json"

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

    /** A budget past its warm-up and four growths, with the count it then asks for. */
    function grown(): [PathBudget, number] {
        const b = pathBudget()
        feed(b, times(PATH_BUDGET.warmup + 4, REFRESH))
        return [b, b.paths]
    }

    it("halves once for one overflow, however many frames the GPU's queue shows it for", () => {
        const [b, before] = grown()
        const counts = feed(b, times(PATH_BUDGET.recoverFrames, 2 * REFRESH))
        expect(counts).toEqual(times(PATH_BUDGET.recoverFrames, Math.floor(before / 2)))
    })

    it("halves again when frames stay over the line that many frames after a halving", () => {
        const [b, before] = grown()
        const counts = feed(b, times(PATH_BUDGET.recoverFrames + 1, 2 * REFRESH))
        expect(counts.at(-1)).toBe(Math.floor(Math.floor(before / 2) / 2))
    })

    it("halves at once for the next overflow once a frame has come back inside the line", () => {
        const [b, before] = grown()
        feed(b, [2 * REFRESH, REFRESH + 3])
        expect(b.paths).toBe(Math.floor(before / 2))
        expect(b.frame(2 * REFRESH)).toBe(Math.floor(Math.floor(before / 2) / 2))
    })

    /**
     * A recorded bake's frames, the bake's cost modelled on them: each recorded interval
     * stands for the game's own, except an over-the-line one the run's own counts explain
     * (the count `lag` frames back over `cap`), which becomes one refresh; then a frame
     * whose count `lag` frames back is over `cap` takes one refresh more, as vsync does.
     * Runs until the budget has traced the recorded bake's paths.
     */
    function replay(run: typeof RECORDED.runs[number]) {
        const game = run.intervals.map((ms, i) => ms > run.refresh + 4 && (run.asked[i - run.lag] ?? 0) > run.cap ? run.refresh : ms)
        const b = pathBudget()
        const counts: number[] = []
        let interval: number | null = null
        let done = 0
        let over = 0
        let ms = 0
        while (done < run.total && counts.length < 5000) {
            const i = counts.length
            const n = b.frame(interval)
            counts.push(n)
            done += n
            interval = (game[i] ?? run.refresh) + ((counts[i - run.lag + 1] ?? 0) > run.cap ? run.refresh : 0)
            ms += interval
            if (b.baselineMs !== null && interval > b.baselineMs + PATH_BUDGET.shrinkOverMs) over++
        }
        return { frames: counts.length, over, ms }
    }

    it("bakes a recorded 120 Hz run in a fifth fewer frames than halving every slow frame did", () => {
        const run = RECORDED.runs.find((r) => r.name.startsWith("120 Hz"))!
        const now = replay(run)
        expect(now.frames).toBeLessThanOrEqual(0.85 * run.old.frames)
        // What it costs: a few more frames over the line while the queue drains.
        expect(now.over).toBeLessThanOrEqual(run.old.over + 4)
    })

    it("bakes every recorded run no slower than before, with at most four more frames over the line", () => {
        for (const run of RECORDED.runs) {
            const now = replay(run)
            expect(now.frames, run.name).toBeLessThanOrEqual(run.old.frames)
            expect(now.over, run.name).toBeLessThanOrEqual(run.old.over + 4)
        }
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
