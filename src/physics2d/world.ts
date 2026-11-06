/**
 * 2D physics for a game: the 3D family's names, on the stage.
 *
 *     const world = await createWorld2D()
 *     world.box({ at: [480, 620], size: [960, 40] })                 // static
 *     const crate = world.box({ at: [480, 100], size: [60, 60], dynamic: true, actor: crateRef })
 *     const me = world.character({ at: [100, 600] })
 *     me.walk([x * 300, 0])
 *     world.raycast(from, to, { only: ["wall"] })
 *
 * Stage pixels, y down, degrees clockwise: the stage's units, so a body and
 * the element it carries agree with no conversion. The engine works in
 * metres, `pixelsPerMeter` (100) to one, which is what masses, densities and
 * its tolerances mean: a 100 px crate is a 1 m crate. Rapier's 2D build does
 * the work, through the implementation 3D shares (src/physics/core.ts), and
 * nothing here names it.
 *
 * Static is the default because scenery is the common case. Nothing here needs
 * React, the stage or Unity, so a room script steps the same world.
 */

import { loadRapier2D, type Rapier2D } from "./rapier"
import { placeElements, resolveElement, type ElementActor, type ElementPlacement } from "./elements"
import { BodyCore, ShapeCore, WorldCore, capsuleHalf, type Dim, type Defaults, type Placement } from "../physics/core"
import type { Layer, Filter } from "../physics3d/world"

export type { Layer, Filter } from "../physics3d/world"
export type { ElementActor } from "./elements"

/** A point or a vector on the stage, in pixels: [x, y], y down. */
export type Vec2 = [number, number]

/** Where a ray or a sweep first met something. */
export interface Hit2D {
    point: Vec2
    /** Out of the surface it hit. */
    normal: Vec2
    /** Along the ray or sweep, in pixels. */
    distance: number
    /** What it hit; null for a shape outside any world. */
    body: Body2D | Character2D | null
}

export interface World2DOptions {
    /** Pixels per second squared. [0, 980] by default: down, a metre's g at 100 px a metre. */
    gravity?: Vec2
    /** Steps a second. 60 by default; the simulation always steps by exactly 1/rate. */
    rate?: number
    /** Stage pixels in a metre, which is what mass, density and the engine's tolerances are in. 100 by default. */
    pixelsPerMeter?: number
}

interface Body2DOptionsBase {
    /** Its centre, or a character's feet. */
    at?: Vec2
    /** Degrees, clockwise, as the stage turns an element. */
    rotation?: number
    /** Moved by the simulation: falls, is pushed, bounces. */
    dynamic?: boolean
    /** Moved by the game, and pushes dynamic bodies out of its way. */
    kinematic?: boolean
    /** Kilograms. Until set, a dynamic body's mass is its area at `density`. */
    mass?: number
    /** Kilograms a square metre (`pixelsPerMeter` squared pixels). 500 by default: a 100 px crate weighs 500 kg. */
    density?: number
    /** 0 is ice. 0.5 by default. */
    friction?: number
    /** 0 is dead, 1 bounces back as high. The larger of two bodies' bounces wins. 0 by default. */
    bounce?: number
    /** Reports what enters and leaves, never blocks. */
    trigger?: boolean
    layer?: Layer
    /** Layers it passes through: neither it nor they block the other. Queries still see it. */
    ignores?: readonly Layer[]
    /**
     * The element the world moves to this body every frame, or a ref to one:
     * its centre on the body's centre, turned with it. Give it `position:
     * "absolute"` in a parent at the stage's top left. Destroying the body
     * leaves the element alone, since React owns it.
     */
    actor?: ElementActor | null
    /** Anything the game wants back from a hit or a touch. */
    tag?: unknown
}

export interface Box2DOptions extends Body2DOptionsBase {
    /** Width and height. [100, 100] by default. */
    size?: Vec2
}

export interface CircleOptions extends Body2DOptionsBase {
    /** 50 by default. */
    radius?: number
}

export interface Capsule2DOptions extends Body2DOptionsBase {
    /** 30 by default. */
    radius?: number
    /** End to end, the round ends included, upright. 160 by default. */
    height?: number
}

export interface PolygonOptions extends Body2DOptionsBase {
    /** Its corners, around its centre (`at`): a convex shape; anything else becomes its hull. */
    points: readonly Vec2[]
}

export interface OutlineOptions extends Omit<Body2DOptionsBase, "dynamic" | "mass" | "density"> {
    /** A line through these points, relative to `at`: ground, walls, a level of any shape. */
    points: readonly Vec2[]
    /** Joins the last point back to the first. False by default. */
    closed?: boolean
}

export interface Character2DOptions {
    /** Where its feet are. */
    at?: Vec2
    /** 30 by default. */
    radius?: number
    /** Feet to the top of its head. 160 by default. */
    height?: number
    /** The tallest ledge it walks up. 30 by default; 0 climbs nothing, and is cheaper. */
    stepHeight?: number
    /** The steepest slope it climbs, in degrees. 45 by default. */
    slope?: number
    /** How far down it keeps to the ground going over a crest or down a step. 30 by default. */
    snap?: number
    layer?: Layer
    /** Layers it walks through: `ignores: ["player"]` passes other players. */
    ignores?: readonly Layer[]
    actor?: ElementActor | null
    tag?: unknown
}

/** Where two bodies first touched. */
export interface Contact2D {
    /** One point of the touch, on the stage. */
    point: Vec2 | null
    /** How fast the two were closing when they met, pixels a second: how hard the hit was. */
    speed: number
}

type Kind2D = "box" | "circle" | "capsule" | "polygon" | "outline"

/** One body in a 2D world. */
export interface Body2D {
    readonly kind: Kind2D
    /** Its centre. Assign to teleport it; a kinematic body travels there over the next step. */
    position: Vec2
    /** Degrees, clockwise. */
    rotation: number
    /** Pixels per second. */
    velocity: Vec2
    readonly dynamic: boolean
    readonly kinematic: boolean
    readonly trigger: boolean
    readonly layer: Layer
    mass: number
    friction: number
    bounce: number
    actor: ElementActor | null
    tag: unknown
    /** False once destroyed, or rewound out of existence by `world.restore`. */
    readonly alive: boolean
    /** A shove, in kilogram pixels per second, so a heavy body moves less. */
    push(impulse: Vec2): void
    /** A change of speed whatever the mass: `addVelocity([0, -500])` throws anything up at 500 px/s more. */
    addVelocity(velocity: Vec2): void
    /** Each time something starts touching it, after the step. Returns an unsubscribe. */
    onTouch(handler: (other: Body2D | Character2D, contact: Contact2D) => void): () => void
    /** Each time something stops touching it. Returns an unsubscribe. */
    onTouchEnd(handler: (other: Body2D | Character2D) => void): () => void
    /** A trigger: each time something comes in. */
    onEnter(handler: (other: Body2D | Character2D) => void): () => void
    /** A trigger: each time something leaves. */
    onLeave(handler: (other: Body2D | Character2D) => void): () => void
    destroy(): void
}

/** Something that walks: slides along walls, climbs steps, falls, keeps to the ground. */
export interface Character2D {
    readonly kind: "character"
    /** Where its feet are. Read-only: `walk`, `jump` and `teleport` change it. */
    readonly position: Vec2
    /** Standing on something, as of the last step. */
    readonly grounded: boolean
    /** How it moved over the last step, pixels per second; up and down is its jump and its fall. */
    readonly velocity: Vec2
    readonly radius: number
    readonly height: number
    readonly layer: Layer
    actor: ElementActor | null
    tag: unknown
    readonly alive: boolean
    /** The speed it wants to go, pixels per second, held until changed: `walk([x * 300, 0])`. */
    walk(velocity: Vec2): void
    /** Up, as high as `height` pixels against the world's gravity. Call it while `grounded` for one jump. */
    jump(height: number): void
    /** Puts its feet exactly at `at`. `world.clearSpot` finds somewhere it fits. */
    teleport(at: Vec2): void
    onTouch(handler: (other: Body2D | Character2D, contact: Contact2D) => void): () => void
    onTouchEnd(handler: (other: Body2D | Character2D) => void): () => void
    destroy(): void
}

/** A shape as a value, in no world: for asking about a place and a time that are not now. */
export interface Shape2D {
    readonly kind: "box" | "circle" | "capsule"
    /** Where a ray from `from` to `to` meets this shape standing at `at`, or null. */
    raycast(from: Vec2, to: Vec2, place?: Place2D): Hit2D | null
    /** Whether this shape at `at` overlaps `other` at `otherAt`. */
    overlaps(other: Shape2D, places?: Places2D): boolean
    /** Two shapes moving in straight lines: when they first touch, in seconds from now, or null if not `within` that many. */
    firstTouch(other: Shape2D, motion: Motions2D): number | null
}

export interface Place2D {
    at?: Vec2
    rotation?: number
}

export interface Places2D {
    at?: Vec2
    rotation?: number
    otherAt?: Vec2
    otherRotation?: number
}

export interface Motions2D extends Places2D {
    /** Pixels per second; still by default. */
    velocity?: Vec2
    /** Pixels per second; still by default. */
    otherVelocity?: Vec2
    /** How many seconds ahead to look. */
    within: number
}

export interface ClearSpot2DOptions extends Filter {
    /** How far from `near` to look, in pixels. 1000 by default. */
    within?: number
}

export interface Slide2DOptions extends Filter {
    radius?: number
    height?: number
    stepHeight?: number
    slope?: number
}

export interface Slid2D {
    at: Vec2
    grounded: boolean
}

export interface World2D {
    box(options?: Box2DOptions): Body2D
    circle(options?: CircleOptions): Body2D
    capsule(options?: Capsule2DOptions): Body2D
    /** A convex shape from its corners. */
    polygon(options: PolygonOptions): Body2D
    /** A line through points, static or kinematic: ground and walls of any shape. */
    outline(options: OutlineOptions): Body2D
    character(options?: Character2DOptions): Character2D
    /** The first thing on the line from `from` to `to`, or null. */
    raycast(from: Vec2, to: Vec2, filter?: Filter): Hit2D | null
    /** Whether nothing the filter sees is between `from` and `target`; a body as the target is looked at in its middle and does not hide itself. */
    canSee(from: Vec2, target: Vec2 | Body2D | Character2D, filter?: Filter): boolean
    /** A shape moved from `from` to `to`: where it first meets something, or null. */
    sweep(shape: Shape2D, from: Vec2, to: Vec2, filter?: Filter): Hit2D | null
    /** Every body a shape placed at `at` overlaps. */
    overlap(shape: Shape2D, at: Vec2, filter?: Filter): Body2D[]
    /** The nearest place to `near` where a shape fits without overlapping anything solid, or null when nowhere `within` does. */
    clearSpot(shape: Shape2D, near: Vec2, options?: ClearSpot2DOptions): Vec2 | null
    /** A character's move without a character: where it ends and whether it stands. */
    slide(from: Vec2, delta: Vec2, options?: Slide2DOptions): Slid2D
    /** One fixed step. A world `useWorld2D` made steps itself; call this on one from `createWorld2D`. */
    step(): void
    /** Every body's state, to hand back to `restore`. */
    snapshot(): Uint8Array
    /** Back to a snapshot: bodies destroyed since come back behind the same handles, bodies made since are destroyed. */
    restore(snapshot: Uint8Array): void
    gravity: Vec2
    readonly pixelsPerMeter: number
    /** Seconds one step advances. */
    readonly stepSeconds: number
    /** Steps taken since the world was made. */
    readonly steps: number
    readonly bodies: readonly (Body2D | Character2D)[]
    dispose(): void
}

const DEFAULTS = Object.freeze({
    gravity: [0, 980] as Vec2,
    rate: 60,
    pixelsPerMeter: 100,
    friction: 0.5,
    bounce: 0,
    density: 500,
    box: [100, 100] as Vec2,
    circle: 50,
    capsule: { radius: 30, height: 160 },
    character: { radius: 30, height: 160, stepHeight: 30, slope: 45, snap: 30 },
    clearSpotWithin: 1000,
    layer: "default",
})
export { DEFAULTS as WORLD2D_DEFAULTS }

/** Loaded by the first 2D world, and what a `Shape2D` needs before it can answer. */
let R: Rapier2D | null = null

function engine(): Rapier2D {
    if (R === null) throw new Error("[oj] a shape answers once the physics engine has loaded: make a world first (useWorld2D or await createWorld2D())")
    return R
}

/** A 2D world, once its engine is loaded. Stepped by whoever holds it. */
export async function createWorld2D(options: World2DOptions = {}): Promise<World2D> {
    R = await loadRapier2D()
    return new World2(R, options) as unknown as World2D
}

// ---------- the second dimension ----------

const RAD = Math.PI / 180

/** Rounds away float noise, so a body turned by 90 reads back 90. */
function tidy(deg: number): number {
    const r = Math.round(deg * 1e6) / 1e6
    return r === 0 ? 0 : r
}

/**
 * How 2D turns the stage's pixels into the engine's metres. y stays down: the
 * engine has no up of its own, so gravity points down the screen, and an angle
 * that turns +x toward +y is clockwise on the stage, as `rotate` is.
 */
function dim2(pixelsPerMeter: number): Dim<Vec2, number | undefined, ElementActor> {
    return {
        n: 2,
        unit: pixelsPerMeter,
        up: [0, -1],
        e: (v) => ({ x: v[0], y: v[1] }),
        a: (o) => [o.x, o.y],
        rot: (deg) => (deg ?? 0) * RAD,
        rotOut: (rad) => tidy(rad / RAD),
        rotate: (rad: number, v) => [Math.cos(rad) * v[0]! - Math.sin(rad) * v[1]!, Math.sin(rad) * v[0]! + Math.cos(rad) * v[1]!],
        ring: (near, radius, a) => [near[0] + Math.sin(a) * radius, near[1] + Math.cos(a) * radius],
        shape: (r, kind, d) => kind === "box" ? new r.Cuboid(d[0]! / 2, d[1]! / 2)
            : kind === "circle" ? new r.Ball(d[0]!)
                : new r.Capsule(capsuleHalf(d[0]!, d[1]!), d[0]!),
        place: (list) => {
            const out: ElementPlacement[] = []
            for (const p of list as readonly Placement<Vec2, ElementActor>[]) {
                const element = resolveElement(p.actor)
                if (element !== null) out.push({ element, at: p.at, degrees: p.rotation === null ? null : tidy(p.rotation / RAD) })
            }
            placeElements(out)
        },
        release: () => {},
    }
}

const SHAPE_DIM = dim2(DEFAULTS.pixelsPerMeter)

/** Shapes as values, taking the options the world's bodies take: `shape2D.circle({ radius: 20 })`. Usable once any 2D world exists. */
export const shape2D = Object.freeze({
    box(o: { size?: Vec2 } = {}): Shape2D { return new ShapeCore(SHAPE_DIM, engine, "box", o.size ?? DEFAULTS.box) as unknown as Shape2D },
    circle(o: { radius?: number } = {}): Shape2D { return new ShapeCore(SHAPE_DIM, engine, "circle", [o.radius ?? DEFAULTS.circle]) as unknown as Shape2D },
    capsule(o: { radius?: number, height?: number } = {}): Shape2D {
        return new ShapeCore(SHAPE_DIM, engine, "capsule", [o.radius ?? DEFAULTS.capsule.radius, o.height ?? DEFAULTS.capsule.height]) as unknown as Shape2D
    },
})

type Body2 = BodyCore<Vec2, number | undefined, ElementActor>

class World2 extends WorldCore<Vec2, number | undefined, ElementActor> {
    readonly pixelsPerMeter: number

    constructor(r: Rapier2D, options: World2DOptions) {
        const ppm = options.pixelsPerMeter ?? DEFAULTS.pixelsPerMeter
        if (!(ppm > 0)) throw new Error(`[oj] pixelsPerMeter is a positive number of stage pixels; got ${ppm}`)
        super(r, dim2(ppm), DEFAULTS as unknown as Defaults<Vec2>, options)
        this.pixelsPerMeter = ppm
    }

    /** Pixels to the engine's metres. */
    private m(px: number): number { return px / this.pixelsPerMeter }

    box(o: Box2DOptions = {}): Body2 {
        const s = o.size ?? DEFAULTS.box
        return this.makeBody("box", this.r.ColliderDesc.cuboid(this.m(s[0]) / 2, this.m(s[1]) / 2), o)
    }

    circle(o: CircleOptions = {}): Body2 {
        return this.makeBody("circle", this.r.ColliderDesc.ball(this.m(o.radius ?? DEFAULTS.circle)), o)
    }

    capsule(o: Capsule2DOptions = {}): Body2 {
        const radius = o.radius ?? DEFAULTS.capsule.radius
        return this.makeBody("capsule", this.r.ColliderDesc.capsule(this.m(capsuleHalf(radius, o.height ?? DEFAULTS.capsule.height)), this.m(radius)), o)
    }

    polygon(o: PolygonOptions): Body2 {
        if (o.points.length < 3) throw new Error(`[oj] a polygon needs 3 points or more; got ${o.points.length}`)
        // Rapier makes a hull of points on one line and fails only when the collider is built.
        if (!enclosesArea(o.points)) throw new Error("[oj] those points make no area: a polygon's points cannot all lie on one line")
        const desc = this.r.ColliderDesc.convexHull(this.flat(o.points))
        if (desc === null || desc === undefined) throw new Error("[oj] those points make no area: a polygon's points cannot all lie on one line")
        return this.makeBody("polygon", desc, o)
    }

    outline(o: OutlineOptions): Body2 {
        if ((o as { dynamic?: boolean }).dynamic === true) throw new Error("[oj] an outline is static or kinematic, since a line has no inside to fall with. For something that falls, use polygon.")
        if (o.points.length < 2) throw new Error(`[oj] an outline needs 2 points or more; got ${o.points.length}`)
        const points = o.closed === true ? [...o.points, o.points[0]!] : o.points
        return this.makeBody("outline", this.r.ColliderDesc.polyline(this.flat(points)), o)
    }

    private flat(points: readonly Vec2[]): Float32Array {
        const out = new Float32Array(points.length * 2)
        points.forEach((p, i) => { out[i * 2] = this.m(p[0]); out[i * 2 + 1] = this.m(p[1]) })
        return out
    }
}

/** Whether some three of the points are not on one line. */
function enclosesArea(points: readonly Vec2[]): boolean {
    const [a] = points
    const b = points.find((p) => Math.hypot(p[0] - a![0], p[1] - a![1]) > 1e-6)
    if (a === undefined || b === undefined) return false
    const span = Math.hypot(b[0] - a[0], b[1] - a[1])
    return points.some((p) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / span > 1e-6)
}
