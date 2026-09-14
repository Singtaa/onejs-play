/**
 * The rules, as one pure function.
 *
 * Nothing here knows about React, a screen or a container: given a state and
 * an action it returns the next state. That is what lets tally.test.ts check
 * every rule without rendering anything, and it is why undo is four lines
 * rather than a feature. The log of what happened is already the state.
 */

export interface State {
    /** A running count per player. */
    scores: number[]
    /** Who scored, in order. Undo needs nothing else. */
    log: number[]
}

export type Action =
    | { type: "score"; who: number }
    | { type: "undo" }
    | { type: "reset" }

export const start = (players: number): State => ({ scores: Array(players).fill(0), log: [] })

export function reduce(state: State, action: Action): State {
    switch (action.type) {
        case "score":
            return { scores: bump(state.scores, action.who, 1), log: [...state.log, action.who] }
        case "undo": {
            const last = state.log[state.log.length - 1]
            if (last === undefined) return state
            return { scores: bump(state.scores, last, -1), log: state.log.slice(0, -1) }
        }
        case "reset":
            return start(state.scores.length)
    }
}

const bump = (scores: number[], who: number, by: number): number[] =>
    scores.map((n, i) => (i === who ? n + by : n))
