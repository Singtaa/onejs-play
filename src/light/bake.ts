/**
 * What `scene.bake` hands OneJS (docs/lightmapping.md §6): which models are
 * baked into, each one's unwrap, every static actor's and scattered copy's
 * rectangle of the atlas, and the probe grid over them.
 *
 * OneJS's ModelBridge owns the geometry and the baker; oj owns the layout,
 * since xatlas runs here. So a bake reads each model's triangles from the
 * bridge (LightMesh), unwraps them once a scene, lays the atlas out, gives each
 * model its unwrap back (SetLightUnwrap), and then either starts the bake
 * (BeginBake), which the bridge steps from then on (StepBake, each frame from
 * models.ts), or shows a saved one (LoadLight).
 *
 * A saved bake is a light file: OneJS's PNG of the lightmap and the probes
 * (LightFile), with the record (record.ts) in its text chunk. A named bake
 * lays its items out in the record's order, from the record's rounded numbers,
 * so a scene that matches a file lays out exactly as the file did.
 */

import type { Model, Rotation, Vec3 } from "../models"
import type { Triangles } from "../physics3d/gltf"
import { rotate, toQuat } from "../physics3d/rotation"
import { modelUrls } from "../physics3d/sources"
import { DEFAULT_DETAIL, MAX_PAGES, MIN_DETAIL } from "./atlas"
import { readText, writeText } from "./png"
import { probeGrid } from "./probes"
import { compareRows, difference, layoutOf, matches, OPTION_NAMES, parseSaved, recordOf, rowOf, sameLayout, type BakedHere, type BakeOptionValues, type LightInputs, type LightRecord, type SavedLayout, type SavedLight, type StaticActor } from "./record"
import { chartModel, layoutLight, type Charts } from "./unwrap"

// Type-level redeclaration only, so dynamic host globals typecheck.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

/** `scene.bake`'s options when not given: the bake the first version had. */
export const BAKE_DEFAULTS: Readonly<BakeOptionValues> = Object.freeze({ bounces: 2, samples: 256, occlusion: 0, detail: DEFAULT_DETAIL })

/**
 * Each option's bounds. More bounces than 8 add nothing a player sees and
 * lengthen every path, and 4096 paths a texel is sixteen times the default's
 * time; past either, a number is a mistake rather than a wish.
 */
const OPTION_BOUNDS: Record<keyof BakeOptionValues, { min: number, max: number, whole: boolean }> = {
    bounces: { min: 0, max: 8, whole: true },
    samples: { min: 1, max: 4096, whole: true },
    occlusion: { min: 0, max: 1, whole: false },
    detail: { min: MIN_DETAIL, max: Infinity, whole: false },
}

/** `scene.bake`'s options with the defaults filled in, or a thrown error naming what is wrong with one. */
export function bakeOptions(given: unknown): BakeOptionValues {
    if (given === undefined) return { ...BAKE_DEFAULTS }
    if (given === null || typeof given !== "object" || Array.isArray(given)) throw new Error("[oj] scene.bake: its options are an object, like { bounces: 3 }")
    const o = given as Record<string, unknown>
    for (const k of Object.keys(o)) {
        if (!(OPTION_NAMES as readonly string[]).includes(k)) throw new Error(`[oj] scene.bake has no option ${k}: its options are ${OPTION_NAMES.join(", ")}`)
    }
    const values = { ...BAKE_DEFAULTS }
    for (const k of OPTION_NAMES) {
        const v = o[k]
        if (v === undefined) continue
        const { min, max, whole } = OPTION_BOUNDS[k]
        const range = max === Infinity ? `${min} or more` : `from ${min} to ${max}`
        if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) {
            throw new Error(`[oj] scene.bake: ${k} is ${whole ? "a whole number" : "a number"} ${range}, not ${typeof v === "number" ? v : JSON.stringify(v)}`)
        }
        values[k] = v
    }
    return values
}

/**
 * Frames a finished bake waits for its light file. The bridge reads the
 * lightmap back asynchronously where the GPU can (WebGPU and WebGL 2), landing
 * a frame or a few later, and LightFile answers "" until it does.
 */
export const FILE_READ_FRAMES = 120

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
    const bytes = fromBase64(text)
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

/** A bake laid out: what BeginBake and LoadLight are handed, and the layout a light file keeps. */
export interface LightPlan {
    actors: Float32Array
    copies: Float32Array
    grid: Float32Array
    /** Each page's size, and how many. */
    width: number
    height: number
    pages: number
    detail: number
    layout: SavedLayout
}

/**
 * The record of `items` and the items in its order, each placed by its
 * rounded row, so the layout made from them is the record's. `identify` names
 * a model and hashes what it is made of.
 */
export async function recordItems(items: readonly BakeItem[], identify: (model: Model) => Promise<{ name: string, sha: string }>,
    lights: Omit<LightInputs, "actors">): Promise<{ record: LightRecord, items: BakeItem[] }> {
    const ids = await Promise.all(items.map((item) => identify(item.model)))
    const actors: StaticActor[] = items.map((item, i) => ({ model: ids[i]!.name, sha: ids[i]!.sha, position: item.position, rotation: item.rotation, scale: item.scale }))
    const rows = actors.map(rowOf)
    const order = items.map((_, i) => i).sort((a, b) => compareRows(rows[a]!, rows[b]!) || a - b)
    const placed = order.map((i): BakeItem => {
        const r = rows[i]!
        return { ...items[i]!, position: [r[2], r[3], r[4]], rotation: { yaw: r[5], pitch: r[6], roll: r[7] }, scale: r[8] }
    })
    return { record: recordOf({ ...lights, actors }), items: placed }
}

/**
 * Lays the light out and gives each model its unwrap: a plan, or why not, for
 * the console. Null when `live` turned false while the charts were cut, so a
 * bake replaced meanwhile changes nothing.
 */
export async function planLight(bridge: any, items: readonly BakeItem[], cache: ChartCache, live: () => boolean, detail = DEFAULT_DETAIL): Promise<LightPlan | string | null> {
    if (items.length === 0) return "nothing in the scene is static. Spawn what never moves with { static: true }, or give it a static body"
    const models: Model[] = []
    for (const item of items) if (!models.includes(item.model)) models.push(item.model)
    const charted = await Promise.all(models.map((m) => cache.get(bridge, m)))
    if (!live()) return null

    const refused = models.filter((_, i) => charted[i] === null).map(nameOf)
    if (refused.length > 0) console.warn(`[oj] scene.bake: ${[...new Set(refused)].join(", ")} cannot be baked into (a skinned mesh, or one drawing points or lines), so it is lit like something that moves.`)
    const usable = models.filter((_, i) => charted[i] !== null)
    const baked = items.filter((item) => usable.includes(item.model))
    if (baked.length === 0) return "no static model can be baked into"

    const charts = usable.map((m) => charted[models.indexOf(m)]!)
    const layout = layoutLight(charts.map((c) => c.charts), baked.map((item) => ({ model: usable.indexOf(item.model), scale: item.scale })), detail)
    if (layout === null) return `its static surface is too large for ${MAX_PAGES} pages of light even at one texel a metre`

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
        // In pages: the sheet's second column starts at 1 less the seam, and one page's are as before pages.
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
    const g = probeGrid(min, max)
    const grid = [...g.origin, g.spacing, ...g.counts]
    return {
        actors: new Float32Array(actors), copies: new Float32Array(copies), grid: new Float32Array(grid),
        width: layout.width, height: layout.height, pages: layout.pages, detail: layout.detail,
        layout: layoutOf(layout.width, layout.height, layout.detail, grid, layout.rects, layout.pages),
    }
}

/** Starts baking the plan with these options' bounces, samples and occlusion: "" when it started, or why not. */
export function beginBake(bridge: any, plan: LightPlan, options: BakeOptionValues): string {
    return String(bridge.BeginBake(plan.actors, plan.copies, plan.grid, plan.width, plan.height, plan.pages, plan.detail, options.samples, options.bounces, options.occlusion))
}

/** What reading a named light file found. */
export type SavedFile = { found: "none" } | { found: "unreadable", why: string } | { found: "saved", saved: SavedLight, png: Uint8Array }

/** A light file's bytes as `scene.bake` reads them. */
export function readSaved(png: Uint8Array | null): SavedFile {
    if (png === null) return { found: "none" }
    let text: string | null
    try {
        text = readText(png)
    } catch (e) {
        return { found: "unreadable", why: e instanceof Error ? e.message.replace(/^\[oj\] /, "") : String(e) }
    }
    const saved = parseSaved(text)
    return typeof saved === "string" ? { found: "unreadable", why: saved } : { found: "saved", saved, png }
}

/**
 * Why a named bake has to run here, or null when the file it read was baked
 * for this scene and lays out as `plan` does, so it can be shown instead.
 */
export function whyBakeHere(file: SavedFile, now: LightRecord, plan: LightPlan): BakedHere | null {
    if (file.found === "none") return { why: "missing" }
    if (file.found === "unreadable") return { why: "unreadable", detail: file.why }
    const changed = difference(file.saved, now)
    if (changed !== null) return { why: "stale", detail: changed }
    if (!matches(file.saved, now)) return { why: "stale", detail: "its record does not match this scene's" }
    if (!sameLayout(file.saved.layout, plan.layout)) return { why: "stale", detail: "its atlas is laid out differently by this oj" }
    return null
}

/** Shows a saved bake laid out as `plan`: "" when its light is showing, or why not. */
export function loadLight(bridge: any, plan: LightPlan, png: Uint8Array): string {
    return String(bridge.LoadLight(toBase64(png), plan.actors, plan.copies, plan.grid, plan.width, plan.height, plan.pages))
}

/** The finished bake as a light file carrying `saved`, or null while the bridge has nothing finished or its read has not landed. */
export function lightFile(bridge: any, saved: SavedLight): Uint8Array | null {
    const text = String(bridge.LightFile())
    if (text === "") return null
    return writeText(fromBase64(text), JSON.stringify(saved))
}

function fromBase64(text: string): Uint8Array {
    const binary: string = globalThis.atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function toBase64(bytes: Uint8Array): string {
    let binary = ""
    // A chunk at a time: one call per byte is slow, and one call for all of them passes the argument limit.
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return globalThis.btoa(binary)
}
