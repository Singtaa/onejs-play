/**
 * The probe grid that lights moving actors (docs/lightmapping.md §5).
 *
 * Placed with no author work: a grid over the box round the static actors, a
 * metre past it, a metre apart, spaced wider when it would pass `MAX_PROBES`.
 * Each probe holds the light arriving there as nine spherical harmonic
 * coefficients a colour, which OneJS's baker writes, filling a probe inside a
 * static actor from its neighbours. Blending them for a moving actor is
 * OneJS's too (ModelBridge.BlendProbes), so oj only places the grid.
 */

export const PROBE_SPACING = 1
export const MAX_PROBES = 4096
export const BOUNDS_MARGIN = 1

export interface ProbeGrid {
    /** The first probe, the box's lowest corner. */
    origin: [number, number, number]
    spacing: number
    counts: [number, number, number]
}

const countsAt = (size: readonly number[], s: number) => size.map((x) => Math.floor(x / s + 1e-9) + 1) as [number, number, number]
const total = (c: readonly number[]) => c[0]! * c[1]! * c[2]!

/** The grid over the static actors' bounds, `min` to `max` in metres. */
export function probeGrid(min: readonly number[], max: readonly number[]): ProbeGrid {
    const lo = min.map((x) => x - BOUNDS_MARGIN), hi = max.map((x, i) => Math.max(x, min[i]!) + BOUNDS_MARGIN)
    const size = hi.map((x, i) => x - lo[i]!)
    let spacing = PROBE_SPACING
    if (total(countsAt(size, spacing)) > MAX_PROBES) {
        // The fewest probes still fit is monotone in the spacing: halve the gap to a centimetre.
        let a = spacing, b = spacing
        while (total(countsAt(size, b)) > MAX_PROBES) b *= 2
        while (b - a > 0.01) {
            const m = (a + b) / 2
            if (total(countsAt(size, m)) > MAX_PROBES) a = m
            else b = m
        }
        // The tightest whole centimetre that fits: the counts move in steps, so step down while they still fit.
        let cm = Math.ceil(b * 100)
        while (cm > 100 && total(countsAt(size, (cm - 1) / 100)) <= MAX_PROBES) cm--
        spacing = cm / 100
    }
    return { origin: lo as [number, number, number], spacing, counts: countsAt(size, spacing) }
}
