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
 *
 * Two frames are slow whatever the count: the one whose step finishes the
 * probes, and the one their read lands in, a few frames later. The switch
 * costs the GPU, so the replay gives it to the frame its own bake switches on
 * and takes it off the recorded one. The landing's latency is time, not work,
 * so it lands in the recorded frame, whose stall stays where it was. The bake
 * loop's newPhase hears of both as models.ts tells it, before reading the
 * interval of the frame after.
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
    /** Each frame's interval as the budget saw it, ms. */
    intervals: number[]
    /** Each frame's traced paths, to the bake's end. */
    traced: number[]
    /** The recorded frame whose step finished the probes. */
    switchAt: number
    /** The recorded frame whose step landed the probes' read: its interval holds the landing's stall. */
    landAt: number
    /**
     * The GPUs the run is replayed on: a queue of `lag` frames and `cap` paths of room a frame,
     * each with the path budget of the day's replay on it. The recorded runs fit every lag
     * from 1 to 3 equally, so each is replayed at each.
     */
    gpus: { lag: number; cap: number; old: Replayed }[]
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
    let landed = false
    return {
        get done() { return sweep >= BAKE.sweeps && landed },
        /** LightBaker.Phase: 1 the probes' rays, 2 the tiles while the probes read back, 3 once landed, 4 finishing. */
        get phase() { return sweep >= BAKE.sweeps ? 4 : rays < BAKE.probeRays ? 1 : landed ? 3 : 2 },
        /** Lands the probes' read, once their rays are traced. */
        land() { if (rays >= BAKE.probeRays) landed = true },
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

export interface ReplayedBudget {
    frame(ms: number | null): number
    readonly baselineMs: number | null
    newPhase?(): void
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
 * frame (a tile budget's tiles times tilePaths), on the GPU of `run` with a
 * queue of `lag` frames and `cap` paths of room a frame. A budget with
 * newPhase hears each phase change as the bake loop tells it: one without is
 * the budget the bake had before it learned of them.
 */
export function replay(budget: ReplayedBudget, bake: RecordedBake, run: RecordedRun, lag: number, cap: number, overMs = 4): Replayed {
    const explained = (ms: number, i: number) => ms > run.refresh + overMs && ((run.traced[i - lag] ?? 0) > cap || (i > run.switchAt && i <= run.switchAt + lag))
    const game = run.intervals.map((ms, i) => explained(ms, i) ? run.refresh : ms)
    const work = bakeWork(bake)
    const traced: number[] = []
    const switched: boolean[] = []
    let phase = 0
    let interval: number | null = null
    let ms = 0
    let over = 0
    while (!work.done && traced.length < 10_000) {
        const i = traced.length
        if (work.phase !== phase) budget.newPhase?.()
        phase = work.phase
        traced.push(work.step(budget.frame(interval)))
        switched.push(phase === 1 && work.phase !== 1)
        if (i >= run.landAt) work.land()
        const shown = i - lag + 1
        interval = (game[i] ?? run.refresh) + ((traced[shown] ?? 0) > cap || switched[shown] ? run.refresh : 0)
        ms += interval
        if (budget.baselineMs !== null && interval > budget.baselineMs + overMs) over++
    }
    return { frames: traced.length, ms, over }
}
