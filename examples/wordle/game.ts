/**
 * Wordle rules, with no rendering and no oj in sight.
 *
 * Kept pure so it can be unit tested, which matters most for scoring: the
 * duplicate-letter rule is where nearly every Wordle clone goes wrong.
 */

export type LetterState = "correct" | "present" | "absent"

export const WORD_LENGTH = 5
export const MAX_GUESSES = 6

/**
 * Scores a guess against the answer.
 *
 * Two passes, because one is not enough. Marking "present" whenever the answer
 * merely contains the letter over-marks duplicates: guessing BOBBY against
 * ABBEY would light up three Bs when the answer only has two, one of which is
 * already an exact match. So exact matches are taken first and the remaining
 * answer letters become a supply that "present" draws down.
 */
export function scoreGuess(guess: string, answer: string): LetterState[] {
    const g = guess.toUpperCase()
    const a = answer.toUpperCase()
    const states: LetterState[] = new Array(g.length).fill("absent")

    /** Answer letters not already claimed by an exact match. */
    const supply = new Map<string, number>()

    for (let i = 0; i < g.length; i++) {
        if (g[i] === a[i]) {
            states[i] = "correct"
        } else {
            supply.set(a[i]!, (supply.get(a[i]!) ?? 0) + 1)
        }
    }

    for (let i = 0; i < g.length; i++) {
        if (states[i] === "correct") continue
        const left = supply.get(g[i]!) ?? 0
        if (left > 0) {
            states[i] = "present"
            supply.set(g[i]!, left - 1)
        }
    }

    return states
}

/** Rank used to keep the best state a letter has ever earned on the keyboard. */
const RANK: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 }

/**
 * The best state each letter has earned across every guess so far.
 *
 * Best, not latest: a letter shown correct in guess two must not drop back to
 * present because guess four put it somewhere else.
 */
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

/**
 * Why a guess was rejected, or null when it is fine to submit.
 *
 * Takes a predicate rather than an array so the accepted-guess set can be
 * stored however it likes. It is nearly 15,000 words, and holding that as an
 * array purely so this function can call includes() would cost both the
 * allocation and a linear scan per keystroke.
 */
export function rejectionReason(draft: string, accepts: (word: string) => boolean): string | null {
    if (draft.length < WORD_LENGTH) return "Not enough letters"
    if (!accepts(draft.toUpperCase())) return "Not in word list"
    return null
}
