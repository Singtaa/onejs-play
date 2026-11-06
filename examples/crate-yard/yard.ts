/**
 * Crate Yard without the engine: where everything stands, how the controls
 * become a drive, and where the camera goes. The world, the models and the
 * frame clock are index.tsx's.
 */

export type Vec3 = [number, number, number]

/** The yard is this many metres square, walled round. */
export const YARD = 80
/** A crate's side, metres: the 1 m model at this scale. */
export const CRATE = 0.9
/** Where the car starts, facing +z, toward the ramp. */
export const START: Vec3 = [0, 1, -28]

/** The ramp: its middle, size, and how far its front is tipped up, degrees. */
export const RAMP = { at: [0, 0.6, -8] as Vec3, size: [6, 1, 10] as Vec3, pitch: -10 }

/** The bottom middle of each stack, and how many crates its bottom row has. */
export const STACKS: readonly { at: Vec3, rows: number, along: "x" | "z" }[] = [
    { at: [0, 0, 12], rows: 4, along: "x" },
    { at: [-18, 0, -4], rows: 3, along: "z" },
    { at: [18, 0, -4], rows: 3, along: "z" },
    { at: [-14, 0, 24], rows: 3, along: "x" },
    { at: [14, 0, 24], rows: 3, along: "x" },
]

/**
 * The middle of every crate in a stack: a wall `rows` wide at the bottom,
 * one fewer on each row up, each row centred on the one below, with a
 * finger's gap between neighbours so they start apart rather than pressed.
 */
export function crateSpots(stack: { at: Vec3, rows: number, along: "x" | "z" }): Vec3[] {
    const spots: Vec3[] = []
    const pitch = CRATE + 0.02
    for (let row = 0; row < stack.rows; row++) {
        const n = stack.rows - row
        for (let i = 0; i < n; i++) {
            const offset = (i - (n - 1) / 2) * pitch
            const y = stack.at[1] + CRATE / 2 + row * CRATE
            spots.push(stack.along === "x" ? [stack.at[0] + offset, y, stack.at[2]] : [stack.at[0], y, stack.at[2] + offset])
        }
    }
    return spots
}

/** What the controls ask of the car this frame: world.car's drive. */
export interface Drive {
    throttle: number
    steer: number
    brake: number
}

/** The controls a frame reads, whatever is plugged in. */
export interface Controls {
    /** Held keys, by oj's names. */
    key: (name: string) => boolean
    /** The first gamepad, or null. Stick y is up positive, as gamepads count. */
    pad: { stickX: number, rightTrigger: number, leftTrigger: number, south: boolean } | null
    /** The on-screen stick: y is -1 at the top, as the stage counts. */
    stick: { x: number, y: number, active: boolean }
}

/** A gamepad stick or trigger within this of rest counts as at rest. */
const DEAD = 0.12

const dead = (x: number) => (Math.abs(x) < DEAD ? 0 : x)
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))

/**
 * Keys, a gamepad and the on-screen stick, added together and held to -1..1,
 * so whichever is in use drives and the others, at rest, add nothing.
 */
export function readDrive(c: Controls): Drive {
    let throttle = 0, steer = 0, brake = 0
    if (c.key("W") || c.key("UpArrow")) throttle += 1
    if (c.key("S") || c.key("DownArrow")) throttle -= 1
    if (c.key("D") || c.key("RightArrow")) steer += 1
    if (c.key("A") || c.key("LeftArrow")) steer -= 1
    if (c.key("Space")) brake = 1
    if (c.pad !== null) {
        throttle += dead(c.pad.rightTrigger) - dead(c.pad.leftTrigger)
        steer += dead(c.pad.stickX)
        if (c.pad.south) brake = 1
    }
    if (c.stick.active) {
        // Up the screen is forward.
        throttle -= c.stick.y
        steer += c.stick.x
    }
    return { throttle: clamp1(throttle), steer: clamp1(steer), brake }
}

/** The way something with this yaw faces, flat. Yaw 0 faces +z, and 90 faces +x. */
export function facing(yaw: number): Vec3 {
    const r = (yaw * Math.PI) / 180
    return [Math.sin(r), 0, Math.cos(r)]
}

/** How far behind and above the car the camera sits, metres, and how fast it catches up, per second. */
export const CHASE = { behind: 8, above: 3.5, look: 1, catchUp: 5 }

/**
 * Where the camera goes this frame: toward a spot behind and above the car,
 * a share of the way that depends on the frame's length, so it settles in
 * the same time at any frame rate.
 */
export function chase(camera: Vec3, car: Vec3, yaw: number, dt: number): { position: Vec3, lookAt: Vec3 } {
    const f = facing(yaw)
    const want: Vec3 = [car[0] - f[0] * CHASE.behind, car[1] + CHASE.above, car[2] - f[2] * CHASE.behind]
    const k = 1 - Math.exp(-CHASE.catchUp * dt)
    const position = camera.map((x, i) => x + (want[i]! - x) * k) as Vec3
    return { position, lookAt: [car[0], car[1] + CHASE.look, car[2]] }
}

/**
 * Whether a rotation has its top facing more sideways or down than up: the
 * height of its up direction, from pitch and roll, under a half.
 */
export function overturned(rotation: { pitch: number, roll: number }): boolean {
    const r = Math.PI / 180
    return Math.cos(rotation.pitch * r) * Math.cos(rotation.roll * r) < 0.5
}

/** Puts a car back on its wheels where it lies, facing the way it faced, from a metre up. */
export function setUpright(body: { position: Vec3, rotation: { yaw: number }, velocity: Vec3 }): void {
    const at = body.position
    body.position = [at[0], 1, at[2]]
    body.rotation = { yaw: body.rotation.yaw }
    body.velocity = [0, 0, 0]
}

/** A crate this far from where it was stacked, metres, has been knocked. */
export const KNOCKED = 0.3

export function knocked(from: Vec3, now: readonly number[]): boolean {
    return Math.hypot(now[0]! - from[0], now[1]! - from[1], now[2]! - from[2]) > KNOCKED
}
