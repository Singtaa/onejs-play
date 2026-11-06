import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { createWorld, shape, type World, type Body, type Character } from "../world"
import { setActorPlacer, type ActorPlacement } from "../actors"
import { toQuat, fromQuat } from "../rotation"
import type { Vec3 } from "../../models"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

const near = (a: readonly number[], b: readonly number[], eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]!) < eps)
const run = (w: World, steps: number) => { for (let i = 0; i < steps; i++) w.step() }

/** A floor 20 m square whose top is at y = 0. */
async function floored(): Promise<World> {
    const w = await createWorld()
    w.box({ at: [0, -0.5, 0], size: [20, 1, 20], layer: "floor" })
    return w
}

describe("bodies", () => {
    it("are static unless asked: a dynamic box falls and comes to rest on a static floor", async () => {
        const w = await floored()
        const crate = w.box({ at: [0, 3, 0], dynamic: true })
        run(w, 180)
        expect(crate.position[1]).toBeCloseTo(0.5, 1)
        expect(Math.abs(crate.velocity[1])).toBeLessThan(0.05)
        expect(w.bodies.length).toBe(2)
        w.dispose()
    })

    it("push is an impulse: 5 kg m/s on a 1 kg box is 5 m/s", async () => {
        const w = await createWorld({ gravity: [0, 0, 0] })
        const b = w.box({ dynamic: true, mass: 1 })
        b.push([5, 0, 0])
        expect(b.velocity[0]).toBeCloseTo(5, 3)
        w.dispose()
    })

    it("weighs what its size and density say: wood by default", async () => {
        const w = await createWorld()
        expect(w.box({ dynamic: true }).mass).toBeCloseTo(500, 3)
        expect(w.box({ dynamic: true, size: [0.5, 0.5, 0.5] }).mass).toBeCloseTo(62.5, 3)
        expect(w.box({ dynamic: true, density: 1000 }).mass).toBeCloseTo(1000, 3)
        expect(w.box({ dynamic: true, density: 1000, mass: 3 }).mass).toBeCloseTo(3, 3)
        w.dispose()
    })

    it("addVelocity changes speed whatever the mass; push does not", async () => {
        const w = await createWorld({ gravity: [0, 0, 0] })
        const light = w.box({ dynamic: true, size: [0.2, 0.2, 0.2] }), heavy = w.box({ dynamic: true, at: [3, 0, 0], size: [2, 2, 2] })
        light.addVelocity([0, 5, 0]); heavy.addVelocity([0, 5, 0])
        expect(light.velocity[1]).toBeCloseTo(5, 3)
        expect(heavy.velocity[1]).toBeCloseTo(5, 3)
        heavy.addVelocity([1, 0, 0])
        expect(near(heavy.velocity, [1, 5, 0])).toBe(true)
        heavy.push([4000, 0, 0])
        expect(heavy.velocity[0]).toBeCloseTo(2, 3)
        w.dispose()
    })

    it("passes through a layer it ignores, which queries still see", async () => {
        const w = await createWorld({ gravity: [0, 0, 0] })
        w.box({ at: [0, 0, 3], size: [4, 4, 0.5], layer: "glass" })
        const ghost = w.sphere({ radius: 0.2, dynamic: true, ignores: ["glass"] })
        const ball = w.sphere({ at: [1, 0, 0], radius: 0.2, dynamic: true })
        ghost.velocity = [0, 0, 5]; ball.velocity = [0, 0, 5]
        run(w, 90)
        expect(ghost.position[2]).toBeGreaterThan(5)
        expect(ball.position[2]).toBeLessThan(3)
        expect(w.raycast([0, 0, 0], [0, 0, 10])!.body!.layer).toBe("glass")
        w.dispose()
    })

    it("a destroyed body says so and leaves the world", async () => {
        const w = await floored()
        const b = w.sphere({ at: [0, 2, 0], dynamic: true })
        b.destroy()
        expect(b.alive).toBe(false)
        expect(w.bodies.length).toBe(1)
        expect(() => b.position).toThrow(/destroyed/)
        w.dispose()
    })

    it("turns as an Actor does: yaw 90 faces +x", async () => {
        const q = toQuat({ yaw: 90 })
        // +z rotated by q
        const v = rotate(q, [0, 0, 1])
        expect(near(v, [1, 0, 0])).toBe(true)
        expect(fromQuat(toQuat({ yaw: 30, pitch: 20, roll: -10 }))).toEqual({ yaw: 30, pitch: 20, roll: -10 })
        const w = await createWorld()
        const b = w.box({ rotation: { yaw: 45 } })
        expect(b.rotation.yaw).toBeCloseTo(45, 4)
        w.dispose()
    })
})

describe("queries", () => {
    it("raycast: the first thing on the line, with point, normal, distance and body", async () => {
        const w = await floored()
        const wall = w.box({ at: [0, 1, 5], size: [4, 2, 1], layer: "wall", tag: "north" })
        const hit = w.raycast([0, 1, 0], [0, 1, 10])!
        expect(hit.body).toBe(wall)
        expect((hit.body as Body).tag).toBe("north")
        expect(hit.distance).toBeCloseTo(4.5, 4)
        expect(near(hit.point, [0, 1, 4.5])).toBe(true)
        expect(near(hit.normal, [0, 0, -1])).toBe(true)
        expect(w.raycast([0, 1, 0], [0, 1, 3])).toBeNull()
        w.dispose()
    })

    it("sees a body where it was teleported, before and after the next step", async () => {
        const w = await floored()
        const crate = w.box({ at: [0, 1, 3], layer: "crate" })
        w.step()
        crate.position = [0, 1, 6]
        expect(w.raycast([0, 1, 0], [0, 1, 10])!.distance).toBeCloseTo(5.5, 4)
        w.step()
        expect(w.raycast([0, 1, 0], [0, 1, 10])!.distance).toBeCloseTo(5.5, 4)
        expect(w.raycast([0, 1, 0], [0, 1, 4])).toBeNull()
        w.dispose()
    })

    it("rays and sweeps pass through triggers; overlap finds them", async () => {
        const w = await floored()
        const zone = w.box({ at: [0, 1, 3], size: [4, 2, 1], trigger: true })
        expect(w.raycast([0, 1, 0], [0, 1, 10])).toBeNull()
        expect(w.sweep(shape.sphere({ radius: 0.2 }), [0, 1, 0], [0, 1, 10])).toBeNull()
        expect(w.overlap(shape.sphere({ radius: 0.5 }), [0, 1, 3])).toEqual([zone])
        w.step()
        expect(w.raycast([0, 1, 0], [0, 1, 10])).toBeNull()
        expect(w.overlap(shape.sphere({ radius: 0.5 }), [0, 1, 3])).toEqual([zone])
        w.dispose()
    })

    it("only and skip choose what a query sees", async () => {
        const w = await floored()
        const crate = w.box({ at: [0, 1, 3], layer: "crate" })
        const wall = w.box({ at: [0, 1, 6], size: [4, 2, 1], layer: "wall" })
        expect(w.raycast([0, 1, 0], [0, 1, 10])!.body).toBe(crate)
        expect(w.raycast([0, 1, 0], [0, 1, 10], { only: ["wall"] })!.body).toBe(wall)
        expect(w.raycast([0, 1, 0], [0, 1, 10], { skip: ["crate"] })!.body).toBe(wall)
        expect(w.raycast([0, 1, 0], [0, 1, 10], { skip: [crate] })!.body).toBe(wall)
        expect(w.raycast([0, 1, 0], [0, 1, 10], { only: ["nothing"] })).toBeNull()
        expect(w.canSee([0, 1, 0], [0, 1, 10], { only: ["wall"] })).toBe(false)
        expect(w.canSee([0, 1, 0], [0, 1, 4], { only: ["wall"] })).toBe(true)
        w.dispose()
    })

    it("sweep: a fat ray stops its radius short of the wall", async () => {
        const w = await floored()
        w.box({ at: [0, 1, 5], size: [4, 2, 1], layer: "wall" })
        const hit = w.sweep(shape.sphere({ radius: 0.25 }), [0, 1, 0], [0, 1, 10], { only: ["wall"] })!
        expect(hit.distance).toBeCloseTo(4.25, 3)
        expect(w.sweep(shape.sphere({ radius: 0.25 }), [3, 1, 0], [3, 1, 10], { only: ["wall"] })).toBeNull()
        w.dispose()
    })

    it("overlap: every body a shape placed there touches", async () => {
        const w = await floored()
        const a = w.sphere({ at: [1, 0.5, 0], radius: 0.5, layer: "player" })
        const b = w.sphere({ at: [-1, 0.5, 0], radius: 0.5, layer: "player" })
        w.sphere({ at: [9, 0.5, 0], radius: 0.5, layer: "player" })
        const found = w.overlap(shape.sphere({ radius: 1 }), [0, 0.5, 0], { only: ["player"] })
        expect(new Set(found)).toEqual(new Set([a, b]))
        w.dispose()
    })

    it("clearSpot: null when nowhere within reach is clear", async () => {
        const w = await floored()
        w.box({ at: [0, 1, 0], size: [8, 2, 8], layer: "wall" })
        const capsule = shape.capsule({ radius: 0.3, height: 1.6 })
        expect(w.clearSpot(capsule, [0, 1, 0], { only: ["wall"], within: 2 })).toBeNull()
        const far = w.clearSpot(capsule, [0, 1, 0], { only: ["wall"], within: 6 })!
        expect(Math.max(Math.abs(far[0]), Math.abs(far[2]))).toBeGreaterThanOrEqual(4.3 - 1e-6)
        w.dispose()
    })

    it("canSee a body: looks at its middle, and the body does not hide itself", async () => {
        const w = await floored()
        const me = w.character({ at: [0, 0, 0], layer: "player" })
        const enemy = w.character({ at: [0, 0, 8], layer: "player" })
        const crate = w.box({ at: [5, 0.5, 8], layer: "crate" })
        expect(w.canSee([0, 1.5, 0], enemy, { skip: [me] })).toBe(true)
        expect(w.canSee([0, 1.5, 0], crate, { skip: [me] })).toBe(true)
        // Its far side is not hidden by its near side, and a wall in between hides it.
        w.box({ at: [0, 1, 4], size: [2, 2, 0.2], layer: "wall" })
        expect(w.canSee([0, 1.5, 0], enemy, { skip: [me] })).toBe(false)
        expect(w.canSee([0, 1.5, 0], crate, { skip: [me] })).toBe(true)
        w.dispose()
    })

    it("clearSpot: the nearest place a shape fits, out of a box it was dropped in", async () => {
        const w = await floored()
        w.box({ at: [0, 1, 0], size: [2, 2, 2], layer: "wall" })
        const capsule = shape.capsule({ radius: 0.3, height: 1.6 })
        const spot = w.clearSpot(capsule, [0.2, 1, 0], { only: ["wall"] })!
        expect(Math.max(Math.abs(spot[0]), Math.abs(spot[2]))).toBeGreaterThanOrEqual(1.3 - 1e-6)
        expect(w.overlap(capsule, spot, { only: ["wall"] })).toEqual([])
        expect(w.clearSpot(capsule, [5, 1, 5], { only: ["wall"] })).toEqual([5, 1, 5])
        w.dispose()
    })
})

describe("a character", () => {
    async function walking(): Promise<{ w: World, me: Character }> {
        const w = await floored()
        const me = w.character({ at: [0, 0, 0], radius: 0.3, height: 1.6, layer: "player" })
        return { w, me }
    }
    const walk = (w: World, me: Character, dir: Vec3, steps: number, speed = 4) => {
        me.walk([dir[0] * speed, 0, dir[2] * speed])
        run(w, steps)
        me.walk([0, 0, 0])
    }

    it("bumps into another character, and walks through one on a layer it ignores", async () => {
        const w = await floored()
        const a = w.character({ at: [0, 0, 0], layer: "fighter" })
        w.character({ at: [0, 0, 1.5], layer: "fighter" })
        run(w, 2)
        walk(w, a, [0, 0, 1], 60)
        expect(a.position[2]).toBeLessThan(1.5 - 0.6 + 0.05)

        const b = w.character({ at: [3, 0, 0], layer: "fighter", ignores: ["fighter"] })
        w.character({ at: [3, 0, 1.5], layer: "fighter" })
        run(w, 2)
        walk(w, b, [0, 0, 1], 60)
        expect(b.position[2]).toBeGreaterThan(3.5)
        expect(b.grounded).toBe(true)
    })

    it("is stopped by a dynamic crate as by a wall, and is not moved by one landing on it", async () => {
        const { w, me } = await walking()
        run(w, 2)
        const crate = w.box({ at: [0, 0.25, 2], size: [0.5, 0.5, 0.5], dynamic: true })
        run(w, 30)
        const crateAt = crate.position
        walk(w, me, [0, 0, 1], 60)
        expect(me.position[2]).toBeLessThan(2 - 0.25 - 0.3 + 0.05)
        expect(near(crate.position, crateAt, 0.02)).toBe(true)

        const before = me.position
        w.box({ at: [before[0], 3, before[2]], size: [0.5, 0.5, 0.5], dynamic: true })
        run(w, 90)
        expect(near(me.position, before, 0.02)).toBe(true)
    })

    it("stands on the floor", async () => {
        const { w, me } = await walking()
        walk(w, me, [0, 0, 0], 30)
        expect(me.grounded).toBe(true)
        expect(me.position[1]).toBeCloseTo(0, 1)
        w.dispose()
    })

    it("slides along a wall it walks into at an angle, rather than stopping", async () => {
        const { w, me } = await walking()
        w.box({ at: [0, 1, 2], size: [20, 2, 1], layer: "wall" })
        walk(w, me, [Math.SQRT1_2, 0, Math.SQRT1_2], 90)
        const p = me.position
        expect(p[2]).toBeLessThan(1.5 - 0.3 + 0.05)
        expect(p[2]).toBeGreaterThan(1.0)
        expect(p[0]).toBeGreaterThan(3)
        w.dispose()
    })

    it("walks up a step lower than `stepHeight`, and not up one higher", async () => {
        const low = await walking()
        low.w.box({ at: [0, 0.1, 3], size: [4, 0.2, 2], layer: "step" })
        walk(low.w, low.me, [0, 0, 1], 60)
        expect(low.me.position[2]).toBeGreaterThan(2.5)
        expect(low.me.position[1]).toBeCloseTo(0.2, 1)
        low.w.dispose()

        const high = await walking()
        high.w.box({ at: [0, 0.3, 3], size: [4, 0.6, 2], layer: "step" })
        walk(high.w, high.me, [0, 0, 1], 60)
        expect(high.me.position[2]).toBeLessThan(2)
        high.w.dispose()
    })

    it("climbs nothing with stepHeight 0, not even a ledge it would otherwise walk up", async () => {
        const w = await floored()
        const me = w.character({ at: [0, 0, 0], stepHeight: 0 })
        // Off, not set to zero: a zero-height autostep still pays for its casts.
        expect((me as any).controller.autostepEnabled()).toBe(false)
        expect((w.character({ at: [5, 0, 0] }) as any).controller.autostepEnabled()).toBe(true)
        w.box({ at: [0, 0.1, 3], size: [4, 0.2, 2], layer: "step" })
        run(w, 2)
        walk(w, me, [0, 0, 1], 60, 1)
        expect(me.position[2]).toBeLessThan(2)
        expect(me.position[1]).toBeCloseTo(0, 2)
        w.dispose()
    })

    it("falls off an edge", async () => {
        const { w, me } = await walking()
        walk(w, me, [1, 0, 0], 200, 6)
        expect(me.position[0]).toBeGreaterThan(10)
        expect(me.position[1]).toBeLessThan(-2)
        expect(me.grounded).toBe(false)
        w.dispose()
    })

    it("covers the whole distance across open floor", async () => {
        const { w, me } = await walking()
        run(w, 2)
        walk(w, me, [1, 0, 0], 120)
        expect(me.position[0]).toBeCloseTo(8, 1)
        w.dispose()
    })

    it("walks at its speed whatever the frame rate, since it moves in the world's own steps", async () => {
        const distance = async (frameSeconds: number) => {
            const { w, me } = await walking()
            run(w, 2)
            me.walk([4, 0, 0])
            const stepped = w as unknown as { advance(s: number): number }
            for (let t = 0; t < 2 - 1e-9; t += frameSeconds) stepped.advance(frameSeconds)
            const x = me.position[0]
            w.dispose()
            return x
        }
        const at30 = await distance(1 / 30), at144 = await distance(1 / 144)
        expect(at30).toBeCloseTo(8, 1)
        expect(Math.abs(at30 - at144)).toBeLessThan(4 / 60 + 1e-6)
    })

    it("reports how it moved, and jumps as high as asked", async () => {
        const { w, me } = await walking()
        run(w, 2)
        me.walk([3, 0, 0])
        run(w, 10)
        expect(near(me.velocity, [3, 0, 0], 0.01)).toBe(true)
        me.walk([0, 0, 0])
        me.jump(1.2)
        let peak = 0
        for (let i = 0; i < 120; i++) { w.step(); peak = Math.max(peak, me.position[1]) }
        expect(peak).toBeGreaterThan(1.2 * 0.95)
        expect(peak).toBeLessThan(1.2 * 1.05)
        expect(me.grounded).toBe(true)
        expect(me.position[1]).toBeCloseTo(0, 1)
        w.dispose()
    })

    it("stops rising when its head meets a ceiling", async () => {
        const { w, me } = await walking()
        w.box({ at: [0, 2.5, 0], size: [4, 1, 4], layer: "ceiling" })
        run(w, 2)
        me.jump(3)
        let peak = 0
        for (let i = 0; i < 90; i++) { w.step(); peak = Math.max(peak, me.position[1]) }
        expect(peak).toBeLessThan(2 - 1.6 + 0.05)
        expect(me.grounded).toBe(true)
        w.dispose()
    })

    it("pressed 10 degrees into a wall, travels its whole face", async () => {
        const { w, me } = await walking()
        w.box({ at: [0, 1, 3], size: [40, 2, 1], layer: "wall" })
        me.teleport([-8, 0, 2.5 - 0.3 - 0.05])
        run(w, 2)
        const a = (10 * Math.PI) / 180
        walk(w, me, [Math.cos(a), 0, Math.sin(a)], 240)
        expect(me.position[0]).toBeGreaterThan(-8 + 16 * Math.cos(a) - 0.3)
        w.dispose()
    })

    it("teleport onto open floor lands exactly there, feet on the floor, and walks off at once", async () => {
        const { w, me } = await walking()
        me.teleport([-4, 0, 3])
        expect(near(me.position, [-4, 0, 3])).toBe(true)
        expect(me.grounded).toBe(true)
        walk(w, me, [1, 0, 0], 1, 6)
        expect(near(me.position, [-3.9, 0, 3], 0.02)).toBe(true)
        w.dispose()
    })

    it("teleport goes exactly where asked, and clearSpot is what finds room", async () => {
        const { w, me } = await walking()
        w.box({ at: [5, 1, 5], size: [2, 2, 2], layer: "wall" })
        me.teleport([5, 0, 5])
        expect(near(me.position, [5, 0, 5])).toBe(true)
        const spot = w.clearSpot(shape.capsule({ radius: 0.3, height: 1.6 }), [5, 0.81, 5], { only: ["wall"] })!
        expect(Math.max(Math.abs(spot[0] - 5), Math.abs(spot[2] - 5))).toBeGreaterThanOrEqual(1.3 - 1e-6)
        w.dispose()
    })

    it("hears what it walks into, once a touch", async () => {
        const { w, me } = await walking()
        const wall = w.box({ at: [0, 1, 2], size: [20, 2, 1], layer: "wall" })
        const mine: unknown[] = [], walls: unknown[] = []
        me.onTouch((other) => mine.push(other))
        wall.onTouch((other) => walls.push(other))
        walk(w, me, [0, 0, 1], 90)
        expect(mine.filter((o) => o === wall).length).toBe(1)
        expect(walls).toEqual([me])
        w.dispose()
    })

    it("feels how hard it walked into something, and when it walks away", async () => {
        const { w, me } = await walking()
        const wall = w.box({ at: [0, 1, 2], size: [20, 2, 1], layer: "wall" })
        const speeds: number[] = [], ended: unknown[] = []
        me.onTouch((other, c) => { if (other === wall) speeds.push(c.speed) })
        me.onTouchEnd((other) => ended.push(other))
        run(w, 2)
        walk(w, me, [0, 0, 1], 60, 4)
        expect(speeds.length).toBe(1)
        expect(speeds[0]).toBeCloseTo(4, 0)
        expect(ended).toEqual([])
        walk(w, me, [0, 0, -1], 30, 4)
        expect(ended).toEqual([wall])
        w.dispose()
    })
})

describe("slide", () => {
    it("moves a walker it does not keep: along a wall, up a step, standing", async () => {
        const w = await floored()
        w.box({ at: [0, 1, 2], size: [20, 2, 1], layer: "wall" })
        w.box({ at: [0, 0.1, -3], size: [4, 0.2, 2], layer: "step" })
        w.step()
        const along = w.slide([0, 0, 1], [0.5, 0, 0.5])
        expect(along.at[0]).toBeCloseTo(0.5, 2)
        expect(along.at[2]).toBeLessThan(1.5 - 0.3 + 0.02)
        expect(along.grounded).toBe(true)
        const up = w.slide([0, 0, -1.6], [0, 0, -0.5])
        expect(up.at[1]).toBeCloseTo(0.2, 1)
        expect(w.bodies.length).toBe(3)
        expect(w.raycast([0, 1, -10], [0, 1, 10], { skip: ["wall"] })).toBeNull()
        w.dispose()
    })

    it("covers the whole distance when a game moves it from where it says, every frame", async () => {
        const w = await floored()
        w.step()
        let at: Vec3 = [-8, 0, -4]
        for (let i = 0; i < 120; i++) at = w.slide(at, [4 / 60 * Math.SQRT1_2, 0, 4 / 60 * Math.SQRT1_2]).at
        expect(Math.hypot(at[0] + 8, at[2] + 4)).toBeCloseTo(8, 1)
        expect(at[1]).toBeCloseTo(0, 2)
        w.dispose()
    })

    it("takes a filter, and its own size", async () => {
        const w = await floored()
        w.box({ at: [0, 1, 2], size: [20, 2, 1], layer: "wall" })
        w.step()
        expect(w.slide([0, 0, 0], [0, 0, 4], { skip: ["wall"] }).at[2]).toBeCloseTo(4, 2)
        expect(w.slide([0, 0, 0], [0, 0, 4], { radius: 0.5 }).at[2]).toBeLessThan(1.5 - 0.5 + 0.02)
        w.dispose()
    })

    it("survives a restore", async () => {
        const w = await floored()
        w.step()
        const snap = w.snapshot()
        w.slide([0, 0, 0], [1, 0, 0])
        w.restore(snap)
        expect(w.slide([0, 0, 0], [1, 0, 0]).at[0]).toBeCloseTo(1, 2)
        w.dispose()
    })
})

describe("events", () => {
    it("onTouch: a box landing on the floor, once", async () => {
        const w = await floored()
        const crate = w.box({ at: [0, 2, 0], dynamic: true, layer: "crate" })
        const touches: { other: unknown, point: Vec3 | null }[] = []
        crate.onTouch((other, c) => touches.push({ other, point: c.point }))
        run(w, 120)
        expect(touches.length).toBe(1)
        expect((touches[0]!.other as Body).layer).toBe("floor")
        expect(touches[0]!.point![1]).toBeCloseTo(0, 1)
        w.dispose()
    })

    it("says how hard a hit was, and when a touch ends", async () => {
        const w = await floored()
        // Dropped 5 m: it meets the floor at the square root of 2 g h.
        const crate = w.box({ at: [0, 5.5, 0], dynamic: true })
        const speeds: number[] = [], ended: unknown[] = []
        crate.onTouch((_, c) => speeds.push(c.speed))
        crate.onTouchEnd((other) => ended.push(other))
        run(w, 120)
        expect(speeds.length).toBe(1)
        expect(speeds[0]).toBeGreaterThan(Math.sqrt(2 * 9.81 * 5) * 0.85)
        expect(speeds[0]).toBeLessThan(Math.sqrt(2 * 9.81 * 5) * 1.15)
        expect(ended).toEqual([])
        crate.addVelocity([0, 6, 0])
        run(w, 10)
        expect(ended.length).toBe(1)
        expect((ended[0] as Body).layer).toBe("floor")
        w.dispose()
    })

    it("a gentle touch is a slow one: a 10 cm drop lands at 1.4 m/s", async () => {
        const w = await floored()
        const crate = w.box({ at: [0, 0.6, 0], dynamic: true })
        const speeds: number[] = []
        crate.onTouch((_, c) => speeds.push(c.speed))
        run(w, 60)
        expect(speeds.length).toBe(1)
        expect(speeds[0]).toBeGreaterThan(Math.sqrt(2 * 9.81 * 0.1) * 0.75)
        expect(speeds[0]).toBeLessThan(Math.sqrt(2 * 9.81 * 0.1) * 1.25)
        w.dispose()
    })

    it("a trigger hears a ball come in and leave, and never stops it", async () => {
        const w = await createWorld({ gravity: [0, 0, 0] })
        const zone = w.box({ at: [0, 0, 5], size: [4, 4, 2], trigger: true })
        const ball = w.sphere({ at: [0, 0, 0], radius: 0.2, dynamic: true })
        ball.velocity = [0, 0, 10]
        const heard: string[] = []
        zone.onEnter((o) => heard.push(o === ball ? "enter" : "?"))
        zone.onLeave((o) => heard.push(o === ball ? "leave" : "?"))
        run(w, 90)
        expect(heard).toEqual(["enter", "leave"])
        expect(ball.position[2]).toBeGreaterThan(10)
        w.dispose()
    })

    it("a trigger hears a character walk in", async () => {
        const w = await floored()
        const pad = w.box({ at: [0, 0.5, 3], size: [2, 1, 2], trigger: true })
        const me = w.character({ at: [0, 0, 0] })
        let entered: unknown = null
        pad.onEnter((o) => { entered = o })
        me.walk([0, 0, 4])
        run(w, 60)
        expect(entered).toBe(me)
        w.dispose()
    })
})

describe("shapes outside any world, and rewind", () => {
    it("a capsule standing where a body was 80 ms ago answers a ray", async () => {
        await createWorld()
        const body = shape.capsule({ radius: 0.32, height: 1.6 })
        const hit = body.raycast([-5, 1, 0], [5, 1, 0], { at: [2, 0.8, 0] })!
        expect(hit.distance).toBeCloseTo(5 + 2 - 0.32, 4)
        expect(hit.body).toBeNull()
        expect(body.raycast([-5, 1, 3], [5, 1, 3], { at: [2, 0.8, 0] })).toBeNull()
    })

    it("firstTouch: two moving shapes meet at the exact time", async () => {
        await createWorld()
        // A shot at 20 m/s along +x from x = 0, a body walking toward it at 2 m/s from x = 11.
        // Centres close at 22 m/s; they touch when 11 - 22t = 0.32 + 0.06.
        const t = shape.sphere({ radius: 0.06 }).firstTouch(shape.capsule({ radius: 0.32, height: 1.6 }), {
            at: [0, 1, 0], velocity: [20, 0, 0],
            otherAt: [11, 0.8, 0], otherVelocity: [-2, 0, 0],
            within: 1,
        })!
        expect(t).toBeCloseTo((11 - 0.38) / 22, 4)
        expect(shape.sphere({ radius: 0.06 }).firstTouch(shape.capsule({ radius: 0.32, height: 1.6 }), {
            at: [0, 1, 0], velocity: [20, 0, 0], otherAt: [11, 0.8, 0], within: 0.3,
        })).toBeNull()
        expect(shape.sphere({ radius: 1 }).overlaps(shape.box({ size: [1, 1, 1] }), { otherAt: [1.2, 0, 0] })).toBe(true)
        expect(shape.sphere({ radius: 1 }).overlaps(shape.box({ size: [1, 1, 1] }), { at: [0, 0, 0], otherAt: [1.6, 0, 0] })).toBe(false)
    })

    it("restore rewinds every body, and a body made since is gone", async () => {
        const w = await floored()
        const crate = w.box({ at: [0, 5, 0], dynamic: true })
        const me = w.character({ at: [3, 0, 0] })
        run(w, 10)
        const snap = w.snapshot()
        const then = crate.position, meThen = me.position
        run(w, 60)
        const later = w.sphere({ at: [0, 9, 0], dynamic: true })
        expect(crate.position[1]).toBeLessThan(then[1] - 1)
        w.restore(snap)
        expect(crate.position).toEqual(then)
        expect(near(me.position, meThen)).toBe(true)
        expect(later.alive).toBe(false)
        expect(w.bodies.length).toBe(3)
        // And it keeps running from there, the character included.
        me.walk([6, 0, 0])
        run(w, 60)
        expect(me.position[0]).toBeGreaterThan(meThen[0] + 5)
        expect(crate.position[1]).toBeLessThan(then[1] - 1)
        w.dispose()
    })

    it("a body destroyed since the snapshot comes back, behind the same handle", async () => {
        const w = await floored()
        const a = w.box({ at: [0, 5, 0], dynamic: true, tag: "coin" })
        const touched: unknown[] = []
        a.onTouch((other) => touched.push(other))
        const snap = w.snapshot()
        a.destroy()
        expect(a.alive).toBe(false)
        w.restore(snap)
        expect(a.alive).toBe(true)
        expect(a.tag).toBe("coin")
        expect(near(a.position, [0, 5, 0])).toBe(true)
        expect(w.bodies).toContain(a)
        run(w, 120)
        expect(a.position[1]).toBeLessThan(0.6)
        expect(touched.length).toBe(1)
        w.dispose()
    })

    it("a body made since the snapshot is destroyed by restore, and a character comes back walking", async () => {
        const w = await floored()
        const me = w.character({ at: [0, 0, 0] })
        run(w, 2)
        const snap = w.snapshot()
        const later = w.box({ at: [3, 1, 0] })
        me.destroy()
        w.restore(snap)
        expect(later.alive).toBe(false)
        expect(me.alive).toBe(true)
        me.walk([0, 0, 2])
        run(w, 30)
        expect(me.position[2]).toBeGreaterThan(0.9)
        w.dispose()
    })

    it("rewinds a character mid-jump, held walk and all, and it lands where it did", async () => {
        const w = await floored()
        const me = w.character({ at: [0, 0, 0] })
        run(w, 2)
        me.walk([2, 0, 0])
        me.jump(1)
        run(w, 10)
        const snap = w.snapshot()
        run(w, 60)
        const landed = me.position
        me.walk([0, 0, -3])
        run(w, 20)
        w.restore(snap)
        run(w, 60)
        expect(me.position).toEqual(landed)
        w.dispose()
    })

    it("refuses bytes that are not a snapshot", async () => {
        const w = await createWorld()
        expect(() => w.restore(new Uint8Array([1, 2, 3]))).toThrow(/not one this world made/)
        w.dispose()
    })

    it("the same steps give the same numbers", async () => {
        const once = async () => {
            const w = await floored()
            const boxes = Array.from({ length: 20 }, (_, i) => w.box({ at: [(i % 5) * 1.1 - 2, 1 + Math.floor(i / 5) * 1.1, 0.01 * i], dynamic: true }))
            run(w, 120)
            const out = boxes.flatMap((b) => [...b.position, ...Object.values(b.rotation)])
            w.dispose()
            return out
        }
        expect(await once()).toEqual(await once())
    })
})

describe("the world", () => {
    it("names its 17th layer when it runs out", async () => {
        const w = await createWorld()
        for (let i = 0; i < 16; i++) w.box({ layer: `l${i}` })
        expect(() => w.box({ layer: "one too many" })).toThrow(/16 layers; "one too many" would be the 17th/)
        w.dispose()
    })

    it("advance steps in whole fixed steps, and catches up no more than four", async () => {
        const w = await createWorld()
        expect((w as any).advance(1 / 60)).toBe(1)
        expect((w as any).advance(1 / 120)).toBe(0)
        expect((w as any).advance(1 / 120)).toBe(1)
        expect((w as any).advance(2)).toBe(4)
        expect(w.steps).toBe(6)
        w.dispose()
    })

    it("moves every body's actor in one batch a sync, and leaves a character's facing to the game", async () => {
        const batches: ActorPlacement[][] = []
        setActorPlacer((list) => { batches.push([...list]) })
        try {
            const w = await floored()
            const a = {} as any, b = {} as any, c = {} as any
            const crate = w.box({ at: [0, 3, 0], dynamic: true, actor: a })
            w.box({ at: [2, 3, 0], dynamic: true, actor: b })
            const me = w.character({ at: [4, 0, 0], actor: c })
            w.box({ at: [6, 3, 0], dynamic: true })
            expect(batches.length).toBe(3)
            run(w, 30)
            batches.length = 0
            ;(w as any).syncActors()
            expect(batches.length).toBe(1)
            expect(batches[0]!.map((p) => p.actor)).toEqual([a, b, c])
            expect(batches[0]![0]!.at).toEqual(crate.position)
            expect(batches[0]![2]!.rotation).toBeNull()
            expect(batches[0]![2]!.at).toEqual(me.position)
            w.dispose()
        } finally {
            setActorPlacer((list) => { for (const p of list) p.actor.position = p.at })
        }
    })

    it("refuses work once disposed", async () => {
        const w = await createWorld()
        w.dispose()
        expect(() => w.box()).toThrow(/disposed/)
    })
})

function rotate(q: { x: number, y: number, z: number, w: number }, v: Vec3): Vec3 {
    const { x, y, z, w } = q
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
}

describe("what the cold review asked of behaviour", () => {
    it("destroying a body destroys its actor with it", async () => {
        const w = await floored()
        let gone = 0
        const actor = { destroy: () => { gone++ } } as any
        const b = w.box({ at: [0, 1, 0], actor })
        b.destroy()
        expect(gone).toBe(1)
        expect(b.actor).toBeNull()
        w.dispose()
    })

    it("the larger bounce of two bodies wins, so a ball bounces off a dead floor", async () => {
        const w = await floored()
        const ball = w.sphere({ at: [0, 3, 0], radius: 0.25, dynamic: true, bounce: 0.9 })
        let peak = 0, landed = false
        for (let i = 0; i < 240; i++) {
            w.step()
            const y = ball.position[1]
            if (y < 0.3) landed = true
            if (landed) peak = Math.max(peak, y)
        }
        expect(peak).toBeGreaterThan(1.5)
        w.dispose()
    })

    it("says once when a filter names a layer no body has been on, and matches nothing", async () => {
        const w = await floored()
        w.box({ at: [0, 1, 2], size: [4, 2, 0.5], layer: "wall" })
        run(w, 1)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(w.raycast([0, 1, 0], [0, 1, 5], { only: ["walls"] })).toBeNull()
        expect(w.raycast([0, 1, 0], [0, 1, 5], { only: ["walls"] })).toBeNull()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(String(warn.mock.calls[0]![0])).toContain("walls")
        expect(w.raycast([0, 1, 0], [0, 1, 5], { only: ["wall"] })).not.toBeNull()
        warn.mockRestore()
        w.dispose()
    })
})
