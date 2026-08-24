export const MIN_HOLD = 1.6
export const MAX_HOLD = 5

export const REACTION_WINDOW = 2.6

export const REST = 3

export const STALE = 15

/** Nobody sees a word and answers in 80ms, so anything faster was a guess. */
export const FLOOR_MS = 80
export const CEILING_MS = 1000

export type Verdict = "early" | "counted" | "slow"

export function classify(ms: number): Verdict {
    if (!Number.isFinite(ms) || ms < FLOOR_MS) return "early"
    if (ms >= CEILING_MS) return "slow"
    return "counted"
}

export interface Claim {
    id: number
    ms: number
    jumped: boolean
}

export function addClaim(claims: readonly Claim[], claim: Claim): Claim[] {
    if (claims.some((existing) => existing.id === claim.id)) return [...claims]
    return [...claims, claim]
}

export interface Outcome {
    winner: number | null
    ms: number | null
}

/** Only a counted time can win, so a claim that crosses the close cannot change it. */
export function resolve(claims: readonly Claim[]): Outcome {
    let winner: number | null = null
    let best = Infinity
    for (const claim of claims) {
        if (claim.jumped) continue
        if (classify(claim.ms) !== "counted") continue
        if (claim.ms < best || (claim.ms === best && winner !== null && claim.id < winner)) {
            best = claim.ms
            winner = claim.id
        }
    }
    return winner === null ? { winner: null, ms: null } : { winner, ms: best }
}

/** Boards sort downward, so a score is the time left on the clock. */
export function scoreOf(ms: number): number {
    return Math.max(0, Math.min(CEILING_MS, CEILING_MS - Math.round(ms)))
}

export function msOf(score: number): number {
    return CEILING_MS - score
}

export function submittable(ms: number): boolean {
    return classify(ms) === "counted"
}

export function holdFor(next: () => number): number {
    return MIN_HOLD + next() * (MAX_HOLD - MIN_HOLD)
}

export function credit(tally: Readonly<Record<number, number>>, id: number | null): Record<number, number> {
    if (id === null) return { ...tally }
    return { ...tally, [id]: (tally[id] ?? 0) + 1 }
}
