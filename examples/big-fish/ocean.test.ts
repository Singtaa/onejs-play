import { describe, it, expect } from "vitest"
import {
    speedOf, grow, canEat, overlaps, contain, swim, scatterPellets, pelletsEaten, spawnPoint,
    POND_W, POND_H, START_SIZE, MAX_SIZE, EAT_RATIO, PELLET_AREA, PELLET_SIZE,
    type Fish,
} from "./ocean"

const fish = (x: number, y: number, size = START_SIZE): Fish => ({ x, y, size })

describe("speed", () => {
    it("falls as a fish grows, so the biggest is not also the fastest", () => {
        expect(speedOf(MAX_SIZE)).toBeLessThan(speedOf(START_SIZE))
    })

    it("leaves the biggest fish escapable rather than crippled", () => {
        const ratio = speedOf(MAX_SIZE) / speedOf(START_SIZE)
        expect(ratio).toBeGreaterThan(0.25)
        expect(ratio).toBeLessThan(0.6)
    })

    it("does not reward being smaller than the starting size", () => {
        expect(speedOf(1)).toBe(speedOf(START_SIZE))
    })
})

describe("growing", () => {
    it("adds area rather than length, so doubling takes four times the food", () => {
        const once = grow(START_SIZE, START_SIZE * START_SIZE * 3)
        expect(once).toBeCloseTo(START_SIZE * 2, 5)
    })

    it("stops at the maximum", () => {
        expect(grow(MAX_SIZE - 1, 1e9)).toBe(MAX_SIZE)
    })

    it("makes a pellet worth something without being a meal", () => {
        const after = grow(START_SIZE, PELLET_AREA)
        expect(after).toBeGreaterThan(START_SIZE)
        expect(after).toBeLessThan(START_SIZE * 1.15)
    })
})

describe("eating", () => {
    it("needs both a size margin and an overlap", () => {
        const big = fish(100, 100, 40)
        expect(canEat(big, fish(100, 100, 40 / EAT_RATIO - 1))).toBe(true)
        expect(canEat(big, fish(400, 400, 10))).toBe(false)
        expect(canEat(fish(100, 100, 20), fish(100, 100, 19))).toBe(false)
    })

    it("lets two equals circle each other rather than trading", () => {
        expect(canEat(fish(100, 100, 30), fish(105, 100, 30))).toBe(false)
        expect(canEat(fish(105, 100, 30), fish(100, 100, 30))).toBe(false)
    })

    it("is never mutual", () => {
        for (let i = 0; i < 500; i++) {
            const a = fish(Math.random() * 200, Math.random() * 200, 10 + Math.random() * 60)
            const b = fish(Math.random() * 200, Math.random() * 200, 10 + Math.random() * 60)
            expect(canEat(a, b) && canEat(b, a)).toBe(false)
        }
    })

    it("requires the prey to be well inside, not merely touching", () => {
        const big = fish(0, 0, 40)
        expect(overlaps(big, fish(29, 0, 10), 0.75)).toBe(true)
        expect(overlaps(big, fish(31, 0, 10), 0.75)).toBe(false)
    })
})

describe("the pond edges", () => {
    it("keeps a fish inside, allowing for its own radius", () => {
        const f = fish(-500, -500, 30)
        contain(f)
        expect(f.x).toBe(30)
        expect(f.y).toBe(30)
        const g = fish(POND_W + 500, POND_H + 500, 30)
        contain(g)
        expect(g.x).toBe(POND_W - 30)
        expect(g.y).toBe(POND_H - 30)
    })
})

describe("swimming", () => {
    it("moves toward the point at the fish's own speed", () => {
        const f = fish(100, 100)
        swim(f, 1000, 100, 1)
        expect(f.x).toBeCloseTo(100 + speedOf(START_SIZE), 4)
    })

    it("never overshoots the point it was aimed at", () => {
        const f = fish(100, 100)
        swim(f, 104, 100, 1)
        expect(f.x).toBeCloseTo(104, 5)
    })

    it("holds still when the target is already under it", () => {
        const f = fish(100, 100)
        swim(f, 101, 100, 1)
        expect(f.x).toBe(100)
    })

    it("stays in the pond however hard it is pushed", () => {
        const f = fish(100, 100, 40)
        for (let i = 0; i < 200; i++) swim(f, -9999, -9999, 1)
        expect(f.x).toBeGreaterThanOrEqual(40)
        expect(f.y).toBeGreaterThanOrEqual(40)
    })
})

describe("pellets", () => {
    it("scatters the number asked for, inside the pond", () => {
        const pellets = scatterPellets(300, Math.random)
        expect(pellets).toHaveLength(300)
        for (const p of pellets) {
            expect(p.x).toBeGreaterThanOrEqual(PELLET_SIZE)
            expect(p.x).toBeLessThanOrEqual(POND_W - PELLET_SIZE)
            expect(p.y).toBeGreaterThanOrEqual(PELLET_SIZE)
            expect(p.y).toBeLessThanOrEqual(POND_H - PELLET_SIZE)
        }
    })

    it("is reproducible from the same source, so every client lays the same field", () => {
        const seeded = () => {
            let seed = 5
            return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
        }
        expect(scatterPellets(50, seeded())).toEqual(scatterPellets(50, seeded()))
    })

    it("reports the pellets a fish is on top of, by index", () => {
        const pellets = [{ x: 100, y: 100, tone: 0, alive: true }, { x: 900, y: 900, tone: 1, alive: true }]
        expect(pelletsEaten(fish(100, 100, 20), pellets)).toEqual([0])
    })

    it("reports nothing when a fish is nowhere near one", () => {
        expect(pelletsEaten(fish(0, 0, 10), [{ x: 900, y: 900, tone: 0, alive: true }])).toEqual([])
    })

    it("ignores one that has already been eaten", () => {
        const pellets = [{ x: 100, y: 100, tone: 0, alive: false }]
        expect(pelletsEaten(fish(100, 100, 20), pellets)).toEqual([])
    })

    it("swallows several at once when they are bunched", () => {
        const pellets = [{ x: 100, y: 100, tone: 0, alive: true }, { x: 108, y: 100, tone: 1, alive: true }, { x: 96, y: 104, tone: 2, alive: true }]
        expect(pelletsEaten(fish(100, 100, 20), pellets)).toHaveLength(3)
    })
})

describe("spawning", () => {
    it("keeps clear of the edges, where a fish has one way to flee", () => {
        for (let i = 0; i < 300; i++) {
            const at = spawnPoint(Math.random)
            expect(at.x).toBeGreaterThan(POND_W * 0.1)
            expect(at.x).toBeLessThan(POND_W * 0.9)
            expect(at.y).toBeGreaterThan(POND_H * 0.1)
            expect(at.y).toBeLessThan(POND_H * 0.9)
        }
    })
})
