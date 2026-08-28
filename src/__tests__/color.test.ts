import { describe, it, expect } from "vitest"
// A deliberate reach into the sibling's internals: this is a contract test
// on the wire normalization itself, which onejs-react does not export as API.
// eslint-disable-next-line no-restricted-imports
import { toWire } from "onejs-react/src/particles"
import { Color } from "../color"

/** The hex forms oj and the particle wire schema both have to agree on. */
const colorHexCases = [
    "#f00", "#0f08", "#ff8800", "#ff880080", "#000000", "#ffffffff",
    "ff8800", "#abc", "#1234", "#00000000",
]

describe("Color", () => {
    describe("statics are fresh instances", () => {
        it("does not leak a mutation", () => {
            const w = Color.white
            w.r = 0
            expect(Color.white.r).toBe(1)
        })
    })

    describe("FromHex", () => {
        it("expands the 3 digit form", () => {
            const c = Color.FromHex("#f00")
            expect(c.r).toBe(1)
            expect(c.g).toBe(0)
            expect(c.b).toBe(0)
            expect(c.a).toBe(1)
        })
        it("expands the 4 digit form, including alpha", () => {
            const c = Color.FromHex("#0f08")
            expect(c.g).toBe(1)
            expect(c.a).toBeCloseTo(0x88 / 255, 12)
        })
        it("parses the 6 digit form and defaults alpha to 1", () => {
            const c = Color.FromHex("#ff8800")
            expect(c.r).toBe(1)
            expect(c.g).toBeCloseTo(0x88 / 255, 12)
            expect(c.a).toBe(1)
        })
        it("parses the 8 digit form", () => {
            expect(Color.FromHex("#ff880080").a).toBeCloseTo(0x80 / 255, 12)
        })
        it("accepts a missing leading hash", () => {
            expect(Color.FromHex("ff8800").equals(Color.FromHex("#ff8800"))).toBe(true)
        })
        it("is case insensitive", () => {
            expect(Color.FromHex("#FF8800").equals(Color.FromHex("#ff8800"))).toBe(true)
        })
        it("rejects malformed input", () => {
            for (const bad of ["", "#", "#12", "#12345", "#1234567", "#gggggg", "not a color"]) {
                expect(() => Color.FromHex(bad)).toThrow(/invalid color/)
            }
        })
    })

    describe("hex parity with the particle wire schema", () => {
        // oj.Color and particles.ts each carry their own parser. This pins them
        // together so a change to either shows up as a failure here rather than
        // as a game whose particles are a different colour than its UI.
        it.each(colorHexCases)("agrees on %s", (hex) => {
            const wire = toWire({ max: 1, emitters: [{ colorOverLife: [hex] }] })
            const key = wire.emitters[0]!.colorKeys[0]!
            const c = Color.FromHex(hex)
            expect(key.r).toBeCloseTo(c.r, 15)
            expect(key.g).toBeCloseTo(c.g, 15)
            expect(key.b).toBeCloseTo(c.b, 15)
            expect(key.a).toBeCloseTo(c.a, 15)
        })
    })

    describe("toHex", () => {
        it("round-trips through FromHex", () => {
            for (const hex of ["#ff8800ff", "#00000000", "#123456ff"]) {
                expect(Color.FromHex(hex).toHex()).toBe(hex)
            }
        })
        it("always emits 8 digits with a leading hash", () => {
            expect(Color.white.toHex()).toBe("#ffffffff")
            expect(Color.clear.toHex()).toBe("#00000000")
        })
        it("clamps out-of-range components rather than emitting bad hex", () => {
            expect(new Color(2, -1, 0.5, 1).toHex()).toBe("#ff0080ff")
        })
    })

    describe("Lerp", () => {
        it("clamps t", () => {
            expect(Color.Lerp(Color.black, Color.white, 2).r).toBe(1)
            expect(Color.Lerp(Color.black, Color.white, -1).r).toBe(0)
        })
        it("interpolates alpha too", () => {
            expect(Color.Lerp(Color.clear, Color.white, 0.5).a).toBeCloseTo(0.5, 12)
        })
    })

    describe("helpers", () => {
        it("withAlpha leaves rgb alone and does not mutate", () => {
            const c = Color.red
            const f = c.withAlpha(0.25)
            expect(f.r).toBe(1)
            expect(f.a).toBe(0.25)
            expect(c.a).toBe(1)
        })
        it("mul scales rgb but not alpha", () => {
            const c = new Color(1, 1, 1, 0.5).mul(0.5)
            expect(c.r).toBe(0.5)
            expect(c.a).toBe(0.5)
        })
        it("computes luminance with Unity's coefficients", () => {
            expect(Color.white.grayscale).toBeCloseTo(1, 12)
            expect(Color.black.grayscale).toBe(0)
            expect(Color.red.grayscale).toBeCloseTo(0.299, 12)
        })
        it("builds from Color32 bytes", () => {
            expect(Color.FromBytes(255, 136, 0).equals(Color.FromHex("#ff8800"))).toBe(true)
        })
    })
})
