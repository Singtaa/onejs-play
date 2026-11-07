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
 * halves. A browser queues a frame or more of GPU work, so a count shows in
 * the interval a frame or more later, and when a slow frame comes tells the
 * two kinds apart:
 *
 * - An overflow comes within `lagFrames` of the count growing. It halves, and
 *   keeps a ceiling below the count it was at, which stops it climbing
 *   straight back into the same jump. The ceiling rises a tile after
 *   `relaxAfter` steady frames, so a GPU with room is found again. Not below
 *   the count some frames back: how deep the queue is varies, and in headless
 *   Chrome an overflow shows on the next frame, so the count 3 frames back was
 *   one that fitted, and a ceiling below it held a WebGL 2 bake at 8 tiles
 *   where 15 ran (4.7 s where 3.4 s did).
 * - A hitch comes at a count that has already run clean that long: the
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
 * budget.test.ts replays the recorded 60 Hz, 120 Hz and phone bakes, each at
 * a queue of 1 to 3 frames.
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
    /** After an overflow the ceiling is this share of the count it was at. */
    ceilingShare: 0.8,
    /** Steady frames at the ceiling before it rises a tile. */
    relaxAfter: 90,
    /** Frames whose median may lower the baseline. */
    recent: 5,
    /** Frames in a row still over the shrink line, after a halving, before it halves again. */
    recoverFrames: 6,
    /** Frames after the count grows in which a slow frame is its overflow; later, a hitch. */
    lagFrames: 2,
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
    // The count a hitch's second slow frame last halved, cleared by an overflow.
    let hitchHalved = Infinity

    function halve(lowersCeiling: boolean): number {
        if (lowersCeiling) {
            ceiling = Math.max(tune.min, Math.floor(tiles * tune.ceilingShare))
            hitchHalved = Infinity
        } else hitchHalved = tiles
        tiles = Math.max(tune.min, Math.floor(tiles / 2))
        steady = 0
        overSince = 0
        hitch = false
        return tiles
    }

    function frame(intervalMs: number | null): number {
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
            // The same slow pair again at the count it halved, or above it, is the GPU's queue, not a hitch.
            if (hitch) return halve(tiles >= hitchHalved)
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
        frame,
    }
}
