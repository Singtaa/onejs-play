/**
 * The 1.3.0 names that change how things move: drag, rotates, fast,
 * character.addVelocity, and characters riding what they stand on.
 */
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { RECAST_VERSION } from "../../nav/recast.version"
import { createWorld, type World, type Body } from "../world"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/recast-${RECAST_VERSION}.wasm`))))
})

const run = (w: World, steps: number) => { for (let i = 0; i < steps; i++) w.step() }
const speed = (v: readonly number[]) => Math.hypot(...v)

/** A floor 40 m square whose top is at y = 0. */
async function floored(): Promise<World> {
    const w = await createWorld()
    w.box({ at: [0, -0.5, 0], size: [40, 1, 40] })
    return w
}

/** The engine's own body, for what oj does not hand out: a spin to set or read. */
const raw = (b: Body) => (b as any).world.raw.getRigidBody((b as any).bodyHandle)

describe("drag", () => {
    it("slows a body in empty space, by about two thirds in a second at 1, and leaves one without it alone", async () => {
        const w = await createWorld({ gravity: [0, 0, 0] })
        const slowed = w.sphere({ dynamic: true, drag: 1, at: [0, 0, 0] })
        const free = w.sphere({ dynamic: true, at: [0, 0, 5] })
        slowed.velocity = [10, 0, 0]
        free.velocity = [10, 0, 0]
        run(w, 60)
        expect(speed(slowed.velocity)).toBeGreaterThan(3)
        expect(speed(slowed.velocity)).toBeLessThan(4.5)
        expect(speed(free.velocity)).toBeCloseTo(10, 3)
        w.dispose()
    })

    it("slows its spin by the same amount", async () => {
        const w = await createWorld({ gravity: [0, 0, 0] })
        const b = w.box({ dynamic: true, drag: 1 })
        raw(b).setAngvel({ x: 0, y: 6, z: 0 }, true)
        run(w, 60)
        const spin = raw(b).angvel().y
        expect(spin).toBeGreaterThan(1.8)
        expect(spin).toBeLessThan(2.7)
        w.dispose()
    })

    it("reads back and can be changed", async () => {
        const w = await createWorld({ gravity: [0, 0, 0] })
        const b = w.sphere({ dynamic: true })
        expect(b.drag).toBe(0)
        b.drag = 2
        expect(b.drag).toBe(2)
        b.velocity = [10, 0, 0]
        run(w, 60)
        expect(speed(b.velocity)).toBeLessThan(2)
        w.dispose()
    })
})

describe("rotates: false", () => {
    /** A box dropped on one corner's edge: free, it tips flat; locked, it stays tilted. */
    async function tipped(rotates: boolean | undefined) {
        const w = await floored()
        const b = w.box({ dynamic: true, at: [0, 1.2, 0], rotation: { roll: 30 }, rotates })
        run(w, 180)
        return { w, b }
    }

    it("keeps a body from turning, where a free one tips over", async () => {
        const free = await tipped(undefined)
        expect(Math.abs(free.b.rotation.roll)).toBeLessThan(2)
        free.w.dispose()
        const held = await tipped(false)
        expect(held.b.rotation.roll).toBeCloseTo(30, 3)
        expect(held.b.rotates).toBe(false)
        held.w.dispose()
    })

    it("turns again once it is set back to true", async () => {
        const { w, b } = await tipped(false)
        b.rotates = true
        run(w, 180)
        expect(Math.abs(b.rotation.roll)).toBeLessThan(2)
        w.dispose()
    })

    it("comes back with a rewind", async () => {
        const w = await floored()
        const b = w.box({ dynamic: true, at: [0, 1.2, 0], rotation: { roll: 30 }, rotates: false })
        const saved = w.snapshot()
        b.rotates = true
        w.restore(saved)
        expect(b.rotates).toBe(false)
        run(w, 180)
        expect(b.rotation.roll).toBeCloseTo(30, 3)
        w.dispose()
    })
})

describe("fast", () => {
    /** A 5 cm shot at 300 m/s, 5 m a step, at a 10 cm ball or a thin plate: where each ends. */
    async function shoot(target: "ball" | "door" | "wall", fast: boolean | undefined) {
        const w = await createWorld({ gravity: [0, 0, 0] })
        const t = target === "ball" ? w.sphere({ dynamic: true, at: [6, 0, 0], radius: 0.1 })
            : w.box({ at: [6, 0, 0], size: [0.05, 4, 4], kinematic: target === "door" })
        const shot = w.sphere({ dynamic: true, radius: 0.05, fast })
        shot.velocity = [300, 0, 0]
        run(w, 4)
        const out = { shot: shot.position[0], target: t.position[0] }
        w.dispose()
        return out
    }

    it("hits a moving body a shot would pass through between two steps", async () => {
        const missed = await shoot("ball", undefined)
        expect(missed.shot).toBeGreaterThan(15)
        expect(missed.target).toBe(6)
        const hit = await shoot("ball", true)
        expect(hit.target).toBeGreaterThan(6.5)
        expect((await shoot("door", undefined)).shot).toBeGreaterThan(15)
        expect((await shoot("door", true)).shot).toBeLessThan(6)
    })

    it("is not needed against a static wall, which stops a shot either way", async () => {
        expect((await shoot("wall", undefined)).shot).toBeLessThan(6)
    })
})

describe("character.addVelocity", () => {
    it("throws it up as a jump does", async () => {
        const w = await floored()
        const c = w.character({ at: [0, 0, 0] })
        run(w, 2)
        c.addVelocity([0, 5, 0])
        run(w, 15)
        expect(c.position[1]).toBeGreaterThan(0.5)
        expect(c.grounded).toBe(false)
        w.dispose()
    })

    it("shoves it along the ground, fading to a stop in about a fifth of a second", async () => {
        const w = await floored()
        const c = w.character({ at: [0, 0, 0] })
        run(w, 2)
        c.addVelocity([10, 0, 0])
        run(w, 3)
        expect(c.velocity[0]).toBeGreaterThan(5)
        run(w, 12)
        expect(Math.abs(c.velocity[0])).toBeLessThan(1)
        run(w, 30)
        expect(c.velocity[0]).toBe(0)
        // About the speed over the fade: 10 / 15 metres.
        expect(c.position[0]).toBeGreaterThan(0.5)
        expect(c.position[0]).toBeLessThan(0.8)
        w.dispose()
    })

    it("keeps the shove in the air", async () => {
        const w = await createWorld({ gravity: [0, -9.81, 0] })
        const c = w.character({ at: [0, 100, 0] })
        c.addVelocity([5, 0, 0])
        run(w, 30)
        expect(c.velocity[0]).toBeCloseTo(5, 2)
        w.dispose()
    })

    it("adds to its walk rather than replacing it, and a wall takes what runs into it", async () => {
        const w = await floored()
        w.box({ at: [1.5, 1, 0], size: [0.2, 2, 4] })
        const c = w.character({ at: [0, 0, 0] })
        c.walk([0, 0, 2])
        run(w, 2)
        c.addVelocity([20, 0, 0])
        run(w, 10)
        // Against the wall, still walking along it.
        expect(c.position[0]).toBeGreaterThan(1)
        expect(c.position[0]).toBeLessThan(1.4)
        expect(c.velocity[2]).toBeCloseTo(2, 1)
        // The wall took the shove: walking away does not fight it.
        c.walk([-2, 0, 0])
        run(w, 1)
        expect(c.velocity[0]).toBeLessThan(-1.9)
        w.dispose()
    })

    it("comes back mid-slide with a rewind", async () => {
        const w = await floored()
        const c = w.character({ at: [0, 0, 0] })
        run(w, 2)
        c.addVelocity([10, 0, 0])
        run(w, 2)
        const saved = w.snapshot()
        run(w, 10)
        const there = c.position
        w.restore(saved)
        run(w, 10)
        expect(c.position).toEqual(there)
        w.dispose()
    })
})

describe("riding", () => {
    /** A kinematic platform 4 m square whose top is at y = 0, with a character on it. */
    async function platform(at: [number, number, number] = [0, 0, 0]) {
        const w = await createWorld()
        const p = w.box({ kinematic: true, at: [at[0], at[1] - 0.25, at[2]], size: [4, 0.5, 4] })
        const c = w.character({ at })
        run(w, 2)
        return { w, p, c }
    }

    it("carries a character on a platform sliding sideways", async () => {
        const { w, p, c } = await platform()
        p.velocity = [2, 0, 0]
        run(w, 60)
        expect(c.position[0]).toBeCloseTo(p.position[0], 1)
        expect(c.position[0]).toBeGreaterThan(1.9)
        expect(c.grounded).toBe(true)
        w.dispose()
    })

    it("carries a character up on a lift, and down again, its feet on the floor of it every step", async () => {
        const { w, p, c } = await platform()
        let standing = 0, worst = 0
        for (const v of [3, -3]) {
            p.velocity = [0, v, 0]
            for (let i = 0; i < 60; i++) {
                w.step()
                if (c.grounded) standing++
                worst = Math.max(worst, Math.abs(c.position[1] - (p.position[1] + 0.25)))
            }
        }
        expect(worst).toBeLessThan(0.01)
        expect(standing).toBe(120)
        w.dispose()
    })

    it("goes round with a turntable", async () => {
        const w = await createWorld()
        const p = w.box({ kinematic: true, at: [0, -0.25, 0], size: [4, 0.5, 4] })
        const c = w.character({ at: [1.5, 0, 0] })
        run(w, 2)
        // A quarter turn over a second, by hand, as a cart turns a kinematic body.
        for (let i = 1; i <= 60; i++) {
            p.rotation = { yaw: (90 * i) / 60 }
            w.step()
        }
        expect(c.position[0]).toBeCloseTo(0, 1)
        expect(Math.abs(c.position[2])).toBeCloseTo(1.5, 1)
        w.dispose()
    })

    it("rides a dynamic body sliding on ice", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [40, 1, 40], friction: 0 })
        const raft = w.box({ dynamic: true, at: [0, 0.25, 0], size: [3, 0.5, 3], friction: 0 })
        const c = w.character({ at: [0, 0.5, 0] })
        run(w, 10)
        raft.velocity = [3, 0, 0]
        run(w, 30)
        expect(c.position[0]).toBeCloseTo(raft.position[0], 1)
        w.dispose()
    })

    it("is stopped by a ceiling the lift carries it into", async () => {
        const { w, p, c } = await platform()
        w.box({ at: [0, 3.5, 0], size: [4, 1, 4] })
        p.velocity = [0, 1, 0]
        run(w, 150)
        // The ceiling's underside is at 3 m: its head stays below it.
        expect(c.position[1] + c.height).toBeLessThan(3.05)
        w.dispose()
    })

    it("does not ride a static floor, and does not slide off the edge of a platform that stops", async () => {
        const { w, p, c } = await platform()
        p.velocity = [2, 0, 0]
        run(w, 30)
        p.velocity = [0, 0, 0]
        const x = c.position[0]
        run(w, 30)
        expect(c.position[0]).toBeCloseTo(x, 3)
        w.dispose()
    })

    it("rides the same after a rewind", async () => {
        const { w, p, c } = await platform()
        p.velocity = [2, 0, 1]
        run(w, 10)
        const saved = w.snapshot()
        run(w, 20)
        const there = c.position
        // Somewhere else, standing on nothing, before going back.
        c.teleport([10, 5, 10])
        run(w, 1)
        w.restore(saved)
        run(w, 20)
        expect(c.position).toEqual(there)
        w.dispose()
    })
})

describe("stepHeight's default, 0.4", () => {
    /** A ledge `h` high across the way, long enough to stand on. */
    async function ledge(h: number) {
        const w = await floored()
        w.box({ at: [0, h / 2, 12], size: [6, h, 20] })
        return w
    }

    it("walks a character and a slide up a 0.35 m kerb, and stops both at 0.45 m", async () => {
        for (const [h, up] of [[0.35, true], [0.45, false]] as const) {
            const w = await ledge(h)
            const c = w.character({ at: [0, 0, 0] })
            c.walk([0, 0, 3])
            run(w, 120)
            expect(c.position[1] > h - 0.05).toBe(up)
            let at: [number, number, number] = [0, 0, 0]
            for (let i = 0; i < 120; i++) at = w.slide(at, [0, 0, 0.05]).at as [number, number, number]
            expect(at[1] > h - 0.05).toBe(up)
            w.dispose()
        }
    })

    it("is nav's too, so a path goes up what a character can climb and round what it cannot", async () => {
        for (const [h, up] of [[0.35, true], [0.45, false]] as const) {
            const w = await ledge(h)
            const nav = await w.nav()
            const pts = nav.path([0, 0, 0], [0, h, 12])
            const end = pts[pts.length - 1]
            expect(end !== undefined && Math.abs(end[1] - h) < 0.1 && Math.abs(end[2] - 12) < 0.5).toBe(up)
            nav.dispose()
            w.dispose()
        }
    })
})
