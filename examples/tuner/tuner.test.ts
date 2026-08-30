import { describe, it, expect } from "vitest"
import { closeness, distance, isTuned, makeTarget, roundScore, TOLERANCE } from "./tuner"

const at = (warp: number, hue: number, speed: number) => ({ warp, hue, speed })

describe("targets", () => {
    it("never lands near the middle, where every dial already starts", () => {
        // A target at 0.5 is solved by touching nothing, which is not a round.
        let seed = 1
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let i = 0; i < 200; i++) {
            const t = makeTarget(rand)
            for (const v of [t.warp, t.hue, t.speed]) {
                expect(Math.abs(v - 0.5)).toBeGreaterThan(TOLERANCE)
                expect(v).toBeGreaterThanOrEqual(0)
                expect(v).toBeLessThanOrEqual(1)
            }
        }
    })
})

describe("tuning", () => {
    it("needs EVERY dial close, not the average", () => {
        // Averaging would let two perfect dials carry a hopeless third, so the
        // picture would count as matched while plainly not matching.
        const target = at(0.5, 0.5, 0.5)
        expect(isTuned(target, at(0.5, 0.5, 0.5))).toBe(true)
        expect(isTuned(target, at(0.5, 0.5, 0.95))).toBe(false)
        expect(distance(target, at(0.5, 0.5, 0.95))).toBeCloseTo(0.45, 5)
    })

    it("accepts anything inside the tolerance", () => {
        const target = at(0.3, 0.7, 0.2)
        expect(isTuned(target, at(0.3 + TOLERANCE, 0.7, 0.2))).toBe(true)
        expect(isTuned(target, at(0.3 + TOLERANCE + 0.001, 0.7, 0.2))).toBe(false)
    })
})

describe("the meter", () => {
    it("reads 1 when matched and 0 when half a turn away", () => {
        expect(closeness(0.4, 0.4)).toBe(1)
        expect(closeness(0, 0.5)).toBe(0)
        expect(closeness(0, 1)).toBe(0)
    })

    it("rises as you approach, which is the only feedback there is", () => {
        expect(closeness(0.2, 0.5)).toBeLessThan(closeness(0.4, 0.5))
    })
})

describe("scoring", () => {
    it("pays for speed and still pays for finishing slowly", () => {
        expect(roundScore(30)).toBeGreaterThan(roundScore(1))
        expect(roundScore(0)).toBeGreaterThan(0)
    })
})
