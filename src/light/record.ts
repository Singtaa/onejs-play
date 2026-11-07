/**
 * What a saved light was baked for, and how a scene now differs from it.
 *
 * `scene.bake(name)` loads the named file only when it was baked for the scene
 * in front of it (PlaySite docs/lightmapping.md §2, "Out of date"). The file
 * carries a record of that scene: every static actor's model, its bytes' hash
 * and where it stands, the sun and the ambient the bounce was made of, and the
 * options and baker it was made with. A scene that matches loads the file; one
 * that does not bakes here, and `difference` names the first thing that
 * changed, for the one console line that says so.
 *
 * Plain data and arithmetic, so the same code answers in the browser, under
 * QuickJS and in Node, and the tests need no engine.
 */

/** Moves on whenever what the baker writes for the same scene changes, which makes every saved file out of date. */
export const BAKER_VERSION = 1

/** Positions are compared to a tenth of a millimetre, so float noise in a placement never makes a file stale. */
const POSITION_STEP = 1e-4
/** Angles to a hundredth of a degree, and scale to one part in ten thousand. */
const ANGLE_STEP = 1e-2
const SCALE_STEP = 1e-4

/** A static actor as the light depends on it. */
export interface StaticActor {
    /** The model's name in the cart, as `useModel` was given it. */
    model: string
    /** The model file's bytes, hashed: the SHA-256 the cart's file map carries. */
    sha: string
    position: readonly [number, number, number]
    /** Degrees, as an actor's rotation is. */
    rotation: { readonly yaw: number, readonly pitch: number, readonly roll: number }
    scale: number
}

/** Everything a bake's result depends on. */
export interface LightInputs {
    actors: readonly StaticActor[]
    /** The sun's direction and colour, or null for a scene with no sun. */
    sun: { direction: readonly [number, number, number], color: readonly [number, number, number], intensity: number } | null
    ambient: { sky: readonly [number, number, number], ground: readonly [number, number, number] }
    /** `scene.bake`'s options, given or defaulted. */
    options: BakeOptionValues
}

/** `scene.bake`'s options, each given or defaulted (docs/lightmapping.md §8). */
export interface BakeOptionValues {
    /** Times light bounces off surfaces before it stops: 0 is the sky and the sun's light off the first thing it meets. */
    bounces: number
    /** Paths a texel. */
    samples: number
    /** Extra darkening in corners and where things touch, 0 to 1. */
    occlusion: number
    /** Texels a metre asked for. */
    detail: number
}

/** The options' names in the order the record keeps and the console names them. */
export const OPTION_NAMES = ["bounces", "samples", "occlusion", "detail"] as const

/** One actor as the record keeps it: model, hash, x, y, z, yaw, pitch, roll, scale, each rounded. */
export type ActorRow = [string, string, number, number, number, number, number, number, number]

/** The record a light file carries in its text chunk. */
export interface LightRecord {
    v: 2
    baker: number
    fingerprint: string
    /** Sorted, so the order actors were spawned in does not matter. */
    actors: ActorRow[]
    sun: [number, number, number, number, number, number, number] | null
    ambient: [number, number, number, number, number, number]
    bounces: number
    samples: number
    occlusion: number
    detail: number
}

const round = (x: number, step: number) => {
    const r = Math.round(x / step) * step
    // -0 and 0 are one place, and a decimal step leaves digits past itself.
    return r === 0 ? 0 : Number(r.toFixed(Math.max(0, -Math.floor(Math.log10(step)))))
}

/** An actor as the record keeps it, rounded. */
export function rowOf(a: StaticActor): ActorRow {
    return [
        a.model, a.sha,
        round(a.position[0], POSITION_STEP), round(a.position[1], POSITION_STEP), round(a.position[2], POSITION_STEP),
        round(a.rotation.yaw, ANGLE_STEP), round(a.rotation.pitch, ANGLE_STEP), round(a.rotation.roll, ANGLE_STEP),
        round(a.scale, SCALE_STEP),
    ]
}

/** The record's order: model, hash, then place. */
export const compareRows = (a: ActorRow, b: ActorRow) => {
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!, y = b[i]!
        if (x < y) return -1
        if (x > y) return 1
    }
    return 0
}

/** The record for these inputs, fingerprint included. */
export function recordOf(inputs: LightInputs): LightRecord {
    const actors = inputs.actors.map(rowOf).sort(compareRows)
    const c = (v: readonly number[]) => v.map((x) => round(x, 1e-4))
    const sun = inputs.sun === null ? null
        : [...c(inputs.sun.direction), ...c(inputs.sun.color), round(inputs.sun.intensity, 1e-4)] as LightRecord["sun"]
    const ambient = [...c(inputs.ambient.sky), ...c(inputs.ambient.ground)] as LightRecord["ambient"]
    const { bounces, samples, occlusion, detail } = inputs.options
    const body = { v: 2 as const, baker: BAKER_VERSION, actors, sun, ambient, bounces, samples, occlusion, detail }
    return { ...body, fingerprint: fingerprintOf(body) }
}

/** A hash of everything but the fingerprint itself, as 16 hex digits. */
function fingerprintOf(body: Omit<LightRecord, "fingerprint">): string {
    return hash16(JSON.stringify([body.v, body.baker, body.actors, body.sun, body.ambient, ...OPTION_NAMES.map((k) => body[k])]))
}

function hash16(text: string): string {
    // Two 32-bit FNV-1a passes with different offsets: a file named in a cart
    // is compared with one scene, so this guards against chance, not an adversary.
    let a = 0x811c9dc5, b = 0x050c5d1f
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i)
        a = Math.imul(a ^ ch, 0x01000193) >>> 0
        b = Math.imul(b ^ ch, 0x01000193) >>> 0
        b = (b ^ (b >>> 15)) >>> 0
    }
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}

/**
 * Where a bake's light sits: the atlas, the probe grid and every rectangle.
 * It is made from the record alone (the rounded actors, in the record's order),
 * so a scene that matches a file lays out as the file did; the layout is
 * saved too, so an unwrapper or packer that changed is caught rather than
 * drawing one actor's light on another.
 */
export interface SavedLayout {
    /** The atlas's width and height in texels, and its texels a metre: each page's. */
    atlas: [number, number, number]
    /**
     * How many pages, when more than one. A one-page layout has no `pages`, and
     * its rectangles are hashed without theirs, so it is the layout a file had
     * before there were pages, and such a file still matches.
     */
    pages?: number
    /** The probe grid's origin, spacing and three counts. */
    grid: [number, number, number, number, number, number, number]
    /** Every rectangle, in the record's order, hashed. */
    rects: string
}

/** What a light file's text chunk holds. */
export interface SavedLight extends LightRecord {
    layout: SavedLayout
}

/**
 * The layout of pages `width` by `height` at `detail`, a probe grid, and each
 * rectangle as x, y, width and height in texels on its page (`page`, all 0
 * when not given).
 */
export function layoutOf(width: number, height: number, detail: number, grid: readonly number[], rects: readonly (readonly number[])[], page: readonly number[] = []): SavedLayout {
    const pages = Math.max(0, ...page) + 1
    const layout: SavedLayout = {
        atlas: [width, height, detail],
        grid: [...grid] as SavedLayout["grid"],
        rects: hash16(JSON.stringify(pages === 1 ? rects : rects.map((r, i) => [page[i] ?? 0, ...r]))),
    }
    if (pages > 1) layout.pages = pages
    return layout
}

export function sameLayout(a: SavedLayout, b: SavedLayout): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}

const isNumbers = (x: unknown, n: number) => Array.isArray(x) && x.length === n && x.every((v) => typeof v === "number")

/** parseSaved's answer for a record an older oj wrote, which a bake reads as out of date rather than unreadable. */
export const OLDER = "it was saved by an older oj"

/** A light file's text read back: the record, or why it is not one this baker wrote. */
export function parseSaved(text: string | null): SavedLight | string {
    if (text === null) return "it holds no light record"
    let r: any
    try {
        r = JSON.parse(text)
    } catch {
        return "its light record is not JSON"
    }
    if (r === null || typeof r !== "object") return "its light record is not an object"
    // The first record, before the options: every file that carries one is out of date, as no option was recorded.
    if (r.v === 1) return OLDER
    if (r.v !== 2) return "its light record is of a version this oj does not read"
    const ok = typeof r.baker === "number" && typeof r.fingerprint === "string" && Array.isArray(r.actors)
        && (r.sun === null || isNumbers(r.sun, 7)) && isNumbers(r.ambient, 6)
        && OPTION_NAMES.every((k) => typeof r[k] === "number")
        && r.layout !== null && typeof r.layout === "object" && isNumbers(r.layout.atlas, 3) && isNumbers(r.layout.grid, 7) && typeof r.layout.rects === "string"
        && (r.layout.pages === undefined || (Number.isInteger(r.layout.pages) && r.layout.pages > 1))
        && r.actors.every((a: unknown) => Array.isArray(a) && a.length === 9 && typeof a[0] === "string" && typeof a[1] === "string" && a.slice(2).every((v: unknown) => typeof v === "number"))
    return ok ? r as SavedLight : "its light record is missing a field"
}

/** Whether a saved record was baked for exactly these inputs. */
export function matches(saved: LightRecord, now: LightRecord): boolean {
    return saved.fingerprint === now.fingerprint && saved.baker === now.baker
}

const place = (r: ActorRow) => `[${r[2]}, ${r[3]}, ${r[4]}]`
const sameTransform = (a: ActorRow, b: ActorRow) => a[0] === b[0] && a.slice(2).every((x, i) => x === b[i + 2])
const sameRow = (a: ActorRow, b: ActorRow) => compareRows(a, b) === 0

/**
 * The first way `now` differs from `saved`, in the words of the console line,
 * or null when they are the same scene. In order: the baker, the static actors
 * (a model whose file changed, one added, moved or gone), then the sun, the
 * ambient and the options.
 */
export function difference(saved: LightRecord, now: LightRecord): string | null {
    if (saved.baker !== now.baker) return "the baker has changed since it was saved"
    const left = saved.actors.filter((r) => !now.actors.some((n) => sameRow(n, r)))
    const added = now.actors.filter((r) => !saved.actors.some((s) => sameRow(s, r)))
    for (const r of added) {
        // Standing where a saved one stood, with other bytes: the model's file changed.
        if (left.some((s) => sameTransform(s, r))) return `${r[0]} changed`
    }
    for (const r of added) {
        const was = left.find((s) => s[0] === r[0] && !added.some((a) => sameTransform(a, s)))
        if (was !== undefined) return place(was) === place(r) ? `${r[0]} at ${place(r)} turned or was scaled` : `${r[0]} moved from ${place(was)} to ${place(r)}`
        return `${r[0]} at ${place(r)} is not in it`
    }
    for (const r of left) if (!now.actors.some((n) => n[0] === r[0] && sameTransform(n, r))) return `${r[0]} at ${place(r)} is no longer there`
    if (JSON.stringify(saved.sun) !== JSON.stringify(now.sun)) return now.sun === null ? "the sun is out" : saved.sun === null ? "the sun is up" : "the sun changed"
    if (JSON.stringify(saved.ambient) !== JSON.stringify(now.ambient)) return "the ambient light changed"
    for (const k of OPTION_NAMES) if (saved[k] !== now[k]) return `its ${k} changed from ${saved[k]} to ${now[k]}`
    return null
}

/**
 * Why a named bake ran here: the file was missing, it could not be read, it
 * was baked for a different scene, or the host asked for it again.
 */
export type BakedHere = { why: "missing" } | { why: "unreadable", detail: string } | { why: "stale", detail: string } | { why: "again" }

/**
 * The console line for a named bake that ran here, saying the detail it was
 * baked at when that is below the detail asked: `lowered`.
 */
export function bakedHereLine(name: string, here: BakedHere, lowered?: Lowered): string {
    const line = (() => {
        switch (here.why) {
            case "missing": return `[oj] ${name} is not in the cart yet: baked here`
            case "unreadable": return here.detail === OLDER ? `[oj] ${name} was saved by an older oj: baked here instead` : `[oj] ${name} is not a light file oj can read (${here.detail}): baked here instead`
            case "stale": return `[oj] ${name} was baked for a different scene (${here.detail}): baked here instead`
            case "again": return `[oj] ${name} baked again here`
        }
    })()
    return lowered === undefined ? `${line}.` : `${line}, ${loweredWords(lowered)}.`
}

/** A detail asked for that the pages could not hold, and the detail baked. */
export interface Lowered {
    asked: number
    baked: number
    pages: number
}

/** "at 3.1 texels a metre, as 24 does not fit 4 pages" */
export const loweredWords = (l: Lowered) => `at ${l.baked} texels a metre, as ${l.asked} does not fit ${l.pages} pages`
