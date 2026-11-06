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
    /** Texels a metre asked for, and samples a texel. */
    detail: number
    quality: number
}

/** One actor as the record keeps it: model, hash, x, y, z, yaw, pitch, roll, scale, each rounded. */
export type ActorRow = [string, string, number, number, number, number, number, number, number]

/** The record a light file carries in its text chunk. */
export interface LightRecord {
    v: 1
    baker: number
    fingerprint: string
    /** Sorted, so the order actors were spawned in does not matter. */
    actors: ActorRow[]
    sun: [number, number, number, number, number, number, number] | null
    ambient: [number, number, number, number, number, number]
    detail: number
    quality: number
}

const round = (x: number, step: number) => {
    const r = Math.round(x / step) * step
    // -0 and 0 are one place, and a decimal step leaves digits past itself.
    return r === 0 ? 0 : Number(r.toFixed(Math.max(0, -Math.floor(Math.log10(step)))))
}

function rowOf(a: StaticActor): ActorRow {
    return [
        a.model, a.sha,
        round(a.position[0], POSITION_STEP), round(a.position[1], POSITION_STEP), round(a.position[2], POSITION_STEP),
        round(a.rotation.yaw, ANGLE_STEP), round(a.rotation.pitch, ANGLE_STEP), round(a.rotation.roll, ANGLE_STEP),
        round(a.scale, SCALE_STEP),
    ]
}

const compareRows = (a: ActorRow, b: ActorRow) => {
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
    const body = { v: 1 as const, baker: BAKER_VERSION, actors, sun, ambient, detail: inputs.detail, quality: inputs.quality }
    return { ...body, fingerprint: fingerprintOf(body) }
}

/** A hash of everything but the fingerprint itself, as 16 hex digits. */
function fingerprintOf(body: Omit<LightRecord, "fingerprint">): string {
    const text = JSON.stringify([body.v, body.baker, body.actors, body.sun, body.ambient, body.detail, body.quality])
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
    if (saved.detail !== now.detail || saved.quality !== now.quality) return "its detail or quality changed"
    return null
}

/** The console line for a named bake that ran here: the file was missing, or `reason` says what changed. */
export function bakedHereLine(name: string, reason: string | null): string {
    return reason === null
        ? `[oj] ${name} is not in the cart yet: baked here.`
        : `[oj] ${name} was baked for a different scene (${reason}): baked here instead.`
}
