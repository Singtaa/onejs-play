/**
 * `world.car`: Rapier's ray-cast vehicle under a chassis body, driven each
 * step before the engine steps, as gliding bodies and characters are.
 *
 * Each wheel is a ray with a spring, a damper and a tyre model; no wheel
 * collides, so it is cheap and does not snag. Rapier leaves five things to
 * its caller, each found by the drive test in PlaySite/docs/physics.md §9,
 * and this does them: the lock narrows with speed and turns at a hand's
 * pace, pressing back while rolling forward brakes, a car let go of rolls to
 * a stop, a car held still on a slope stays put, and a sleeping chassis is
 * left alone.
 */

import type { Rotation, Vec3 } from "../models"
import type { BodyCore, Drawn, Driver } from "../physics/core"
import { fromQuat, type Quat } from "./rotation"

/** What `world.car` takes. Every number has a default that drives like a small road car. */
export interface CarOptionsOf<A> {
    /** Where the chassis's middle starts. */
    at?: Vec3
    rotation?: Partial<Rotation>
    /** The chassis: width, height, length, metres. [1.8, 0.5, 4] by default. */
    size?: Vec3
    /** Kilograms. 1200 by default. */
    mass?: number
    /** Metres. 0.35 by default. */
    wheelRadius?: number
    /** Metres a second at full throttle on the flat. 30 by default (108 km/h). */
    topSpeed?: number
    /** Seconds from standing to near top speed on the flat. 8 by default. */
    acceleration?: number
    /** The wheels' lock at a crawl, degrees; it narrows with speed. 32 by default. */
    steering?: number
    /** Tyre grip: 1 is a road car, lower slides, higher corners harder. 1 by default. */
    grip?: number
    /** Which wheels the engine turns. "rear" by default. */
    drivenWheels?: "front" | "rear" | "all"
    /** The chassis model, centred on the chassis. */
    actor?: A | null
    /**
     * Wheel models, front left, front right, rear left, rear right: the world
     * puts each where its wheel is, steered and rolling, on the chassis as it
     * is drawn. Without them, `car.wheels` says where to put your own.
     */
    wheels?: readonly [A, A, A, A]
    layer?: string
}

export interface CarWheelState {
    /** Its middle, in the world. */
    readonly position: Vec3
    /** The chassis's rotation, turned by the steering and the wheel's roll. */
    readonly rotation: Readonly<Rotation>
    /** On the ground, as of the last step. */
    readonly grounded: boolean
}

/** The chassis's width, height and length when none is given, metres. */
export const CAR_SIZE: Vec3 = [1.8, 0.5, 4]
const G = 9.81
/** The linear damping a chassis always has, which the engine force makes up for so top speed is still reached. */
const DAMP = 0.05
/** Below this, metres a second, a car counts as stopped: back reverses rather than brakes, and a still car is held. */
const CRAWL = 0.5
/** Brakes, metres a second squared at full pedal. */
const BRAKE = 9
/** Rolling resistance, metres a second squared, so a car let go of comes to rest. */
const ROLLING = 0.6
/** How much of the forward force reverse gets, and how much of top speed it reaches. */
const REVERSE_FORCE = 0.6, REVERSE_TOP = 0.3
/** Full lock takes this many seconds to reach from straight. */
const LOCK_SECONDS = 1 / 3.5
/** A held car further than this from where it stopped, metres, was pushed, and is held where it is now. */
const REANCHOR = 0.02
/** Each wheel's spring rest length and travel, metres. */
const REST = 0.25, TRAVEL = 0.2
/** The mass sits this far below the chassis's middle, as a fraction of its height: low enough that grip gives out before it tips. */
const COM_Y = -0.25
/**
 * With full force up to 90% of top speed, tapering to none at it, a car
 * reaches 95% of top speed in this many times top speed over the force's
 * acceleration, so the acceleration is solved from the seconds asked for.
 */
const TO_95 = 0.9693

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

/** The engine's car, behind a chassis body. */
export class CarCore<A> implements Driver {
    readonly kind = "car" as const
    readonly colliderHandle: number
    private controller: any
    private readonly corners: Vec3[]
    private readonly driven: readonly number[]
    private readonly mass: number
    private readonly radius: number
    private readonly topSpeed: number
    private readonly accel: number
    private readonly lock: number
    private readonly grip: number
    private wish = { throttle: 0, steer: 0, brake: 0 }
    /** The front wheels' angle now, radians, which follows the wish at a hand's pace. */
    private steerNow = 0
    /** Each wheel's roll, radians, carried across a rewind, which builds a new controller. */
    private spinFrom = [0, 0, 0, 0]
    /** How fast each wheel rolled over the last step, radians a second: how far it rolls on a frame drawn past it. */
    private spinRate = [0, 0, 0, 0]
    /** The wheel models the world places, or null when the cart places its own. */
    private wheelActors: readonly A[] | null
    /** Where the chassis stopped with the brake on, which it is held to, or null while it is not held. */
    private parked: number[] | null = null
    private active = true

    constructor(readonly world: any, readonly body: BodyCore<Vec3, Partial<Rotation> | undefined, A>, o: CarOptionsOf<A>) {
        const [w, h, l] = o.size ?? CAR_SIZE
        this.colliderHandle = body.colliderHandle
        this.mass = o.mass ?? 1200
        this.radius = o.wheelRadius ?? 0.35
        this.topSpeed = o.topSpeed ?? 30
        this.accel = (TO_95 * this.topSpeed) / Math.max(0.1, o.acceleration ?? 8)
        this.lock = ((o.steering ?? 32) * Math.PI) / 180
        this.grip = o.grip ?? 1
        const d = o.drivenWheels ?? "rear"
        this.driven = d === "front" ? [0, 1] : d === "rear" ? [2, 3] : [0, 1, 2, 3]
        // Front left, front right, rear left, rear right, where each spring hangs from the chassis.
        const x = w / 2 - 0.1, y = -h / 2 + 0.05, z = l / 2 - 0.6
        this.corners = [[-x, y, z], [x, y, z], [-x, y, -z], [x, y, -z]]
        const m = this.mass
        body.collider().setMassProperties(m, { x: 0, y: COM_Y * h, z: 0 },
            { x: (m * (h * h + l * l)) / 12, y: (m * (w * w + l * l)) / 12, z: (m * (w * w + h * h)) / 12 }, { x: 0, y: 0, z: 0, w: 1 })
        this.rb().setAngularDamping(0.5)
        this.rb().setLinearDamping(DAMP)
        this.build()
        world.drivers.add(this)
        if (o.wheels !== undefined) {
            if (!Array.isArray(o.wheels) || o.wheels.length !== 4) throw new Error("[oj] a car's wheels are four models: front left, front right, rear left, rear right")
            this.wheelActors = [...o.wheels]
            world.carriers.set(body, this)
            body.syncActor()
        } else this.wheelActors = null
    }

    private rb(): any { return this.world.raw.getRigidBody(this.body.bodyHandle) }

    /** A controller on this world's engine, its springs sized so the car sits a third into their travel. */
    private build(): void {
        const v = this.world.raw.createVehicleController(this.rb())
        v.indexUpAxis = 1
        v.setIndexForwardAxis = 2
        // Rapier's stiffness is per unit of chassis mass.
        const k = G / 4 / (TRAVEL / 3)
        for (const c of this.corners) {
            v.addWheel({ x: c[0], y: c[1], z: c[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, REST, this.radius)
            const i = v.numWheels() - 1
            v.setWheelSuspensionStiffness(i, k)
            v.setWheelSuspensionCompression(i, 0.6 * 2 * Math.sqrt(k))
            v.setWheelSuspensionRelaxation(i, 0.8 * 2 * Math.sqrt(k))
            v.setWheelMaxSuspensionTravel(i, TRAVEL)
            v.setWheelMaxSuspensionForce(i, this.mass * G * 4)
            v.setWheelFrictionSlip(i, this.grip)
            v.setWheelSideFrictionStiffness(i, this.grip)
        }
        this.controller = v
    }

    get alive(): boolean { return this.active && this.body.alive }

    private live(): void {
        if (!this.alive) throw new Error("[oj] this car was destroyed")
    }

    drive(throttle: number, steer = 0, brake = 0): void {
        this.live()
        this.wish = { throttle: clamp(throttle || 0, -1, 1), steer: clamp(steer || 0, -1, 1), brake: clamp(brake || 0, 0, 1) }
        if (this.wish.throttle !== 0 || this.wish.steer !== 0) this.rb().wakeUp()
    }

    /** Forward speed, metres a second: the chassis read directly, since Rapier's own is cached from before the step. */
    get speed(): number {
        this.live()
        const rb = this.rb()
        if (rb.isSleeping()) return 0
        const f = rotate(rb.rotation(), [0, 0, 1]), u = rb.linvel()
        return f[0] * u.x + f[1] * u.y + f[2] * u.z
    }

    get grounded(): boolean {
        this.live()
        for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) return true
        return false
    }

    /**
     * Wheel `i` on a chassis at `at` turned by `q`: its middle and its
     * rotation, `ahead` seconds past the last step, rolled on by as much.
     */
    private wheelOn(i: number, at: Readonly<Vec3>, q: Quat, ahead: number): { at: Vec3, rotation: Quat } {
        const c = this.corners[i]!
        const len = this.controller.wheelSuspensionLength(i) ?? REST
        const p = rotate(q, [c[0], c[1] - len, c[2]])
        const steer = i < 2 ? this.steerNow : 0
        const spin = this.spinFrom[i]! + (this.controller.wheelRotation(i) ?? 0) + this.spinRate[i]! * ahead
        return { at: [p[0] + at[0], p[1] + at[1], p[2] + at[2]], rotation: mul(mul(q, axisAngle([0, 1, 0], steer)), axisAngle([1, 0, 0], spin)) }
    }

    /** Each wheel where it is now, worked out from the chassis's pose after the step rather than the controller's from before it. */
    get wheels(): readonly CarWheelState[] {
        this.live()
        const rb = this.rb(), q: Quat = rb.rotation(), t = rb.translation()
        return this.corners.map((_, i) => {
            const w = this.wheelOn(i, [t.x, t.y, t.z], q, 0)
            return Object.freeze({
                position: Object.freeze(w.at) as unknown as Vec3,
                rotation: fromQuat(w.rotation),
                grounded: this.controller.wheelIsInContact(i) === true,
            })
        })
    }

    carried(at: readonly number[], rotation: Quat, ahead: number, out: Drawn<Vec3, A>[]): void {
        if (this.wheelActors === null) return
        for (let i = 0; i < 4; i++) {
            const w = this.wheelOn(i, at as unknown as Vec3, rotation, ahead)
            out.push({ actor: this.wheelActors[i]!, at: w.at, rotation: w.rotation })
        }
    }

    stepDrive(dt: number): void {
        if (!this.alive) return
        const rb = this.rb()
        // A sleeping chassis is left alone: the controller's impulses would sit in its velocity and kick it on waking.
        if (rb.isSleeping()) { this.spinRate = [0, 0, 0, 0]; return }
        const speed = this.speed, v = this.controller, wish = this.wish
        const s = Math.abs(speed) / this.topSpeed
        // The lock narrows with speed, and the wheel turns at a hand's pace rather than snapping.
        const target = wish.steer * this.lock / (1 + 4 * s * s)
        const rate = (this.lock / LOCK_SECONDS) * dt
        this.steerNow += clamp(target - this.steerNow, -rate, rate)
        v.setWheelSteering(0, this.steerNow)
        v.setWheelSteering(1, this.steerNow)
        // Brakes as decelerations, turned into each wheel's impulse for this step.
        const t = wish.throttle, m = this.mass
        let force = 0, decel = wish.brake * BRAKE
        if (t !== 0 && Math.sign(t) !== Math.sign(speed) && Math.abs(speed) > CRAWL) decel += Math.abs(t) * BRAKE
        else if (t > 0) force = m * (this.accel + DAMP * speed) * t * clamp((1 - speed / this.topSpeed) * 10, 0, 1)
        else if (t < 0) force = m * (this.accel - DAMP * speed) * t * REVERSE_FORCE * clamp((1 + speed / (this.topSpeed * REVERSE_TOP)) * 10, 0, 1)
        if (t === 0) decel += ROLLING
        for (let i = 0; i < 4; i++) {
            v.setWheelEngineForce(i, this.driven.includes(i) ? force / this.driven.length : 0)
            v.setWheelBrake(i, (m * decel * dt) / 4)
        }
        const rolled = [0, 1, 2, 3].map((i) => v.wheelRotation(i) ?? 0)
        v.updateVehicle(dt)
        this.spinRate = rolled.map((r, i) => ((v.wheelRotation(i) ?? 0) - r) / dt)
        // Held still: a ray-cast car's tyres let it creep down a slope, 4 cm a
        // second at 15 degrees, braked or not, and taking its speed away each
        // step still leaves a quarter of a millimetre a step. So with the
        // brake on, no throttle, all four wheels down and below a crawl, it is
        // held where it stopped, as a parking brake holds: its speed along its
        // length each step is what takes it back to that spot, less gravity's
        // pull that way, up to what its tyres could grip. After the
        // controller, whose own impulses are what creep.
        let down = 0
        for (let i = 0; i < 4; i++) if (v.wheelIsInContact(i)) down++
        if (t === 0 && wish.brake > 0 && down === 4 && Math.abs(speed) < CRAWL) {
            const at = rb.translation()
            // Pushed further than creep could take it, it stays where it was pushed.
            if (this.parked === null || Math.hypot(this.parked[0]! - at.x, this.parked[1]! - at.y, this.parked[2]! - at.z) > REANCHOR) this.parked = [at.x, at.y, at.z]
            const f = rotate(rb.rotation(), [0, 0, 1]), u = rb.linvel(), g = this.world.raw.gravity
            const along = f[0] * u.x + f[1] * u.y + f[2] * u.z
            const back = (f[0] * (this.parked[0] - at.x) + f[1] * (this.parked[1] - at.y) + f[2] * (this.parked[2] - at.z)) / dt
            const pull = clamp(f[0] * g.x + f[1] * g.y + f[2] * g.z, -this.grip * G, this.grip * G)
            const k = along + pull * dt - clamp(back, -CRAWL, CRAWL)
            rb.setLinvel({ x: u.x - f[0] * k, y: u.y - f[1] * k, z: u.z - f[2] * k }, false)
        } else this.parked = null
    }

    saveState(): number[] {
        const spins = [0, 1, 2, 3].map((i) => this.spinFrom[i]! + (this.controller?.wheelRotation(i) ?? 0))
        return [this.wish.throttle, this.wish.steer, this.wish.brake, this.steerNow, ...spins, ...(this.parked ?? [])]
    }

    restored(alive: boolean, state: number[] | undefined): void {
        // The old controller went with the old engine.
        this.controller = null
        this.active = alive
        if (!alive) { this.releaseWheels(); return }
        this.build()
        this.spinRate = [0, 0, 0, 0]
        const s = state ?? [0, 0, 0, 0, 0, 0, 0, 0]
        this.wish = { throttle: s[0]!, steer: s[1]!, brake: s[2]! }
        this.steerNow = s[3]!
        this.spinFrom = s.slice(4, 8)
        this.parked = s.length === 11 ? s.slice(8, 11) : null
        this.controller.setWheelSteering(0, this.steerNow)
        this.controller.setWheelSteering(1, this.steerNow)
    }

    destroy(): void {
        if (!this.alive) return
        this.world.raw.removeVehicleController(this.controller)
        this.controller = null
        this.active = false
        this.releaseWheels()
        this.body.destroy()
    }

    /** Its wheel models go with it, as its chassis model does: a rewind that brings it back brings it without them. */
    private releaseWheels(): void {
        if (this.wheelActors === null) return
        for (const a of this.wheelActors) this.world.dim.release(a)
        this.wheelActors = null
        this.world.carriers.delete(this.body)
    }
}

function rotate(q: Quat, v: Readonly<Vec3>): Vec3 {
    const { x, y, z, w } = q
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}

function axisAngle(axis: Vec3, angle: number): Quat {
    const s = Math.sin(angle / 2)
    return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angle / 2) }
}

function mul(a: Quat, b: Quat): Quat {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    }
}
