import { describe, it, expect } from "vitest"
import { Vector2 } from "../vec"

describe("Vector2", () => {
    describe("statics are fresh instances, not shared mutable singletons", () => {
        it("does not leak a mutation into the next reader", () => {
            const a = Vector2.zero
            a.x = 999
            expect(Vector2.zero.x).toBe(0)
        })
        it("gives distinct objects each time", () => {
            expect(Vector2.one).not.toBe(Vector2.one)
        })
    })

    describe("reference semantics differ from Unity's struct", () => {
        it("aliases on assignment, which C# would not", () => {
            const a = new Vector2(1, 2)
            const b = a
            b.x = 99
            expect(a.x).toBe(99)
        })
        it("clone gives what C# assignment would have", () => {
            const a = new Vector2(1, 2)
            const b = a.clone()
            b.x = 99
            expect(a.x).toBe(1)
        })
    })

    describe("magnitude", () => {
        it("computes length and squared length", () => {
            const v = new Vector2(3, 4)
            expect(v.magnitude).toBe(5)
            expect(v.sqrMagnitude).toBe(25)
        })
    })

    describe("normalized", () => {
        it("produces a unit vector", () => {
            expect(new Vector2(3, 4).normalized.magnitude).toBeCloseTo(1, 12)
        })
        it("returns zero for a zero vector rather than NaN", () => {
            const n = Vector2.zero.normalized
            expect(n.x).toBe(0)
            expect(n.y).toBe(0)
            expect(Number.isNaN(n.x)).toBe(false)
        })
        it("returns zero below Unity's kEpsilon rather than exploding", () => {
            const n = new Vector2(1e-9, 1e-9).normalized
            expect(n.x).toBe(0)
            expect(n.y).toBe(0)
        })
        it("does not mutate the source", () => {
            const v = new Vector2(3, 4)
            void v.normalized
            expect(v.x).toBe(3)
            expect(v.y).toBe(4)
        })

        // Unity writes the test as !(mag > kEpsilon), which sends NaN to zero.
        // Writing it as mag < kEpsilon divides by NaN instead and seeds NaN
        // into every coordinate downstream.
        it("returns zero for a NaN vector rather than propagating NaN", () => {
            const n = new Vector2(NaN, 1).normalized
            expect(n.x).toBe(0)
            expect(n.y).toBe(0)
        })

        it("returns zero at exactly kEpsilon, since Unity's test is strict", () => {
            expect(new Vector2(1e-5, 0).normalized.x).toBe(0)
        })

        it("normalizes just above kEpsilon", () => {
            expect(new Vector2(1.001e-5, 0).normalized.x).toBeCloseTo(1, 6)
        })
    })

    describe("arithmetic returns new instances", () => {
        it("leaves both operands untouched", () => {
            const a = new Vector2(1, 2)
            const b = new Vector2(3, 4)
            const c = a.add(b)
            expect(c.x).toBe(4)
            expect(a.x).toBe(1)
            expect(b.x).toBe(3)
        })
        it("supports sub, mul, div and negate", () => {
            const a = new Vector2(6, 8)
            expect(a.sub(new Vector2(1, 2)).equals(new Vector2(5, 6))).toBe(true)
            expect(a.mul(2).equals(new Vector2(12, 16))).toBe(true)
            expect(a.div(2).equals(new Vector2(3, 4))).toBe(true)
            expect(a.negate().equals(new Vector2(-6, -8))).toBe(true)
        })
    })

    describe("set and copyFrom mutate in place", () => {
        it("returns this so calls chain", () => {
            const v = new Vector2()
            expect(v.set(1, 2)).toBe(v)
            expect(v.x).toBe(1)
            const w = new Vector2().copyFrom(v)
            expect(w.equals(v)).toBe(true)
            expect(w).not.toBe(v)
        })
    })

    describe("Dot and Cross", () => {
        it("computes the dot product", () => {
            expect(Vector2.Dot(new Vector2(1, 0), new Vector2(0, 1))).toBe(0)
            expect(Vector2.Dot(new Vector2(2, 3), new Vector2(4, 5))).toBe(23)
        })
        it("gives a positive cross when b is counter-clockwise of a", () => {
            expect(Vector2.Cross(new Vector2(1, 0), new Vector2(0, 1))).toBe(1)
            expect(Vector2.Cross(new Vector2(0, 1), new Vector2(1, 0))).toBe(-1)
        })
    })

    describe("Distance", () => {
        it("matches the pythagorean result", () => {
            expect(Vector2.Distance(new Vector2(0, 0), new Vector2(3, 4))).toBe(5)
            expect(Vector2.SqrDistance(new Vector2(0, 0), new Vector2(3, 4))).toBe(25)
        })
    })

    describe("Lerp", () => {
        it("clamps t", () => {
            expect(Vector2.Lerp(Vector2.zero, new Vector2(10, 10), 2).x).toBe(10)
            expect(Vector2.Lerp(Vector2.zero, new Vector2(10, 10), -1).x).toBe(0)
        })
        it("does not clamp when unclamped", () => {
            expect(Vector2.LerpUnclamped(Vector2.zero, new Vector2(10, 10), 2).x).toBe(20)
        })
    })

    describe("MoveTowards", () => {
        it("never overshoots", () => {
            const r = Vector2.MoveTowards(Vector2.zero, new Vector2(10, 0), 100)
            expect(r.x).toBe(10)
        })
        it("steps by exactly maxDistanceDelta", () => {
            const r = Vector2.MoveTowards(Vector2.zero, new Vector2(10, 0), 3)
            expect(r.x).toBeCloseTo(3, 12)
        })
        it("handles a zero-length step without NaN", () => {
            const r = Vector2.MoveTowards(new Vector2(5, 5), new Vector2(5, 5), 3)
            expect(r.equals(new Vector2(5, 5))).toBe(true)
        })
    })

    describe("Angle and SignedAngle", () => {
        it("returns degrees in [0, 180]", () => {
            expect(Vector2.Angle(new Vector2(1, 0), new Vector2(0, 1))).toBeCloseTo(90, 10)
            expect(Vector2.Angle(new Vector2(1, 0), new Vector2(-1, 0))).toBeCloseTo(180, 10)
            expect(Vector2.Angle(new Vector2(1, 0), new Vector2(1, 0))).toBeCloseTo(0, 10)
        })
        it("is unaffected by magnitude", () => {
            expect(Vector2.Angle(new Vector2(5, 0), new Vector2(0, 9))).toBeCloseTo(90, 10)
        })
        it("returns 0 rather than NaN for a zero vector", () => {
            expect(Vector2.Angle(Vector2.zero, new Vector2(0, 1))).toBe(0)
        })

        // Unity guards the product of squared magnitudes against 1e-30 before
        // the square root. Guarding the root against kEpsilon instead looks
        // equivalent and silently returns 0 for small legitimate vectors.
        it("computes real angles for small vectors instead of collapsing to 0", () => {
            expect(Vector2.Angle(new Vector2(1e-3, 0), new Vector2(0, 1e-3))).toBeCloseTo(90, 6)
            expect(Vector2.Angle(new Vector2(1e-7, 0), new Vector2(0, 1e-7))).toBeCloseTo(90, 6)
        })

        it("still collapses to 0 once genuinely degenerate", () => {
            expect(Vector2.Angle(new Vector2(1e-9, 0), new Vector2(0, 1e-9))).toBe(0)
        })
        it("signs by rotation direction", () => {
            expect(Vector2.SignedAngle(new Vector2(1, 0), new Vector2(0, 1))).toBeCloseTo(90, 10)
            expect(Vector2.SignedAngle(new Vector2(0, 1), new Vector2(1, 0))).toBeCloseTo(-90, 10)
        })
    })

    describe("Perpendicular", () => {
        it("rotates 90 degrees counter-clockwise, matching Unity", () => {
            const p = Vector2.Perpendicular(new Vector2(1, 0))
            expect(p.x).toBeCloseTo(0, 12)
            expect(p.y).toBeCloseTo(1, 12)
        })
        it("stays orthogonal to the source", () => {
            const v = new Vector2(3, 7)
            expect(Vector2.Dot(v, Vector2.Perpendicular(v))).toBeCloseTo(0, 12)
        })
    })

    describe("Reflect", () => {
        it("bounces off a horizontal surface", () => {
            const r = Vector2.Reflect(new Vector2(1, -1), new Vector2(0, 1))
            expect(r.x).toBeCloseTo(1, 12)
            expect(r.y).toBeCloseTo(1, 12)
        })
        it("preserves magnitude against a unit normal", () => {
            const d = new Vector2(3, -4)
            expect(Vector2.Reflect(d, new Vector2(0, 1)).magnitude).toBeCloseTo(d.magnitude, 12)
        })
    })

    describe("ClampMagnitude", () => {
        it("shortens a long vector", () => {
            expect(Vector2.ClampMagnitude(new Vector2(30, 40), 5).magnitude).toBeCloseTo(5, 12)
        })
        it("leaves a short vector alone", () => {
            const v = new Vector2(3, 4)
            const c = Vector2.ClampMagnitude(v, 100)
            expect(c.equals(v)).toBe(true)
            expect(c).not.toBe(v)
        })
    })

    describe("FromAngle", () => {
        it("builds a unit vector at the given radians", () => {
            const v = Vector2.FromAngle(0)
            expect(v.x).toBeCloseTo(1, 12)
            expect(v.y).toBeCloseTo(0, 12)
            expect(Vector2.FromAngle(Math.PI / 2).y).toBeCloseTo(1, 12)
        })
        it("honours the length argument", () => {
            expect(Vector2.FromAngle(1.234, 7).magnitude).toBeCloseTo(7, 12)
        })
    })
})
