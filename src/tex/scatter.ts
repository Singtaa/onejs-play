/**
 * Scatter's placements, worked out on the CPU as Magerie works them out
 * (magerie-one js/src/nodes/generators/scatter/core.ts, and js/src/utils/
 * random.ts for mulberry32): the same draws in the same order, so the same
 * parameters land every copy in the same place. Only the drawing runs on the
 * GPU, from the table built here.
 *
 * Not `scene.scatter`, which places instanced meshes in a 3D scene: this one
 * stamps copies of a picture into a picture, Magerie's Scatter node.
 */

/** Magerie's one mulberry32: uniform floats in [0, 1), integer maths only, so every engine agrees. */
export function mulberry32(seed: number): () => number {
    let s = seed | 0
    return () => {
        s = (s + 0x6D2B79F5) | 0
        let t = Math.imul(s ^ (s >>> 15), s | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** A copy's ID colour, Flood Fill's hash: the same RGB is the same copy downstream. */
export function instanceColor(seed: number, idx: number): [number, number, number] {
    const rand = mulberry32((seed * 0xF3A1) ^ ((idx + 1) * 0x9E3779B1))
    rand()
    return [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)]
}

/** A copy's keep draw against a Mask, its own stream so a mask moves no placement: Magerie's scatterKeepRand. */
export function scatterKeepRand(seed: number, idx: number): number {
    return mulberry32((seed * 0x5BD1) ^ ((idx + 1) * 0x9E3779B1))()
}

export interface ScatterPlacementParams {
    layout: "random" | "grid"
    seed: number
    count: number
    gridX: number
    gridY: number
    positionJitter: number
    scaleMin: number
    scaleMax: number
    rotationRange: number
    opacityMin: number
    opacityMax: number
}

export interface ScatterPlacement {
    cx: number
    cy: number
    scale: number
    /** Radians. */
    rotation: number
    opacity: number
    idx: number
}

/** Every copy in drawing order, the last on top: five draws a copy from one stream, as Magerie's computeScatterPlacements. */
export function scatterPlacements(p: ScatterPlacementParams, outW: number, outH: number): ScatterPlacement[] {
    const rand = mulberry32(p.seed)
    const DEG_TO_RAD = Math.PI / 180
    const out: ScatterPlacement[] = []
    const rest = (idx: number, cx: number, cy: number) => {
        const scale = p.scaleMin + rand() * (p.scaleMax - p.scaleMin)
        const rotation = rand() * p.rotationRange * DEG_TO_RAD
        const opacity = p.opacityMin + rand() * (p.opacityMax - p.opacityMin)
        out.push({ cx, cy, scale, rotation, opacity, idx })
    }
    if (p.layout === "grid") {
        const gridX = Math.max(1, Math.round(p.gridX))
        const gridY = Math.max(1, Math.round(p.gridY))
        const jitter = Math.max(0, Math.min(1, p.positionJitter))
        const cellW = outW / gridX, cellH = outH / gridY
        let idx = 0
        for (let gy = 0; gy < gridY; gy++) {
            for (let gx = 0; gx < gridX; gx++) {
                const jx = (rand() - 0.5) * 2 * jitter * (cellW * 0.5)
                const jy = (rand() - 0.5) * 2 * jitter * (cellH * 0.5)
                rest(idx++, (gx + 0.5) * cellW + jx, (gy + 0.5) * cellH + jy)
            }
        }
    } else {
        const count = Math.max(1, Math.round(p.count))
        for (let n = 0; n < count; n++) {
            const cx = rand() * outW
            const cy = rand() * outH
            rest(n, cx, cy)
        }
    }
    return out
}

/** Texels a copy takes in the table: cx, cy, scale, rotation, opacity, its ID colour, then its keep draw. */
export const SCATTER_TEXELS = 7

/** Steps in a 24-bit fixed-point value, one per RGB byte triple: as fine as a float32 over these ranges. */
const FIXED = 16777215

/**
 * What each of a copy's first five values is divided by in the table, so each
 * lies in [0, 1]: Magerie's sliders bound scale to 2, rotation to a turn and
 * opacity to 1, and a centre lies on the canvas.
 */
export function scatterRanges(outW: number, outH: number): [number, number, number, number, number] {
    return [outW, outH, 2, 2 * Math.PI, 1]
}

/**
 * The placements as RGBA bytes, `SCATTER_TEXELS` texels a row and one row a
 * copy, for an 8-bit table the kernel fetches: each of the first five values
 * as 24 bits over its range in R, G and B, the ID colour's own bytes, then
 * the keep draw as 24 bits over [0, 1].
 */
export function scatterTable(placements: readonly ScatterPlacement[], seed: number, outW: number, outH: number): number[] {
    const ranges = scatterRanges(outW, outH)
    const out: number[] = []
    for (const q of placements) {
        const values = [q.cx, q.cy, q.scale, q.rotation, q.opacity]
        values.forEach((v, k) => {
            const n = Math.round(Math.min(1, Math.max(0, Math.fround(v) / ranges[k]!)) * FIXED)
            out.push(n >>> 16, (n >>> 8) & 255, n & 255, 255)
        })
        const [r, g, b] = instanceColor(seed, q.idx)
        out.push(r, g, b, 255)
        const keep = Math.round(Math.fround(scatterKeepRand(seed, q.idx)) * FIXED)
        out.push(keep >>> 16, (keep >>> 8) & 255, keep & 255, 255)
    }
    return out
}

/** A table value back from its bytes, as the kernel decodes it: the inverse of scatterTable's packing. */
export function scatterUnpack(r: number, g: number, b: number, range: number): number {
    return ((r * 65536 + g * 256 + b) / FIXED) * range
}
