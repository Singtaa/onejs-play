/**
 * The probe grid that lights moving actors (docs/lightmapping.md §5).
 *
 * Placed with no author work: a grid over the box round the static actors, a
 * metre past it, a metre apart across and `PROBE_RISE` times that up, since a
 * scene is mostly flat and its light changes least with height, and spaced
 * wider on every axis alike when it would pass `MAX_PROBES`.
 * Each probe holds the light arriving there as nine spherical harmonic
 * coefficients a colour, which OneJS's baker writes, filling a probe inside a
 * static actor from its neighbours. Blending them for a moving actor is
 * OneJS's too (ModelBridge.BlendProbes), so oj only places the grid.
 */

export const PROBE_SPACING = 1
/** How many times the spacing across the probes stand apart up: halves a flat scene's probes, which were most of its light file. */
export const PROBE_RISE = 2
export const MAX_PROBES = 4096
export const BOUNDS_MARGIN = 1

export interface ProbeGrid {
    /** The first probe, the box's lowest corner. */
    origin: [number, number, number]
    /** The distance between probes along x, y and z. */
    spacing: [number, number, number]
    counts: [number, number, number]
}

/** The grid as BeginBake and LoadLight take it: origin, a spacing an axis, counts. */
export const gridFloats = (g: ProbeGrid) => [...g.origin, ...g.spacing, ...g.counts]

const countsAt = (size: readonly number[], s: number, rise: number) => size.map((x, k) => Math.floor(x / (k === 1 ? s * rise : s) + 1e-9) + 1) as [number, number, number]
const total = (c: readonly number[]) => c[0]! * c[1]! * c[2]!

/**
 * The grid over the static actors' bounds, `min` to `max` in metres. `rise`
 * is 1 for a host whose OneJS takes one spacing for every axis (before 1.4.1).
 */
export function probeGrid(min: readonly number[], max: readonly number[], rise = PROBE_RISE): ProbeGrid {
    const lo = min.map((x) => x - BOUNDS_MARGIN), hi = max.map((x, i) => Math.max(x, min[i]!) + BOUNDS_MARGIN)
    const size = hi.map((x, i) => x - lo[i]!)
    const at = (s: number) => countsAt(size, s, rise)
    let spacing = PROBE_SPACING
    if (total(at(spacing)) > MAX_PROBES) {
        // The fewest probes still fit is monotone in the spacing: halve the gap to a centimetre.
        let a = spacing, b = spacing
        while (total(at(b)) > MAX_PROBES) b *= 2
        while (b - a > 0.01) {
            const m = (a + b) / 2
            if (total(at(m)) > MAX_PROBES) a = m
            else b = m
        }
        // The tightest whole centimetre that fits: the counts move in steps, so step down while they still fit.
        let cm = Math.ceil(b * 100)
        while (cm > 100 && total(at((cm - 1) / 100)) <= MAX_PROBES) cm--
        spacing = cm / 100
    }
    return { origin: lo as [number, number, number], spacing: [spacing, spacing * rise, spacing], counts: at(spacing) }
}
