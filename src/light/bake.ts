/**
 * What `scene.bake` hands OneJS (docs/lightmapping.md §6): which models are
 * baked into, each one's unwrap, every static actor's and scattered copy's
 * rectangle of the atlas, and the probe grid over them.
 *
 * OneJS's ModelBridge owns the geometry and the baker; oj owns the layout,
 * since xatlas runs here. So a bake reads each model's triangles from the
 * bridge (LightMesh), unwraps them once a scene, lays the atlas out, gives each
 * model its unwrap back (SetLightUnwrap) and starts the bake (BeginBake). The
 * bridge steps it from then on (StepBake), and models.ts calls that each frame.
 */

import type { Model, Rotation, Vec3 } from "../models"
import type { Triangles } from "../physics3d/gltf"
import { rotate, toQuat } from "../physics3d/rotation"
import { modelUrls } from "../physics3d/sources"
import { DEFAULT_DETAIL } from "./atlas"
import { probeGrid } from "./probes"
import { chartModel, layoutLight, type Charts } from "./unwrap"

// Type-level redeclaration only, so dynamic host globals typecheck.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

/** Paths a texel: the one quality the first version has (§7). */
export const BAKE_SAMPLES = 256

/**
 * Paths of the bake a frame: about 4 ms of a desktop GPU's time (the spike
 * traced about 33,000 paths a millisecond, docs/lightmapping.md S2). What a
 * phone's share should be is measured on real phones (§7).
 */
export const PATHS_PER_FRAME = 131_072

/** A static thing to bake into: an actor, or one copy of a scatter. */
export interface BakeItem {
    model: Model
    position: Readonly<Vec3>
    rotation: Readonly<Rotation>
    scale: number
    /** The actor's id, or the scatter's id and the copy's index in it. */
    actor?: number
    copy?: readonly [number, number]
}

/** A model's charts and its triangles' bounds, in its own space. */
interface Charted {
    charts: Charts
    min: Vec3
    max: Vec3
}

/** The triangles LightMesh answers, or null for "", a model that cannot be baked into. */
export function decodeLightMesh(text: string): Triangles | null {
    if (text === "") return null
    const binary: string = globalThis.atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const view = new DataView(bytes.buffer)
    const vertexCount = view.getUint32(0, true), indexCount = view.getUint32(4, true)
    if (bytes.length !== 8 + vertexCount * 12 + indexCount * 4) throw new Error(`[oj] a model's light mesh is ${bytes.length} bytes, not the ${8 + vertexCount * 12 + indexCount * 4} its counts say`)
    return {
        vertices: new Float32Array(bytes.buffer, 8, vertexCount * 3),
        indices: new Uint32Array(bytes.buffer, 8 + vertexCount * 12, indexCount),
    }
}

/** Each model's charts, cut the first time a bake needs them and kept for the scene's later bakes. */
export class ChartCache {
    private readonly byModel = new Map<number, Promise<Charted | null>>()

    get(bridge: any, model: Model): Promise<Charted | null> {
        let found = this.byModel.get(model.id)
        if (found === undefined) {
            found = (async () => {
                const triangles = decodeLightMesh(String(bridge.LightMesh(model.id)))
                if (triangles === null) return null
                const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
                const v = triangles.vertices
                for (let i = 0; i < v.length; i += 3) {
                    for (let k = 0; k < 3; k++) {
                        min[k] = Math.min(min[k]!, v[i + k]!)
                        max[k] = Math.max(max[k]!, v[i + k]!)
                    }
                }
                return { charts: await chartModel(triangles), min, max }
            })()
            this.byModel.set(model.id, found)
            // Forgotten on failure, so the next bake tries again.
            const settled = found
            settled.catch(() => { if (this.byModel.get(model.id) === settled) this.byModel.delete(model.id) })
        }
        return found
    }

    /** A mesh model's charts are of the triangles it had: `set` forgets them. */
    forget(model: Model): void {
        const found = this.byModel.get(model.id)
        if (found === undefined) return
        this.byModel.delete(model.id)
        found.then((c) => c?.charts.dispose(), () => {})
    }

    dispose(): void {
        for (const found of this.byModel.values()) found.then((c) => c?.charts.dispose(), () => {})
        this.byModel.clear()
    }
}

/** How a model is named on the console: its file, or what made it. */
function nameOf(model: Model): string {
    const url = modelUrls.get(model)
    return url === undefined ? "a scene.mesh model" : url.split("/").pop()!
}

/**
 * Lays the light out and starts the bake. "" when it started; otherwise why
 * not, for the console. `live` is asked before anything reaches the bridge, so
 * a bake replaced while its charts were cut changes nothing.
 */
export async function beginBake(bridge: any, items: readonly BakeItem[], cache: ChartCache, live: () => boolean): Promise<string> {
    if (items.length === 0) return "nothing in the scene is static. Spawn what never moves with { static: true }, or give it a static body"
    const models: Model[] = []
    for (const item of items) if (!models.includes(item.model)) models.push(item.model)
    const charted = await Promise.all(models.map((m) => cache.get(bridge, m)))
    if (!live()) return ""

    const refused = models.filter((_, i) => charted[i] === null).map(nameOf)
    if (refused.length > 0) console.warn(`[oj] scene.bake: ${[...new Set(refused)].join(", ")} cannot be baked into (a skinned mesh, or one drawing points or lines), so it is lit like something that moves.`)
    const usable = models.filter((_, i) => charted[i] !== null)
    const baked = items.filter((item) => usable.includes(item.model))
    if (baked.length === 0) return "no static model can be baked into"

    const charts = usable.map((m) => charted[models.indexOf(m)]!)
    const layout = layoutLight(charts.map((c) => c.charts), baked.map((item) => ({ model: usable.indexOf(item.model), scale: item.scale })), DEFAULT_DETAIL)
    if (layout === null) return "its static surface is too large for the atlas even at one texel a metre"

    for (let m = 0; m < usable.length; m++) {
        const unwrap = layout.unwraps[m]
        if (unwrap === null || unwrap === undefined) continue
        const problem = String(bridge.SetLightUnwrap(usable[m]!.id, unwrap.xref, unwrap.uv, unwrap.indices))
        if (problem !== "") throw new Error(`[oj] scene.bake: OneJS refused ${nameOf(usable[m]!)}'s unwrap: ${problem}`)
    }

    const actors: number[] = [], copies: number[] = []
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
    baked.forEach((item, i) => {
        const [x, y, w, h] = layout.rects[i]!
        const st = [w / layout.width, h / layout.height, x / layout.width, y / layout.height]
        if (item.actor !== undefined) actors.push(item.actor, ...st)
        else copies.push(item.copy![0], item.copy![1], ...st)
        const c = charts[usable.indexOf(item.model)]!
        const q = toQuat(item.rotation)
        for (let corner = 0; corner < 8; corner++) {
            const local: Vec3 = [corner & 1 ? c.max[0] : c.min[0], corner & 2 ? c.max[1] : c.min[1], corner & 4 ? c.max[2] : c.min[2]]
            const p = rotate(q, [local[0] * item.scale, local[1] * item.scale, local[2] * item.scale])
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k]!, p[k]! + item.position[k]!)
                max[k] = Math.max(max[k]!, p[k]! + item.position[k]!)
            }
        }
    })
    const grid = probeGrid(min, max)
    if (!live()) return ""
    return String(bridge.BeginBake(new Float32Array(actors), new Float32Array(copies),
        new Float32Array([...grid.origin, grid.spacing, ...grid.counts]), layout.width, layout.height, layout.detail, BAKE_SAMPLES))
}
