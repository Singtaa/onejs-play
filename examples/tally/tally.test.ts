import { describe, expect, it } from "vitest"
import { reduce, start, type State } from "./tally"

/**
 * The point of the sketch, checked the way the sketch claims you can check it:
 * no container, no screen, no render. A reducer is a function, so its rules
 * are a table of inputs and outputs.
 */
const play = (state: State, ...actions: Parameters<typeof reduce>[1][]): State =>
    actions.reduce(reduce, state)

describe("the tally", () => {
    it("counts for one player and leaves the others alone", () => {
        const after = play(start(3), { type: "score", who: 1 }, { type: "score", who: 1 })
        expect(after.scores).toEqual([0, 2, 0])
    })

    it("walks the last point back, whoever scored it", () => {
        const after = play(start(2),
            { type: "score", who: 0 }, { type: "score", who: 1 }, { type: "undo" })
        expect(after.scores).toEqual([1, 0])
    })

    it("undoes down to nothing and then stays there", () => {
        const after = play(start(2), { type: "score", who: 0 }, { type: "undo" }, { type: "undo" })
        expect(after.scores).toEqual([0, 0])
        expect(after.log).toEqual([])
    })

    it("keeps the player count through a reset", () => {
        const after = play(start(4), { type: "score", who: 3 }, { type: "reset" })
        expect(after).toEqual(start(4))
    })

    it("never changes the state it was given", () => {
        const before = start(2)
        play(before, { type: "score", who: 0 })
        expect(before.scores).toEqual([0, 0])
    })
})
