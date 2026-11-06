/**
 * Where each static actor's light goes in the atlas (docs/lightmapping.md §6).
 *
 * The unwrap is per model: xatlas lays a model's charts out once, at one texel
 * a metre, and that layout's size is the model's footprint. Each static actor
 * gets its own rectangle of the atlas, its model's footprint times its scale
 * times the detail. A bake holds 168 bytes a texel, so the atlas is capped at
 * `MAX_ATLAS` a side (44 MB while baking at 512) and the detail is lowered
 * until every rectangle fits: bounce light is soft, so a yard at 5 texels a
 * metre still looks right where a room keeps its 24.
 */

export const MAX_ATLAS = 512
export const DEFAULT_DETAIL = 24
/** Texels between rectangles: the seams are dilated 4 texels past each chart, so neighbours never bleed. */
export const GUTTER = 4
/** Below this the bake is not worth having, and the caller says so. */
export const MIN_DETAIL = 1

export interface Footprint {
    /** The model's layout at one texel a metre, times the actor's scale. */
    width: number
    height: number
}

export interface Packed {
    /** Texels a metre the atlas was packed at: `detail` asked for, or lower to fit. */
    detail: number
    width: number
    height: number
    /** Each footprint's rectangle, x, y, width, height in texels, in the order given. */
    rects: [number, number, number, number][]
}

/**
 * Shelf packing, tallest first, into a square of `size`: a row at a time, each
 * rectangle beside the last until the row is full. Null when they do not fit.
 */
function shelves(sizes: readonly [number, number][], size: number): { rects: [number, number, number, number][], width: number, height: number } | null {
    const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]![1] - sizes[a]![1] || sizes[b]![0] - sizes[a]![0] || a - b)
    const rects: [number, number, number, number][] = new Array(sizes.length)
    let x = 0, y = 0, row = 0, width = 0
    for (const i of order) {
        const [w, h] = sizes[i]!
        if (w > size || h > size) return null
        if (x + w > size) { x = 0; y += row + GUTTER; row = 0 }
        if (y + h > size) return null
        rects[i] = [x, y, w, h]
        x += w + GUTTER
        row = Math.max(row, h)
        width = Math.max(width, x - GUTTER)
    }
    return { rects, width, height: y + row }
}

const texels = (fp: Footprint, detail: number): [number, number] => [Math.max(1, Math.ceil(fp.width * detail)), Math.max(1, Math.ceil(fp.height * detail))]

/** The atlas for these footprints at `detail` texels a metre, or the highest lower detail that fits; null below `MIN_DETAIL`. */
export function packAtlas(footprints: readonly Footprint[], detail = DEFAULT_DETAIL, max = MAX_ATLAS): Packed | null {
    const at = (d: number) => shelves(footprints.map((f) => texels(f, d)), max)
    const first = at(detail)
    if (first !== null) return { detail, ...first }
    // Whether it fits only gets easier as the detail falls: search down to a tenth of a texel.
    let lo = MIN_DETAIL, hi = detail
    if (at(lo) === null) return null
    while (hi - lo > 0.1) {
        const mid = (lo + hi) / 2
        if (at(mid) !== null) lo = mid
        else hi = mid
    }
    const d = Math.floor(lo * 10) / 10
    return { detail: d, ...at(d)! }
}
