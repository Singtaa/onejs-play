import { describe, it, expect } from "vitest"
import { wrap, shortest, touching, shatter, sizeOf, outlineFor, edgeSpawn, SIZES, type Rock } from "./space"

const FIELD = { width: 900, height: 600 }

describe("wrap", () => {
    it("leaves a coordinate already inside alone", () => {
        expect(wrap(450, 900)).toBe(450)
        expect(wrap(0, 900)).toBe(0)
    })

    it("brings a coordinate past the end back to the start", () => {
        expect(wrap(905, 900)).toBe(5)
        expect(wrap(900, 900)).toBe(0)
    })

    it("brings a negative coordinate to the far end rather than leaving it negative", () => {
        expect(wrap(-5, 900)).toBe(895)
        expect(wrap(-900, 900)).toBe(0)
    })

    it("handles something many fields away", () => {
        expect(wrap(900 * 7 + 13, 900)).toBe(13)
        expect(wrap(-900 * 7 - 13, 900)).toBe(887)
    })

    it("refuses to divide by a field with no size", () => {
        expect(wrap(50, 0)).toBe(0)
    })
})

describe("shortest", () => {
    it("is the plain difference when that is the short way", () => {
        expect(shortest(100, 300, 900)).toBe(200)
        expect(shortest(300, 100, 900)).toBe(-200)
    })

    it("goes round the back when that is shorter", () => {
        expect(shortest(895, 5, 900)).toBe(10)
        expect(shortest(5, 895, 900)).toBe(-10)
    })

    it("never reports more than half the field", () => {
        for (let a = 0; a < 900; a += 37) {
            for (let b = 0; b < 900; b += 41) {
                expect(Math.abs(shortest(a, b, 900))).toBeLessThanOrEqual(450)
            }
        }
    })

    it("is antisymmetric", () => {
        expect(shortest(120, 700, 900)).toBe(-shortest(700, 120, 900))
    })
})

describe("touching", () => {
    it("sees two circles that overlap in the middle of the field", () => {
        expect(touching(FIELD, 400, 300, 10, 415, 300, 10)).toBe(true)
        expect(touching(FIELD, 400, 300, 10, 425, 300, 10)).toBe(false)
    })

    it("counts exactly grazing as a hit", () => {
        expect(touching(FIELD, 400, 300, 10, 420, 300, 10)).toBe(true)
    })

    it("sees a hit across the left and right edges", () => {
        expect(touching(FIELD, 895, 300, 8, 5, 300, 8)).toBe(true)
    })

    it("sees a hit across the top and bottom edges", () => {
        expect(touching(FIELD, 400, 597, 8, 400, 3, 8)).toBe(true)
    })

    it("sees a hit across a corner, where both axes wrap at once", () => {
        expect(touching(FIELD, 897, 597, 10, 3, 3, 10)).toBe(true)
    })

    it("does not invent a hit between two things genuinely far apart", () => {
        expect(touching(FIELD, 100, 100, 20, 500, 400, 20)).toBe(false)
    })
})

describe("shatter", () => {
    const rockOf = (radius: number): Rock => ({
        x: 100, y: 100, vx: 30, vy: -10, radius,
        angle: 0, spin: 0.5, outline: outlineFor(9, () => 0.5),
    })
    const next = () => Math.random()

    it("breaks a large rock into two of the next size", () => {
        const pieces = shatter(rockOf(SIZES[0]!), next)
        expect(pieces).toHaveLength(2)
        expect(pieces.every((p) => p.radius === SIZES[1])).toBe(true)
    })

    it("breaks a medium rock into two small ones", () => {
        const pieces = shatter(rockOf(SIZES[1]!), next)
        expect(pieces).toHaveLength(2)
        expect(pieces.every((p) => p.radius === SIZES[2])).toBe(true)
    })

    it("leaves nothing behind when the smallest is hit", () => {
        expect(shatter(rockOf(SIZES[2]!), next)).toHaveLength(0)
    })

    it("ignores a rock whose size is not on the scale", () => {
        expect(shatter(rockOf(97), next)).toHaveLength(0)
    })

    it("starts the pieces where the rock was", () => {
        const pieces = shatter(rockOf(SIZES[0]!), next)
        expect(pieces.every((p) => p.x === 100 && p.y === 100)).toBe(true)
    })

    it("carries the parent's drift into the pieces", () => {
        for (let i = 0; i < 200; i++) {
            const parent = rockOf(SIZES[0]!)
            for (const piece of shatter(parent, next)) {
                const thrown = Math.hypot(piece.vx - parent.vx, piece.vy - parent.vy)
                expect(thrown).toBeGreaterThanOrEqual(26)
                expect(thrown).toBeLessThanOrEqual(72)
            }
        }
    })

    it("gives the pieces as many vertices as the parent had", () => {
        const pieces = shatter(rockOf(SIZES[0]!), next)
        expect(pieces.every((p) => p.outline.length === 9)).toBe(true)
    })
})

describe("sizeOf", () => {
    it("names each band", () => {
        SIZES.forEach((size, band) => expect(sizeOf(size)).toBe(band))
    })

    it("reports nothing for a radius off the scale", () => {
        expect(sizeOf(100)).toBe(-1)
    })
})

describe("outlineFor", () => {
    it("makes one multiplier per vertex", () => {
        expect(outlineFor(11, () => 0.5)).toHaveLength(11)
    })

    it("stays lumpy without becoming a starburst", () => {
        for (let i = 0; i < 200; i++) {
            for (const r of outlineFor(9, Math.random)) {
                expect(r).toBeGreaterThanOrEqual(0.72)
                expect(r).toBeLessThanOrEqual(1.15)
            }
        }
    })
})

describe("edgeSpawn", () => {
    it("always arrives on an edge rather than in the middle", () => {
        for (let i = 0; i < 400; i++) {
            const at = edgeSpawn(FIELD, Math.random)
            const onVertical = at.x === 0 || at.x === FIELD.width
            const onHorizontal = at.y === 0 || at.y === FIELD.height
            expect(onVertical || onHorizontal).toBe(true)
        }
    })

    it("stays inside the field on the other axis", () => {
        for (let i = 0; i < 400; i++) {
            const at = edgeSpawn(FIELD, Math.random)
            expect(at.x).toBeGreaterThanOrEqual(0)
            expect(at.x).toBeLessThanOrEqual(FIELD.width)
            expect(at.y).toBeGreaterThanOrEqual(0)
            expect(at.y).toBeLessThanOrEqual(FIELD.height)
        }
    })
})
