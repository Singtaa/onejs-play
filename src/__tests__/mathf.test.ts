import { describe, it, expect } from "vitest"
import { Mathf } from "../mathf"

describe("Mathf parity with UnityEngine.Mathf", () => {
    describe("Sign", () => {
        it("returns 1 for zero, matching Unity rather than Math.sign", () => {
            expect(Mathf.Sign(0)).toBe(1)
            expect(Math.sign(0)).toBe(0)
        })
        it("returns 1 for positive and -1 for negative", () => {
            expect(Mathf.Sign(3.5)).toBe(1)
            expect(Mathf.Sign(-3.5)).toBe(-1)
            expect(Mathf.Sign(-0.0001)).toBe(-1)
        })
    })

    describe("Round (banker's rounding)", () => {
        it("rounds halves to even, unlike Math.round", () => {
            expect(Mathf.Round(0.5)).toBe(0)
            expect(Mathf.Round(1.5)).toBe(2)
            expect(Mathf.Round(2.5)).toBe(2)
            expect(Mathf.Round(3.5)).toBe(4)
            expect(Math.round(0.5)).toBe(1)
        })
        it("rounds negative halves to even", () => {
            expect(Mathf.Round(-0.5)).toBe(0)
            expect(Mathf.Round(-1.5)).toBe(-2)
            expect(Mathf.Round(-2.5)).toBe(-2)
        })
        it("rounds non-halves normally", () => {
            expect(Mathf.Round(2.4)).toBe(2)
            expect(Mathf.Round(2.6)).toBe(3)
            expect(Mathf.Round(-2.4)).toBe(-2)
            expect(Mathf.Round(-2.6)).toBe(-3)
        })
        it("passes non-finite values through", () => {
            expect(Mathf.Round(Infinity)).toBe(Infinity)
            expect(Mathf.Round(NaN)).toBeNaN()
        })
    })

    describe("Clamp01 and Clamp", () => {
        it("clamps to the unit range", () => {
            expect(Mathf.Clamp01(-5)).toBe(0)
            expect(Mathf.Clamp01(0.3)).toBe(0.3)
            expect(Mathf.Clamp01(5)).toBe(1)
        })
        it("clamps to an arbitrary range", () => {
            expect(Mathf.Clamp(15, 0, 10)).toBe(10)
            expect(Mathf.Clamp(-15, 0, 10)).toBe(0)
            expect(Mathf.Clamp(5, 0, 10)).toBe(5)
        })
    })

    describe("Lerp", () => {
        it("clamps t", () => {
            expect(Mathf.Lerp(0, 10, -1)).toBe(0)
            expect(Mathf.Lerp(0, 10, 2)).toBe(10)
            expect(Mathf.Lerp(0, 10, 0.5)).toBe(5)
        })
        it("does not clamp when unclamped", () => {
            expect(Mathf.LerpUnclamped(0, 10, 2)).toBe(20)
            expect(Mathf.LerpUnclamped(0, 10, -1)).toBe(-10)
        })
        it("hits the endpoints exactly", () => {
            expect(Mathf.Lerp(3, 7, 0)).toBe(3)
            expect(Mathf.Lerp(3, 7, 1)).toBe(7)
        })
    })

    describe("InverseLerp", () => {
        it("inverts Lerp", () => {
            expect(Mathf.InverseLerp(10, 20, 15)).toBe(0.5)
        })
        it("clamps the result", () => {
            expect(Mathf.InverseLerp(10, 20, 0)).toBe(0)
            expect(Mathf.InverseLerp(10, 20, 30)).toBe(1)
        })
        it("returns 0 when the range is degenerate, rather than NaN", () => {
            expect(Mathf.InverseLerp(5, 5, 5)).toBe(0)
            expect(Mathf.InverseLerp(5, 5, 99)).toBe(0)
        })
    })

    describe("Repeat", () => {
        it("wraps positive values", () => {
            expect(Mathf.Repeat(7, 5)).toBeCloseTo(2, 10)
            expect(Mathf.Repeat(3, 5)).toBeCloseTo(3, 10)
        })
        it("wraps negative values into the positive range", () => {
            expect(Mathf.Repeat(-1, 5)).toBeCloseTo(4, 10)
            expect(Mathf.Repeat(-7, 5)).toBeCloseTo(3, 10)
        })
        it("never returns a value outside [0, length]", () => {
            for (let t = -50; t <= 50; t += 0.37) {
                const r = Mathf.Repeat(t, 5)
                expect(r).toBeGreaterThanOrEqual(0)
                expect(r).toBeLessThanOrEqual(5)
            }
        })
    })

    describe("PingPong", () => {
        it("bounces between 0 and length", () => {
            expect(Mathf.PingPong(0, 5)).toBeCloseTo(0, 10)
            expect(Mathf.PingPong(5, 5)).toBeCloseTo(5, 10)
            expect(Mathf.PingPong(7, 5)).toBeCloseTo(3, 10)
            expect(Mathf.PingPong(10, 5)).toBeCloseTo(0, 10)
            expect(Mathf.PingPong(12, 5)).toBeCloseTo(2, 10)
        })
        it("stays within range for negatives", () => {
            for (let t = -50; t <= 50; t += 0.37) {
                const r = Mathf.PingPong(t, 5)
                expect(r).toBeGreaterThanOrEqual(0)
                expect(r).toBeLessThanOrEqual(5)
            }
        })
    })

    describe("DeltaAngle", () => {
        it("takes the shortest path across the wrap point", () => {
            expect(Mathf.DeltaAngle(350, 10)).toBeCloseTo(20, 10)
            expect(Mathf.DeltaAngle(10, 350)).toBeCloseTo(-20, 10)
            expect(Mathf.DeltaAngle(0, 180)).toBeCloseTo(180, 10)
        })
        it("stays within [-180, 180]", () => {
            for (let a = -720; a <= 720; a += 17) {
                const d = Mathf.DeltaAngle(a, a + 400)
                expect(d).toBeGreaterThanOrEqual(-180)
                expect(d).toBeLessThanOrEqual(180)
            }
        })
    })

    describe("LerpAngle", () => {
        it("interpolates the short way around", () => {
            expect(Mathf.LerpAngle(350, 10, 0.5)).toBeCloseTo(360, 10)
            expect(Mathf.LerpAngle(0, 90, 0.5)).toBeCloseTo(45, 10)
        })
    })

    describe("MoveTowards", () => {
        it("never overshoots", () => {
            expect(Mathf.MoveTowards(0, 10, 3)).toBe(3)
            expect(Mathf.MoveTowards(0, 10, 100)).toBe(10)
            expect(Mathf.MoveTowards(10, 0, 100)).toBe(0)
        })
        it("moves backwards when the target is lower", () => {
            expect(Mathf.MoveTowards(10, 0, 3)).toBe(7)
        })
        it("returns the target when already there", () => {
            expect(Mathf.MoveTowards(5, 5, 3)).toBe(5)
        })
    })

    describe("MoveTowardsAngle", () => {
        it("crosses the wrap point the short way", () => {
            expect(Mathf.MoveTowardsAngle(350, 10, 5)).toBeCloseTo(355, 10)
        })
        it("snaps to the target when within maxDelta", () => {
            expect(Mathf.MoveTowardsAngle(350, 10, 90)).toBe(10)
        })
    })

    describe("SmoothStep", () => {
        it("hits the endpoints", () => {
            expect(Mathf.SmoothStep(0, 10, 0)).toBeCloseTo(0, 10)
            expect(Mathf.SmoothStep(0, 10, 1)).toBeCloseTo(10, 10)
        })
        it("is symmetric about the midpoint", () => {
            expect(Mathf.SmoothStep(0, 10, 0.5)).toBeCloseTo(5, 10)
        })
        it("clamps t", () => {
            expect(Mathf.SmoothStep(0, 10, -1)).toBeCloseTo(0, 10)
            expect(Mathf.SmoothStep(0, 10, 2)).toBeCloseTo(10, 10)
        })
        it("eases rather than moving linearly", () => {
            expect(Mathf.SmoothStep(0, 10, 0.25)).toBeLessThan(2.5)
            expect(Mathf.SmoothStep(0, 10, 0.75)).toBeGreaterThan(7.5)
        })
    })

    describe("Approximately", () => {
        it("treats float drift as equal", () => {
            expect(Mathf.Approximately(0.1 + 0.2, 0.3)).toBe(true)
            expect(Mathf.Approximately(1, 1.0000001)).toBe(true)
        })
        it("keeps meaningful differences distinct", () => {
            expect(Mathf.Approximately(1, 1.01)).toBe(false)
            expect(Mathf.Approximately(0, 1)).toBe(false)
        })
        it("scales tolerance with magnitude", () => {
            expect(Mathf.Approximately(1e6, 1e6 + 0.1)).toBe(true)
            expect(Mathf.Approximately(1e-6, 2e-6)).toBe(false)
        })
    })

    describe("constants", () => {
        it("matches Unity's conversion factors", () => {
            expect(Mathf.Deg2Rad * 180).toBeCloseTo(Math.PI, 12)
            expect(Mathf.Rad2Deg * Math.PI).toBeCloseTo(180, 12)
        })
    })
})
