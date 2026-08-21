import { describe, it, expect } from "vitest"
import { random } from "../random"

const draw = (seed: string | number, n = 20) => {
    const rng = random(seed)
    return Array.from({ length: n }, () => rng.next())
}

describe("random", () => {
    describe("determinism", () => {
        it("gives the same sequence for the same string seed", () => {
            expect(draw("daily-2026-08-21")).toEqual(draw("daily-2026-08-21"))
        })
        it("gives the same sequence for the same numeric seed", () => {
            expect(draw(12345)).toEqual(draw(12345))
        })
        it("gives different sequences for different seeds", () => {
            expect(draw("a")).not.toEqual(draw("b"))
            expect(draw(1)).not.toEqual(draw(2))
        })
        it("differs by one character in the seed", () => {
            expect(draw("level-1")).not.toEqual(draw("level-2"))
        })
        it("is unseeded when no seed is given", () => {
            expect(draw(undefined as never)).not.toEqual(draw(undefined as never))
        })
        it("survives a non-finite numeric seed without producing NaN", () => {
            const v = draw(NaN, 5)
            expect(v.every((n) => Number.isFinite(n))).toBe(true)
        })
    })

    describe("next", () => {
        it("stays within [0, 1)", () => {
            const rng = random("range")
            for (let i = 0; i < 20000; i++) {
                const v = rng.next()
                expect(v).toBeGreaterThanOrEqual(0)
                expect(v).toBeLessThan(1)
            }
        })
        it("has a mean near 0.5", () => {
            const rng = random("mean")
            let sum = 0
            const n = 50000
            for (let i = 0; i < n; i++) sum += rng.next()
            expect(sum / n).toBeCloseTo(0.5, 2)
        })
        it("fills all deciles", () => {
            const rng = random("spread")
            const buckets = new Array(10).fill(0)
            for (let i = 0; i < 10000; i++) buckets[Math.floor(rng.next() * 10)]++
            expect(buckets.every((b) => b > 500)).toBe(true)
        })
    })

    describe("int", () => {
        it("covers the range and excludes the max", () => {
            const rng = random("int")
            const seen = new Set<number>()
            for (let i = 0; i < 5000; i++) {
                const v = rng.int(0, 5)
                expect(Number.isInteger(v)).toBe(true)
                expect(v).toBeGreaterThanOrEqual(0)
                expect(v).toBeLessThan(5)
                seen.add(v)
            }
            expect(seen.size).toBe(5)
        })
        it("handles negative ranges", () => {
            const rng = random("neg")
            for (let i = 0; i < 1000; i++) {
                const v = rng.int(-3, 3)
                expect(v).toBeGreaterThanOrEqual(-3)
                expect(v).toBeLessThan(3)
            }
        })
        it("returns min for an empty range rather than NaN", () => {
            expect(random("e").int(5, 5)).toBe(5)
        })
        it("returns min for a reversed range rather than looping forever", () => {
            expect(random("r").int(10, 0)).toBe(10)
        })
    })

    describe("range, bool and sign", () => {
        it("keeps floats inside the bounds", () => {
            const rng = random("f")
            for (let i = 0; i < 2000; i++) {
                const v = rng.range(-2.5, 7.5)
                expect(v).toBeGreaterThanOrEqual(-2.5)
                expect(v).toBeLessThan(7.5)
            }
        })
        it("honours the probability argument", () => {
            const rng = random("b")
            let trues = 0
            for (let i = 0; i < 10000; i++) if (rng.bool(0.25)) trues++
            expect(trues / 10000).toBeCloseTo(0.25, 1)
        })
        it("always returns 1 or -1 from sign", () => {
            const rng = random("s")
            for (let i = 0; i < 500; i++) expect(Math.abs(rng.sign())).toBe(1)
        })
    })

    describe("pick", () => {
        it("only returns elements of the array", () => {
            const rng = random("p")
            const items = ["a", "b", "c"]
            for (let i = 0; i < 500; i++) expect(items).toContain(rng.pick(items))
        })
        it("eventually returns every element", () => {
            const rng = random("p2")
            const items = ["a", "b", "c"]
            const seen = new Set(Array.from({ length: 200 }, () => rng.pick(items)))
            expect(seen.size).toBe(3)
        })
        it("throws on an empty array rather than returning undefined", () => {
            expect(() => random("p3").pick([])).toThrow(/non-empty/)
        })
    })

    describe("shuffle", () => {
        it("leaves the input array untouched", () => {
            const input = [1, 2, 3, 4, 5]
            const copy = input.slice()
            random("sh").shuffle(input)
            expect(input).toEqual(copy)
        })
        it("preserves every element exactly once", () => {
            const input = [1, 2, 3, 4, 5, 6, 7, 8]
            const out = random("sh2").shuffle(input)
            expect(out.slice().sort((a, b) => a - b)).toEqual(input)
        })
        it("is deterministic for a seed", () => {
            const input = [1, 2, 3, 4, 5, 6, 7, 8]
            expect(random("sh3").shuffle(input)).toEqual(random("sh3").shuffle(input))
        })
        it("actually reorders", () => {
            const input = Array.from({ length: 30 }, (_, i) => i)
            expect(random("sh4").shuffle(input)).not.toEqual(input)
        })
    })

    describe("direction", () => {
        it("returns unit-length vectors", () => {
            const rng = random("d")
            for (let i = 0; i < 500; i++) {
                const v = rng.direction()
                expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 12)
            }
        })
        it("covers all four quadrants", () => {
            const rng = random("d2")
            const quads = new Set<string>()
            for (let i = 0; i < 500; i++) {
                const v = rng.direction()
                quads.add(`${v.x > 0}${v.y > 0}`)
            }
            expect(quads.size).toBe(4)
        })
    })

    describe("fork", () => {
        it("is deterministic for a label", () => {
            const a = random("world").fork("levels")
            const b = random("world").fork("levels")
            expect(Array.from({ length: 10 }, () => a.next())).toEqual(
                Array.from({ length: 10 }, () => b.next()),
            )
        })
        it("gives different streams for different labels", () => {
            const base = () => random("world")
            const levels = Array.from({ length: 10 }, () => base().fork("levels").next())
            const cosmetics = Array.from({ length: 10 }, () => base().fork("cosmetics").next())
            expect(levels).not.toEqual(cosmetics)
        })
        it("does not consume draws from the parent", () => {
            const withFork = random("world")
            withFork.fork("anything")
            const without = random("world")
            expect(withFork.next()).toBe(without.next())
        })
        it("differs from the parent stream", () => {
            const parent = random("world")
            const child = random("world").fork("child")
            expect(parent.next()).not.toBe(child.next())
        })
    })
})
