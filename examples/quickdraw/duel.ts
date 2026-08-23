/**
 * The rules of a round, with no screen and no network in them.
 *
 * The header of index.tsx works out why a reaction can be measured honestly
 * with no clock shared between players. This file is the half of that argument
 * which can be tested: given what everybody claims about themselves, who won,
 * and does every client reach the same answer from the same claims.
 *
 * Two properties matter more than the rest, and both have tests:
 *
 *   resolve is order independent. The relay hands messages over in whatever
 *   order it processed them, and a client never receives its own, so no two
 *   clients hold the claims in the same order. If the outcome depended on that
 *   order, two people watching the same round would disagree about who won it.
 *
 *   resolve rejects the impossible, whoever sent it. A claim of two
 *   milliseconds is not a fast player, it is a client that answered before it
 *   could have seen anything, and it loses the round rather than winning it.
 *   That is the only cheat this design can refuse without a server, and it is
 *   worth having because it is the one a bored player tries first.
 */

/** How long the wait before a signal can be, in seconds. */
export const MIN_HOLD = 1.6
export const MAX_HOLD = 5

/** How long after the signal answers are still taken. */
export const REACTION_WINDOW = 2.6

/** How long the result stays up before the next round is armed. */
export const REST = 4

/** A round with nothing happening in it for this long has lost its host. */
export const STALE = 15

/**
 * Faster than a person, and slower than a board wants.
 *
 * The floor is the honest part of the design: nobody sees a light and answers
 * in eighty milliseconds, so a time under it is a client that was already
 * moving, and it is treated as a false start whether it was one or not. The
 * ceiling is only about the leaderboard: a second is a long time to look at a
 * signal, and a board full of them says nothing about anybody.
 */
export const FLOOR_MS = 80
export const CEILING_MS = 1000

export type Verdict = "early" | "counted" | "slow"

/** What a reported time is worth. Anything strange counts as a false start. */
export function classify(ms: number): Verdict {
    if (!Number.isFinite(ms) || ms < FLOOR_MS) return "early"
    if (ms >= CEILING_MS) return "slow"
    return "counted"
}

/** What one player says about their own round, and nothing about anybody else's. */
export interface Claim {
    /** The peer the relay stamped on the message. Never a field inside it. */
    id: number
    /** Milliseconds from their own signal to their own answer. */
    ms: number
    /** They say they moved before the signal. */
    jumped: boolean
}

/**
 * Records a claim, keeping the first one a player made.
 *
 * A second claim from the same player in the same round is either a duplicate
 * or somebody improving their answer after seeing everybody else's, and the
 * first is the only one that can be either honest or timely.
 */
export function addClaim(claims: readonly Claim[], claim: Claim): Claim[] {
    if (claims.some((existing) => existing.id === claim.id)) return [...claims]
    return [...claims, claim]
}

export interface Outcome {
    winner: number | null
    ms: number | null
}

/**
 * Who won the round.
 *
 * A pure function of the claims, so every client computes it rather than being
 * told: nobody is trusted to announce a winner, and there is nothing to
 * announce that everybody cannot work out. Fastest answer wins, false starts
 * and impossible times are not answers, and a tie goes to the lower peer id.
 *
 * The tie break is arbitrary and that is fine. Times are measured in frames,
 * so two players really can produce the same number, and the alternative to an
 * arbitrary rule is a round with no winner, which is worse to watch. It has to
 * be a rule every client applies identically, which is the only thing that
 * makes it a tie break rather than a coin toss.
 *
 * WHY ONLY A COUNTED TIME CAN WIN, AND NOT MERELY SCORE
 *
 * A round is closed by a message, and a claim in flight when that message goes
 * out reaches some clients before the close and others after it. That would be
 * a real disagreement about who won, and the only way to close it without a
 * server is to make every claim that could possibly be in that position
 * worthless to begin with. So the window for answers, in index.tsx, is more
 * than twice the ceiling: anything arriving anywhere near the close is already
 * slower than a second, and a slower answer than that cannot win a round on
 * any client. Two clients can therefore hold different claims and still
 * resolve the round identically, which is the property that matters.
 */
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

/**
 * A reaction as a leaderboard score.
 *
 * Boards here sort descending and hold non negative integers, and the thing
 * worth ranking is the smallest number rather than the largest, so it is
 * stored as the time left on the clock: how far under a second the answer was.
 * A 180 millisecond draw scores 820. The mapping is exact and reversible, so
 * the board can be printed back as times rather than as points, which is what
 * a player wants to read.
 *
 * Slower than the ceiling is not submitted at all, which is what keeps every
 * score on the board a real time rather than a floor of zeroes.
 */
export function scoreOf(ms: number): number {
    return Math.max(0, Math.min(CEILING_MS, CEILING_MS - Math.round(ms)))
}

/** The time a score was made from. The inverse of scoreOf, for printing. */
export function msOf(score: number): number {
    return CEILING_MS - score
}

/** Whether a time belongs on the board at all. */
export function submittable(ms: number): boolean {
    return classify(ms) === "counted"
}

/** How long to wait before the signal, from any source of randomness. */
export function holdFor(next: () => number): number {
    return MIN_HOLD + next() * (MAX_HOLD - MIN_HOLD)
}

/** The running tally of rounds won. */
export function credit(tally: Readonly<Record<number, number>>, id: number | null): Record<number, number> {
    if (id === null) return { ...tally }
    return { ...tally, [id]: (tally[id] ?? 0) + 1 }
}

/**
 * Who runs the clock.
 *
 * The lowest id in the room, which everybody can evaluate from the peer list
 * alone: no election, no messages, and an instant handover when the host
 * leaves. The host decides when a round is armed and when the signal fires,
 * because somebody has to and there is nobody else. It decides nothing about
 * who won: see resolve.
 */
export function hostOf(myId: number, peers: readonly number[]): number {
    let lowest = myId
    for (const peer of peers) if (peer < lowest) lowest = peer
    return lowest
}

export function isHost(myId: number, peers: readonly number[]): boolean {
    if (myId === 0) return true
    return hostOf(myId, peers) === myId
}
