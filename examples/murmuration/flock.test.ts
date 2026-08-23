import { describe, it, expect } from "vitest"
import { Grid, step, DEFAULTS, type Boid, type Rules } from "./flock"

const boid = (x: number, y: number, vx = 0, vy = 0): Boid => ({ x, y, vx, vy })

/** Rules with everything off, so one behaviour can be tested at a time. */
const only = (overrides: Partial<Rules>): Rules => ({
    ...DEFAULTS, separation: 0, alignment: 0, cohesion: 0, edge: 0, minSpeed: 0, maxSpeed: 1e9,
    ...overrides,
})

describe("Grid", () => {
    it("covers the field, rounding a partial column up", () => {
        const grid = new Grid(100, 100, 40)
        expect(grid.cols).toBe(3)
        expect(grid.rows).toBe(3)
    })

    it("never collapses to no buckets, however small the field", () => {
        const grid = new Grid(5, 5, 40)
        expect(grid.cols).toBe(1)
        expect(grid.rows).toBe(1)
    })

    it("puts a point in the bucket that contains it", () => {
        const grid = new Grid(120, 120, 40)
        expect(grid.indexOf(10, 10)).toBe(0)
        expect(grid.indexOf(50, 10)).toBe(1)
        expect(grid.indexOf(10, 50)).toBe(3)
    })

    /** A bird nudged just past the wall must land somewhere rather than nowhere. */
    it("clamps a point outside the field into the nearest bucket", () => {
        const grid = new Grid(120, 120, 40)
        expect(grid.indexOf(-30, -30)).toBe(0)
        expect(grid.indexOf(500, 500)).toBe(8)
    })

    it("finds a neighbour in the same bucket", () => {
        const grid = new Grid(120, 120, 40)
        grid.insert(grid.indexOf(10, 10), 7)
        const seen: number[] = []
        grid.near(12, 12, (b) => seen.push(b))
        expect(seen).toEqual([7])
    })

    it("finds a neighbour one bucket over", () => {
        const grid = new Grid(120, 120, 40)
        grid.insert(grid.indexOf(50, 10), 3)
        const seen: number[] = []
        grid.near(10, 10, (b) => seen.push(b))
        expect(seen).toEqual([3])
    })

    it("does not find one two buckets over", () => {
        const grid = new Grid(200, 200, 40)
        grid.insert(grid.indexOf(110, 10), 3)
        const seen: number[] = []
        grid.near(10, 10, (b) => seen.push(b))
        expect(seen).toEqual([])
    })

    /**
     * The bug a hand-rolled grid usually has: visiting a bucket twice at the
     * field's edge, which silently doubles a neighbour's influence.
     */
    it("visits each neighbour exactly once, including in a corner", () => {
        const grid = new Grid(120, 120, 40)
        for (let i = 0; i < 9; i++) grid.insert(i, i)
        const seen: number[] = []
        grid.near(5, 5, (b) => seen.push(b))
        expect(seen.length).toBe(new Set(seen).size)
        // Only the four buckets that exist around a corner.
        expect(new Set(seen)).toEqual(new Set([0, 1, 3, 4]))
    })

    it("empties completely when cleared", () => {
        const grid = new Grid(120, 120, 40)
        grid.insert(grid.indexOf(10, 10), 1)
        grid.clear()
        const seen: number[] = []
        grid.near(10, 10, (b) => seen.push(b))
        expect(seen).toEqual([])
    })
})

describe("separation", () => {
    it("pushes two birds sitting on top of each other apart", () => {
        const boids = [boid(100, 100), boid(105, 100)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({ separation: 0.5 }), 1 / 60, null)
        expect(boids[0]!.vx).toBeLessThan(0)
        expect(boids[1]!.vx).toBeGreaterThan(0)
    })

    it("leaves birds outside each other's personal space alone", () => {
        const boids = [boid(100, 100), boid(100 + DEFAULTS.personal + 1, 100)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({ separation: 0.5 }), 1 / 60, null)
        expect(boids[0]!.vx).toBe(0)
    })

    it("pushes harder the closer they are", () => {
        const measure = (gap: number) => {
            const boids = [boid(100, 100), boid(100 + gap, 100)]
            step(boids, new Grid(400, 400, DEFAULTS.range), only({ separation: 0.5 }), 1 / 60, null)
            return Math.abs(boids[0]!.vx)
        }
        expect(measure(3)).toBeGreaterThan(measure(12))
    })
})

describe("alignment", () => {
    it("turns a bird toward its neighbours' heading", () => {
        const boids = [boid(100, 100, 0, 50), boid(120, 100, 100, 0), boid(130, 100, 100, 0)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({ alignment: 0.4 }), 1 / 60, null)
        expect(boids[0]!.vx).toBeGreaterThan(0)
        expect(boids[0]!.vy).toBeLessThan(50)
    })

    it("brings a flock to a common heading given enough passes", () => {
        const boids = [boid(100, 100, 100, 0), boid(115, 100, -100, 0), boid(130, 100, 0, 100)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        for (let i = 0; i < 400; i++) step(boids, grid, only({ alignment: 0.3 }), 1 / 60, null)
        const spread = Math.max(...boids.map((b) => b.vx)) - Math.min(...boids.map((b) => b.vx))
        expect(spread).toBeLessThan(1)
    })
})

describe("cohesion", () => {
    it("pulls a stray toward the middle of the group", () => {
        const boids = [boid(140, 100), boid(100, 100), boid(105, 100)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({ cohesion: 0.05 }), 1 / 60, null)
        expect(boids[0]!.vx).toBeLessThan(0)
    })

    it("does nothing for a bird with nobody in range", () => {
        const boids = [boid(20, 20), boid(380, 380)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({ cohesion: 0.05 }), 1 / 60, null)
        expect(boids[0]!.vx).toBe(0)
        expect(boids[0]!.vy).toBe(0)
    })
})

describe("edges", () => {
    it("turns a bird back before it reaches the wall", () => {
        const boids = [boid(10, 200, -50, 0)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({ edge: 400, margin: 90, maxSpeed: 1e9 }), 1 / 60, null)
        expect(boids[0]!.vx).toBeGreaterThan(-50)
    })

    it("turns harder the closer to the wall a bird is", () => {
        const nudge = (x: number) => {
            const boids = [boid(x, 200, 0, 0)]
            step(boids, new Grid(400, 400, DEFAULTS.range), only({ edge: 400, margin: 90 }), 1 / 60, null)
            return boids[0]!.vx
        }
        expect(nudge(5)).toBeGreaterThan(nudge(70))
    })

    it("never lets a bird leave the field", () => {
        const boids = [boid(200, 200, 9000, 9000)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, DEFAULTS, 1 / 60, null)
        expect(boids[0]!.x).toBeLessThanOrEqual(400)
        expect(boids[0]!.y).toBeLessThanOrEqual(400)
        expect(boids[0]!.x).toBeGreaterThanOrEqual(0)
        expect(boids[0]!.y).toBeGreaterThanOrEqual(0)
    })
})

describe("the predator", () => {
    it("pushes birds away when its strength is positive", () => {
        const boids = [boid(200, 200)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({}), 1 / 60, { x: 180, y: 200, radius: 100, strength: 600 })
        expect(boids[0]!.vx).toBeGreaterThan(0)
    })

    it("draws them in when its strength is negative", () => {
        const boids = [boid(200, 200)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({}), 1 / 60, { x: 180, y: 200, radius: 100, strength: -600 })
        expect(boids[0]!.vx).toBeLessThan(0)
    })

    it("does not reach past its radius", () => {
        const boids = [boid(200, 200)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({}), 1 / 60, { x: 50, y: 200, radius: 100, strength: 600 })
        expect(boids[0]!.vx).toBe(0)
    })

    it("survives sitting exactly on a bird rather than dividing by zero", () => {
        const boids = [boid(200, 200)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({}), 1 / 60, { x: 200, y: 200, radius: 100, strength: 600 })
        expect(Number.isFinite(boids[0]!.vx)).toBe(true)
        expect(Number.isFinite(boids[0]!.vy)).toBe(true)
    })
})

describe("speed", () => {
    it("never lets a bird stop, which would leave the flock a still clump", () => {
        const boids = [boid(200, 200, 0.0001, 0)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, DEFAULTS, 1 / 60, null)
        expect(Math.hypot(boids[0]!.vx, boids[0]!.vy)).toBeGreaterThanOrEqual(DEFAULTS.minSpeed - 0.001)
    })

    it("caps the fastest a bird can go", () => {
        const boids = [boid(200, 200, 5000, 0)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, DEFAULTS, 1 / 60, null)
        expect(Math.hypot(boids[0]!.vx, boids[0]!.vy)).toBeLessThanOrEqual(DEFAULTS.maxSpeed + 0.001)
    })

    it("leaves a bird with exactly no speed alone rather than producing NaN", () => {
        const boids = [boid(200, 200, 0, 0)]
        const grid = new Grid(400, 400, DEFAULTS.range)
        step(boids, grid, only({}), 1 / 60, null)
        expect(Number.isFinite(boids[0]!.vx)).toBe(true)
    })
})

describe("the flock as a whole", () => {
    /**
     * The reason positions are read and velocities written in one pass, then
     * everything moved in another. Reacting to a neighbour that has already
     * moved makes the result depend on array order, so the same flock in a
     * different order would behave differently.
     */
    it("does not depend on the order the birds are stored in", () => {
        const make = (): Boid[] => [
            boid(100, 100, 30, 10), boid(130, 110, -20, 40), boid(160, 90, 10, -30), boid(120, 150, 5, 5),
        ]
        const forward = make()
        const backward = make().reverse()
        for (let i = 0; i < 60; i++) {
            step(forward, new Grid(400, 400, DEFAULTS.range), DEFAULTS, 1 / 60, null)
            step(backward, new Grid(400, 400, DEFAULTS.range), DEFAULTS, 1 / 60, null)
        }
        const sorted = (list: Boid[]) => [...list].sort((a, b) => a.x - b.x).map((b) => Math.round(b.x))
        expect(sorted(forward)).toEqual(sorted(backward))
    })

    it("keeps a large flock finite over a long run", () => {
        const boids: Boid[] = []
        for (let i = 0; i < 300; i++) {
            boids.push(boid(Math.random() * 800, Math.random() * 600,
                (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200))
        }
        const grid = new Grid(800, 600, DEFAULTS.range)
        for (let i = 0; i < 600; i++) step(boids, grid, DEFAULTS, 1 / 60, null)
        expect(boids.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true)
        expect(boids.every((b) => b.x >= 0 && b.x <= 800 && b.y >= 0 && b.y <= 600)).toBe(true)
    })
})
