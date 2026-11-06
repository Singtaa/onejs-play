import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { setWasmModule } from "../../src/wasm"
import { RAPIER_VERSION } from "../../src/physics3d/rapier.version"
import { createWorld, type World } from "../../src/physics3d/world"
import { CRATE, RAMP, STACKS, START, YARD, chase, crateSpots, knocked, overturned, readDrive, setUpright, type Controls, type Vec3 } from "./yard"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

/** The yard as index.tsx builds it, without models. */
async function build(start: Vec3 = START) {
    const world: World = await createWorld()
    world.box({ at: [0, -0.5, 0], size: [YARD, 1, YARD] })
    for (const side of [-1, 1]) {
        world.box({ at: [0, 1, (side * YARD) / 2], size: [YARD, 2, 1] })
        world.box({ at: [(side * YARD) / 2, 1, 0], size: [YARD, 2, 1], rotation: { yaw: 90 } })
    }
    world.box({ at: RAMP.at, size: RAMP.size, rotation: { pitch: RAMP.pitch } })
    const crates = STACKS.flatMap(crateSpots).map((at) => ({ from: at, body: world.box({ at, size: [CRATE, CRATE, CRATE], dynamic: true, mass: 40 }) }))
    const car = world.car({ at: start })
    return { world, crates, car }
}
const run = (w: World, seconds: number, each?: () => void) => { for (let i = 0; i < seconds * 60; i++) { each?.(); w.step() } }

const still: Controls = { key: () => false, pad: null, stick: { x: 0, y: 0, active: false } }

describe("the yard", () => {
    it("stands every stack still until something hits it, and sets the car down on its wheels", async () => {
        const { world, crates, car } = await build()
        run(world, 3)
        expect(crates.filter((c) => knocked(c.from, c.body.position))).toEqual([])
        expect(car.grounded).toBe(true)
        expect(car.wheels.every((w) => w.grounded)).toBe(true)
        expect(overturned(car.body.rotation)).toBe(false)
        world.dispose()
    })

    it("throws a car driven flat out up the ramp into the air, and lands it on its wheels", async () => {
        const { world, car } = await build()
        run(world, 1)
        let airborne = 0, highest = 0
        run(world, 5, () => {
            car.drive(1)
            if (!car.grounded) airborne++
            highest = Math.max(highest, car.body.position[1])
        })
        // Clear of the ramp for a quarter of a second or more, and a metre and more up.
        expect(airborne).toBeGreaterThan(15)
        expect(highest).toBeGreaterThan(2)
        car.drive(0, 0, 1)
        run(world, 3)
        expect(car.grounded).toBe(true)
        expect(overturned(car.body.rotation)).toBe(false)
        world.dispose()
    })

    it("knocks crates off the stack a car drives into", async () => {
        // Straight at the four-wide stack, from between it and the ramp.
        const { world, crates, car } = await build([STACKS[0]!.at[0], 1, 0])
        run(world, 1)
        run(world, 4, () => car.drive(0.7))
        expect(crates.filter((c) => knocked(c.from, c.body.position)).length).toBeGreaterThan(4)
        world.dispose()
    })
})

describe("setUpright", () => {
    it("puts a car on its roof back on its wheels, facing the way it faced", async () => {
        const { world, car } = await build([20, 2, -20])
        car.body.rotation = { yaw: 40, roll: 180 }
        run(world, 2)
        expect(overturned(car.body.rotation)).toBe(true)
        setUpright(car.body)
        run(world, 2)
        expect(overturned(car.body.rotation)).toBe(false)
        expect(car.wheels.every((w) => w.grounded)).toBe(true)
        expect(car.body.rotation.yaw).toBeCloseTo(40, 0)
        world.dispose()
    })
})

describe("the stacks", () => {
    it("rest each crate on the ground or on two below it", () => {
        for (const stack of STACKS) {
            const spots = crateSpots(stack)
            expect(spots.length).toBe((stack.rows * (stack.rows + 1)) / 2)
            for (const s of spots) {
                if (s[1] === CRATE / 2) continue
                const under = spots.filter((o) => Math.abs(o[1] - (s[1] - CRATE)) < 1e-9 && Math.hypot(o[0] - s[0], o[2] - s[2]) < CRATE)
                expect(under.length).toBe(2)
            }
        }
    })
})

describe("readDrive", () => {
    it("drives from keys, a gamepad or the stick, each alone", () => {
        const keys = (...held: string[]): Controls => ({ ...still, key: (n) => held.includes(n) })
        expect(readDrive(still)).toEqual({ throttle: 0, steer: 0, brake: 0 })
        expect(readDrive(keys("W", "D"))).toEqual({ throttle: 1, steer: 1, brake: 0 })
        expect(readDrive(keys("DownArrow", "LeftArrow", "Space"))).toEqual({ throttle: -1, steer: -1, brake: 1 })
        expect(readDrive({ ...still, pad: { stickX: -0.5, rightTrigger: 0.8, leftTrigger: 0, south: false } })).toEqual({ throttle: 0.8, steer: -0.5, brake: 0 })
        // The stick's y counts down the screen: up it is forward.
        expect(readDrive({ ...still, stick: { x: 0.25, y: -0.75, active: true } })).toEqual({ throttle: 0.75, steer: 0.25, brake: 0 })
    })

    it("lets a pad at rest add nothing, and holds what is added together to full", () => {
        expect(readDrive({ ...still, pad: { stickX: 0.08, rightTrigger: 0.05, leftTrigger: 0.1, south: false } })).toEqual({ throttle: 0, steer: 0, brake: 0 })
        const both: Controls = { key: (n) => n === "W", pad: { stickX: 0, rightTrigger: 1, leftTrigger: 0, south: false }, stick: { x: 0, y: -1, active: true } }
        expect(readDrive(both).throttle).toBe(1)
        // A stick let go of is not read, wherever it was left.
        expect(readDrive({ ...still, stick: { x: 1, y: -1, active: false } })).toEqual({ throttle: 0, steer: 0, brake: 0 })
    })
})

describe("chase", () => {
    it("settles behind the way the car faces in the same time at 60 Hz and 120 Hz", () => {
        const after = (hz: number) => {
            let cam: Vec3 = [0, 10, 0]
            for (let i = 0; i < hz / 2; i++) cam = chase(cam, [0, 0, 0], 90, 1 / hz).position
            return cam
        }
        const a = after(60), b = after(120)
        for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, 9)
        // Facing +x at yaw 90, so behind is -x.
        const settled = (() => { let cam: Vec3 = [0, 10, 0]; for (let i = 0; i < 600; i++) cam = chase(cam, [0, 0, 0], 90, 1 / 60).position; return cam })()
        expect(settled[0]).toBeCloseTo(-8, 3)
        expect(settled[1]).toBeCloseTo(3.5, 3)
        expect(settled[2]).toBeCloseTo(0, 3)
    })
})

describe("overturned", () => {
    it("is upright tipped a little, and over on its side or roof", () => {
        expect(overturned({ pitch: 0, roll: 0 })).toBe(false)
        expect(overturned({ pitch: 20, roll: -25 })).toBe(false)
        expect(overturned({ pitch: 0, roll: 90 })).toBe(true)
        expect(overturned({ pitch: 0, roll: 180 })).toBe(true)
        expect(overturned({ pitch: -75, roll: 0 })).toBe(true)
    })
})
