import { describe, it, expect } from "vitest"
import { scoreGuess, keyboardStates, statusOf, rejectionReason } from "./game"
import { ANSWERS, GUESS_COUNT, isAcceptedGuess } from "./words"

describe("scoreGuess", () => {
    it("marks an exact match", () => {
        expect(scoreGuess("CRANE", "CRANE")).toEqual(Array(5).fill("correct"))
    })

    it("marks a miss", () => {
        expect(scoreGuess("BUMPS", "CRANE")).toEqual(Array(5).fill("absent"))
    })

    // The rule every Wordle clone gets wrong. BOBBY has three Bs, ABBEY has
    // two, and one of those is already an exact match, so exactly one B may
    // come back present and the other must be absent.
    it("does not over-mark duplicate letters", () => {
        expect(scoreGuess("BOBBY", "ABBEY")).toEqual(["present", "absent", "correct", "absent", "correct"])
    })

    it("draws present from the letters exact matches did not claim", () => {
        expect(scoreGuess("BABES", "ABBEY")).toEqual(["present", "present", "correct", "correct", "absent"])
    })

    it("handles a guess with more of a letter than the answer holds", () => {
        expect(scoreGuess("SPEED", "ERASE")).toEqual(["present", "absent", "present", "present", "absent"])
    })

    it("spreads a repeated answer letter across repeated guess letters", () => {
        expect(scoreGuess("EAGLE", "LEVEL")).toEqual(["present", "absent", "absent", "present", "present"])
    })

    it("is case insensitive", () => {
        expect(scoreGuess("crane", "CRANE")).toEqual(Array(5).fill("correct"))
    })

    it("never returns more marks than the answer has of that letter", () => {
        for (const answer of ANSWERS.slice(0, 60)) {
            for (const guess of ANSWERS.slice(0, 60)) {
                const states = scoreGuess(guess, answer)
                for (const letter of new Set(guess)) {
                    const marked = [...guess].filter((c, i) => c === letter && states[i] !== "absent").length
                    const available = [...answer].filter((c) => c === letter).length
                    expect(marked).toBeLessThanOrEqual(available)
                }
            }
        }
    })
})

describe("keyboardStates", () => {
    it("keeps the best state a letter has earned, not the latest", () => {
        // C is correct in the first guess and merely present in the second.
        const states = keyboardStates(["CRANE", "SCARF"], "CRANE")
        expect(states.C).toBe("correct")
    })

    it("promotes absent to present when a later guess finds it", () => {
        const states = keyboardStates(["BUMPS", "CRANE"], "CRANE")
        expect(states.C).toBe("correct")
        expect(states.B).toBe("absent")
    })

    it("leaves untouched letters undefined", () => {
        expect(keyboardStates(["CRANE"], "CRANE").Z).toBeUndefined()
    })
})

describe("statusOf", () => {
    it("is playing before the last guess", () => {
        expect(statusOf(["BUMPS"], "CRANE")).toBe("playing")
    })
    it("is won when the last guess matches", () => {
        expect(statusOf(["BUMPS", "CRANE"], "CRANE")).toBe("won")
    })
    it("is lost after six wrong guesses", () => {
        expect(statusOf(Array(6).fill("BUMPS"), "CRANE")).toBe("lost")
    })
    it("is won even on the sixth guess", () => {
        expect(statusOf([...Array(5).fill("BUMPS"), "CRANE"], "CRANE")).toBe("won")
    })
})

describe("rejectionReason", () => {
    it("rejects a short guess", () => {
        expect(rejectionReason("CRA", isAcceptedGuess)).toMatch(/Not enough/)
    })
    it("rejects a word not in the list", () => {
        expect(rejectionReason("ZZZZZ", isAcceptedGuess)).toMatch(/Not in word list/)
    })
    it("accepts a real word", () => {
        expect(rejectionReason("CRANE", isAcceptedGuess)).toBeNull()
    })
    it("accepts lowercase", () => {
        expect(rejectionReason("crane", isAcceptedGuess)).toBeNull()
    })
})

describe("the word lists", () => {
    it("accepts the openers players actually type", () => {
        // The bug this guards: one 380-word list served as both the answer pool
        // and the accepted-guess set, so every one of these bounced.
        for (const opener of ["SLATE", "AUDIO", "ADIEU", "ARISE", "TEARS", "CRANE", "ROATE", "STARE"]) {
            expect(isAcceptedGuess(opener)).toBe(true)
        }
    })

    it("accepts lowercase, since that is what a player types", () => {
        expect(isAcceptedGuess("slate")).toBe(true)
    })

    it("rejects non-words and wrong lengths", () => {
        for (const bad of ["ZZZZZ", "QQQQQ", "ABCDE"]) expect(isAcceptedGuess(bad)).toBe(false)
        expect(isAcceptedGuess("CRAN")).toBe(false)
        expect(isAcceptedGuess("CRANES")).toBe(false)
        expect(isAcceptedGuess("")).toBe(false)
    })

    it("can guess every answer, or a puzzle would be unwinnable", () => {
        for (const answer of ANSWERS) expect(isAcceptedGuess(answer)).toBe(true)
    })

    it("holds a whole number of words", () => {
        expect(GUESS_COUNT).toBe(Math.floor(GUESS_COUNT))
        expect(GUESS_COUNT).toBeGreaterThan(10000)
    })
})
