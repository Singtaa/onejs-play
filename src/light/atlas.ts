/**
 * Where each static actor's light goes in the atlas (docs/lightmapping.md §6).
 *
 * The unwrap is per model: xatlas lays a model's charts out once, at one texel
 * a metre, and that layout's size is the model's footprint. Each static actor
 * gets its own rectangle of the atlas, its model's footprint times its scale
 * times the detail. A bake holds about 56 bytes a texel of the page it is
 * baking (OneJS Runtime/Lighting), so a page is capped at `MAX_ATLAS` a side
 * (15 MB while baking at 512). A scene that does not fit one page is packed
 * into one sheet of up to `MAX_PAGES` pages, two wide and two high, each page a
 * slice of the lightmap: the sheet is `2 * width - SEAM` texels wide, the second
 * column starting `SEAM` texels before the first ends, so the texels either side
 * of the split are on both pages and a bilinear read near it finds all it needs
 * on one. A rectangle may cross the split, so an actor up to the sheet's side
 * keeps the detail asked for. Only past the whole sheet is the detail lowered
 * until every rectangle fits: bounce light is soft, so a yard at 10 texels a
 * metre still looks right where a room keeps its 24.
 */

export const MAX_ATLAS = 512
/** Pages a bake may use, two by two: 4 finished pages are 8 MB of half floats, which a phone holds. */
export const MAX_PAGES = 4
/** Texels a page's second column or row shares with its first. */
export const SEAM = 2
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
    /** Each page's size. */
    width: number
    height: number
    /** How many pages: 1, 2 side by side, or 4 two by two. */
    pages: 1 | 2 | 4
    /** Each footprint's rectangle of the sheet, x, y, width, height in texels, in the order given. */
    rects: [number, number, number, number][]
}

/** The sheet `pages` pages of `width` by `height` make: its columns and rows, and its size in texels. */
export function sheetOf(width: number, height: number, pages: number) {
    const columns = pages === 1 ? 1 : 2, rows = pages === 4 ? 2 : 1
    return { columns, rows, width: columns * width - (columns - 1) * SEAM, height: rows * height - (rows - 1) * SEAM }
}

/**
 * Shelf packing, tallest first, into `wide` by `high`: a row at a time, each
 * rectangle beside the last until the row is full. Null when they do not fit;
 * otherwise the rectangles and the size they take.
 */
function shelves(sizes: readonly [number, number][], wide: number, high: number) {
    const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]![1] - sizes[a]![1] || sizes[b]![0] - sizes[a]![0] || a - b)
    const rects: [number, number, number, number][] = new Array(sizes.length)
    let x = 0, y = 0, row = 0, width = 0, height = 0
    for (const i of order) {
        const [w, h] = sizes[i]!
        if (w > wide) return null
        if (x + w > wide) { x = 0; y += row + GUTTER; row = 0 }
        if (y + h > high) return null
        rects[i] = [x, y, w, h]
        x += w + GUTTER
        row = Math.max(row, h)
        width = Math.max(width, x - GUTTER)
        height = Math.max(height, y + row)
    }
    return { rects, width, height }
}

/**
 * One page of `size` when they fit it, packed as before there were pages.
 * Otherwise the sheet, two pages wide and, when `pages` allows 4 and the rows
 * need it, two high, each page half the sheet's packed size and the seam: so a
 * sheet that came out 600 texels wide bakes pages of 301, not of `size`.
 */
function sheet(sizes: readonly [number, number][], size: number, pages: number): Omit<Packed, "detail"> | null {
    const one = shelves(sizes, size, size)
    if (one !== null) return { rects: one.rects, width: one.width, height: one.height, pages: 1 }
    if (pages < 2) return null
    const side = 2 * size - SEAM
    const packed = shelves(sizes, side, pages >= 4 ? side : size)
    if (packed === null) return null
    const rows = packed.height > size ? 2 : 1
    const half = (n: number) => Math.ceil((n + SEAM) / 2)
    return { rects: packed.rects, width: half(packed.width), height: rows === 2 ? half(packed.height) : packed.height, pages: rows === 2 ? 4 : 2 }
}

/** Rounded up, past a millionth of a texel of float noise: a footprint made from texels at the same detail comes back as those texels. */
const up = (x: number) => Math.max(1, Math.ceil(x - 1e-6))
const texels = (fp: Footprint, detail: number): [number, number] => [up(fp.width * detail), up(fp.height * detail)]

/** The atlas for these footprints at `detail` texels a metre on up to `pages` pages, or the highest lower detail that fits; null below `MIN_DETAIL`. */
export function packAtlas(footprints: readonly Footprint[], detail = DEFAULT_DETAIL, max = MAX_ATLAS, pages = MAX_PAGES): Packed | null {
    const at = (d: number) => sheet(footprints.map((f) => texels(f, d)), max, pages)
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

/** A static actor as the layout sees it: which model, and its scale. */
export interface LaidActor {
    model: number
    scale: number
}

/** A model's charts packed at `density` texels a metre, as a size in texels: what unwrap.ts's Charts.size answers. */
export type PackModel = (model: number, density: number) => { width: number, height: number }

export interface Layout extends Packed {
    /** Texels a metre each model was laid out at, by model index; 0 for a model no actor uses. */
    densities: number[]
}

/**
 * The atlas with every model laid out once, at the density its smallest actor
 * needs: `detail` times that actor's scale. A bigger actor of the same model
 * gets a bigger rectangle of the same layout, so the padding xatlas leaves
 * between charts is never less than it asked for, in any actor's texels.
 *
 * The padding is in texels, so a model laid out at a lower detail takes more
 * metres: when packAtlas has to lower the detail, the models are laid out
 * again at the new one and packed again, until the detail asked for is the
 * detail packed. The detail falls by at least a tenth each round and packAtlas
 * gives up below MIN_DETAIL, so this ends.
 *
 * `areas` is each model's surface in square metres. Charts cover at least
 * their surface, so no detail above `max` times the root of `pages` over the
 * root of the scene's surface can fit, nor above the sheet's side over the
 * root of one actor's, and the first round starts there rather than packing a
 * yard's ground at 24 texels a metre (3877 by 2039 texels, 126 ms) to learn
 * it does not.
 */
export function layoutAtlas(actors: readonly LaidActor[], areas: readonly number[], pack: PackModel, detail = DEFAULT_DETAIL, max = MAX_ATLAS, pages = MAX_PAGES): Layout | null {
    const models = areas.length
    const smallest = new Array<number>(models).fill(Infinity)
    for (const a of actors) {
        if (!(a.scale > 0) || !Number.isFinite(a.scale)) throw new Error(`[oj] a static actor's scale is ${a.scale}: it has to be a positive number to be baked`)
        if (!Number.isInteger(a.model) || a.model < 0 || a.model >= models) throw new Error(`[oj] layoutAtlas: model ${a.model} is not one of the ${models} given`)
        smallest[a.model] = Math.min(smallest[a.model]!, a.scale)
    }
    let surface = 0, largest = 0
    for (const a of actors) {
        surface += areas[a.model]! * a.scale * a.scale
        largest = Math.max(largest, areas[a.model]! * a.scale * a.scale)
    }
    // A twentieth over the bound, for charts xatlas lays out a little under their surface.
    const side = pages >= 4 ? 2 * max - SEAM : max
    const bound = surface > 0 ? 1.05 * Math.min(max * Math.sqrt(pages / surface), side / Math.sqrt(largest)) : Infinity
    for (let d = Math.min(detail, Math.floor(bound * 10) / 10); ;) {
        const densities = smallest.map((s) => s === Infinity ? 0 : d * s)
        const sizes = densities.map((density, m) => density === 0 ? null : pack(m, density))
        const footprints = actors.map((a) => {
            const size = sizes[a.model]!, density = densities[a.model]!
            return { width: size.width / density * a.scale, height: size.height / density * a.scale }
        })
        const packed = packAtlas(footprints, d, max, pages)
        if (packed === null) return null
        if (packed.detail === d) return { ...packed, densities }
        d = packed.detail
    }
}
