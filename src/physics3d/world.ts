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
 * Static is the default because scenery is the common case. Every query and
 * every handle works the same on every host, a room script's included, since
 * nothing here needs React, the scene or Unity.
 */

import type { Actor, Rotation, Vec3 } from "../models"
import { loadRapier, type Rapier } from "./rapier"
import { fromQuat, toQuat, type Quat } from "./rotation"
import { placeActors, type ActorPlacement } from "./actors"
import { glbTriangles, type Triangles } from "./gltf"
import { loadFileBytes, modelUrls } from "./sources"
import { buildNav, type Nav, type NavOptions } from "../nav/nav"

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

/** What a mesh collider is made from: a model, a .glb by name or URL, its bytes, or triangles. */
export type MeshSource = { readonly id: number } | string | ArrayBuffer | Uint8Array | Triangles

export interface CharacterOptions {
    /** Where its feet are. */
    at?: Vec3
    /** 0.3 by default. */
    radius?: number
    /** Feet to the top of its head. 1.6 by default. */
    height?: number
    /** The tallest ledge it walks up. 0.3 by default; 0 climbs nothing, and is cheaper. */
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
    rotation: Readonly<Rotation>
    /** Metres per second. */
    velocity: Vec3
    readonly dynamic: boolean
    readonly kinematic: boolean
    readonly trigger: boolean
    readonly layer: Layer
    mass: number
    friction: number
    bounce: number
    actor: Actor | null
    tag: unknown
    /** False once destroyed, or rewound out of existence by `world.restore`. */
    readonly alive: boolean
    /** A shove, in kilogram metres per second, so a heavy body moves less: `push([0, 500, 0])` throws a 500 kg crate up at 1 m/s. */
    push(impulse: Vec3): void
    /** A change of speed whatever the mass: `addVelocity([0, 5, 0])` throws anything up at 5 m/s more. */
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

/** Something that walks: slides along walls, climbs steps, falls, keeps to the ground. */
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
    /** Puts its feet exactly at `at`. `world.clearSpot` finds somewhere it fits. */
    teleport(at: Vec3): void
    onTouch(handler: (other: Body | Character, contact: BodyContact) => void): () => void
    onTouchEnd(handler: (other: Body | Character) => void): () => void
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
    /** The tallest ledge it walks up. 0.3 by default. */
    stepHeight?: number
    /** The steepest slope it climbs, in degrees. 45 by default. */
    slope?: number
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
    character(options?: CharacterOptions): Character
    /**
     * Paths over this world's floor, built from every static, solid body:
     * walls, crates and mesh levels, as they are now. A level that changes
     * builds a new one.
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
    overlap(shape: Shape, at: Vec3, filter?: Filter): Body[]
    /**
     * The nearest place to `near`, at its height, where a shape fits without
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
    character: { radius: 0.3, height: 1.6, stepHeight: 0.3, slope: 45, snap: 0.3 },
    clearSpotWithin: 10,
    layer: "default",
})
export { DEFAULTS as WORLD_DEFAULTS }

/** Loaded by the first world, and what a `Shape` needs before it can answer. */
let R: Rapier | null = null

/** A world, once its engine is loaded. Stepped by whoever holds it. */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
    R = await loadRapier()
    return new WorldImpl(R, options)
}

// ---------- shapes as values ----------

class ShapeImpl implements Shape {
    private raw: unknown = null
    constructor(readonly kind: "box" | "sphere" | "capsule", readonly dims: readonly number[]) {}

    /** The engine's shape, made on first use, which is after a world loaded the engine. */
    rapier(): any {
        if (this.raw !== null) return this.raw
        const r = engine()
        const [a, b, c] = this.dims
        this.raw = this.kind === "box" ? new r.Cuboid(a! / 2, b! / 2, c! / 2)
            : this.kind === "sphere" ? new r.Ball(a!)
                : new r.Capsule(capsuleHalf(a!, b!), a!)
        return this.raw
    }

    raycast(from: Vec3, to: Vec3, place: Place = {}): Hit | null {
        const r = engine()
        const d = sub(to, from), len = length(d)
        if (len === 0) return null
        const ray = new r.Ray(xyz(from), xyz(scale(d, 1 / len)))
        const hit = this.rapier().castRayAndGetNormal(ray, xyz(place.at ?? [0, 0, 0]), toQuat(place.rotation), len, true)
        if (hit === null || hit === undefined || hit.timeOfImpact < 0) return null
        return { point: add(from, scale(d, hit.timeOfImpact / len)), normal: vec(hit.normal), distance: hit.timeOfImpact, body: null }
    }

    overlaps(other: Shape, p: Places = {}): boolean {
        return this.rapier().intersectsShape(xyz(p.at ?? ORIGIN), toQuat(p.rotation), (other as ShapeImpl).rapier(), xyz(p.otherAt ?? ORIGIN), toQuat(p.otherRotation))
    }

    firstTouch(other: Shape, m: Motions): number | null {
        const hit = this.rapier().castShape(
            xyz(m.at ?? ORIGIN), toQuat(m.rotation), xyz(m.velocity ?? ORIGIN),
            (other as ShapeImpl).rapier(), xyz(m.otherAt ?? ORIGIN), toQuat(m.otherRotation), xyz(m.otherVelocity ?? ORIGIN),
            0, m.within, true,
        )
        return hit === null || hit === undefined ? null : hit.time_of_impact
    }
}

const ORIGIN: Vec3 = [0, 0, 0]

/** Shapes as values, taking the options the world's bodies take: `shape.capsule({ radius: 0.3, height: 1.6 })`. Usable once any world exists. */
export const shape = Object.freeze({
    box(o: BoxShapeOptions = {}): Shape { return new ShapeImpl("box", o.size ?? DEFAULTS.box) },
    sphere(o: SphereShapeOptions = {}): Shape { return new ShapeImpl("sphere", [o.radius ?? DEFAULTS.sphere]) },
    capsule(o: CapsuleShapeOptions = {}): Shape {
        return new ShapeImpl("capsule", [o.radius ?? DEFAULTS.capsule.radius, o.height ?? DEFAULTS.capsule.height])
    },
})

function engine(): Rapier {
    if (R === null) throw new Error("[oj] a shape answers once the physics engine has loaded: make a world first (useWorld or await createWorld())")
    return R
}

/** Rapier's capsule is a segment and a radius; ours is end to end. */
function capsuleHalf(radius: number, height: number): number {
    return Math.max(0, height / 2 - radius)
}

// ---------- the world ----------

interface Handlers {
    touch?: Set<(other: Body | Character, contact: BodyContact) => void>
    touchEnd?: Set<(other: Body | Character) => void>
    enter?: Set<(other: Body | Character) => void>
    leave?: Set<(other: Body | Character) => void>
}

const MAX_STEPS_PER_FRAME = 4

class WorldImpl implements World {
    raw: any
    readonly r: Rapier
    private readonly queue: any
    private readonly layers = new Map<Layer, number>()
    private readonly unknownLayers = new Set<Layer>()
    /**
     * Bodies destroyed, by collider handle, so `restore` can bring one back
     * with the handle the game already holds. The most recent 4096, since a
     * snapshot older than that many destructions is not a rewind a game makes.
     */
    readonly buried = new Map<number, BodyImpl | CharacterImpl>()
    /** Every body and character, by its collider's handle. */
    readonly byCollider = new Map<number, BodyImpl | CharacterImpl>()
    readonly characters = new Set<CharacterImpl>()
    readonly stepSeconds: number
    private accumulated = 0
    steps = 0
    private disposed = false

    constructor(r: Rapier, options: WorldOptions) {
        this.r = r
        const g = options.gravity ?? DEFAULTS.gravity
        this.raw = new r.World(xyz(g))
        this.stepSeconds = 1 / (options.rate ?? DEFAULTS.rate)
        this.raw.timestep = this.stepSeconds
        this.queue = new r.EventQueue(true)
    }

    get gravity(): Vec3 { return vec(this.raw.gravity) }
    set gravity(g: Vec3) { this.raw.gravity = xyz(g) }

    get bodies(): readonly (Body | Character)[] { return [...this.byCollider.values()] }

    /** The bit a layer occupies, given on first use. */
    layerBit(layer: Layer): number {
        let bit = this.layers.get(layer)
        if (bit === undefined) {
            if (this.layers.size >= 16) throw new Error(`[oj] a world holds 16 layers; "${layer}" would be the 17th (${[...this.layers.keys()].join(", ")})`)
            bit = 1 << this.layers.size
            this.layers.set(layer, bit)
        }
        return bit
    }

    /** A collider's interaction groups: a member of its layer, colliding with all but the layers it ignores. */
    groupsFor(layer: Layer, ignores: readonly Layer[] = []): number {
        return ((this.layerBit(layer) << 16) | (0xffff & ~this.ignoreMask(ignores))) >>> 0
    }

    /** The bits of layers a body passes through, claiming them, since naming a layer to pass through is using it. */
    ignoreMask(ignores: readonly Layer[]): number {
        let mask = 0
        for (const l of ignores) mask |= this.layerBit(l)
        return mask
    }

    /** A layer a filter names: its bit, or 0 for one no body has been on, said once. */
    private filterBit(layer: Layer): number {
        const bit = this.layers.get(layer)
        if (bit !== undefined) return bit
        if (!this.unknownLayers.has(layer)) {
            this.unknownLayers.add(layer)
            console.warn(`[oj] no body has been on a layer called "${layer}" yet, so a filter naming it matches nothing. Layers so far: ${[...this.layers.keys()].join(", ") || "none"}.`)
        }
        return 0
    }

    queryGroups(filter: Filter | undefined): number | undefined {
        const only = filter?.only
        let mask = 0xffff
        if (only !== undefined) {
            mask = 0
            for (const l of only) mask |= this.filterBit(l)
        }
        for (const s of filter?.skip ?? []) if (typeof s === "string") mask &= ~this.filterBit(s)
        return mask === 0xffff ? undefined : ((0xffff << 16) | mask) >>> 0
    }

    queryPredicate(filter: Filter | undefined): ((collider: any) => boolean) | undefined {
        const skipped = (filter?.skip ?? []).filter((s): s is Body | Character => typeof s !== "string")
        if (skipped.length === 0) return undefined
        const handles = new Set(skipped.map((s) => (s as BodyImpl | CharacterImpl).colliderHandle))
        return (collider) => !handles.has(collider.handle)
    }

    private live(): void {
        if (this.disposed) throw new Error("[oj] this world was disposed")
    }

    private makeBody(kind: Kind, desc: any, o: BodyOptionsBase): Body {
        this.live()
        const r = this.r
        const at = o.at ?? [0, 0, 0]
        const bodyDesc = o.dynamic ? r.RigidBodyDesc.dynamic() : o.kinematic ? r.RigidBodyDesc.kinematicPositionBased() : r.RigidBodyDesc.fixed()
        bodyDesc.setTranslation(at[0], at[1], at[2]).setRotation(toQuat(o.rotation))
        const rb = this.raw.createRigidBody(bodyDesc)
        const layer = o.layer ?? DEFAULTS.layer
        // The larger bounce of two bodies wins, so a ball does not die on a floor with none.
        desc.setFriction(o.friction ?? DEFAULTS.friction).setRestitution(o.bounce ?? DEFAULTS.bounce).setRestitutionCombineRule(r.CoefficientCombineRule.Max)
            .setSensor(o.trigger === true).setCollisionGroups(this.groupsFor(layer, o.ignores))
        if (o.mass !== undefined) desc.setMass(o.mass)
        else desc.setDensity(o.density ?? DEFAULTS.density)
        // Every pair is reported, so a trigger hears a character and a wall hears a kinematic door.
        desc.setActiveCollisionTypes(r.ActiveCollisionTypes.ALL)
        const collider = this.raw.createCollider(desc, rb)
        const body = new BodyImpl(this, kind, rb.handle, collider.handle, layer, o)
        this.byCollider.set(collider.handle, body)
        this.fresh.add(collider.handle)
        return body
    }

    box(o: BoxOptions = {}): Body {
        const s = o.size ?? DEFAULTS.box
        return this.makeBody("box", this.r.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2), o)
    }

    sphere(o: SphereOptions = {}): Body {
        return this.makeBody("sphere", this.r.ColliderDesc.ball(o.radius ?? DEFAULTS.sphere), o)
    }

    capsule(o: CapsuleOptions = {}): Body {
        const radius = o.radius ?? DEFAULTS.capsule.radius
        return this.makeBody("capsule", this.r.ColliderDesc.capsule(capsuleHalf(radius, o.height ?? DEFAULTS.capsule.height), radius), o)
    }

    async mesh(source: MeshSource, o: MeshOptions = {}): Promise<Body> {
        this.live()
        if (o.dynamic === true) throw new Error("[oj] a mesh collider is static or kinematic. For something that falls, use box, sphere or capsule.")
        const t = await trianglesOf(source)
        this.live()
        const k = o.scale ?? 1
        const vertices = k === 1 ? t.vertices : t.vertices.map((v) => v * k)
        const body = this.makeBody("mesh", this.r.ColliderDesc.trimesh(vertices, t.indices), o) as BodyImpl
        body.meshTriangles = { vertices, indices: t.indices }
        return body
    }

    async nav(o: NavOptions = {}): Promise<Nav> {
        this.live()
        const vertices: number[] = [], indices: number[] = []
        for (const w of this.byCollider.values()) {
            if (!(w instanceof BodyImpl) || w.dynamic || w.kinematic || w.trigger) continue
            if (o.only !== undefined && !o.only.includes(w.layer)) continue
            w.appendTriangles(vertices, indices)
        }
        if (indices.length === 0) throw new Error("[oj] world.nav: no static bodies to walk on" + (o.only ? ` in layers ${o.only.join(", ")}` : ""))
        return buildNav(new Float32Array(vertices), new Uint32Array(indices), o)
    }

    character(o: CharacterOptions = {}): Character {
        this.live()
        const c = new CharacterImpl(this, this.r, o)
        this.byCollider.set(c.colliderHandle, c)
        this.characters.add(c)
        this.fresh.add(c.colliderHandle)
        return c
    }

    // ---------- slide ----------

    /**
     * One walker for each shape a game slides: a capsule on a fixed body,
     * in no layer, so nothing collides with it and no query sees it, and a
     * controller set up as a character's would be.
     */
    private readonly sliders = new Map<string, { bodyHandle: number, colliderHandle: number, controller: any, height: number }>()

    slide(from: Vec3, delta: Vec3, o: SlideOptions = {}): Slid {
        this.live()
        const radius = o.radius ?? DEFAULTS.character.radius
        const height = Math.max(o.height ?? DEFAULTS.character.height, radius * 2)
        const step = o.stepHeight ?? DEFAULTS.character.stepHeight
        const slope = o.slope ?? DEFAULTS.character.slope
        const key = `${radius} ${height} ${step} ${slope}`
        let s = this.sliders.get(key)
        if (s === undefined) {
            const r = this.r
            const rb = this.raw.createRigidBody(r.RigidBodyDesc.fixed())
            const collider = this.raw.createCollider(r.ColliderDesc.capsule(capsuleHalf(radius, height), radius).setSensor(true).setCollisionGroups(0), rb)
            s = { bodyHandle: rb.handle, colliderHandle: collider.handle, controller: makeController(this, radius, step, DEFAULTS.character.snap, slope), height }
            this.sliders.set(key, s)
        }
        const rb = this.raw.getRigidBody(s.bodyHandle)
        rb.setTranslation({ x: from[0], y: from[1] + height / 2 + SKIN, z: from[2] }, false)
        this.raw.propagateModifiedBodyPositionsToColliders()
        s.controller.computeColliderMovement(this.raw.getCollider(s.colliderHandle), xyz(delta), this.r.QueryFilterFlags.EXCLUDE_SENSORS, this.queryGroups(o), this.queryPredicate(o))
        const m = s.controller.computedMovement()
        return { at: vec3([from[0] + m.x, from[1] + m.y, from[2] + m.z]), grounded: s.controller.computedGrounded() }
    }

    // ---------- queries ----------
    //
    // The engine's query tree is rebuilt inside a step, so a body made or
    // teleported since the last one is not in it yet. Those few colliders are
    // tested one by one instead, which is what makes a level queryable the
    // moment it is built, and a respawn visible the moment it happens.

    /** Colliders made or teleported since the last step. */
    readonly fresh = new Set<number>()

    markFresh(colliderHandle: number): void {
        this.fresh.add(colliderHandle)
        this.raw.propagateModifiedBodyPositionsToColliders()
    }

    /** Whether a collider is one a query with this filter sees. */
    private sees(handle: number, filter: Filter | undefined, sensors: boolean): boolean {
        const w = this.byCollider.get(handle)
        if (w === undefined) return false
        if (!sensors && w.trigger) return false
        if (filter?.only !== undefined && !filter.only.includes(w.layer)) return false
        for (const s of filter?.skip ?? []) if (s === w.layer || s === w) return false
        return true
    }

    private predicate(filter: Filter | undefined): ((collider: any) => boolean) | undefined {
        const skip = this.queryPredicate(filter)
        if (this.fresh.size === 0) return skip
        return (collider) => !this.fresh.has(collider.handle) && (skip === undefined || skip(collider))
    }

    private freshColliders(filter: Filter | undefined, sensors: boolean): any[] {
        const out: any[] = []
        for (const h of this.fresh) if (this.sees(h, filter, sensors)) out.push(this.raw.getCollider(h))
        return out
    }

    raycast(from: Vec3, to: Vec3, filter?: Filter): Hit | null {
        this.live()
        const d = sub(to, from), len = length(d)
        if (len === 0) return null
        const ray = new this.r.Ray(xyz(from), xyz(scale(d, 1 / len)))
        let best: { toi: number, normal: Vec3, handle: number } | null = null
        const hit = this.raw.castRayAndGetNormal(ray, len, true, this.r.QueryFilterFlags.EXCLUDE_SENSORS, this.queryGroups(filter), undefined, undefined, this.predicate(filter))
        if (hit !== null && hit !== undefined) best = { toi: hit.timeOfImpact, normal: vec(hit.normal), handle: hit.collider.handle }
        for (const c of this.freshColliders(filter, false)) {
            const h = c.castRayAndGetNormal(ray, len, true)
            if (h !== null && h !== undefined && (best === null || h.timeOfImpact < best.toi)) best = { toi: h.timeOfImpact, normal: vec(h.normal), handle: c.handle }
        }
        if (best === null) return null
        return { point: add(from, scale(d, best.toi / len)), normal: best.normal, distance: best.toi, body: this.wrapperOf(best.handle) }
    }

    canSee(from: Vec3, target: Vec3 | Body | Character, filter?: Filter): boolean {
        if (Array.isArray(target)) return this.raycast(from, target as Vec3, filter) === null
        const t = target as Body | Character
        const p = t.position
        const middle: Vec3 = t.kind === "character" ? [p[0], p[1] + t.height / 2, p[2]] : p
        return this.raycast(from, middle, { only: filter?.only, skip: [...(filter?.skip ?? []), t] }) === null
    }

    sweep(s: Shape, from: Vec3, to: Vec3, filter?: Filter): Hit | null {
        this.live()
        const d = sub(to, from), len = length(d)
        const raw = (s as ShapeImpl).rapier(), rot = toQuat(undefined)
        let best: { toi: number, point: Vec3, normal: Vec3, handle: number } | null = null
        const hit = this.raw.castShape(xyz(from), rot, xyz(d), raw, 0, 1, true,
            this.r.QueryFilterFlags.EXCLUDE_SENSORS, this.queryGroups(filter), undefined, undefined, this.predicate(filter))
        if (hit !== null && hit !== undefined) best = { toi: hit.time_of_impact, point: vec(hit.witness1), normal: vec(hit.normal1), handle: hit.collider.handle }
        for (const c of this.freshColliders(filter, false)) {
            const h = c.castShape({ x: 0, y: 0, z: 0 }, raw, xyz(from), rot, xyz(d), 0, 1, true)
            if (h === null || h === undefined || (best !== null && h.time_of_impact >= best.toi)) continue
            // A collider's own cast reports in its local frame.
            const q = c.rotation(), t = c.translation()
            best = { toi: h.time_of_impact, point: add(vec(t), rotate(q, vec(h.witness1))), normal: vec3(rotate(q, vec(h.normal1))), handle: c.handle }
        }
        if (best === null) return null
        return { point: best.point, normal: best.normal, distance: best.toi * len, body: this.wrapperOf(best.handle) }
    }

    /** Every collider a shape at `at` overlaps, sensors included. */
    private overlapping(raw: any, at: Vec3, filter: Filter | undefined, visit: (handle: number) => boolean): void {
        const pos = xyz(at), rot = toQuat(undefined)
        let going = true
        this.raw.intersectionsWithShape(pos, rot, raw, (collider: any) => (going = visit(collider.handle)),
            undefined, this.queryGroups(filter), undefined, undefined, this.predicate(filter))
        if (!going) return
        for (const c of this.freshColliders(filter, true)) {
            if (c.intersectsShape(raw, pos, rot) && !visit(c.handle)) return
        }
    }

    overlap(s: Shape, at: Vec3, filter?: Filter): Body[] {
        this.live()
        const found: Body[] = []
        this.overlapping((s as ShapeImpl).rapier(), at, filter, (h) => {
            const w = this.wrapperOf(h)
            if (w !== null) found.push(w as Body)
            return true
        })
        return found
    }

    clearSpot(s: Shape, near: Vec3, options: ClearSpotOptions = {}): Vec3 | null {
        this.live()
        const filter: Filter = options
        const within = options.within ?? DEFAULTS.clearSpotWithin
        const raw = (s as ShapeImpl).rapier()
        const solid = (at: Vec3) => {
            let blocked = false
            this.overlapping(raw, at, filter, (h) => {
                const w = this.byCollider.get(h)
                if (w === undefined || w.trigger) return true
                blocked = true
                return false
            })
            return blocked
        }
        if (!solid(near)) return vec3(near)
        // Rings outward on the ground plane, nearest first, half the shape's smallest size apart.
        const stepSize = Math.max(0.05, smallestHalfExtent(s as ShapeImpl) / 2, within / 400)
        for (let radius = stepSize; radius <= within + 1e-9; radius += stepSize) {
            const around = Math.max(8, Math.ceil((2 * Math.PI * radius) / stepSize))
            for (let i = 0; i < around; i++) {
                const a = (i / around) * Math.PI * 2
                const at: Vec3 = [near[0] + Math.sin(a) * radius, near[1], near[2] + Math.cos(a) * radius]
                if (!solid(at)) return vec3(at)
            }
        }
        return null
    }

    step(): void {
        this.live()
        // The pipeline itself, as World.step calls it, without World.step's
        // mapNewSoftBodies: that wraps what the engine made on its own (pieces a
        // tear split off) and scans for what it removed, two JS calls a body
        // every step. Free in V8, about a microsecond each in QuickJS, which
        // made it most of a native step. oj makes no soft bodies or joints, so
        // the engine never adds or removes a body by itself here.
        // rapier.test.ts fails if a new Rapier's World.step does more.
        // Characters walk first, each by its held wish for exactly one step.
        for (const c of this.characters) c.stepWalk(this.stepSeconds)
        const w = this.raw
        w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver, this.queue, undefined)
        this.steps++
        this.fresh.clear()
        this.queue.drainCollisionEvents((h1: number, h2: number, started: boolean) => {
            const a = this.byCollider.get(h1), b = this.byCollider.get(h2)
            if (a === undefined || b === undefined) return
            const sensor = a.trigger || b.trigger
            if (sensor) {
                if (a.trigger) a.emitTrigger(started, b)
                if (b.trigger) b.emitTrigger(started, a)
                return
            }
            // A character's touches come from its controller, which sees them
            // whether or not the engine generated a contact.
            if (a.kind === "character" || b.kind === "character") return
            if (!started) {
                a.emitTouchEnd(b)
                b.emitTouchEnd(a)
                return
            }
            if (!a.listening && !b.listening) return
            const contact = this.contactOf(h1, h2, a as BodyImpl, b as BodyImpl)
            a.emitTouch(b, contact)
            b.emitTouch(a, contact)
        })
    }

    /**
     * A point of the touch, and how fast the two were closing. The solver has
     * already stopped them by the time a step reports the touch, so the speed
     * is read from what it took to stop them: the impulse along the normal over
     * the pair's reduced mass is the change of speed, which is (1 + bounce)
     * times the speed they met at.
     */
    private contactOf(h1: number, h2: number, a: BodyImpl, b: BodyImpl): BodyContact {
        let point: Vec3 | null = null, impulse = 0
        const c1 = this.raw.getCollider(h1), c2 = this.raw.getCollider(h2)
        this.raw.contactPair(c1, c2, (manifold: any) => {
            if (point === null && manifold.numSolverContacts() > 0) point = vec(manifold.solverContactPoint(0))
            for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i)
        })
        const inverse = a.inverseMass() + b.inverseMass()
        const bounce = Math.max(c1.restitution(), c2.restitution())
        const speed = inverse > 0 ? (impulse * inverse) / (1 + bounce) : 0
        return { point, speed }
    }

    /** Advances by a frame's time, in whole fixed steps. useWorld calls it from the frame clock. */
    advance(seconds: number): number {
        if (this.disposed) return 0
        this.accumulated = Math.min(this.accumulated + seconds, this.stepSeconds * MAX_STEPS_PER_FRAME)
        let n = 0
        while (this.accumulated >= this.stepSeconds - 1e-9) {
            this.step()
            this.accumulated -= this.stepSeconds
            n++
        }
        return n
    }

    /**
     * The engine's bytes, then what oj itself holds about each character (its
     * held walk and its speed up and down), then the engine part's length, so
     * a rewind brings a jump back mid-air too.
     */
    snapshot(): Uint8Array {
        this.live()
        const engine: Uint8Array = this.raw.takeSnapshot()
        const own: Record<number, number[]> = {}
        for (const c of this.characters) own[c.colliderHandle] = c.saveState()
        const text = asciiBytes(JSON.stringify(own))
        const out = new Uint8Array(engine.length + text.length + 4)
        out.set(engine, 0)
        out.set(text, engine.length)
        new DataView(out.buffer).setUint32(out.length - 4, engine.length, true)
        return out
    }

    restore(snapshot: Uint8Array): void {
        this.live()
        const engineLength = snapshot.length >= 4 ? new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.length).getUint32(snapshot.length - 4, true) : -1
        if (engineLength < 0 || engineLength > snapshot.length - 4) throw new Error("[oj] that snapshot is not one this world made")
        let own: Record<number, number[]>
        try { own = JSON.parse(asciiText(snapshot.subarray(engineLength, snapshot.length - 4))) } catch { throw new Error("[oj] that snapshot is not one this world made") }
        const restored = this.r.World.restoreSnapshot(snapshot.subarray(0, engineLength))
        if (restored === null || restored === undefined) throw new Error("[oj] that snapshot is not one this world's engine can read")
        // A body destroyed since the snapshot comes back, behind the handle the
        // game already holds (its actor went with it, so it has none). One made
        // since is destroyed. Anything else in the snapshot is no body of this world's.
        const holders = new Map<number, BodyImpl | CharacterImpl>()
        for (const w of [...this.byCollider.values(), ...this.buried.values()]) holders.set(w.bodyHandle, w)
        const orphans: number[] = []
        restored.forEachRigidBody((rb: any) => { if (!holders.has(rb.handle)) orphans.push(rb.handle) })
        for (const h of orphans) restored.removeRigidBody(restored.getRigidBody(h))
        // The slide walkers were among them; they are made again when next asked for.
        for (const s of this.sliders.values()) s.controller.free()
        this.sliders.clear()
        const old = this.raw
        this.raw = restored
        this.fresh.clear()
        for (const [handle, w] of [...this.byCollider]) {
            if (restored.getCollider(handle) === null || restored.getCollider(handle) === undefined) {
                w.markGone()
                this.byCollider.delete(handle)
                this.characters.delete(w as CharacterImpl)
                this.bury(w)
            }
        }
        for (const [handle, w] of [...this.buried]) {
            if (restored.getCollider(handle) === null || restored.getCollider(handle) === undefined) continue
            this.buried.delete(handle)
            w.revive()
            this.byCollider.set(handle, w)
            if (w instanceof CharacterImpl) this.characters.add(w)
        }
        for (const c of this.characters) {
            c.rebuildController()
            c.loadState(own[c.colliderHandle])
        }
        old.free()
    }

    wrapperOf(colliderHandle: number): Body | Character | null {
        return this.byCollider.get(colliderHandle) ?? null
    }

    /** Puts every body's actor where its body is, in one go. */
    syncActors(): void {
        const list: ActorPlacement[] = []
        for (const w of this.byCollider.values()) {
            const p = w.placement()
            if (p !== null) list.push(p)
        }
        placeActors(list)
    }

    forget(w: BodyImpl | CharacterImpl): void {
        this.byCollider.delete(w.colliderHandle)
        this.fresh.delete(w.colliderHandle)
        if (w instanceof CharacterImpl) this.characters.delete(w)
        this.bury(w)
    }

    private bury(w: BodyImpl | CharacterImpl): void {
        this.buried.set(w.colliderHandle, w)
        if (this.buried.size > 4096) this.buried.delete(this.buried.keys().next().value!)
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        for (const w of this.byCollider.values()) w.markGone()
        this.byCollider.clear()
        this.characters.clear()
        for (const s of this.sliders.values()) s.controller.free()
        this.sliders.clear()
        this.queue.free()
        this.raw.free()
    }
}

class BodyImpl implements Body {
    actor: Actor | null
    tag: unknown
    readonly dynamic: boolean
    readonly kinematic: boolean
    readonly trigger: boolean
    private handlers: Handlers = {}
    private gone = false

    constructor(
        readonly world: WorldImpl,
        readonly kind: Kind,
        readonly bodyHandle: number,
        readonly colliderHandle: number,
        readonly layer: Layer,
        o: BodyOptionsBase,
    ) {
        this.actor = o.actor ?? null
        this.tag = o.tag
        this.dynamic = o.dynamic === true
        this.kinematic = o.kinematic === true && !this.dynamic
        this.trigger = o.trigger === true
        if (this.actor !== null) this.syncActor()
    }

    get alive(): boolean { return !this.gone }

    private rb(): any {
        if (this.gone) throw new Error(`[oj] this ${this.kind} was destroyed`)
        return this.world.raw.getRigidBody(this.bodyHandle)
    }

    private collider(): any {
        if (this.gone) throw new Error(`[oj] this ${this.kind} was destroyed`)
        return this.world.raw.getCollider(this.colliderHandle)
    }

    get position(): Vec3 { return vec(this.rb().translation()) }
    set position(p: Vec3) {
        const rb = this.rb()
        if (this.kinematic) rb.setNextKinematicTranslation(xyz(p))
        else {
            rb.setTranslation(xyz(p), true)
            this.world.markFresh(this.colliderHandle)
        }
    }

    get rotation(): Readonly<Rotation> { return fromQuat(this.rb().rotation()) }
    set rotation(r: Partial<Rotation>) {
        const rb = this.rb()
        if (this.kinematic) rb.setNextKinematicRotation(toQuat(r))
        else {
            rb.setRotation(toQuat(r), true)
            this.world.markFresh(this.colliderHandle)
        }
    }

    get velocity(): Vec3 { return vec(this.rb().linvel()) }
    set velocity(v: Vec3) { this.rb().setLinvel(xyz(v), true) }

    get mass(): number { return this.rb().mass() }
    set mass(m: number) { this.collider().setMass(m) }
    get friction(): number { return this.collider().friction() }
    set friction(f: number) { this.collider().setFriction(f) }
    get bounce(): number { return this.collider().restitution() }
    set bounce(b: number) { this.collider().setRestitution(b) }

    push(impulse: Vec3): void { this.rb().applyImpulse(xyz(impulse), true) }

    addVelocity(v: Vec3): void {
        const rb = this.rb(), now = rb.linvel()
        rb.setLinvel({ x: now.x + v[0], y: now.y + v[1], z: now.z + v[2] }, true)
    }

    /** 0 for anything the simulation does not move, which no touch can slow. */
    inverseMass(): number {
        if (!this.dynamic || this.gone) return 0
        const m = this.rb().mass()
        return m > 0 ? 1 / m : 0
    }

    /** Whether a touch on this body has anyone to tell. */
    get listening(): boolean { return (this.handlers.touch?.size ?? 0) > 0 }

    onTouch(handler: (other: Body | Character, contact: BodyContact) => void): () => void { return this.listen("touch", handler) }
    onTouchEnd(handler: (other: Body | Character) => void): () => void { return this.listen("touchEnd", handler) }
    onEnter(handler: (other: Body | Character) => void): () => void { return this.listen("enter", handler) }
    onLeave(handler: (other: Body | Character) => void): () => void { return this.listen("leave", handler) }

    private listen<K extends keyof Handlers>(kind: K, handler: any): () => void {
        const set = (this.handlers[kind] ??= new Set() as never) as Set<unknown>
        set.add(handler)
        this.reportEvents()
        return () => { set.delete(handler) }
    }

    /** Asks the engine for this collider's events, which it skips unless asked. */
    private reportEvents(): void {
        this.collider().setActiveEvents(this.world.r.ActiveEvents.COLLISION_EVENTS)
    }

    emitTouch(other: Body | Character, contact: BodyContact): void {
        for (const h of this.handlers.touch ?? []) h(other, contact)
    }

    emitTouchEnd(other: Body | Character): void {
        for (const h of this.handlers.touchEnd ?? []) h(other)
    }

    emitTrigger(started: boolean, other: Body | Character): void {
        for (const h of (started ? this.handlers.enter : this.handlers.leave) ?? []) h(other)
    }

    placement(): ActorPlacement | null {
        if (this.actor === null || this.gone) return null
        const rb = this.world.raw.getRigidBody(this.bodyHandle)
        return { actor: this.actor, at: vec(rb.translation()), rotation: rb.rotation() }
    }

    syncActor(): void {
        const p = this.placement()
        if (p !== null) placeActors([p])
    }

    markGone(): void { this.gone = true }

    /** A mesh body's own triangles, in its local frame. */
    meshTriangles: Triangles | null = null

    /**
     * Its surface as triangles in the world, facing out (counter-clockwise
     * from outside), which is what tells a navigation mesh floor from wall.
     * A sphere or capsule stands in as its bounding box.
     */
    appendTriangles(vertices: number[], indices: number[]): void {
        const c = this.collider()
        const q = c.rotation(), t = c.translation()
        const put = (v: Readonly<Vec3>) => {
            const p = rotate(q, v)
            vertices.push(p[0] + t.x, p[1] + t.y, p[2] + t.z)
        }
        if (this.meshTriangles !== null) {
            const base = vertices.length / 3, mv = this.meshTriangles.vertices
            for (let i = 0; i < mv.length; i += 3) put([mv[i]!, mv[i + 1]!, mv[i + 2]!])
            for (const i of this.meshTriangles.indices) indices.push(base + i)
            return
        }
        const h = halfExtentsOf(c)
        const base = vertices.length / 3
        for (const [x, y, z] of BOX_CORNERS) put([x * h[0], y * h[1], z * h[2]])
        for (const i of BOX_FACES) indices.push(base + i)
    }

    destroy(): void {
        if (this.gone) return
        this.world.raw.removeRigidBody(this.rb())
        this.world.forget(this)
        this.gone = true
        this.actor?.destroy()
        this.actor = null
    }

    revive(): void { this.gone = false }
}

/**
 * The gap a character's controller keeps from everything it touches. Its
 * capsule floats this far above where its feet are said to be: a character
 * placed with its feet exactly on a floor would start inside the gap, and the
 * controller stalls from inside it (Gunyard's fighters froze mid-floor).
 */
const SKIN = 0.01

/** A character controller: climbs `step`, keeps to the ground within `snap`, climbs slopes up to `slope` degrees. */
function makeController(world: WorldImpl, radius: number, step: number, snap: number, slope: number): any {
    const c = world.raw.createCharacterController(SKIN)
    // Climbing costs the controller extra casts at every contact, about 40%
    // of a walking move, so a character that climbs nothing does not pay it.
    if (step > 0) c.enableAutostep(step, radius / 2, false)
    else c.disableAutostep()
    c.enableSnapToGround(snap)
    const angle = (slope * Math.PI) / 180
    c.setMaxSlopeClimbAngle(angle)
    c.setMinSlopeSlideAngle(angle)
    return c
}

class CharacterImpl implements Character {
    readonly kind = "character" as const
    readonly trigger = false
    readonly radius: number
    readonly height: number
    readonly layer: Layer
    readonly bodyHandle: number
    readonly colliderHandle: number
    actor: Actor | null
    tag: unknown
    /** Its speed up and down, which gravity builds while it is off the ground and a jump sets. */
    private fall = 0
    /** What `walk` asked for, held. */
    private wish: Vec3 = [0, 0, 0]
    private moved: Vec3 = vec3([0, 0, 0])
    private controller: any
    private isGrounded = false
    private touching = new Set<number>()
    private touchHandlers = new Set<(other: Body | Character, contact: BodyContact) => void>()
    private touchEndHandlers = new Set<(other: Body | Character) => void>()
    private gone = false
    private readonly o: CharacterOptions
    /** What its controller collides with: everything but the layers it ignores. */
    private readonly walkGroups: number | undefined

    constructor(readonly world: WorldImpl, private readonly r: Rapier, o: CharacterOptions) {
        this.o = o
        this.radius = o.radius ?? DEFAULTS.character.radius
        this.height = Math.max(o.height ?? DEFAULTS.character.height, this.radius * 2)
        this.layer = o.layer ?? DEFAULTS.layer
        this.actor = o.actor ?? null
        this.tag = o.tag
        const at = o.at ?? [0, 0, 0]
        const rb = world.raw.createRigidBody(r.RigidBodyDesc.kinematicPositionBased().setTranslation(at[0], at[1] + this.height / 2 + SKIN, at[2]))
        const collider = world.raw.createCollider(
            r.ColliderDesc.capsule(capsuleHalf(this.radius, this.height), this.radius)
                .setCollisionGroups(world.groupsFor(this.layer, o.ignores))
                .setActiveCollisionTypes(r.ActiveCollisionTypes.ALL),
            rb,
        )
        const ignored = world.ignoreMask(o.ignores ?? [])
        this.walkGroups = ignored === 0 ? undefined : ((0xffff << 16) | (0xffff & ~ignored)) >>> 0
        this.bodyHandle = rb.handle
        this.colliderHandle = collider.handle
        this.rebuildController()
        this.isGrounded = this.groundUnder([at[0], at[1] + this.height / 2 + SKIN, at[2]])
        if (this.actor !== null) this.syncActor()
    }

    /**
     * Standing if there is ground within its skin of a capsule centred at
     * `centre`, so a character placed on a floor starts standing, rather than
     * falling one step into its own skin and climbing back out of it.
     */
    private groundUnder(centre: Vec3): boolean {
        return this.world.sweep(shape.capsule({ radius: this.radius, height: this.height }), centre, [centre[0], centre[1] - 2 * SKIN, centre[2]], { skip: [this] }) !== null
    }

    /** The controller holds the world's sets, so a restored world needs a new one. */
    rebuildController(): void {
        this.controller?.free()
        this.controller = makeController(this.world, this.radius, this.o.stepHeight ?? DEFAULTS.character.stepHeight, this.o.snap ?? DEFAULTS.character.snap, this.o.slope ?? DEFAULTS.character.slope)
    }

    get alive(): boolean { return !this.gone }
    get grounded(): boolean { return this.isGrounded }

    private rb(): any {
        if (this.gone) throw new Error("[oj] this character was destroyed")
        return this.world.raw.getRigidBody(this.bodyHandle)
    }

    get position(): Vec3 {
        const t = this.rb().nextTranslation()
        return vec3([t.x, t.y - this.height / 2 - SKIN, t.z])
    }

    get velocity(): Vec3 { return this.moved }

    walk(velocity: Vec3): void {
        if (this.gone) throw new Error("[oj] this character was destroyed")
        this.wish = [velocity[0], velocity[1], velocity[2]]
    }

    jump(height: number): void {
        if (this.gone) throw new Error("[oj] this character was destroyed")
        const g = Math.abs(this.world.raw.gravity.y)
        this.fall = Math.sqrt(2 * g * Math.max(0, height))
    }

    /** One step of its held walk, called by the world before the engine steps. */
    stepWalk(dt: number): void {
        const rb = this.world.raw.getRigidBody(this.bodyHandle)
        const g = this.world.raw.gravity.y
        // Standing, it does not push down into the floor: snap-to-ground keeps
        // it there, and a downward wish into a floor it rests on made Rapier's
        // controller drop a frame's movement now and then (Gunyard's fighters
        // lost 3% of every walk, and froze outright when placed on the floor).
        const standing = this.isGrounded && this.fall <= 0
        this.fall = standing ? 0 : this.fall + g * dt
        const wish = { x: this.wish[0] * dt, y: (this.wish[1] + this.fall) * dt, z: this.wish[2] * dt }
        const collider = this.world.raw.getCollider(this.colliderHandle)
        this.controller.computeColliderMovement(collider, wish, this.r.QueryFilterFlags.EXCLUDE_SENSORS, this.walkGroups)
        const m = this.controller.computedMovement()
        this.isGrounded = this.controller.computedGrounded()
        if (this.isGrounded && this.fall < 0) this.fall = 0
        // A head that meets a ceiling stops rising.
        if (this.fall > 0 && m.y < wish.y * 0.5) this.fall = 0
        const t = rb.nextTranslation()
        rb.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z })
        this.moved = vec3([m.x / dt, m.y / dt, m.z / dt])
        this.reportTouches(dt)
    }

    /** What oj holds that the engine's snapshot does not: the held walk, the speed up and down, standing. */
    saveState(): number[] {
        return [this.wish[0], this.wish[1], this.wish[2], this.fall, this.isGrounded ? 1 : 0]
    }

    loadState(s: number[] | undefined): void {
        if (s === undefined) return
        this.wish = [s[0]!, s[1]!, s[2]!]
        this.fall = s[3]!
        this.isGrounded = s[4] === 1
        this.touching.clear()
    }

    inverseMass(): number { return 0 }
    get listening(): boolean { return this.touchHandlers.size > 0 }

    /** What the controller ran into this step, reported once when a touch starts and once when it ends. */
    private reportTouches(dt: number): void {
        const now = new Set<number>()
        const n = this.controller.numComputedCollisions()
        const asked: Vec3 = [this.wish[0], this.wish[1] + this.fall, this.wish[2]]
        void dt
        for (let i = 0; i < n; i++) {
            const hit = this.controller.computedCollision(i)
            const handle = hit?.collider?.handle
            if (handle === undefined || now.has(handle)) continue
            now.add(handle)
            if (this.touching.has(handle)) continue
            const other = this.world.wrapperOf(handle)
            if (other === null) continue
            // How fast it was going into the surface: its wish against the normal, less the other's own speed that way.
            const normal = hit.normal1 ?? { x: 0, y: 0, z: 0 }
            const otherVelocity = other.kind === "character" ? other.velocity : (other as BodyImpl).dynamic || (other as BodyImpl).kinematic ? other.velocity : ORIGIN
            const closing = -((asked[0] - otherVelocity[0]) * normal.x + (asked[1] - otherVelocity[1]) * normal.y + (asked[2] - otherVelocity[2]) * normal.z)
            const contact: BodyContact = { point: vec(hit.witness1), speed: Math.max(0, closing) }
            for (const h of this.touchHandlers) h(other, contact)
            if (other instanceof BodyImpl) other.emitTouch(this, contact)
        }
        // A controller resting against a wall does not run into it every
        // frame, so a touch lasts while the wall is within 5 cm, not only
        // while the controller is hitting it.
        for (const handle of this.touching) {
            if (now.has(handle)) continue
            const other = this.world.raw.getCollider(handle)
            if (other !== null && other !== undefined && other.intersectsShape(this.near(), this.world.raw.getRigidBody(this.bodyHandle).nextTranslation(), toQuat(undefined))) now.add(handle)
        }
        for (const handle of this.touching) {
            if (now.has(handle)) continue
            const other = this.world.wrapperOf(handle)
            if (other === null) continue
            this.emitTouchEnd(other)
            if (other instanceof BodyImpl) other.emitTouchEnd(this)
        }
        this.touching = now
    }

    private nearShape: any = null
    /** This character's capsule grown by 5 cm: what counts as still touching. */
    private near(): any {
        this.nearShape ??= new this.r.Capsule(capsuleHalf(this.radius, this.height), this.radius + 0.05)
        return this.nearShape
    }

    teleport(at: Vec3): void {
        // Exactly where asked; finding somewhere clear is clearSpot's job.
        const spot: Vec3 = [at[0], at[1] + this.height / 2 + SKIN, at[2]]
        this.rb().setTranslation(xyz(spot), true)
        this.rb().setNextKinematicTranslation(xyz(spot))
        this.world.markFresh(this.colliderHandle)
        this.fall = 0
        this.moved = vec3([0, 0, 0])
        this.isGrounded = this.groundUnder(spot)
        this.touching.clear()
    }

    onTouch(handler: (other: Body | Character, contact: BodyContact) => void): () => void {
        this.touchHandlers.add(handler)
        return () => { this.touchHandlers.delete(handler) }
    }

    onTouchEnd(handler: (other: Body | Character) => void): () => void {
        this.touchEndHandlers.add(handler)
        return () => { this.touchEndHandlers.delete(handler) }
    }

    emitTouch(other: Body | Character, contact: BodyContact): void {
        for (const h of this.touchHandlers) h(other, contact)
    }

    emitTouchEnd(other: Body | Character): void {
        for (const h of this.touchEndHandlers) h(other)
    }

    emitTrigger(): void {}

    placement(): ActorPlacement | null {
        if (this.actor === null || this.gone) return null
        return { actor: this.actor, at: this.position, rotation: null }
    }

    syncActor(): void {
        const p = this.placement()
        if (p !== null) placeActors([p])
    }

    markGone(): void {
        this.gone = true
        this.controller?.free()
        this.controller = null
    }

    destroy(): void {
        if (this.gone) return
        this.world.raw.removeRigidBody(this.rb())
        this.world.forget(this)
        this.markGone()
        this.actor?.destroy()
        this.actor = null
    }

    revive(): void {
        this.gone = false
        this.rebuildController()
    }
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
    const url = modelUrls.get(source)
    if (url === undefined) throw new Error("[oj] world.mesh: that model was not loaded with loadModel or useModel, so there is no file to read its triangles from")
    return glbTriangles(await loadFileBytes(url))
}

function smallestHalfExtent(s: ShapeImpl): number {
    if (s.kind === "box") return Math.min(...s.dims) / 2
    return s.dims[0]!
}

// ---------- the snapshot's own part ----------
//
// JSON of numbers and keys, so ASCII: no TextEncoder, which a OneJS app on
// QuickJS does not have.

function asciiBytes(text: string): Uint8Array {
    const out = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
    return out
}

function asciiText(bytes: Uint8Array): string {
    let text = ""
    for (let i = 0; i < bytes.length; i += 4096) text += String.fromCharCode(...bytes.subarray(i, i + 4096))
    return text
}

// ---------- vectors, as plain arrays ----------

function xyz(v: Readonly<Vec3>): { x: number, y: number, z: number } {
    return { x: v[0], y: v[1], z: v[2] }
}
function vec(v: { x: number, y: number, z: number }): Vec3 {
    return Object.freeze([v.x, v.y, v.z]) as unknown as Vec3
}
function vec3(v: Readonly<Vec3>): Vec3 {
    return Object.freeze([v[0], v[1], v[2]]) as unknown as Vec3
}
/** A vector turned by a quaternion. */
function rotate(q: Quat, v: Readonly<Vec3>): Vec3 {
    const { x, y, z, w } = q
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
function add(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 { return vec3([a[0] + b[0], a[1] + b[1], a[2] + b[2]]) }
function sub(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function scale(a: Readonly<Vec3>, k: number): Vec3 { return [a[0] * k, a[1] * k, a[2] * k] }
function length(a: Readonly<Vec3>): number { return Math.hypot(a[0], a[1], a[2]) }
