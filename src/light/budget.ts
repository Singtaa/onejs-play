/**
 * How many tiles a bake traces a frame, from how long its frames take.
 *
 * The unit is the bake's tile (LightBaker's TileSize squared, SamplesPerPass
 * paths a texel), because that is what a step traces: whole tiles, at least
 * one. A budget counted in paths below a tile asked for work the bake could
 * not do, and read its own count where the GPU saw a tile.
 *
 * No backend a cart runs on gives the bake's GPU time: its draws are queued,
 * so StepBake returns at once, and WebGL 2 on Safari has no timer query. What
 * the bake loop can see is the interval between its frames, so the budget is
 * that interval against the game's own: the bake may add 2 to 4 ms to it.
 *
 * The game's own interval (the baseline) comes from a warm-up the bake runs
 * itself, at one tile, rather than from frames before the bake: a bake that
 * starts on the first frame has none, and those frames are the load. The
 * warm-up's first frames are dropped too, since the bake's first steps compile
 * its shaders, and the rest give their median. Later frames that run faster
 * lower it, by the median of the last `recent` so one short frame cannot;
 * nothing raises it, or the bake's own cost would become the baseline.
 *
 * Under vsync a GPU's spare time is invisible until it runs out, when the
 * interval jumps a whole refresh. So the count grows while frames stay within
 * `growUnderMs` of the baseline, holds up to `shrinkOverMs`, and above that
 * halves. A browser queues `lagFrames` frames of GPU work, so a count shows in
 * the interval that many frames later, and that tells the two kinds of slow
 * frame apart:
 *
 * - An overflow comes within `lagFrames` of the count growing. It halves, and
 *   keeps a ceiling below the count that showed, which stops it climbing
 *   straight back into the same jump. The ceiling rises a tile after
 *   `relaxAfter` steady frames, so a GPU with room is found again.
 * - A hitch comes at a count that has already run clean through its lag: the
 *   game, the compositor or the OS took the frame. It holds, and halves only
 *   if the next frame is over too. It never lowers the ceiling. The phone run
 *   of 7 Nov (a Mali-G715) dropped a refresh about one frame in twenty at any
 *   count, and halving and lowering the ceiling for each pinned its bake at
 *   one tile a frame for 45 s.
 *
 * The queue also shows one overflow for several frames, so it halves once an
 * overflow: after a halving it holds until a frame comes back inside the
 * shrink line, and halves again only when `recoverFrames` frames in a row stay
 * over it. Halving every slow frame took a 120 Hz bake from 18 tiles to 1.
 * budget.test.ts replays the recorded 60 Hz, 120 Hz and phone bakes.
 */
export const TILE_BUDGET = {
    /** The warm-up's count, and the floor. */
    min: 1,
    max: 64,
    /** Warm-up frames: the first `dropped` are shader compiles and load, the rest give the baseline. */
    warmup: 10,
    dropped: 2,
    growUnderMs: 2,
    shrinkOverMs: 4,
    grow: 1.25,
    /** After an overflow the ceiling is this share of the count that showed. */
    ceilingShare: 0.8,
    /** Steady frames at the ceiling before it rises a tile. */
    relaxAfter: 60,
    /** Frames whose median may lower the baseline. */
    recent: 5,
    /** Frames in a row still over the shrink line, after a halving, before it halves again. */
    recoverFrames: 6,
    /** Frames from a count to the interval that shows it: the GPU's queue. */
    lagFrames: 3,
}

export type TileBudgetTuning = typeof TILE_BUDGET

export interface TileBudget {
    /** The tiles to trace this frame. */
    readonly tiles: number
    /** The game's own frame interval in ms, null during the warm-up. */
    readonly baselineMs: number | null
    /**
     * The interval that ended with this frame, in ms: the time since the last
     * frame. Null when there is none yet. Returns the tiles to trace now.
     */
    frame(intervalMs: number | null): number
}

export function tileBudget(tune: TileBudgetTuning = TILE_BUDGET): TileBudget {
    const warm: number[] = []
    const recent: number[] = []
    // The counts of the last frames, newest last: the one `lagFrames` back is what this interval shows.
    const asked: number[] = []
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
    let seen = 0
    let baseline: number | null = null
    let tiles = tune.min
    let ceiling = tune.max
    let steady = 0
    // Frames still over the line since the last halving, or -1 when none is being waited out.
    let overSince = -1
    let sinceGrowth = 0
    // The last frame was a hitch, held.
    let hitch = false

    function halve(lowersCeiling: boolean): number {
        if (lowersCeiling) {
            const shown = asked[asked.length - tune.lagFrames] ?? tiles
            ceiling = Math.max(tune.min, Math.min(tiles, Math.floor(shown * tune.ceilingShare)))
        }
        tiles = Math.max(tune.min, Math.floor(tiles / 2))
        steady = 0
        overSince = 0
        hitch = false
        return tiles
    }

    function next(intervalMs: number | null): number {
        if (intervalMs === null || !Number.isFinite(intervalMs) || intervalMs <= 0) return tiles
        if (baseline === null) {
            if (seen++ >= tune.dropped) warm.push(intervalMs)
            if (seen >= tune.warmup) baseline = median(warm)
            return tiles
        }
        recent.push(intervalMs)
        if (recent.length > tune.recent) recent.shift()
        if (recent.length === tune.recent) baseline = Math.min(baseline, median(recent))
        sinceGrowth++
        const over = intervalMs - baseline
        if (overSince >= 0) {
            if (over <= tune.shrinkOverMs) overSince = -1
            else if (++overSince < tune.recoverFrames) return tiles
            else return halve(true)
        }
        if (over > tune.shrinkOverMs) {
            if (sinceGrowth <= tune.lagFrames) return halve(true)
            if (hitch) return halve(false)
            hitch = true
            return tiles
        }
        hitch = false
        if (over <= tune.growUnderMs) {
            if (tiles >= ceiling && ++steady >= tune.relaxAfter) {
                ceiling = Math.min(tune.max, ceiling + 1)
                steady = 0
            }
            const grown = Math.min(ceiling, tune.max, Math.max(tiles + 1, Math.floor(tiles * tune.grow)))
            if (grown > tiles) sinceGrowth = 0
            tiles = grown
        }
        return tiles
    }

    return {
        get tiles() { return tiles },
        get baselineMs() { return baseline },
        frame(intervalMs) {
            const n = next(intervalMs)
            asked.push(n)
            if (asked.length > tune.lagFrames) asked.shift()
            return n
        },
    }
}
