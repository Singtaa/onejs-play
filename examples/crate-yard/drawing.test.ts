/**
 * Crate Yard as a 120 Hz screen draws it: the car driven over the ramp into
 * the middle stack and on through two more, on the frame intervals a real
 * 120 Hz Chrome gave a cart (src/__tests__/fixtures/chrome-120hz-frames.json,
 * 3834 frames of Unity's frame time, 7.2 to 9.4 ms, recorded 6 Nov 2026).
 *
 * Each frame's drawing of the chassis is compared with where the engine had
 * it at that moment, found afterwards between the steps either side of it, at
 * a corner so a turn counts too. A steady lag reads as nothing; a frame drawn
 * somewhere the next one jumps away from reads as the size of the jump. On
 * runtime 1.3.0's drawing, ahead of the last step and swept against what it
 * would reach, the chassis froze on every frame between steps while it pushed
 * crates, since the sweep met the crate it was pushing, and Sai saw the car
 * and the camera on it doubled. That drawing fails both checks here: 16
 * frames frozen and 89 jumps over 2 cm, against none and 27 between steps.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { setWasmModule } from "../../src/wasm"
import { RAPIER_VERSION } from "../../src/physics3d/rapier.version"
import { createWorld, type World } from "../../src/physics3d/world"
import { WorldCore } from "../../src/physics/core"
import { setActorPlacer, type ActorPlacement } from "../../src/physics3d/actors"
import { CRATE, RAMP, STACKS, START, YARD, crateSpots, type Vec3 } from "./yard"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

type Q = { x: number, y: number, z: number, w: number }
type Pose = { at: Vec3, q: Q }

const FRAMES: number[] = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../src/__tests__/fixtures/chrome-120hz-frames.json"), "utf8"))

function rotate(q: Q, v: Vec3): Vec3 {
    const { x, y, z, w } = q
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
function slerp(a: Q, b: Q, t: number): Q {
    const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
    const q = { x: a.x * (1 - t) + b.x * t * s, y: a.y * (1 - t) + b.y * t * s, z: a.z * (1 - t) + b.z * t * s, w: a.w * (1 - t) + b.w * t * s }
    const n = Math.hypot(q.x, q.y, q.z, q.w)
    return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n }
}
/** The chassis's front right top corner, where a pose puts it. */
const corner = (p: Pose): Vec3 => { const c = rotate(p.q, [0.9, 0.25, 2]); return [p.at[0] + c[0], p.at[1] + c[1], p.at[2] + c[2]] }
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])

/** Drives the yard frame by frame; what each frame drew of the chassis, and the engine's chassis after every step. */
async function drive() {
    const chassis = {}
    let drawn: Pose | null = null
    setActorPlacer((list: readonly ActorPlacement[]) => {
        for (const p of list) if (p.actor === chassis) drawn = { at: [...p.at] as Vec3, q: { ...p.rotation! } }
    })
    const steps: Pose[] = []
    const step = (WorldCore.prototype as any).step
    let world: World | null = null
    try {
        world = await createWorld()
        world.box({ at: [0, -0.5, 0], size: [YARD, 1, YARD] })
        for (const side of [-1, 1]) {
            world.box({ at: [0, 1, (side * YARD) / 2], size: [YARD, 2, 1] })
            world.box({ at: [(side * YARD) / 2, 1, 0], size: [YARD, 2, 1], rotation: { yaw: 90 } })
        }
        world.box({ at: RAMP.at, size: RAMP.size, rotation: { pitch: RAMP.pitch } })
        for (const at of STACKS.flatMap(crateSpots)) world.box({ at, size: [CRATE, CRATE, CRATE], dynamic: true, mass: 40 })
        const car = world.car({ at: START, actor: chassis as any })
        const raw = (world as any).raw
        ;(WorldCore.prototype as any).step = function (this: unknown, ...args: unknown[]) {
            const r = step.apply(this, args)
            const rb = raw.getRigidBody((car.body as any).bodyHandle)
            const t = rb.translation(), q = rb.rotation()
            steps.push({ at: [t.x, t.y, t.z], q: { x: q.x, y: q.y, z: q.z, w: q.w } })
            return r
        }
        const frames: { time: number, drawn: Pose | null }[] = []
        let clock = 0
        for (const ms of FRAMES) {
            // Straight over the ramp into the middle stack, round into the right ones, then left.
            car.drive(1, clock < 7 ? 0 : clock < 9 ? 1 : clock < 13 ? 0 : clock < 15 ? -1 : clock < 20 ? 0.3 : -0.5)
            drawn = null
            // The frame clock's call, which the hooks make and a cart never does.
            ;(world as any).frame(ms / 1000)
            clock += ms / 1000
            frames.push({ time: clock, drawn })
        }
        return { frames, steps }
    } finally {
        ;(WorldCore.prototype as any).step = step
        world?.dispose()
        setActorPlacer((list) => { for (const p of list) p.actor.position = p.at })
    }
}

/** Where the engine had the chassis at `time`, between the steps either side of it. */
function truth(steps: Pose[], time: number): Pose | null {
    const i = Math.floor(time * 60 + 1e-9) - 1
    const a = steps[i], b = steps[i + 1]
    if (a === undefined || b === undefined) return null
    const f = time * 60 - (i + 1)
    return { at: a.at.map((x, k) => x + (b.at[k]! - x) * f) as Vec3, q: slerp(a.q, b.q, f) }
}

describe("Crate Yard at 120 Hz", () => {
    it("draws the chassis moving on every frame it moves, and jumping over 2 cm only at impacts", async () => {
        const { frames, steps } = await drive()
        let moving = 0, frozen = 0
        const jumps: number[] = []
        for (let i = 2; i < frames.length; i++) {
            const f = frames[i]!, p = frames[i - 1]!
            const now = truth(steps, f.time), was = truth(steps, p.time)
            if (now === null || was === null || f.drawn === null || p.drawn === null) continue
            const truly = len(sub(now.at, was.at))
            // Under 1.2 m/s (a centimetre a frame) nothing a frame draws shows.
            if (truly / (f.time - p.time) < 1.2) continue
            moving++
            if (len(sub(f.drawn.at, p.drawn.at)) < truly / 4) frozen++
            jumps.push(len(sub(sub(corner(f.drawn), corner(now)), sub(corner(p.drawn), corner(was)))))
        }
        // The drive is long enough to mean something: about ten seconds moving.
        expect(moving).toBeGreaterThan(1000)
        expect(frozen).toBe(0)
        // A crash changes the car's speed within a step, so a drawing a step
        // behind jumps by that change once: 27 such frames on this drive.
        expect(jumps.filter((j) => j > 0.02).length).toBeLessThan(40)
    })
})
