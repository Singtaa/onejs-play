/**
 * Replays a recorded bake through a budget, for budget.test.ts.
 *
 * budget-runs.json holds bakes measured on the phone page (lightmapping slice
 * 8, 7 Nov): each frame's interval as the budget saw it and the paths that
 * frame traced. The bake's work is modelled the way LightBaker.Step does it:
 * the probes' rays first, `probes * 2` paths a ray and at most 64 rays a draw,
 * then whole tiles of the atlas, a sweep at a time, at least one draw a step.
 *
 * The GPU is modelled on the run: each recorded interval stands for the game's
 * own, except an over-the-line one the run's own work explains (the work
 * `lag` frames back over `cap`), which becomes one refresh. Then a frame whose
 * work `lag` frames back is over `cap` takes one refresh more, as vsync does.
 * `cap` is the GPU's room a frame, in paths: a run's recorded counts fit some
 * caps and not others, and a run that never found its limit (the phone's)
 * leaves a range.
 */

/** The bake the runs baked: its probes and atlas, and LightBaker's tiles and samples. */
export interface RecordedBake {
    probes: number
    probeRays: number
    width: number
    height: number
    tile: number
    samplesPerPass: number
    sweeps: number
}

export interface RecordedRun {
    name: string
    /** The display's refresh interval, ms. */
    refresh: number
    lag: number
    /** Each frame's interval as the budget saw it, ms. */
    intervals: number[]
    /** Each frame's traced paths, to the bake's end. */
    traced: number[]
    /** The GPU's room a frame in paths, each cap the run is replayed at, with the budget of the day's replay at it. */
    caps: { cap: number; old: Replayed }[]
}

/** The paths a tile of a bake traces. */
export const tilePaths = (bake: RecordedBake) => bake.tile * bake.tile * bake.samplesPerPass

/** A bake's work, stepped as LightBaker.Step steps it. */
export function bakeWork(BAKE: RecordedBake) {
    const tiles: number[] = []
    for (let y = 0; y < BAKE.height; y += BAKE.tile) {
        for (let x = 0; x < BAKE.width; x += BAKE.tile) {
            tiles.push(Math.min(BAKE.tile, BAKE.width - x) * Math.min(BAKE.tile, BAKE.height - y) * BAKE.samplesPerPass)
        }
    }
    const perRay = BAKE.probes * 2
    let rays = 0
    let tile = 0
    let sweep = 0
    return {
        get done() { return sweep >= BAKE.sweeps },
        /** Traces about `paths`, at least one draw, and returns the paths traced. */
        step(paths: number) {
            let spent = 0
            while (sweep < BAKE.sweeps && (spent === 0 || spent < paths)) {
                if (rays < BAKE.probeRays) {
                    const r = Math.min(BAKE.probeRays - rays, Math.max(1, Math.min(64, Math.floor((paths - spent) / perRay))))
                    rays += r
                    spent += r * perRay
                    continue
                }
                spent += tiles[tile]!
                if (++tile === tiles.length) {
                    tile = 0
                    sweep++
                }
            }
            return spent
        },
    }
}

export interface Replayed {
    frames: number
    /** The bake's time, its frames' intervals summed. */
    ms: number
    /** Frames more than the shrink line over the budget's baseline. */
    over: number
}

/**
 * Bakes the recorded bake to the end under a budget that answers paths a
 * frame (a tile budget's tiles times tilePaths), on the GPU of `run` with
 * `cap` paths of room a frame.
 */
export function replay(budget: { frame(ms: number | null): number; readonly baselineMs: number | null }, bake: RecordedBake, run: RecordedRun, cap: number, overMs = 4): Replayed {
    const game = run.intervals.map((ms, i) => ms > run.refresh + overMs && (run.traced[i - run.lag] ?? 0) > cap ? run.refresh : ms)
    const work = bakeWork(bake)
    const traced: number[] = []
    let interval: number | null = null
    let ms = 0
    let over = 0
    while (!work.done && traced.length < 10_000) {
        const i = traced.length
        traced.push(work.step(budget.frame(interval)))
        interval = (game[i] ?? run.refresh) + ((traced[i - run.lag + 1] ?? 0) > cap ? run.refresh : 0)
        ms += interval
        if (budget.baselineMs !== null && interval > budget.baselineMs + overMs) over++
    }
    return { frames: traced.length, ms, over }
}
