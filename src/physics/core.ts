/**
 * The one implementation of oj's physics, for both dimensions.
 *
 * `physics3d/world.ts` and `physics2d/world.ts` declare what a game sees, in
 * their own vectors, rotations and units, and hand this a `Dim`: how to turn
 * those into the engine's and back. Everything else (layers and filters,
 * bodies and characters, queries, touches and triggers, slide, snapshots, the
 * fixed step) is written once, here, against Rapier's API, which its 2D and
 * 3D builds share.
 *
 * Inside, every vector is the engine's: metres, as a plain array. A world
 * unit (a metre in 3D, a stage pixel in 2D) is converted at the edge, by
 * `toE` going in and `fromE` coming out, and directions (normals, the up
 * axis) are never scaled.
 */

// ---------- what a dimension supplies ----------

/** A vector in the engine's metres, as a plain array of 2 or 3 numbers. */
export type EVec = number[]

export interface Dim<V extends readonly number[], R, A> {
    readonly n: 2 | 3
    /** World units in a metre: 1 in 3D, `pixelsPerMeter` in 2D. */
    readonly unit: number
    /** Up, in both the world's axes and the engine's: [0, 1, 0] in 3D, [0, -1] in 2D (y down). */
    readonly up: EVec
    /** An engine vector object from an array. */
    e(v: Readonly<EVec>): any
    /** An array from an engine vector object. */
    a(o: any): EVec
    rot(r: R | undefined): any
    rotOut(o: any): R
    /** An engine vector turned by an engine rotation. */
    rotate(rot: any, v: Readonly<EVec>): EVec
    /** The point `radius` world units from `near`, `angle` radians round, on the ground. */
    ring(near: Readonly<V>, radius: number, angle: number): V
    /** The engine's shape for a shape value: `dims` in metres. */
    shape(r: any, kind: string, dims: readonly number[]): any
    /** Moves every listed actor to its body, in one go if the host can. */
    place(list: readonly Placement<V, A>[]): void
    /** What happens to a destroyed body's actor: a 3D actor goes with it; a 2D element is React's, and stays. */
    release(actor: A): void
}

export interface Placement<V, A> {
    actor: A
    at: V
    /** The engine's rotation, or null to leave the actor's facing alone. */
    rotation: any | null
}

// ---------- the public shapes, generically ----------

export type Layer = string

export interface Filter {
    only?: readonly Layer[]
    skip?: readonly (Layer | object)[]
}

export interface HitOf<V> {
    point: V
    normal: V
    distance: number
    body: unknown
}

export interface ContactOf<V> {
    point: V | null
    speed: number
}

export interface BodyOptionsOf<V, R, A> {
    at?: V
    rotation?: R
    dynamic?: boolean
    kinematic?: boolean
    mass?: number
    density?: number
    friction?: number
    bounce?: number
    trigger?: boolean
    layer?: Layer
    ignores?: readonly Layer[]
    actor?: A | null
    tag?: unknown
}

export interface CharacterOptionsOf<V, A> {
    at?: V
    radius?: number
    height?: number
    stepHeight?: number
    slope?: number
    snap?: number
    layer?: Layer
    ignores?: readonly Layer[]
    actor?: A | null
    tag?: unknown
}

export interface SlideOptionsOf extends Filter {
    radius?: number
    height?: number
    stepHeight?: number
    slope?: number
}

export interface PlacesOf<V, R> {
    at?: V
    rotation?: R
    otherAt?: V
    otherRotation?: R
}

export interface MotionsOf<V, R> extends PlacesOf<V, R> {
    velocity?: V
    otherVelocity?: V
    within: number
}

/** A dimension's defaults, in its own units. */
export interface Defaults<V> {
    gravity: V
    rate: number
    friction: number
    bounce: number
    density: number
    character: { radius: number, height: number, stepHeight: number, slope: number, snap: number }
    clearSpotWithin: number
    layer: Layer
}

// ---------- shapes as values ----------

/** The engine module, loaded by whichever dimension's world came first. */
export class ShapeCore<V extends readonly number[], R> {
    /** The engine's shape, by the world unit it was made for: a 2D world can set its own pixels a metre. */
    private readonly raw = new Map<number, any>()

    constructor(
        private readonly dim: Dim<V, R, unknown>,
        private readonly engine: () => any,
        readonly kind: string,
        /** World units: a box's size, a ball's radius, a capsule's radius and height. */
        readonly dims: readonly number[],
    ) {}

    rapier(unit: number = this.dim.unit): any {
        let made = this.raw.get(unit)
        if (made === undefined) this.raw.set(unit, made = this.dim.shape(this.engine(), this.kind, this.dims.map((x) => x / unit)))
        return made
    }

    /** Half the smallest size across, in world units: how finely `clearSpot` searches round it. */
    smallestHalf(): number {
        return this.kind === "box" ? Math.min(...this.dims) / 2 : this.dims[0]!
    }

    raycast(from: V, to: V, place: { at?: V, rotation?: R } = {}): HitOf<V> | null {
        const r = this.engine(), d = this.dim
        const f = toE(d, from), t = toE(d, to)
        const dir = sub(t, f), len = length(dir)
        if (len === 0) return null
        const ray = new r.Ray(d.e(f), d.e(scale(dir, 1 / len)))
        const hit = this.rapier().castRayAndGetNormal(ray, d.e(place.at ? toE(d, place.at) : zero(d)), d.rot(place.rotation), len, true)
        if (hit === null || hit === undefined || hit.timeOfImpact < 0) return null
        return { point: fromE(d, add(f, scale(dir, hit.timeOfImpact / len))), normal: fromDir(d, d.a(hit.normal)), distance: hit.timeOfImpact * d.unit, body: null }
    }

    overlaps(other: ShapeCore<V, R>, p: PlacesOf<V, R> = {}): boolean {
        const d = this.dim
        return this.rapier().intersectsShape(d.e(p.at ? toE(d, p.at) : zero(d)), d.rot(p.rotation), other.rapier(), d.e(p.otherAt ? toE(d, p.otherAt) : zero(d)), d.rot(p.otherRotation))
    }

    firstTouch(other: ShapeCore<V, R>, m: MotionsOf<V, R>): number | null {
        const d = this.dim
        const hit = this.rapier().castShape(
            d.e(m.at ? toE(d, m.at) : zero(d)), d.rot(m.rotation), d.e(m.velocity ? toE(d, m.velocity) : zero(d)),
            other.rapier(), d.e(m.otherAt ? toE(d, m.otherAt) : zero(d)), d.rot(m.otherRotation), d.e(m.otherVelocity ? toE(d, m.otherVelocity) : zero(d)),
            0, m.within, true,
        )
        return hit === null || hit === undefined ? null : hit.time_of_impact
    }
}

// ---------- the world ----------

interface Handlers {
    touch?: Set<(other: unknown, contact: ContactOf<any>) => void>
    touchEnd?: Set<(other: unknown) => void>
    enter?: Set<(other: unknown) => void>
    leave?: Set<(other: unknown) => void>
}

const MAX_STEPS_PER_FRAME = 4

/**
 * The gap a character's controller keeps from everything it touches, in
 * metres. Its capsule floats this far above where its feet are said to be: a
 * character placed with its feet exactly on a floor would start inside the
 * gap, and the controller stalls from inside it (Gunyard's fighters froze
 * mid-floor).
 */
const SKIN = 0.01

type Thing<V extends readonly number[], R, A> = BodyCore<V, R, A> | CharacterCore<V, R, A>

export class WorldCore<V extends readonly number[], R, A> {
    raw: any
    readonly queue: any
    private readonly layers = new Map<Layer, number>()
    private readonly unknownLayers = new Set<Layer>()
    /**
     * Bodies destroyed, by collider handle, so `restore` can bring one back
     * with the handle the game already holds. The most recent 4096, since a
     * snapshot older than that many destructions is not a rewind a game makes.
     */
    readonly buried = new Map<number, Thing<V, R, A>>()
    /** Every body and character, by its collider's handle. */
    readonly byCollider = new Map<number, Thing<V, R, A>>()
    readonly characters = new Set<CharacterCore<V, R, A>>()
    readonly stepSeconds: number
    private accumulated = 0
    steps = 0
    private disposed = false

    constructor(readonly r: any, readonly dim: Dim<V, R, A>, readonly defaults: Defaults<V>, options: { gravity?: V, rate?: number }) {
        this.raw = new r.World(dim.e(toE(dim, options.gravity ?? defaults.gravity)))
        this.stepSeconds = 1 / (options.rate ?? defaults.rate)
        this.raw.timestep = this.stepSeconds
        this.queue = new r.EventQueue(true)
    }

    get gravity(): V { return fromE(this.dim, this.dim.a(this.raw.gravity)) }
    set gravity(g: V) { this.raw.gravity = this.dim.e(toE(this.dim, g)) }

    get bodies(): readonly Thing<V, R, A>[] { return [...this.byCollider.values()] }

    // ---------- layers ----------

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
        const skipped = (filter?.skip ?? []).filter((s) => typeof s !== "string") as Thing<V, R, A>[]
        if (skipped.length === 0) return undefined
        const handles = new Set(skipped.map((s) => s.colliderHandle))
        return (collider) => !handles.has(collider.handle)
    }

    live(): void {
        if (this.disposed) throw new Error("[oj] this world was disposed")
    }

    // ---------- bodies ----------

    /** A body from a collider description the dimension made, in metres. */
    makeBody(kind: string, desc: any, o: BodyOptionsOf<V, R, A>): BodyCore<V, R, A> {
        this.live()
        const r = this.r, d = this.dim
        const bodyDesc = o.dynamic ? r.RigidBodyDesc.dynamic() : o.kinematic ? r.RigidBodyDesc.kinematicPositionBased() : r.RigidBodyDesc.fixed()
        bodyDesc.setTranslation(...toE(d, o.at ?? zeroWorld(d))).setRotation(d.rot(o.rotation))
        const rb = this.raw.createRigidBody(bodyDesc)
        const layer = o.layer ?? this.defaults.layer
        // The larger bounce of two bodies wins, so a ball does not die on a floor with none.
        desc.setFriction(o.friction ?? this.defaults.friction).setRestitution(o.bounce ?? this.defaults.bounce).setRestitutionCombineRule(r.CoefficientCombineRule.Max)
            .setSensor(o.trigger === true).setCollisionGroups(this.groupsFor(layer, o.ignores))
        if (o.mass !== undefined) desc.setMass(o.mass)
        else desc.setDensity(o.density ?? this.defaults.density)
        // Every pair is reported, so a trigger hears a character and a wall hears a kinematic door.
        desc.setActiveCollisionTypes(r.ActiveCollisionTypes.ALL)
        const collider = this.raw.createCollider(desc, rb)
        const body = new BodyCore(this, kind, rb.handle, collider.handle, layer, o)
        this.byCollider.set(collider.handle, body)
        this.fresh.add(collider.handle)
        return body
    }

    character(o: CharacterOptionsOf<V, A>): CharacterCore<V, R, A> {
        this.live()
        const c = new CharacterCore(this, o)
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
    private readonly sliders = new Map<string, { bodyHandle: number, colliderHandle: number, controller: any }>()

    slide(from: V, delta: V, o: SlideOptionsOf = {}): { at: V, grounded: boolean } {
        this.live()
        const d = this.dim, c = this.defaults.character
        const radius = o.radius ?? c.radius
        const height = Math.max(o.height ?? c.height, radius * 2)
        const step = o.stepHeight ?? c.stepHeight
        const slope = o.slope ?? c.slope
        const key = `${radius} ${height} ${step} ${slope}`
        let s = this.sliders.get(key)
        if (s === undefined) {
            const rb = this.raw.createRigidBody(this.r.RigidBodyDesc.fixed())
            const collider = this.raw.createCollider(capsuleDesc(this.r, d, radius, height).setSensor(true).setCollisionGroups(0), rb)
            s = { bodyHandle: rb.handle, colliderHandle: collider.handle, controller: makeController(this, radius, step, c.snap, slope) }
            this.sliders.set(key, s)
        }
        const feet = toE(d, from)
        this.raw.getRigidBody(s.bodyHandle).setTranslation(d.e(add(feet, scale(d.up, height / 2 / d.unit + SKIN))), false)
        this.raw.propagateModifiedBodyPositionsToColliders()
        s.controller.computeColliderMovement(this.raw.getCollider(s.colliderHandle), d.e(toE(d, delta)), this.r.QueryFilterFlags.EXCLUDE_SENSORS, this.queryGroups(o), this.queryPredicate(o))
        const m = d.a(s.controller.computedMovement())
        return { at: fromE(d, add(feet, m)), grounded: s.controller.computedGrounded() }
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

    raycast(from: V, to: V, filter?: Filter): HitOf<V> | null {
        this.live()
        const d = this.dim
        const f = toE(d, from), dir = sub(toE(d, to), f), len = length(dir)
        if (len === 0) return null
        const best = this.engineRay(f, scale(dir, 1 / len), len, this.queryGroups(filter), this.predicate(filter), this.freshColliders(filter, false))
        if (best === null) return null
        return { point: fromE(d, add(f, scale(dir, best.toi / len))), normal: fromDir(d, best.normal), distance: best.toi * d.unit, body: this.wrapperOf(best.handle) }
    }

    /** A ray from `f` along the unit `dir` (metres): the first solid collider within `len`. */
    private engineRay(f: EVec, dir: EVec, len: number, groups: number | undefined, predicate: ((c: any) => boolean) | undefined, fresh: readonly any[]): { toi: number, normal: EVec, handle: number } | null {
        const d = this.dim
        const ray = new this.r.Ray(d.e(f), d.e(dir))
        let best: { toi: number, normal: EVec, handle: number } | null = null
        const hit = this.raw.castRayAndGetNormal(ray, len, true, this.r.QueryFilterFlags.EXCLUDE_SENSORS, groups, undefined, undefined, predicate)
        if (hit !== null && hit !== undefined) best = { toi: hit.timeOfImpact, normal: d.a(hit.normal), handle: hit.collider.handle }
        for (const c of fresh) {
            const h = c.castRayAndGetNormal(ray, len, true)
            if (h !== null && h !== undefined && (best === null || h.timeOfImpact < best.toi)) best = { toi: h.timeOfImpact, normal: d.a(h.normal), handle: c.handle }
        }
        return best
    }

    canSee(from: V, target: V | Thing<V, R, A>, filter?: Filter): boolean {
        if (Array.isArray(target)) return this.raycast(from, target as V, filter) === null
        const t = target as Thing<V, R, A>
        return this.raycast(from, t.middle(), { only: filter?.only, skip: [...(filter?.skip ?? []), t] }) === null
    }

    /** A shape (engine) moved from `f` to `t` (metres): the first collider it meets. */
    engineSweep(raw: any, f: EVec, t: EVec, filter: Filter | undefined): { toi: number, point: EVec, normal: EVec, handle: number } | null {
        const d = this.dim
        const dir = sub(t, f), rot = d.rot(undefined)
        let best: { toi: number, point: EVec, normal: EVec, handle: number } | null = null
        const hit = this.raw.castShape(d.e(f), rot, d.e(dir), raw, 0, 1, true,
            this.r.QueryFilterFlags.EXCLUDE_SENSORS, this.queryGroups(filter), undefined, undefined, this.predicate(filter))
        if (hit !== null && hit !== undefined) best = { toi: hit.time_of_impact, point: d.a(hit.witness1), normal: d.a(hit.normal1), handle: hit.collider.handle }
        for (const c of this.freshColliders(filter, false)) {
            const h = c.castShape(d.e(zero(d)), raw, d.e(f), rot, d.e(dir), 0, 1, true)
            if (h === null || h === undefined || (best !== null && h.time_of_impact >= best.toi)) continue
            // A collider's own cast reports in its local frame.
            const q = c.rotation(), at = d.a(c.translation())
            best = { toi: h.time_of_impact, point: add(at, d.rotate(q, d.a(h.witness1))), normal: d.rotate(q, d.a(h.normal1)), handle: c.handle }
        }
        return best
    }

    sweep(s: ShapeCore<V, R>, from: V, to: V, filter?: Filter): HitOf<V> | null {
        this.live()
        const d = this.dim
        const f = toE(d, from), t = toE(d, to)
        const best = this.engineSweep(s.rapier(d.unit), f, t, filter)
        if (best === null) return null
        return { point: fromE(d, best.point), normal: fromDir(d, best.normal), distance: best.toi * length(sub(t, f)) * d.unit, body: this.wrapperOf(best.handle) }
    }

    /** Every collider a shape at `at` overlaps, sensors included. */
    private overlapping(raw: any, at: V, filter: Filter | undefined, visit: (handle: number) => boolean): void {
        const d = this.dim
        const pos = d.e(toE(d, at)), rot = d.rot(undefined)
        let going = true
        this.raw.intersectionsWithShape(pos, rot, raw, (collider: any) => (going = visit(collider.handle)),
            undefined, this.queryGroups(filter), undefined, undefined, this.predicate(filter))
        if (!going) return
        for (const c of this.freshColliders(filter, true)) {
            if (c.intersectsShape(raw, pos, rot) && !visit(c.handle)) return
        }
    }

    overlap(s: ShapeCore<V, R>, at: V, filter?: Filter): BodyCore<V, R, A>[] {
        this.live()
        const found: BodyCore<V, R, A>[] = []
        this.overlapping(s.rapier(this.dim.unit), at, filter, (h) => {
            const w = this.wrapperOf(h)
            if (w !== null) found.push(w as BodyCore<V, R, A>)
            return true
        })
        return found
    }

    clearSpot(s: ShapeCore<V, R>, near: V, options: Filter & { within?: number } = {}): V | null {
        this.live()
        const within = options.within ?? this.defaults.clearSpotWithin
        const raw = s.rapier(this.dim.unit)
        const solid = (at: V) => {
            let blocked = false
            this.overlapping(raw, at, options, (h) => {
                const w = this.byCollider.get(h)
                if (w === undefined || w.trigger) return true
                blocked = true
                return false
            })
            return blocked
        }
        if (!solid(near)) return freeze(near) as V
        // Rings outward on the ground, nearest first, half the shape's smallest size apart.
        const unit = this.dim.unit
        const stepSize = Math.max(0.05 * unit, s.smallestHalf() / 2, within / 400)
        for (let radius = stepSize; radius <= within + 1e-9; radius += stepSize) {
            const around = Math.max(8, Math.ceil((2 * Math.PI * radius) / stepSize))
            for (let i = 0; i < around; i++) {
                const at = this.dim.ring(near, radius, (i / around) * Math.PI * 2)
                if (!solid(at)) return freeze(at) as V
            }
        }
        return null
    }

    // ---------- stepping ----------

    step(): void {
        this.live()
        // Characters walk first, each by its held wish for exactly one step.
        for (const c of this.characters) c.stepWalk(this.stepSeconds)
        // The pipeline itself, as World.step calls it, without World.step's
        // mapNewSoftBodies: that wraps what the engine made on its own (pieces a
        // tear split off) and scans for what it removed, two JS calls a body
        // every step. Free in V8, about a microsecond each in QuickJS, which
        // made it most of a native step. oj makes no soft bodies or joints, so
        // the engine never adds or removes a body by itself here.
        // rapier.test.ts fails if a new Rapier's World.step does more.
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
            const contact = this.contactOf(h1, h2, a as BodyCore<V, R, A>, b as BodyCore<V, R, A>)
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
    private contactOf(h1: number, h2: number, a: BodyCore<V, R, A>, b: BodyCore<V, R, A>): ContactOf<V> {
        const d = this.dim
        let point: V | null = null, impulse = 0
        const c1 = this.raw.getCollider(h1), c2 = this.raw.getCollider(h2)
        this.raw.contactPair(c1, c2, (manifold: any) => {
            if (point === null && manifold.numSolverContacts() > 0) point = fromE(d, d.a(manifold.solverContactPoint(0)))
            for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i)
        })
        const inverse = a.inverseMass() + b.inverseMass()
        const bounce = Math.max(c1.restitution(), c2.restitution())
        const speed = inverse > 0 ? ((impulse * inverse) / (1 + bounce)) * d.unit : 0
        return { point, speed }
    }

    /** Advances by a frame's time, in whole fixed steps. The hooks call it from the frame clock. */
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

    // ---------- rewind ----------

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
        const holders = new Map<number, Thing<V, R, A>>()
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
                this.characters.delete(w as CharacterCore<V, R, A>)
                this.bury(w)
            }
        }
        for (const [handle, w] of [...this.buried]) {
            if (restored.getCollider(handle) === null || restored.getCollider(handle) === undefined) continue
            this.buried.delete(handle)
            w.revive()
            this.byCollider.set(handle, w)
            if (w instanceof CharacterCore) this.characters.add(w)
        }
        for (const c of this.characters) {
            c.rebuildController()
            c.loadState(own[c.colliderHandle])
        }
        old.free()
    }

    // ---------- bookkeeping ----------

    wrapperOf(colliderHandle: number): Thing<V, R, A> | null {
        return this.byCollider.get(colliderHandle) ?? null
    }

    /** Puts every body's actor where its body is, in one go. */
    syncActors(): void {
        const list: Placement<V, A>[] = []
        for (const w of this.byCollider.values()) {
            const p = w.placement()
            if (p !== null) list.push(p)
        }
        if (list.length > 0) this.dim.place(list)
    }

    forget(w: Thing<V, R, A>): void {
        this.byCollider.delete(w.colliderHandle)
        this.fresh.delete(w.colliderHandle)
        if (w instanceof CharacterCore) this.characters.delete(w)
        this.bury(w)
    }

    private bury(w: Thing<V, R, A>): void {
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

// ---------- a body ----------

export class BodyCore<V extends readonly number[], R, A> {
    actor: A | null
    tag: unknown
    readonly dynamic: boolean
    readonly kinematic: boolean
    readonly trigger: boolean
    private handlers: Handlers = {}
    private gone = false

    constructor(
        readonly world: WorldCore<V, R, A>,
        readonly kind: string,
        readonly bodyHandle: number,
        readonly colliderHandle: number,
        readonly layer: Layer,
        o: BodyOptionsOf<V, R, A>,
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

    /** The engine's collider, for a dimension's own reading of it. */
    collider(): any {
        if (this.gone) throw new Error(`[oj] this ${this.kind} was destroyed`)
        return this.world.raw.getCollider(this.colliderHandle)
    }

    private get d(): Dim<V, R, A> { return this.world.dim }

    get position(): V { return fromE(this.d, this.d.a(this.rb().translation())) }
    set position(p: V) {
        const rb = this.rb(), at = this.d.e(toE(this.d, p))
        if (this.kinematic) rb.setNextKinematicTranslation(at)
        else {
            rb.setTranslation(at, true)
            this.world.markFresh(this.colliderHandle)
        }
    }

    get rotation(): R { return this.d.rotOut(this.rb().rotation()) }
    set rotation(r: R) {
        const rb = this.rb()
        if (this.kinematic) rb.setNextKinematicRotation(this.d.rot(r))
        else {
            rb.setRotation(this.d.rot(r), true)
            this.world.markFresh(this.colliderHandle)
        }
    }

    /** The middle of it, where `canSee` looks. */
    middle(): V { return this.position }

    get velocity(): V { return fromE(this.d, this.d.a(this.rb().linvel())) }
    set velocity(v: V) { this.rb().setLinvel(this.d.e(toE(this.d, v)), true) }

    get mass(): number { return this.rb().mass() }
    set mass(m: number) { this.collider().setMass(m) }
    get friction(): number { return this.collider().friction() }
    set friction(f: number) { this.collider().setFriction(f) }
    get bounce(): number { return this.collider().restitution() }
    set bounce(b: number) { this.collider().setRestitution(b) }

    push(impulse: V): void { this.rb().applyImpulse(this.d.e(toE(this.d, impulse)), true) }

    addVelocity(v: V): void {
        const rb = this.rb()
        rb.setLinvel(this.d.e(add(this.d.a(rb.linvel()), toE(this.d, v))), true)
    }

    /** 0 for anything the simulation does not move, which no touch can slow. */
    inverseMass(): number {
        if (!this.dynamic || this.gone) return 0
        const m = this.rb().mass()
        return m > 0 ? 1 / m : 0
    }

    /** Whether a touch on this body has anyone to tell. */
    get listening(): boolean { return (this.handlers.touch?.size ?? 0) > 0 }

    onTouch(handler: (other: any, contact: ContactOf<V>) => void): () => void { return this.listen("touch", handler) }
    onTouchEnd(handler: (other: any) => void): () => void { return this.listen("touchEnd", handler) }
    onEnter(handler: (other: any) => void): () => void { return this.listen("enter", handler) }
    onLeave(handler: (other: any) => void): () => void { return this.listen("leave", handler) }

    private listen<K extends keyof Handlers>(kind: K, handler: any): () => void {
        const set = (this.handlers[kind] ??= new Set() as never) as Set<unknown>
        set.add(handler)
        // The engine skips a collider's events unless asked.
        this.collider().setActiveEvents(this.world.r.ActiveEvents.COLLISION_EVENTS)
        return () => { set.delete(handler) }
    }

    emitTouch(other: unknown, contact: ContactOf<V>): void {
        for (const h of this.handlers.touch ?? []) h(other, contact)
    }

    emitTouchEnd(other: unknown): void {
        for (const h of this.handlers.touchEnd ?? []) h(other)
    }

    emitTrigger(started: boolean, other: unknown): void {
        for (const h of (started ? this.handlers.enter : this.handlers.leave) ?? []) h(other)
    }

    placement(): Placement<V, A> | null {
        if (this.actor === null || this.gone) return null
        const rb = this.world.raw.getRigidBody(this.bodyHandle)
        return { actor: this.actor, at: fromE(this.d, this.d.a(rb.translation())), rotation: rb.rotation() }
    }

    syncActor(): void {
        const p = this.placement()
        if (p !== null) this.d.place([p])
    }

    markGone(): void { this.gone = true }

    destroy(): void {
        if (this.gone) return
        this.world.raw.removeRigidBody(this.rb())
        this.world.forget(this)
        this.gone = true
        if (this.actor !== null) this.d.release(this.actor)
        this.actor = null
    }

    revive(): void { this.gone = false }
}

// ---------- a character ----------

/** A character controller: climbs `step`, keeps to the ground within `snap`, climbs slopes up to `slope` degrees. All in world units. */
function makeController<V extends readonly number[], R, A>(world: WorldCore<V, R, A>, radius: number, step: number, snap: number, slope: number): any {
    const d = world.dim
    const c = world.raw.createCharacterController(SKIN)
    c.setUp(d.e(d.up))
    // Climbing costs the controller extra casts at every contact, about 40%
    // of a walking move, so a character that climbs nothing does not pay it.
    if (step > 0) c.enableAutostep(step / d.unit, radius / 2 / d.unit, false)
    else c.disableAutostep()
    c.enableSnapToGround(snap / d.unit)
    const angle = (slope * Math.PI) / 180
    c.setMaxSlopeClimbAngle(angle)
    c.setMinSlopeSlideAngle(angle)
    return c
}

/** A capsule standing along the world's up axis, `height` end to end, in world units. */
function capsuleDesc(r: any, d: Dim<any, any, any>, radius: number, height: number): any {
    return r.ColliderDesc.capsule(capsuleHalf(radius, height) / d.unit, radius / d.unit)
}

/** Rapier's capsule is a segment and a radius; ours is end to end. */
export function capsuleHalf(radius: number, height: number): number {
    return Math.max(0, height / 2 - radius)
}

export class CharacterCore<V extends readonly number[], R, A> {
    readonly kind = "character" as const
    readonly trigger = false
    readonly radius: number
    readonly height: number
    readonly layer: Layer
    readonly bodyHandle: number
    readonly colliderHandle: number
    actor: A | null
    tag: unknown
    /** Its speed along up, metres a second, which gravity builds while it is off the ground and a jump sets. */
    private fall = 0
    /** What `walk` asked for, in metres a second, held. */
    private wish: EVec
    /** How it moved over the last step, in metres a second. */
    private moved: EVec
    private controller: any
    private isGrounded = false
    private touching = new Set<number>()
    private touchHandlers = new Set<(other: unknown, contact: ContactOf<V>) => void>()
    private touchEndHandlers = new Set<(other: unknown) => void>()
    private gone = false
    private readonly o: CharacterOptionsOf<V, A>
    /** What its controller collides with: everything but the layers it ignores. */
    private readonly walkGroups: number | undefined

    constructor(readonly world: WorldCore<V, R, A>, o: CharacterOptionsOf<V, A>) {
        const d = world.dim, r = world.r, c = world.defaults.character
        this.o = o
        this.wish = zero(d)
        this.moved = zero(d)
        this.radius = o.radius ?? c.radius
        this.height = Math.max(o.height ?? c.height, this.radius * 2)
        this.layer = o.layer ?? world.defaults.layer
        this.actor = o.actor ?? null
        this.tag = o.tag
        const centre = this.centreFor(toE(d, o.at ?? zeroWorld(d)))
        const rb = world.raw.createRigidBody(r.RigidBodyDesc.kinematicPositionBased().setTranslation(...centre))
        const collider = world.raw.createCollider(
            capsuleDesc(r, d, this.radius, this.height)
                .setCollisionGroups(world.groupsFor(this.layer, o.ignores))
                .setActiveCollisionTypes(r.ActiveCollisionTypes.ALL),
            rb,
        )
        const ignored = world.ignoreMask(o.ignores ?? [])
        this.walkGroups = ignored === 0 ? undefined : ((0xffff << 16) | (0xffff & ~ignored)) >>> 0
        this.bodyHandle = rb.handle
        this.colliderHandle = collider.handle
        this.rebuildController()
        this.isGrounded = this.groundUnder(centre)
        if (this.actor !== null) this.syncActor()
    }

    private get d(): Dim<V, R, A> { return this.world.dim }

    /** Its capsule's centre for feet at `feet`, both in metres: half its height and its skin up. */
    private centreFor(feet: EVec): EVec {
        return add(feet, scale(this.d.up, this.height / 2 / this.d.unit + SKIN))
    }

    /**
     * Standing if there is ground within its skin of a capsule centred at
     * `centre`, so a character placed on a floor starts standing, rather than
     * falling one step into its own skin and climbing back out of it.
     */
    private groundUnder(centre: EVec): boolean {
        const raw = this.world.raw.getCollider(this.colliderHandle).shape
        return this.world.engineSweep(raw, centre, add(centre, scale(this.d.up, -2 * SKIN)), { skip: [this] }) !== null
    }

    /** The controller holds the world's sets, so a restored world needs a new one. */
    rebuildController(): void {
        this.controller?.free()
        const c = this.world.defaults.character
        this.controller = makeController(this.world, this.radius, this.o.stepHeight ?? c.stepHeight, this.o.snap ?? c.snap, this.o.slope ?? c.slope)
    }

    get alive(): boolean { return !this.gone }
    get grounded(): boolean { return this.isGrounded }

    private rb(): any {
        if (this.gone) throw new Error("[oj] this character was destroyed")
        return this.world.raw.getRigidBody(this.bodyHandle)
    }

    get position(): V {
        const t = this.d.a(this.rb().nextTranslation())
        return fromE(this.d, add(t, scale(this.d.up, -(this.height / 2 / this.d.unit + SKIN))))
    }

    middle(): V {
        const p = this.position
        return freeze(p.map((x, i) => x + this.d.up[i]! * this.height / 2)) as unknown as V
    }

    get velocity(): V { return fromE(this.d, this.moved) }

    walk(velocity: V): void {
        if (this.gone) throw new Error("[oj] this character was destroyed")
        this.wish = toE(this.d, velocity)
    }

    jump(height: number): void {
        if (this.gone) throw new Error("[oj] this character was destroyed")
        const g = Math.abs(dot(this.d.a(this.world.raw.gravity), this.d.up))
        this.fall = Math.sqrt(2 * g * Math.max(0, height / this.d.unit))
    }

    /** One step of its held walk, called by the world before the engine steps. */
    stepWalk(dt: number): void {
        const d = this.d
        const rb = this.world.raw.getRigidBody(this.bodyHandle)
        const g = dot(d.a(this.world.raw.gravity), d.up)
        // Standing, it does not push down into the floor: snap-to-ground keeps
        // it there, and a downward wish into a floor it rests on made Rapier's
        // controller drop a frame's movement now and then (Gunyard's fighters
        // lost 3% of every walk, and froze outright when placed on the floor).
        const standing = this.isGrounded && this.fall <= 0
        this.fall = standing ? 0 : this.fall + g * dt
        const wish = scale(add(this.wish, scale(d.up, this.fall)), dt)
        const collider = this.world.raw.getCollider(this.colliderHandle)
        this.controller.computeColliderMovement(collider, d.e(wish), this.world.r.QueryFilterFlags.EXCLUDE_SENSORS, this.walkGroups)
        const m = d.a(this.controller.computedMovement())
        this.isGrounded = this.controller.computedGrounded()
        if (this.isGrounded && this.fall < 0) this.fall = 0
        // A head that meets a ceiling stops rising.
        if (this.fall > 0 && dot(m, d.up) < this.fall * dt * 0.5) this.fall = 0
        rb.setNextKinematicTranslation(d.e(add(d.a(rb.nextTranslation()), m)))
        this.moved = scale(m, 1 / dt)
        this.reportTouches()
    }

    /** What oj holds that the engine's snapshot does not: the held walk, the speed along up, standing. */
    saveState(): number[] {
        return [...this.wish, this.fall, this.isGrounded ? 1 : 0]
    }

    loadState(s: number[] | undefined): void {
        if (s === undefined) return
        const n = this.d.n
        this.wish = s.slice(0, n)
        this.fall = s[n]!
        this.isGrounded = s[n + 1] === 1
        this.touching.clear()
    }

    inverseMass(): number { return 0 }
    get listening(): boolean { return this.touchHandlers.size > 0 }

    /** What the controller ran into this step, reported once when a touch starts and once when it ends. */
    private reportTouches(): void {
        const d = this.d
        const now = new Set<number>()
        const n = this.controller.numComputedCollisions()
        const asked = add(this.wish, scale(d.up, this.fall))
        for (let i = 0; i < n; i++) {
            const hit = this.controller.computedCollision(i)
            const handle = hit?.collider?.handle
            if (handle === undefined || now.has(handle)) continue
            now.add(handle)
            if (this.touching.has(handle)) continue
            const other = this.world.wrapperOf(handle)
            if (other === null) continue
            // How fast it was going into the surface: its wish against the normal, less the other's own speed that way.
            const normal = hit.normal1 ? d.a(hit.normal1) : zero(d)
            const otherVelocity = other instanceof CharacterCore ? other.moved : other.dynamic || other.kinematic ? toE(d, other.velocity) : zero(d)
            const closing = -dot(sub(asked, otherVelocity), normal)
            const contact: ContactOf<V> = { point: fromE(d, d.a(hit.witness1)), speed: Math.max(0, closing) * d.unit }
            for (const h of this.touchHandlers) h(other, contact)
            if (other instanceof BodyCore) other.emitTouch(this, contact)
        }
        // A controller resting against a wall does not run into it every
        // frame, so a touch lasts while the wall is within 5 cm, not only
        // while the controller is hitting it.
        for (const handle of this.touching) {
            if (now.has(handle)) continue
            const other = this.world.raw.getCollider(handle)
            if (other !== null && other !== undefined && other.intersectsShape(this.near(), this.world.raw.getRigidBody(this.bodyHandle).nextTranslation(), d.rot(undefined))) now.add(handle)
        }
        for (const handle of this.touching) {
            if (now.has(handle)) continue
            const other = this.world.wrapperOf(handle)
            if (other === null) continue
            this.emitTouchEnd(other)
            if (other instanceof BodyCore) other.emitTouchEnd(this)
        }
        this.touching = now
    }

    private nearShape: any = null
    /** This character's capsule grown by 5 cm: what counts as still touching. */
    private near(): any {
        this.nearShape ??= new this.world.r.Capsule(capsuleHalf(this.radius, this.height) / this.d.unit, this.radius / this.d.unit + 0.05)
        return this.nearShape
    }

    teleport(at: V): void {
        // Exactly where asked; finding somewhere clear is clearSpot's job.
        const centre = this.centreFor(toE(this.d, at))
        this.rb().setTranslation(this.d.e(centre), true)
        this.rb().setNextKinematicTranslation(this.d.e(centre))
        this.world.markFresh(this.colliderHandle)
        this.fall = 0
        this.moved = zero(this.d)
        this.isGrounded = this.groundUnder(centre)
        this.touching.clear()
    }

    onTouch(handler: (other: any, contact: ContactOf<V>) => void): () => void {
        this.touchHandlers.add(handler)
        return () => { this.touchHandlers.delete(handler) }
    }

    onTouchEnd(handler: (other: any) => void): () => void {
        this.touchEndHandlers.add(handler)
        return () => { this.touchEndHandlers.delete(handler) }
    }

    emitTouch(other: unknown, contact: ContactOf<V>): void {
        for (const h of this.touchHandlers) h(other, contact)
    }

    emitTouchEnd(other: unknown): void {
        for (const h of this.touchEndHandlers) h(other)
    }

    emitTrigger(): void {}

    placement(): Placement<V, A> | null {
        if (this.actor === null || this.gone) return null
        return { actor: this.actor, at: this.position, rotation: null }
    }

    syncActor(): void {
        const p = this.placement()
        if (p !== null) this.d.place([p])
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
        if (this.actor !== null) this.d.release(this.actor)
        this.actor = null
    }

    revive(): void {
        this.gone = false
        this.rebuildController()
    }
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

// ---------- vectors ----------

/** World units to the engine's metres. */
export function toE<V extends readonly number[]>(d: Dim<V, any, any>, v: Readonly<V>): EVec {
    const out: EVec = new Array(d.n)
    for (let i = 0; i < d.n; i++) out[i] = v[i]! / d.unit
    return out
}

/** The engine's metres to world units, frozen. */
export function fromE<V extends readonly number[]>(d: Dim<V, any, any>, v: Readonly<EVec>): V {
    const out = new Array(d.n)
    for (let i = 0; i < d.n; i++) out[i] = v[i]! * d.unit
    return Object.freeze(out) as unknown as V
}

/** A direction, which no unit scales, frozen. */
function fromDir<V extends readonly number[]>(d: Dim<V, any, any>, v: Readonly<EVec>): V {
    return Object.freeze(v.slice(0, d.n)) as unknown as V
}

function freeze<T extends readonly number[]>(v: T): T {
    return Object.freeze([...v]) as unknown as T
}

function zero(d: Dim<any, any, any>): EVec { return new Array(d.n).fill(0) }
function zeroWorld<V>(d: Dim<V & readonly number[], any, any>): V { return new Array(d.n).fill(0) as unknown as V }
export function add(a: Readonly<EVec>, b: Readonly<EVec>): EVec { return a.map((x, i) => x + b[i]!) }
export function sub(a: Readonly<EVec>, b: Readonly<EVec>): EVec { return a.map((x, i) => x - b[i]!) }
export function scale(a: Readonly<EVec>, k: number): EVec { return a.map((x) => x * k) }
export function dot(a: Readonly<EVec>, b: Readonly<EVec>): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s }
export function length(a: Readonly<EVec>): number { return Math.sqrt(dot(a, a)) }
