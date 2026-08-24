import { describe, it, expect } from "vitest"
import { aim, advance, speedToReach, wander, GRAVITY, type Rocket } from "./flight"

function fly(rocket: Rocket, dt = 1 / 120): { x: number; y: number; frames: number } {
    for (let frames = 1; frames <= 10000; frames++) {
        if (advance(rocket, dt)) return { x: rocket.x, y: rocket.y, frames }
    }
    throw new Error("the shell never stopped rising")
}

describe("speedToReach", () => {
    it("is the speed that exactly spends itself over the rise", () => {
        expect(speedToReach(0)).toBe(0)
        expect(speedToReach(400) / speedToReach(100)).toBeCloseTo(2, 5)
    })

    it("treats a negative rise as none rather than returning NaN", () => {
        expect(speedToReach(-100)).toBe(0)
    })
})

describe("aim", () => {
    it("bursts at the height it was aimed at", () => {
        const rocket = aim(300, 600, 300, 200, 0, false)
        const burst = fly(rocket)
        expect(burst.y).toBeCloseTo(200, 1)
    })

    it("bursts at the horizontal position it was aimed at", () => {
        const rocket = aim(100, 600, 500, 220, 0, false)
        const burst = fly(rocket)
        expect(burst.x).toBeCloseTo(500, 0)
    })

    it("leans the right way for a target on either side", () => {
        expect(aim(300, 600, 500, 200, 0, false).vx).toBeGreaterThan(0)
        expect(aim(300, 600, 100, 200, 0, false).vx).toBeLessThan(0)
    })

    it("goes straight up when the target is directly overhead", () => {
        expect(aim(300, 600, 300, 200, 0, false).vx).toBeCloseTo(0, 6)
    })

    it("rises, which in screen coordinates means a negative vy", () => {
        expect(aim(300, 600, 300, 200, 0, false).vy).toBeLessThan(0)
    })

    it("takes longer to reach a higher target", () => {
        const low = fly(aim(300, 600, 300, 450, 0, false))
        const high = fly(aim(300, 600, 300, 100, 0, false))
        expect(high.frames).toBeGreaterThan(low.frames)
    })

    it("survives a target at ground level", () => {
        const rocket = aim(300, 600, 500, 600, 0, false)
        expect(Number.isFinite(rocket.vx)).toBe(true)
        expect(Number.isFinite(rocket.vy)).toBe(true)
        const burst = fly(rocket)
        expect(Number.isFinite(burst.x)).toBe(true)
    })

    it("survives a target below the ground", () => {
        const rocket = aim(300, 600, 500, 900, 0, false)
        expect(Number.isFinite(rocket.vx)).toBe(true)
        expect(rocket.vy).toBe(-0)
    })

    it("carries the shell and weight it was given", () => {
        const rocket = aim(300, 600, 300, 200, 4, true)
        expect(rocket.shell).toBe(4)
        expect(rocket.heavy).toBe(true)
    })
})

describe("advance", () => {
    it("does not report a burst while the shell is still rising", () => {
        const rocket = aim(300, 600, 300, 100, 0, false)
        expect(advance(rocket, 1 / 120)).toBe(false)
    })

    it("accelerates downward at gravity", () => {
        const rocket: Rocket = { x: 0, y: 0, vx: 0, vy: -100, shell: 0, heavy: false }
        advance(rocket, 0.5)
        expect(rocket.vy).toBeCloseTo(-100 + GRAVITY * 0.5, 5)
    })

    it("lands in the same place however finely it is stepped", () => {
        const coarse: Rocket = { x: 0, y: 0, vx: 40, vy: -300, shell: 0, heavy: false }
        const fine: Rocket = { x: 0, y: 0, vx: 40, vy: -300, shell: 0, heavy: false }
        advance(coarse, 0.4)
        for (let i = 0; i < 40; i++) advance(fine, 0.01)
        expect(coarse.y).toBeCloseTo(fine.y, 6)
        expect(coarse.x).toBeCloseTo(fine.x, 6)
        expect(coarse.vy).toBeCloseTo(fine.vy, 6)
    })

    it("bursts within a frame of the apex whatever the frame rate", () => {
        for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
            const rocket = aim(300, 600, 300, 200, 0, false)
            const burst = fly(rocket, dt)
            expect(burst.y).toBeGreaterThanOrEqual(199.9)
            expect(burst.y).toBeLessThan(200 + 0.5 * GRAVITY * dt * dt + 0.01)
        }
    })
})

describe("wander", () => {
    it("stays clear of the edges and the ceiling", () => {
        for (let i = 0; i < 200; i++) {
            const where = wander(1000, 800, Math.random)
            expect(where.x).toBeGreaterThan(100)
            expect(where.x).toBeLessThan(900)
            expect(where.y).toBeGreaterThan(80)
            expect(where.y).toBeLessThan(400)
        }
    })

    it("scales with the stage rather than assuming a size", () => {
        const next = () => 0.5
        const small = wander(400, 300, next)
        const large = wander(800, 600, next)
        expect(large.x).toBeCloseTo(small.x * 2, 5)
        expect(large.y).toBeCloseTo(small.y * 2, 5)
    })
})
