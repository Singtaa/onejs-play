/**
 * The 1.3.0 names that change how things move, in 2D: stage pixels, y down,
 * degrees clockwise. The 3D file holds each behaviour in full; this one holds
 * that the 2D world does the same in its own units.
 */
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { createWorld2D, type World2D, type Body2D } from "../world"
import { setElementPlacer, type ElementPlacement } from "../elements"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier2d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier2d-${RAPIER_VERSION}.wasm`))))
})

const run = (w: World2D, steps: number) => { for (let i = 0; i < steps; i++) w.step() }
const speed = (v: readonly number[]) => Math.hypot(...v)
const raw = (b: Body2D) => (b as any).world.raw.getRigidBody((b as any).bodyHandle)

/** A floor 4000 px wide whose top is at y = 600. */
async function floored(): Promise<World2D> {
    const w = await createWorld2D()
    w.box({ at: [0, 650], size: [4000, 100] })
    return w
}

describe("2D drag", () => {
    it("slows a puck on a table seen from above, moving and spinning, and leaves one without it alone", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        const puck = w.circle({ dynamic: true, drag: 1, radius: 20 })
        const free = w.circle({ dynamic: true, radius: 20, at: [0, 500] })
        puck.velocity = [1000, 0]
        free.velocity = [1000, 0]
        raw(puck).setAngvel(6, true)
        run(w, 60)
        expect(speed(puck.velocity)).toBeGreaterThan(300)
        expect(speed(puck.velocity)).toBeLessThan(450)
        expect(raw(puck).angvel()).toBeLessThan(2.7)
        expect(speed(free.velocity)).toBeCloseTo(1000, 0)
        w.dispose()
    })
})

describe("2D rotates: false", () => {
    it("keeps a box dropped on its corner from tipping", async () => {
        for (const rotates of [undefined, false]) {
            const w = await floored()
            const b = w.box({ dynamic: true, at: [0, 400], size: [100, 100], rotation: 30, rotates })
            run(w, 180)
            if (rotates === false) expect(b.rotation).toBeCloseTo(30, 3)
            else expect(Math.abs(((b.rotation % 90) + 90) % 90 - 45)).toBeGreaterThan(40)
            w.dispose()
        }
    })
})

describe("2D fast", () => {
    it("hits a moving body a shot would pass through between two steps", async () => {
        for (const fast of [undefined, true]) {
            const w = await createWorld2D({ gravity: [0, 0] })
            const target = w.circle({ dynamic: true, at: [600, 0], radius: 10 })
            const shot = w.circle({ dynamic: true, radius: 5, fast })
            shot.velocity = [30000, 0]
            run(w, 4)
            if (fast) expect(target.position[0]).toBeGreaterThan(650)
            else expect(target.position[0]).toBe(600)
            w.dispose()
        }
    })
})

describe("2D character.addVelocity", () => {
    it("throws it up the screen, and shoves it along the floor until it fades", async () => {
        const w = await floored()
        const c = w.character({ at: [0, 600] })
        run(w, 2)
        c.addVelocity([1000, -500])
        run(w, 3)
        expect(c.position[1]).toBeLessThan(590)
        expect(c.velocity[0]).toBeGreaterThan(500)
        run(w, 120)
        expect(c.grounded).toBe(true)
        expect(c.velocity[0]).toBe(0)
        w.dispose()
    })
})

describe("2D riding", () => {
    it("carries a character on a platform moving sideways and down", async () => {
        const w = await createWorld2D()
        const p = w.box({ kinematic: true, at: [0, 625], size: [400, 50] })
        const c = w.character({ at: [0, 600] })
        run(w, 2)
        p.velocity = [200, 100]
        run(w, 60)
        expect(c.position[0]).toBeCloseTo(p.position[0], -1)
        expect(c.position[1]).toBeCloseTo(p.position[1] - 25, -1)
        expect(c.grounded).toBe(true)
        w.dispose()
    })
})

describe("2D drawing ahead of the step", () => {
    it("moves and turns an element on every frame at 120 Hz", async () => {
        const element = { style: {} }
        const seen: ElementPlacement[] = []
        setElementPlacer((list) => { for (const p of list) if (p.element === element) seen.push({ ...p }) })
        try {
            const w = await createWorld2D({ gravity: [0, 0] }) as any
            const b = w.box({ dynamic: true, actor: element })
            b.velocity = [600, 0]
            raw(b).setAngvel(Math.PI, true)
            const body: { x: number, degrees: number }[] = []
            for (let i = 0; i < 120; i++) {
                w.frame(1 / 120)
                body.push({ x: b.position[0], degrees: b.rotation })
            }
            const tail = seen.slice(-40), under = body.slice(-40)
            let ahead = 0
            for (let i = 1; i < tail.length; i++) {
                expect(tail[i]!.at[0] - tail[i - 1]!.at[0]).toBeCloseTo(5, 1)
                // Half a turn a second, clockwise: 1.5 degrees a frame.
                const turn = ((tail[i]!.degrees! - tail[i - 1]!.degrees! + 540) % 360) - 180
                expect(turn).toBeCloseTo(1.5, 1)
                // Drawn ahead of the last step, moving and turning, never behind it.
                const lead = tail[i]!.at[0] - under[i]!.x
                const leadTurn = ((tail[i]!.degrees! - under[i]!.degrees + 540) % 360) - 180
                expect(lead).toBeGreaterThanOrEqual(-1e-6)
                expect(leadTurn).toBeGreaterThanOrEqual(-1e-4)
                if (lead > 2) {
                    ahead++
                    expect(leadTurn).toBeCloseTo(1.5, 1)
                }
            }
            expect(ahead).toBeGreaterThan(15)
            w.dispose()
        } finally {
            setElementPlacer(null)
        }
    })
})

describe("2D drawing a hand turn", () => {
    it("draws a body turned by hand at the turn, not past it", async () => {
        const element = { style: {} }
        const seen: number[] = []
        setElementPlacer((list) => { for (const p of list) if (p.element === element) seen.push(p.degrees!) })
        try {
            const w = await createWorld2D({ gravity: [0, 0] }) as any
            const b = w.box({ dynamic: true, actor: element })
            b.velocity = [600, 0]
            for (let i = 0; i < 60; i++) w.frame(1 / 120)
            for (let turn = 0; turn < 2; turn++) {
                // Turned on frames of both kinds, those that step and those between.
                b.rotation = 90 * (turn + 1)
                seen.length = 0
                for (let i = 0; i < 6; i++) w.frame(1 / 120)
                expect(seen.length).toBe(6)
                for (const degrees of seen) expect(((degrees - 90 * (turn + 1) + 540) % 360) - 180).toBeCloseTo(0, 3)
                w.frame(1 / 120)
            }
            w.dispose()
        } finally {
            setElementPlacer(null)
        }
    })
})
