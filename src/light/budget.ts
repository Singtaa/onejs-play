/**
 * How many paths a bake traces a frame, from how long its frames take.
 *
 * No backend a cart runs on gives the bake's GPU time: its draws are queued,
 * so StepBake returns at once, and WebGL 2 on Safari has no timer query. What
 * the bake loop can see is the interval between its frames, so the budget is
 * that interval against the game's own: the bake may add 2 to 4 ms to it.
 *
 * The game's own interval (the baseline) comes from a warm-up the bake runs
 * itself, at the smallest count, rather than from frames before the bake: a
 * bake that starts on the first frame has none, and those frames are the load.
 * The warm-up's first frames are dropped too, since the bake's first steps
 * compile its shaders, and the rest give their median. Later frames that run
 * faster lower it, by the median of the last `recent` so one short frame
 * cannot; nothing raises it, or the bake's own cost would become the baseline.
 *
 * Under vsync a GPU's spare time is invisible until it runs out, when the
 * interval jumps a whole refresh (16.7 to 33.3 ms). So the count grows while
 * frames stay within `growUnderMs` of the baseline, holds up to
 * `shrinkOverMs`, and above that halves and keeps a ceiling below the count
 * that overflowed, which is what stops it climbing straight back into the same
 * jump. The ceiling rises again after a long steady run, so one hitch from
 * elsewhere does not slow the rest of the bake.
 *
 * A browser queues frames of GPU work, so the intervals after a halving still
 * show the counts before it, for as many frames as that queue takes to drain.
 * So it halves once an overflow: after a halving it holds until a frame comes
 * back inside the shrink line, and halves again only when `recoverFrames`
 * frames in a row stay over it. Measured at 120 Hz (Sai's Mac, 7 Nov),
 * halving every slow frame took 298k paths to 29k in 11 frames where 142k ran
 * clean, and the bake took 5.7 s where 3.4 s did at 60 Hz. budget.test.ts
 * replays that run's intervals.
 */
export const PATH_BUDGET = {
    /** The warm-up's count, and the floor. */
    min: 4_096,
    max: 1_048_576,
    /** Where the count starts after the warm-up: about half a millisecond of a desktop GPU's time. */
    start: 16_384,
    /** Warm-up frames: the first `dropped` are shader compiles and load, the rest give the baseline. */
    warmup: 10,
    dropped: 2,
    growUnderMs: 2,
    shrinkOverMs: 4,
    grow: 1.25,
    /** After an overflow the ceiling is this share of the count that overflowed. */
    ceilingShare: 0.8,
    /** Steady frames at the ceiling before it rises by `grow`. */
    relaxAfter: 60,
    /** Frames whose median may lower the baseline. */
    recent: 5,
    /** Frames in a row still over the shrink line, after a halving, before it halves again. */
    recoverFrames: 6,
}

export type PathBudgetTuning = typeof PATH_BUDGET

export interface PathBudget {
    /** The paths to trace this frame. */
    readonly paths: number
    /** The game's own frame interval in ms, null during the warm-up. */
    readonly baselineMs: number | null
    /**
     * The interval that ended with this frame, in ms: the time since the last
     * frame, which is when the last count's work showed. Null when there is
     * none yet. Returns the paths to trace now.
     */
    frame(intervalMs: number | null): number
}

export function pathBudget(tune: PathBudgetTuning = PATH_BUDGET): PathBudget {
    const warm: number[] = []
    const recent: number[] = []
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
    let seen = 0
    let baseline: number | null = null
    let paths = tune.min
    let ceiling = tune.max
    let steady = 0
    // Frames still over the line since the last halving, or -1 when none is being waited out.
    let overSince = -1
    return {
        get paths() { return paths },
        get baselineMs() { return baseline },
        frame(intervalMs) {
            if (intervalMs === null || !Number.isFinite(intervalMs) || intervalMs <= 0) return paths
            if (baseline === null) {
                if (seen++ >= tune.dropped) warm.push(intervalMs)
                if (seen < tune.warmup) return paths
                baseline = median(warm)
                paths = tune.start
                return paths
            }
            recent.push(intervalMs)
            if (recent.length > tune.recent) recent.shift()
            if (recent.length === tune.recent) baseline = Math.min(baseline, median(recent))
            const over = intervalMs - baseline
            if (overSince >= 0) {
                if (over <= tune.shrinkOverMs) overSince = -1
                else if (++overSince < tune.recoverFrames) return paths
            }
            if (over > tune.shrinkOverMs) {
                ceiling = Math.max(tune.min, Math.floor(paths * tune.ceilingShare))
                paths = Math.max(tune.min, Math.floor(paths / 2))
                steady = 0
                overSince = 0
            } else if (over <= tune.growUnderMs) {
                if (paths >= ceiling && ++steady >= tune.relaxAfter) {
                    ceiling = Math.min(tune.max, Math.floor(ceiling * tune.grow))
                    steady = 0
                }
                paths = Math.min(ceiling, tune.max, Math.max(paths + 1, Math.floor(paths * tune.grow)))
            }
            return paths
        },
    }
}
