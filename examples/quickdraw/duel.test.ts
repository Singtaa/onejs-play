import { describe, it, expect } from "vitest"
import {
    classify,
    addClaim,
    resolve,
    scoreOf,
    msOf,
    submittable,
    holdFor,
    credit,
    FLOOR_MS,
    CEILING_MS,
    MIN_HOLD,
    MAX_HOLD,
    REACTION_WINDOW,
    type Claim,
} from "./duel"

const claim = (id: number, ms: number, jumped = false): Claim => ({ id, ms, jumped })

function shuffled<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const swap = out[i]!
        out[i] = out[j]!
        out[j] = swap
    }
    return out
}

describe("what a reported time is worth", () => {
    it("takes a human reaction", () => {
        expect(classify(180)).toBe("counted")
        expect(classify(FLOOR_MS)).toBe("counted")
        expect(classify(CEILING_MS - 1)).toBe("counted")
    })

    it("treats anything faster than a person as a false start", () => {
        expect(classify(FLOOR_MS - 1)).toBe("early")
        expect(classify(0)).toBe("early")
        expect(classify(-40)).toBe("early")
    })

    it("refuses nonsense rather than believing it", () => {
        expect(classify(NaN)).toBe("early")
        expect(classify(Infinity)).toBe("early")
        expect(classify(-Infinity)).toBe("early")
        expect(resolve([claim(1, NaN), claim(2, Infinity)]).winner).toBe(null)
    })

    it("counts a slow answer as an answer, just not a score", () => {
        expect(classify(CEILING_MS)).toBe("slow")
        expect(submittable(CEILING_MS)).toBe(false)
        expect(submittable(220)).toBe(true)
        expect(submittable(12)).toBe(false)
    })
})

describe("collecting claims", () => {
    it("keeps the first thing a player said", () => {
        const first = addClaim([], claim(4, 300))
        expect(addClaim(first, claim(4, 90))).toEqual([claim(4, 300)])
    })

    it("leaves the list it was given alone", () => {
        const before: Claim[] = []
        addClaim(before, claim(1, 200))
        expect(before).toEqual([])
    })

    it("takes one claim from each player", () => {
        let claims: Claim[] = []
        for (const id of [3, 1, 9, 3, 1]) claims = addClaim(claims, claim(id, 200 + id))
        expect(claims.map((c) => c.id)).toEqual([3, 1, 9])
    })
})

describe("who won the round", () => {
    it("is the fastest answer", () => {
        expect(resolve([claim(1, 300), claim(2, 210), claim(3, 450)]).winner).toBe(2)
    })

    it("reaches the same answer whatever order the claims arrived in", () => {
        for (let i = 0; i < 500; i++) {
            const claims: Claim[] = []
            const size = 2 + Math.floor(Math.random() * 8)
            for (let id = 1; id <= size; id++) {
                const roll = Math.random()
                claims.push(claim(
                    id,
                    roll < 0.15 ? Math.random() * FLOOR_MS : 100 + Math.random() * 900,
                    roll > 0.9,
                ))
            }
            const expected = resolve(claims)
            for (let take = 0; take < 5; take++) {
                expect(resolve(shuffled(claims))).toEqual(expected)
            }
        }
    })

    it("never lets a false start win, however fast it says it was", () => {
        expect(resolve([claim(1, 5, true), claim(2, 400)]).winner).toBe(2)
        expect(resolve([claim(1, 120, true)]).winner).toBe(null)
    })

    it("throws out a time nobody could have made", () => {
        expect(resolve([claim(1, 2), claim(2, 240)]).winner).toBe(2)
        expect(resolve([claim(1, 0), claim(2, 0)]).winner).toBe(null)
    })

    it("gives a tie to the lower id, the same way on every client", () => {
        expect(resolve([claim(7, 250), claim(3, 250)]).winner).toBe(3)
        expect(resolve([claim(3, 250), claim(7, 250)]).winner).toBe(3)
    })

    it("has no winner when nobody answered", () => {
        expect(resolve([])).toEqual({ winner: null, ms: null })
        expect(resolve([claim(1, 30), claim(2, 200, true)])).toEqual({ winner: null, ms: null })
    })

    it("gives a round where everybody was slower than the ceiling to nobody", () => {
        expect(resolve([claim(5, 1400), claim(6, 40)]).winner).toBe(null)
        expect(resolve([claim(5, CEILING_MS - 1)]).winner).toBe(5)
    })

    it("only ever names a time that belongs on the board", () => {
        for (let i = 0; i < 500; i++) {
            const claims: Claim[] = []
            for (let id = 1; id <= 4; id++) claims.push(claim(id, Math.random() * 2500, Math.random() < 0.2))
            const outcome = resolve(claims)
            if (outcome.ms === null) continue
            expect(submittable(outcome.ms)).toBe(true)
        }
    })

    it("reports the winning time along with the winner", () => {
        expect(resolve([claim(1, 300), claim(2, 210)])).toEqual({ winner: 2, ms: 210 })
    })
})

describe("a time as a score", () => {
    it("is what a board that sorts downward needs: faster is a bigger number", () => {
        for (let i = 0; i < 500; i++) {
            const quick = FLOOR_MS + Math.random() * 400
            const slow = quick + 1 + Math.random() * 400
            expect(scoreOf(quick)).toBeGreaterThan(scoreOf(slow))
        }
    })

    it("is a whole number a board will take", () => {
        for (let ms = FLOOR_MS; ms < CEILING_MS; ms += 0.37) {
            const score = scoreOf(ms)
            expect(Number.isInteger(score)).toBe(true)
            expect(score).toBeGreaterThanOrEqual(0)
            expect(score).toBeLessThan(1e9)
        }
    })

    it("reads back as the time it was made from", () => {
        for (let i = 0; i < 500; i++) {
            const ms = Math.round(FLOOR_MS + Math.random() * (CEILING_MS - FLOOR_MS - 1))
            expect(msOf(scoreOf(ms))).toBe(ms)
        }
    })

    it("stays in range even for a time that should never be submitted", () => {
        expect(scoreOf(-500)).toBe(CEILING_MS)
        expect(scoreOf(99999)).toBe(0)
    })
})

describe("the wait before the signal", () => {
    it("is never so short that a round starts on top of the last one", () => {
        for (let i = 0; i < 500; i++) {
            const hold = holdFor(Math.random)
            expect(hold).toBeGreaterThanOrEqual(MIN_HOLD)
            expect(hold).toBeLessThanOrEqual(MAX_HOLD)
        }
    })

    it("is different from round to round", () => {
        const holds = new Set<number>()
        for (let i = 0; i < 40; i++) holds.add(holdFor(Math.random))
        expect(holds.size).toBeGreaterThan(30)
    })

    it("leaves a window far longer than any time that can win", () => {
        expect(REACTION_WINDOW * 1000).toBeGreaterThan(CEILING_MS * 2)
    })
})

describe("the tally", () => {
    it("counts a win, and nothing for a round nobody won", () => {
        expect(credit({}, 3)).toEqual({ 3: 1 })
        expect(credit({ 3: 4 }, 3)).toEqual({ 3: 5 })
        expect(credit({ 3: 4 }, null)).toEqual({ 3: 4 })
    })
})

