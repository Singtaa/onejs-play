export type LetterState = "correct" | "present" | "absent"

export const WORD_LENGTH = 5
export const MAX_GUESSES = 6

// Exact matches claim their letter first, so a repeated letter is never marked
// present more often than the answer actually holds it.
export function scoreGuess(guess: string, answer: string): LetterState[] {
    const g = guess.toUpperCase()
    const a = answer.toUpperCase()
    const states: LetterState[] = new Array(g.length).fill("absent")
    const unclaimed = new Map<string, number>()

    for (let i = 0; i < g.length; i++) {
        if (g[i] === a[i]) {
            states[i] = "correct"
        } else {
            unclaimed.set(a[i]!, (unclaimed.get(a[i]!) ?? 0) + 1)
        }
    }

    for (let i = 0; i < g.length; i++) {
        if (states[i] === "correct") continue
        const left = unclaimed.get(g[i]!) ?? 0
        if (left > 0) {
            states[i] = "present"
            unclaimed.set(g[i]!, left - 1)
        }
    }

    return states
}

const RANK: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 }

export function keyboardStates(guesses: string[], answer: string): Record<string, LetterState> {
    const out: Record<string, LetterState> = {}
    for (const guess of guesses) {
        const states = scoreGuess(guess, answer)
        for (let i = 0; i < guess.length; i++) {
            const letter = guess[i]!.toUpperCase()
            const next = states[i]!
            const prev = out[letter]
            if (prev === undefined || RANK[next] > RANK[prev]) out[letter] = next
        }
    }
    return out
}

export type Status = "playing" | "won" | "lost"

export function statusOf(guesses: string[], answer: string): Status {
    if (guesses.length > 0 && guesses[guesses.length - 1]!.toUpperCase() === answer.toUpperCase()) return "won"
    return guesses.length >= MAX_GUESSES ? "lost" : "playing"
}

export function rejectionReason(draft: string, accepts: (word: string) => boolean): string | null {
    if (draft.length < WORD_LENGTH) return "Not enough letters"
    if (!accepts(draft.toUpperCase())) return "Not in word list"
    return null
}
