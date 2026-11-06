/**
 * The probe grid that lights moving actors (docs/lightmapping.md §5).
 *
 * Placed with no author work: a grid over the box round the static actors, a
 * metre past it, a metre apart, spaced wider when it would pass `MAX_PROBES`.
 * Each probe holds the light arriving there as nine spherical harmonic
 * coefficients a colour, which the baker writes. A moving actor takes the light
 * at its middle, blended from the eight probes round it; a probe the baker
 * found inside a static actor is left out and its neighbours fill in.
 */

export const PROBE_SPACING = 1
export const MAX_PROBES = 4096
export const BOUNDS_MARGIN = 1
/** Nine coefficients for each of red, green and blue. */
export const SH_FLOATS = 27

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

/** Where probe `i` stands. */
export function probeAt(grid: ProbeGrid, i: number): [number, number, number] {
    const [nx, ny] = grid.counts
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny))
    return [grid.origin[0] + x * grid.spacing, grid.origin[1] + y * grid.spacing, grid.origin[2] + z * grid.spacing]
}

/**
 * The light at `at`, blended from the eight probes round it into `out`
 * (`SH_FLOATS` long), the probes left out by `usable` skipped and the rest
 * weighted up to fill in. Outside the grid it is the nearest edge's. False
 * when all eight are left out, and the caller keeps the scene's ambient.
 */
export function blend(grid: ProbeGrid, sh: Float32Array, usable: Uint8Array, at: readonly number[], out: Float32Array): boolean {
    const c = grid.counts
    const cell: number[] = [], frac: number[] = []
    for (let k = 0; k < 3; k++) {
        const t = Math.min(Math.max((at[k]! - grid.origin[k]!) / grid.spacing, 0), c[k]! - 1)
        const i = Math.min(Math.floor(t), Math.max(0, c[k]! - 2))
        cell.push(i)
        frac.push(c[k]! === 1 ? 0 : t - i)
    }
    out.fill(0)
    let weight = 0
    for (let corner = 0; corner < 8; corner++) {
        const d = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1]
        const idx = d.map((o, k) => Math.min(cell[k]! + o, c[k]! - 1))
        const i = idx[0]! + c[0] * (idx[1]! + c[1] * idx[2]!)
        if (usable[i] === 0) continue
        const w = d.reduce((p, o, k) => p * (o ? frac[k]! : 1 - frac[k]!), 1)
        if (w === 0) continue
        weight += w
        for (let j = 0; j < SH_FLOATS; j++) out[j]! += w * sh[i * SH_FLOATS + j]!
    }
    if (weight === 0) return false
    for (let j = 0; j < SH_FLOATS; j++) out[j]! /= weight
    return true
}
