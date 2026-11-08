/**
 * 3D physics for a game: colliders, bodies, a character controller, queries,
 * contact and trigger events, and rewind.
 *
 *     const world = await createWorld()
 *     world.box({ at: [0, -0.5, 0], size: [20, 1, 20] })            // static
 *     const crate = world.box({ at: [0, 5, 0], dynamic: true })
 *     const me = world.character({ at: [0, 0, 0] })
 *     me.walk([x * 5, 0, z * 5])
 *     world.raycast(from, to, { only: ["wall"] })
 *
 * Metres, y up, degrees: the scene's units, so a body and an actor agree with
 * no scale between them. Rapier does the work (src/physics3d/rapier.ts), and
 * nothing here names it: the engine is oj's to change.
 *
 * The implementation is shared with 2D (src/physics/core.ts); this file is
 * what a 3D game sees, and how its vectors become the engine's.
 *
 * Static is the default because scenery is the common case. Every query and
 * every handle works the same on every host, a room script's included, since
 * nothing here needs React, the scene or Unity.
 */

import type { Actor, Rotation, Vec3 } from "../models"
import { loadRapier, type Rapier } from "./rapier"
import { fromQuat, rotate, toQuat, type Quat } from "./rotation"
import { addStillActors, placeActors, type ActorPlacement } from "./actors"
import { BodyCore, ShapeCore, WorldCore, capsuleHalf, type Dim } from "../physics/core"
import { glbTriangles, type Triangles } from "./gltf"
import { arrayModels, loadFileBytes, modelUrls } from "./sources"
import { buildNav, type Nav, type NavOptions } from "../nav/nav"
import { buildTiledNav, type NavSource, type TiledNav, type TiledNavInternal } from "../nav/tiled"
import { heightGrid, heightfieldTriangles } from "./heightfield"
import { CAR_SIZE, CarCore, type CarOptionsOf, type CarWheelState } from "./car"

/** A collision layer, named by use. Up to 16 in one world. */
export type Layer = string

/** Which bodies a query sees: only these layers, and never these layers or bodies. */
export interface Filter {
    only?: readonly Layer[]
    skip?: readonly (Layer | Body | Character)[]
}

/** Where a ray or a sweep first met something. */
export interface Hit {
    point: Vec3
    /** Out of the surface it hit. */
    normal: Vec3
    /** Along the ray or sweep, in metres. */
    distance: number
    /** What it hit; null for a shape outside any world. */
    body: Body | Character | null
}

export interface WorldOptions {
    /** Metres per second squared. [0, -9.81, 0] by default. */
    gravity?: Vec3
    /** Steps a second. 60 by default; the simulation always steps by exactly 1/rate. */
    rate?: number
}

interface BodyOptionsBase {
    /** Its centre, or a character's feet. */
    at?: Vec3
    rotation?: Partial<Rotation>
    /** Moved by the simulation: falls, is pushed, bounces. */
    dynamic?: boolean
    /** Moved by the game, and pushes dynamic bodies out of its way. */
    kinematic?: boolean
    /** Kilograms. Until set, a dynamic body's mass is its size at `density`. */
    mass?: number
    /** Kilograms a cubic metre. 500 by default, like wood: a 1 m crate weighs 500 kg. */
    density?: number
    /** 0 is ice. 0.5 by default. */
    friction?: number
    /** 0 is dead, 1 bounces back as high. The larger of two bodies' bounces wins. 0 by default. */
    bounce?: number
    /** Reports what enters and leaves, never blocks. */
    trigger?: boolean
    /** How quickly it slows by itself, moving and turning, per second: 1 loses about two thirds of its speed in a second. 0 by default. */
    drag?: number
    /** False: it moves but never turns, like a crate that slides rather than tumbles. True by default. */
    rotates?: boolean
    /**
     * For something small and quick, a shot or a puck: it is swept along its
     * path, so it cannot pass through another moving body between two steps.
     * Static walls stop everything without it. Costs a sweep a step.
     */
    fast?: boolean
    layer?: Layer
    /** Layers it passes through: neither it nor they block the other. Queries still see it. */
    ignores?: readonly Layer[]
    /** The actor the world moves each frame to where this body is. */
    actor?: Actor | null
    /** Anything the game wants back from a hit or a touch. */
    tag?: unknown
}

export interface BoxOptions extends BodyOptionsBase {
    /** Width, height, depth. [1, 1, 1] by default. */
    size?: Vec3
}

export interface SphereOptions extends BodyOptionsBase {
    /** 0.5 by default. */
    radius?: number
}

export interface CapsuleOptions extends BodyOptionsBase {
    /** 0.3 by default. */
    radius?: number
    /** End to end, the round ends included. 1.6 by default. */
    height?: number
}

export interface MeshOptions extends BodyOptionsBase {
    /** 1 is the model's own size, as `scene.spawn` takes it. */
    scale?: number
}

/**
 * Ground as a grid of heights, cheaper than the same ground as `mesh`: to
 * build, to cast a ray at, and to hand the engine. Static.
 */
export interface HeightfieldOptions extends Pick<BodyOptionsBase, "friction" | "bounce" | "layer" | "ignores" | "actor" | "tag"> {
    /** The grid's corner, where `heights[0]` is: its least x and z, and the height heights are measured from. The origin by default. */
    at?: Vec3
    /** Metres along x and along z. */
    size: readonly [number, number]
    /** Metres above `at`, x fastest: the height at sample (ix, iz) is `heights[ix + iz * samples along x]`, as a mesh grid is laid out. */
    heights: ArrayLike<number>
    /** Samples along x and along z, each at least 2. A square grid by default. */
    samples?: readonly [number, number]
}

/** What a mesh collider is made from: a model (loaded or made with `scene.mesh`), a .glb by name or URL, its bytes, or triangles. */
export type MeshSource = { readonly id: number } | string | ArrayBuffer | Uint8Array | Triangles

export interface CharacterOptions {
    /** Where its feet are. */
    at?: Vec3
    /** 0.3 by default. */
    radius?: number
    /** Feet to the top of its head. 1.6 by default. */
    height?: number
    /** The tallest ledge it walks up: 0.4 by default, a kerb or a knee-high rim, and a crate is too tall. 0 climbs nothing, and is cheaper. */
    stepHeight?: number
    /** The steepest slope it climbs, in degrees. 45 by default. */
    slope?: number
    /** How far down it keeps to the ground going over a crest or down a step. 0.3 by default. */
    snap?: number
    layer?: Layer
    /** Layers it walks through: `ignores: ["player"]` passes other players. */
    ignores?: readonly Layer[]
    actor?: Actor | null
    tag?: unknown
}

/** Where two bodies first touched. */
export interface BodyContact {
    /** One point of the touch, in the world. */
    point: Vec3 | null
    /** How fast the two were closing when they met, metres per second: how hard the hit was. */
    speed: number
}

type Kind = "box" | "sphere" | "capsule" | "mesh"

/** One body in a world. */
export interface Body {
    readonly kind: Kind
    readonly world: World
    /** Its centre. Assign to teleport it; a kinematic body travels there over the next step. */
    position: Vec3
    get rotation(): Readonly<Rotation>
    /** Any angle left out is 0: `body.rotation = { yaw: 90 }`. */
    set rotation(rotation: Partial<Rotation>)
    /**
     * Metres per second. A kinematic body holds a velocity it is given and
     * moves by it every step: a lift, a platform, a door. A static one throws.
     */
    velocity: Vec3
    readonly dynamic: boolean
    readonly kinematic: boolean
    readonly trigger: boolean
    readonly layer: Layer
    mass: number
    friction: number
    bounce: number
    /** How quickly it slows by itself, per second. */
    drag: number
    /** False holds it from turning; true lets it turn again. */
    rotates: boolean
    actor: Actor | null
    tag: unknown
    /** False once destroyed, or rewound out of existence by `world.restore`. */
    readonly alive: boolean
    /** A shove, in kilogram metres per second, so a heavy body moves less: `push([0, 500, 0])` throws a 500 kg crate up at 1 m/s. Dynamic bodies only. */
    push(impulse: Vec3): void
    /** A change of speed whatever the mass: `addVelocity([0, 5, 0])` throws anything up at 5 m/s more. A kinematic body adds it to the velocity it holds. */
    addVelocity(velocity: Vec3): void
    /** Each time something starts touching it, after the step. Returns an unsubscribe. */
    onTouch(handler: (other: Body | Character, contact: BodyContact) => void): () => void
    /** Each time something stops touching it. Returns an unsubscribe. */
    onTouchEnd(handler: (other: Body | Character) => void): () => void
    /** A trigger: each time something comes in. */
    onEnter(handler: (other: Body | Character) => void): () => void
    /** A trigger: each time something leaves. */
    onLeave(handler: (other: Body | Character) => void): () => void
    destroy(): void
}

/** Something that walks: slides along walls, climbs steps, falls, keeps to the ground, and rides whatever moving body it stands on. */
export interface Character {
    readonly kind: "character"
    readonly world: World
    /** Where its feet are. Read-only: `walk`, `jump` and `teleport` change it. */
    readonly position: Vec3
    /** Standing on something, as of the last step. */
    readonly grounded: boolean
    /** How it moved over the last step, metres per second; up and down is its jump and its fall. */
    readonly velocity: Vec3
    readonly radius: number
    readonly height: number
    readonly layer: Layer
    actor: Actor | null
    tag: unknown
    readonly alive: boolean
    /**
     * The speed it wants to go, metres per second, held until changed:
     * `walk([x * 5, 0, z * 5])` from a stick, `walk([0, 0, 0])` to stop. Every
     * step it slides along whatever it meets, climbs steps and falls when
     * nothing is under it, whatever the screen's frame rate.
     */
    walk(velocity: Vec3): void
    /** Up, as high as `height` metres against the world's gravity. Call it while `grounded` for one jump. */
    jump(height: number): void
    /**
     * Knockback, metres per second: up throws it as a jump does, and the rest
     * shoves it along the ground beside its walk, carrying on in the air and
     * fading on the ground in about a fifth of a second.
     */
    addVelocity(velocity: Vec3): void
    /** Puts its feet exactly at `at`. `world.clearSpot` finds where its middle fits; its feet are half its height below. */
    teleport(at: Vec3): void
    onTouch(handler: (other: Body | Character, contact: BodyContact) => void): () => void
    onTouchEnd(handler: (other: Body | Character) => void): () => void
    destroy(): void
}

/** What `world.car` takes. Every number has a default: a small car at a game's pace rather than a road car's. */
export type CarOptions = CarOptionsOf<Actor>

/** One wheel of a car, for a model that follows it. */
export type CarWheel = CarWheelState

/** A car: a chassis body on four sprung wheels, driven every step. */
export interface Car {
    /**
     * Held until the next call: throttle and steer from -1 to 1 (steer 1 is
     * right, throttle -1 brakes and then reverses), brake from 0 to 1.
     * Once a frame from a stick, `drive(-stick.y, stick.x)`, since a stick's y
     * is -1 at the top; from the keys, `drive(keys.y, keys.x)`. `drive(0, 0)` lets go.
     */
    drive(throttle: number, steer?: number, brake?: number): void
    /** Metres per second forward, negative in reverse. */
    readonly speed: number
    /** Any wheel on the ground, as of the last step. */
    readonly grounded: boolean
    /** Front left, front right, rear left, rear right. */
    readonly wheels: readonly CarWheel[]
    /** The chassis, an ordinary body: contacts, `push` and rewinds work as for any other. The car owns its mass and drag. */
    readonly body: Body
    /** False once destroyed, or rewound out of existence by `world.restore`. */
    readonly alive: boolean
    /** Takes the car and its chassis out of the world. */
    destroy(): void
}

/** A shape as a value, in no world: for asking about a place and a time that are not now. */
export interface Shape {
    readonly kind: "box" | "sphere" | "capsule"
    /** Where a ray from `from` to `to` meets this shape standing at `at`, or null. */
    raycast(from: Vec3, to: Vec3, place?: Place): Hit | null
    /** Whether this shape at `at` overlaps `other` at `otherAt`. */
    overlaps(other: Shape, places?: Places): boolean
    /**
     * Two shapes moving in straight lines: when they first touch, in seconds
     * from now, or null if not `within` that many seconds. Exact, not sampled.
     */
    firstTouch(other: Shape, motion: Motions): number | null
}

export interface Place {
    at?: Vec3
    rotation?: Partial<Rotation>
}

/** This shape and another, each somewhere. Both at the origin by default. */
export interface Places {
    at?: Vec3
    rotation?: Partial<Rotation>
    otherAt?: Vec3
    otherRotation?: Partial<Rotation>
}

export interface Motions extends Places {
    /** Metres per second; still by default. */
    velocity?: Vec3
    /** Metres per second; still by default. */
    otherVelocity?: Vec3
    /** How many seconds ahead to look. */
    within: number
}

export interface BoxShapeOptions {
    /** Width, height, depth. [1, 1, 1] by default. */
    size?: Vec3
}
export interface SphereShapeOptions {
    /** 0.5 by default. */
    radius?: number
}
export interface CapsuleShapeOptions {
    /** 0.3 by default. */
    radius?: number
    /** End to end, the round ends included. 1.6 by default. */
    height?: number
}

export interface ClearSpotOptions extends Filter {
    /** How far from `near` to look, in metres. 10 by default. */
    within?: number
}

/** The walker `world.slide` moves: a character's shape and limits, and what it bumps into. */
export interface SlideOptions extends Filter {
    /** 0.3 by default. */
    radius?: number
    /** Feet to the top of its head. 1.6 by default. */
    height?: number
    /** The tallest ledge it walks up. 0.4 by default. */
    stepHeight?: number
    /** The steepest slope it climbs, in degrees. 45 by default. */
    slope?: number
}

/** Where `world.visibility` looks from, how far, and what it sees past. */
export interface SightOptions extends Filter {
    /** How high above `eye` the eyes are, in metres; what is lower is seen over. 1.5 by default. */
    height?: number
    /** How far it sees, in metres. 30 by default. */
    within?: number
}

/** What `world.visibility` sees: the floor in sight, and what each corner of it lies on. */
export interface Sight {
    /** The floor in sight, a polygon round the eye, its corners in order at the eye's height. */
    outline: Vec3[]
    /** What `outline[i]` lies on, or null where it is the edge of range. */
    reaches: (Body | Character | null)[]
}

/** Where a slide ended, and whether it ended standing on something. */
export interface Slid {
    /** Its feet. */
    at: Vec3
    grounded: boolean
}

export interface World {
    box(options?: BoxOptions): Body
    sphere(options?: SphereOptions): Body
    capsule(options?: CapsuleOptions): Body
    /**
     * Every triangle of a model, placed as `scene.spawn` would place it: a
     * level, a ramp, a rock. Static, or kinematic to move it; never dynamic,
     * since a pile of triangles has no inside to fall with.
     */
    mesh(source: MeshSource, options?: MeshOptions): Promise<Body>
    /**
     * Ground from a grid of heights: a terrain chunk. Made at once, static,
     * and to rays, characters and `nav` the same ground as the triangles
     * `mesh` would make of it. A changed ground is a new one: destroy this.
     */
    heightfield(options: HeightfieldOptions): Body
    character(options?: CharacterOptions): Character
    /** A car that drives itself from what `drive` holds, each step. */
    car(options?: CarOptions): Car
    /**
     * Paths over this world's floor, built in tiles `tile` metres across
     * that follow the world: a static body made, destroyed or moved rebuilds
     * the tiles it touches within the frame's `budget`, so a building and
     * the way round it are one call.
     */
    nav(options: NavOptions & { tile: number }): Promise<TiledNav>
    /**
     * Paths over this world's floor, built from every static, solid body:
     * walls, crates and mesh levels, as they are now. A level that changes
     * builds a new one, or give `tile` and it follows the world.
     */
    nav(options?: NavOptions): Promise<Nav>
    /** The first thing on the line from `from` to `to`, or null. */
    raycast(from: Vec3, to: Vec3, filter?: Filter): Hit | null
    /**
     * Whether nothing the filter sees is between `from` and `target`. A body
     * or a character as the target is looked at in its middle, and is not
     * what blocks the view of itself.
     */
    canSee(from: Vec3, target: Vec3 | Body | Character, filter?: Filter): boolean
    /** A shape moved from `from` to `to`: where it first meets something, or null. */
    sweep(shape: Shape, from: Vec3, to: Vec3, filter?: Filter): Hit | null
    /** Every body a shape placed at `at` overlaps. */
    overlap(shape: Shape, at: Vec3, filter?: Filter): (Body | Character)[]
    /**
     * The nearest place to `near`, at its height, where a shape centred there fits without
     * overlapping anything solid, or null when nowhere `within` does.
     */
    clearSpot(shape: Shape, near: Vec3, options?: ClearSpotOptions): Vec3 | null
    /**
     * A character's move without a character: feet at `from`, moved by
     * `delta` metres, sliding along walls and climbing steps as `character`
     * would. Where it ends and whether it stands there. For a game that owns
     * its positions (a networked one) and asks the world rather than keeping
     * a body in it. A body made since the last step is not in its way yet.
     */
    slide(from: Vec3, delta: Vec3, options?: SlideOptions): Slid
    /**
     * The floor someone standing at `eye` sees: `outline`, a polygon round
     * them, its corners in order at `eye`'s height, and `reaches`, what each
     * corner lies on. It answers what `canSee` would from their eyes, so
     * whatever is inside it they can see. Shadows, fog of war, a guard's cone
     * cut to the room; `reaches` says which crates are in view.
     */
    visibility(eye: Vec3, options?: SightOptions): Sight
    /** One fixed step. A world `useWorld` made steps itself; call this on one from `createWorld`. */
    step(): void
    /** Every body's state, to hand back to `restore`. */
    snapshot(): Uint8Array
    /**
     * Back to a snapshot. Every body goes back to where it was, behind the
     * handle the game holds: one destroyed since comes back (without its
     * actor, which went with it), and one made since is destroyed.
     */
    restore(snapshot: Uint8Array): void
    gravity: Vec3
    /** Seconds one step advances. */
    readonly stepSeconds: number
    /** Steps taken since the world was made. */
    readonly steps: number
    readonly bodies: readonly (Body | Character)[]
    dispose(): void
}

const DEFAULTS = Object.freeze({
    gravity: [0, -9.81, 0] as Vec3,
    rate: 60,
    friction: 0.5,
    bounce: 0,
    density: 500,
    box: [1, 1, 1] as Vec3,
    sphere: 0.5,
    capsule: { radius: 0.3, height: 1.6 },
    character: { radius: 0.3, height: 1.6, stepHeight: 0.4, slope: 45, snap: 0.3 },
    clearSpotWithin: 10,
    sightHeight: 1.5,
    sightWithin: 30,
    layer: "default",
})
export { DEFAULTS as WORLD_DEFAULTS }

/** Loaded by the first world, and what a `Shape` needs before it can answer. */
let R: Rapier | null = null

function engine(): Rapier {
    if (R === null) throw new Error("[oj] a shape answers once the physics engine has loaded: make a world first (useWorld or await createWorld())")
    return R
}

/** A world, once its engine is loaded. Stepped by whoever holds it. */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
    R = await loadRapier()
    return new World3(R, options) as unknown as World
}

// ---------- the third dimension ----------

/** How 3D turns oj's vectors, rotations and actors into the engine's: metres, y up, quaternions. */
const DIM3: Dim<Vec3, Partial<Rotation> | undefined, Actor> = {
    n: 3,
    unit: 1,
    up: [0, 1, 0],
    e: (v) => ({ x: v[0], y: v[1], z: v[2] }),
    a: (o) => [o.x, o.y, o.z],
    rot: (r) => toQuat(r),
    rotOut: (q) => fromQuat(q),
    rotate: (q: Quat, v) => rotate(q, v as Vec3),
    unrotate: (q: Quat, v) => rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v as Vec3),
    blend: (a: Quat, b: Quat, t: number) => {
        // Normalised linear, the short way round: between two steps the turn is small, where this and a slerp agree.
        const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
        const x = a.x + (s * b.x - a.x) * t, y = a.y + (s * b.y - a.y) * t, z = a.z + (s * b.z - a.z) * t, w = a.w + (s * b.w - a.w) * t
        const n = Math.hypot(x, y, z, w)
        return { x: x / n, y: y / n, z: z / n, w: w / n }
    },
    ring: (near, radius, a) => [near[0] + Math.sin(a) * radius, near[1], near[2] + Math.cos(a) * radius],
    shape: (r, kind, d) => kind === "box" ? new r.Cuboid(d[0]! / 2, d[1]! / 2, d[2]! / 2)
        : kind === "sphere" ? new r.Ball(d[0]!)
            : new r.Capsule(capsuleHalf(d[0]!, d[1]!), d[0]!),
    place: (list) => placeActors(list as unknown as ActorPlacement[]),
    release: (actor) => { actor.destroy(); return true },
    characterActorAt: "feet",
}

/** Shapes as values, taking the options the world's bodies take: `shape.capsule({ radius: 0.3, height: 1.6 })`. Usable once any world exists. */
export const shape = Object.freeze({
    box(o: BoxShapeOptions = {}): Shape { return new ShapeCore(DIM3, engine, "box", o.size ?? DEFAULTS.box) as unknown as Shape },
    sphere(o: SphereShapeOptions = {}): Shape { return new ShapeCore(DIM3, engine, "sphere", [o.radius ?? DEFAULTS.sphere]) as unknown as Shape },
    capsule(o: CapsuleShapeOptions = {}): Shape {
        return new ShapeCore(DIM3, engine, "capsule", [o.radius ?? DEFAULTS.capsule.radius, o.height ?? DEFAULTS.capsule.height]) as unknown as Shape
    },
})

type Body3 = BodyCore<Vec3, Partial<Rotation> | undefined, Actor>

/** A mesh body's own triangles, in its local frame: what `nav` reads back. */
const meshTriangles = new WeakMap<Body3, Triangles>()

class World3 extends WorldCore<Vec3, Partial<Rotation> | undefined, Actor> {
    private readonly forgetStill: () => void
    /** Tiled navs following this world, kept up after each frame. */
    private readonly navs = new Set<TiledNavInternal>()
    private framing = false

    constructor(r: Rapier, options: WorldOptions) {
        super(r, DIM3, DEFAULTS, options)
        this.forgetStill = addStillActors(() => this.stillActors())
    }

    override dispose(): void {
        this.forgetStill()
        this.navs.clear()
        super.dispose()
    }

    /** Stepped on the frame clock: the frame's steps, then each tiled nav's budget once. */
    override frame(seconds: number): void {
        this.framing = true
        try { super.frame(seconds) } finally { this.framing = false }
        this.keepNavs()
    }

    /** Stepped by hand (createWorld): each step is a frame. */
    override step(): void {
        super.step()
        if (!this.framing) this.keepNavs()
    }

    private keepNavs(): void {
        for (const n of this.navs) {
            if (n.disposed) this.navs.delete(n)
            else if (n.budget > 0) n.update(n.budget)
        }
    }

    /** The actors of its static bodies: what the scene bakes light into without being told. */
    private *stillActors(): Iterable<Actor> {
        for (const w of this.byCollider.values()) {
            if (w instanceof BodyCore && w.alive && !w.dynamic && !w.kinematic && w.actor !== null) yield w.actor
        }
    }

    box(o: BoxOptions = {}): Body3 {
        const s = o.size ?? DEFAULTS.box
        return this.makeBody("box", this.r.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2), o)
    }

    car(o: CarOptions = {}): CarCore<Actor> {
        const body = this.makeBody("box", this.r.ColliderDesc.cuboid(...(o.size ?? CAR_SIZE).map((x) => x / 2) as Vec3), {
            at: o.at, rotation: o.rotation, dynamic: true, friction: 0.3, layer: o.layer, actor: o.actor,
        })
        return new CarCore(this, body, o)
    }

    sphere(o: SphereOptions = {}): Body3 {
        return this.makeBody("sphere", this.r.ColliderDesc.ball(o.radius ?? DEFAULTS.sphere), o)
    }

    capsule(o: CapsuleOptions = {}): Body3 {
        const radius = o.radius ?? DEFAULTS.capsule.radius
        return this.makeBody("capsule", this.r.ColliderDesc.capsule(capsuleHalf(radius, o.height ?? DEFAULTS.capsule.height), radius), o)
    }

    async mesh(source: MeshSource, o: MeshOptions = {}): Promise<Body3> {
        this.live()
        if (o.dynamic === true) throw new Error("[oj] a mesh collider is static or kinematic. For something that falls, use box, sphere or capsule.")
        const t = await trianglesOf(source)
        this.live()
        const k = o.scale ?? 1
        const vertices = k === 1 ? t.vertices : t.vertices.map((v) => v * k)
        const body = this.makeBody("mesh", this.r.ColliderDesc.trimesh(vertices, t.indices), o)
        meshTriangles.set(body, { vertices, indices: t.indices })
        return body
    }

    heightfield(o: HeightfieldOptions): Body3 {
        this.live()
        const [sx, sz] = o.size ?? []
        if (!(sx! > 0 && sz! > 0 && Number.isFinite(sx) && Number.isFinite(sz))) throw new Error("[oj] world.heightfield needs size: [along x, along z], in metres")
        const g = heightGrid(o.heights, o.samples)
        const desc = this.r.ColliderDesc.heightfield(g.nz - 1, g.nx - 1, g.heights, { x: sx!, y: 1, z: sz! }, this.r.HeightFieldFlags.FIX_INTERNAL_EDGES)
        // Rapier centres a heightfield on its collider; the body is at the corner a cart counts from.
        desc.setTranslation(sx! / 2, 0, sz! / 2)
        return this.makeBody("heightfield", desc, { at: o.at, friction: o.friction, bounce: o.bounce, layer: o.layer, ignores: o.ignores, actor: o.actor, tag: o.tag })
    }

    nav(o: NavOptions & { tile: number }): Promise<TiledNav>
    nav(o?: NavOptions): Promise<Nav>
    async nav(o: NavOptions = {}): Promise<Nav | TiledNav> {
        this.live()
        if (o.tile !== undefined) {
            const nav = await buildTiledNav(this.navSource(o.only), o as NavOptions & { tile: number })
            try { this.live() } catch (e) { nav.dispose(); throw e }
            this.navs.add(nav)
            return nav
        }
        const vertices: number[] = [], indices: number[] = []
        for (const w of this.byCollider.values()) {
            if (!(w instanceof BodyCore) || w.dynamic || w.kinematic || w.trigger) continue
            if (o.only !== undefined && !o.only.includes(w.layer)) continue
            appendTriangles(w, vertices, indices)
        }
        if (indices.length === 0) throw new Error("[oj] world.nav: no static bodies to walk on" + (o.only ? ` in layers ${o.only.join(", ")}` : ""))
        return buildNav(new Float32Array(vertices), new Uint32Array(indices), o)
    }

    /** This world's static, solid bodies for a tiled nav: the same ones the solo nav reads. */
    private navSource(only: readonly string[] | undefined): NavSource<Body3> {
        const counts = (w: unknown): w is Body3 => w instanceof BodyCore && w.alive && !w.dynamic && !w.kinematic && !w.trigger
            && (only === undefined || only.includes(w.layer))
        return {
            bodies: () => [...this.byCollider.values()].filter(counts),
            triangles: (b) => {
                if (!counts(b) || this.byCollider.get(b.colliderHandle) !== b) return null
                const vertices: number[] = [], indices: number[] = []
                appendTriangles(b, vertices, indices)
                return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), solid: solidOf(b) }
            },
            watch: (changed) => {
                const f = (b: Body3 | null) => changed(b)
                this.sceneryWatchers.add(f)
                return () => { this.sceneryWatchers.delete(f) }
            },
        }
    }
}

/**
 * A body's surface as triangles in the world, facing out (counter-clockwise
 * from outside), which is what tells a navigation mesh floor from wall. A
 * sphere or capsule stands in as its bounding box.
 */
function appendTriangles(body: Body3, vertices: number[], indices: number[]): void {
    const c = body.collider()
    const q = c.rotation(), t = c.translation()
    const put = (v: Readonly<Vec3>) => {
        const p = rotate(q, v)
        vertices.push(p[0] + t.x, p[1] + t.y, p[2] + t.z)
    }
    const mesh = meshTriangles.get(body) ?? (body.kind === "heightfield" ? heightfieldTriangles(c) : undefined)
    if (mesh !== undefined) {
        const base = vertices.length / 3, mv = mesh.vertices
        for (let i = 0; i < mv.length; i += 3) put([mv[i]!, mv[i + 1]!, mv[i + 2]!])
        for (const i of mesh.indices) indices.push(base + i)
        return
    }
    const h = halfExtentsOf(c)
    const base = vertices.length / 3
    for (const [x, y, z] of BOX_CORNERS) put([x * h[0], y * h[1], z * h[2]])
    for (const i of BOX_FACES) indices.push(base + i)
}

/**
 * A box body's inside, for a box standing upright (turned about y alone):
 * its footprint's corners in x and z, and its bottom and top. A sphere or
 * capsule stands in as its bounding box, as in its triangles. A mesh or a
 * heightfield has no inside oj knows.
 */
function solidOf(body: Body3): { poly: number[], ymin: number, ymax: number } | undefined {
    if (meshTriangles.has(body) || body.kind === "heightfield") return undefined
    const c = body.collider()
    const q = c.rotation(), t = c.translation()
    if (Math.abs(rotate(q, [0, 1, 0])[1] - 1) > 1e-6) return undefined
    const h = halfExtentsOf(c)
    const poly: number[] = []
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const p = rotate(q, [x * h[0], 0, z * h[2]])
        poly.push(p[0] + t.x, p[2] + t.z)
    }
    return { poly, ymin: t.y - h[1], ymax: t.y + h[1] }
}

const BOX_CORNERS: readonly Vec3[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
/** Two triangles a face, each counter-clockwise seen from outside, so every normal points out. */
const BOX_FACES = [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]

/** A collider's half extents: a box's own, a sphere's or capsule's bounding box. */
function halfExtentsOf(c: any): Vec3 {
    const s = c.shape
    if (s.halfExtents !== undefined) return [s.halfExtents.x, s.halfExtents.y, s.halfExtents.z]
    if (s.halfHeight !== undefined) return [s.radius, s.halfHeight + s.radius, s.radius]
    return [s.radius, s.radius, s.radius]
}

async function trianglesOf(source: MeshSource): Promise<Triangles> {
    if (typeof source === "string") return glbTriangles(await loadFileBytes(source))
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) return glbTriangles(source)
    if ("vertices" in source && "indices" in source) return source
    const made = arrayModels.get(source)
    if (made !== undefined) {
        made.collider = true
        return made.triangles()
    }
    const url = modelUrls.get(source)
    if (url === undefined) throw new Error("[oj] world.mesh: that model was not loaded with loadModel or useModel, so there is no file to read its triangles from")
    return glbTriangles(await loadFileBytes(url))
}

