/**
 * Each static model's second UV set: where its light goes (docs/lightmapping.md §6).
 *
 * xatlas cuts a model's triangles into charts once, then packs them at
 * whatever density its actors need. The charts depend on the triangles alone
 * and the packing on the density alone, and both are deterministic, so a
 * player's browser that unwraps a model on load gets the layout the author's
 * browser baked into (a saved file holds the light, not the UVs, §3).
 *
 * Unwrapping splits vertices along chart seams. The mesh that is drawn
 * afterwards is the one returned here, every other attribute carried over
 * through `xref`, the input vertex each output vertex came from.
 *
 * xatlas is WebAssembly, loaded through the same seam as Rapier and Recast
 * (src/wasm.ts), so the same code unwraps in the browser, in Node and in a
 * native OneJS build that links it.
 */

import type { Triangles } from "../physics3d/gltf"
import { instantiateWasm } from "../wasm"
import { AUTO_DETAIL, DEFAULT_DETAIL, DETAIL_FLOOR, layoutAtlas, MAX_ATLAS, MAX_PAGES, type LaidActor, type Layout } from "./atlas"
import { XATLAS_VERSION, XATLAS_WASM_SHA256 } from "./xatlas.version"

export const XATLAS_MODULE = { name: "xatlas", version: XATLAS_VERSION, sha256: XATLAS_WASM_SHA256 } as const

/**
 * Texels xatlas leaves between charts: two, so each empty texel between two
 * charts is beside only one of them, and the bake's dilation fills it from
 * that one. Bilinear sampling reads one texel past a chart's edge, which is
 * then that chart's own. xatlas's `bilinear` adds a texel on top, as margin
 * for slivers; unwrap.test.ts holds the two.
 */
export const CHART_PADDING = 2

type XAtlasModule = Awaited<ReturnType<typeof import("./xatlas.vendor.js").default>>
type XAtlas = ReturnType<XAtlasModule["createAtlas"]>

let loading: Promise<XAtlasModule> | null = null

/** The xatlas module, instantiated once. A failure is not kept, so a later call tries again. */
export function loadXAtlas(): Promise<XAtlasModule> {
    if (loading !== null) return loading
    const load = (async () => {
        const X = await import("./xatlas.vendor.js")
        // The factory is handed the module rather than loading one. Emscripten
        // waits on `receive` and has no way to hear a failure, so a failure
        // rejects this promise instead of leaving it pending forever.
        return await new Promise<XAtlasModule>((resolve, reject) => {
            X.default({
                instantiateWasm(imports, receive) {
                    instantiateWasm(XATLAS_MODULE, imports).then((exports) => receive({ exports }), reject)
                    return {}
                },
            }).then(resolve, reject)
        })
    })()
    load.catch(() => { if (loading === load) loading = null })
    loading = load
    return load
}

/** A model's layout at one density: its output mesh, and its size in texels. */
export interface Unwrap {
    /** Texels a metre it was packed at. */
    density: number
    width: number
    height: number
    /** For each output vertex, the input vertex it was split from. */
    xref: Uint32Array
    /** For each output vertex, where it lies in the layout, 0 to 1 across and down. */
    uv: Float32Array
    /** The output triangles, three output vertices each, in the input's order. */
    indices: Uint32Array
    /** How many charts the model was cut into. */
    charts: number
}

/** A model's charts, cut once and packed at whatever density is asked. */
export interface Charts {
    /** The model's surface, in square metres. */
    readonly area: number
    /** The layout's size in texels at `density` texels a metre. */
    size(density: number): { width: number, height: number }
    unwrap(density: number): Unwrap
    /** Frees xatlas's copy of the model. Every method throws afterwards. */
    dispose(): void
}

const packOptions = (density: number) => ({ padding: CHART_PADDING, bilinear: true, texelsPerUnit: density, resolution: 0 })

/** Cuts a model's triangles into charts. Its positions are in metres, as glbTriangles gives them. */
export async function chartModel(triangles: Triangles): Promise<Charts> {
    const { vertices, indices } = triangles
    if (indices.length === 0 || indices.length % 3 !== 0) throw new Error(`[oj] a model to unwrap needs whole triangles, and has ${indices.length} indices`)
    const xatlas = await loadXAtlas()
    let atlas: XAtlas | null = xatlas.createAtlas()
    const error = atlas.addMesh({ positions: vertices, indices })
    if (error !== 0) {
        atlas.destroy()
        throw new Error(`[oj] xatlas refused a model: ${xatlas.addMeshErrorString(error)}`)
    }
    atlas.computeCharts()
    let area = 0
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3
        const ux = vertices[b]! - vertices[a]!, uy = vertices[b + 1]! - vertices[a + 1]!, uz = vertices[b + 2]! - vertices[a + 2]!
        const vx = vertices[c]! - vertices[a]!, vy = vertices[c + 1]! - vertices[a + 1]!, vz = vertices[c + 2]! - vertices[a + 2]!
        area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    }

    let packed = -1
    const packAt = (density: number): XAtlas => {
        if (atlas === null) throw new Error("[oj] these charts were disposed")
        if (!(density > 0) || !Number.isFinite(density)) throw new Error(`[oj] a model is packed at a positive number of texels a metre, not ${density}`)
        if (density !== packed) {
            atlas.packCharts(packOptions(density))
            // texelsPerUnit with no resolution packs one atlas of whatever size it takes.
            if (atlas.atlasCount !== 1) throw new Error(`[oj] xatlas packed a model into ${atlas.atlasCount} atlases, not one`)
            packed = density
        }
        return atlas
    }

    return {
        area,
        size(density) {
            const a = packAt(density)
            return { width: a.width, height: a.height }
        },
        unwrap(density) {
            const a = packAt(density)
            const mesh = a.getMesh(0)
            const n = mesh.vertexCount, width = a.width, height = a.height
            const xref = new Uint32Array(n), uv = new Float32Array(n * 2)
            for (let i = 0; i < n; i++) {
                const v = mesh.vertices[i]!
                xref[i] = v.xref
                // A vertex in no chart belongs only to faces with no area; it is left at the corner.
                if (v.chartIndex < 0) continue
                uv[i * 2] = v.uv[0] / width
                uv[i * 2 + 1] = v.uv[1] / height
            }
            return { density, width, height, xref, uv, indices: new Uint32Array(mesh.indices), charts: mesh.chartCount }
        },
        dispose() {
            atlas?.destroy()
            atlas = null
        },
    }
}

/** A bake's layout: the atlas, each actor's rectangle of it, and each model's unwrap. */
export interface LightLayout extends Layout {
    /** By model index, the mesh its actors are drawn with; null for a model no actor uses. */
    unwraps: (Unwrap | null)[]
}

/**
 * Lays out every static actor at `detail` texels a metre, or the highest
 * lower detail that fits the atlas, each model unwrapped once (atlas.ts,
 * layoutAtlas). Null when the scene cannot fit even at MIN_DETAIL.
 */
export function layoutLight(charts: readonly Charts[], actors: readonly LaidActor[], detail = DEFAULT_DETAIL, max = MAX_ATLAS, pages = MAX_PAGES): LightLayout | null {
    if (detail === AUTO_DETAIL) {
        // AUTO_DETAIL: one page while it holds DETAIL_FLOOR, else the floor on as few pages as hold it.
        const one = layoutLight(charts, actors, DEFAULT_DETAIL, max, 1)
        return one !== null && one.detail >= DETAIL_FLOOR ? one : layoutLight(charts, actors, DETAIL_FLOOR, max, pages)
    }
    const layout = layoutAtlas(actors, charts.map((c) => c.area), (m, density) => charts[m]!.size(density), detail, max, pages)
    if (layout === null) return null
    return { ...layout, unwraps: layout.densities.map((density, m) => density === 0 ? null : charts[m]!.unwrap(density)) }
}
