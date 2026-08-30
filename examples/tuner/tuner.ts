/**
 * The rules of Tuner, with no screen anywhere in them.
 *
 * Same split every example here uses: the rules are ordinary functions with
 * unit tests, and index.tsx draws them. It is also what makes a game readable
 * to somebody who forks it.
 */

/** The three values a round asks you to match. Each is 0..1. */
export interface Dials {
    warp: number
    hue: number
    speed: number
}

export const DIAL_NAMES = ["warp", "hue", "speed"] as const
export type DialName = (typeof DIAL_NAMES)[number]

/** How close counts as tuned, per dial. */
export const TOLERANCE = 0.06
export const ROUND_SECONDS = 30

export function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * A target far enough from the middle to be worth hunting.
 *
 * Pushed away from 0.5 on purpose: a target near the centre is solved by
 * leaving every dial where it starts, which is not a round.
 */
export function makeTarget(rand: () => number): Dials {
    const away = () => {
        const v = rand()
        return v < 0.5 ? v * 0.7 : 1 - (1 - v) * 0.7
    }
    return { warp: away(), hue: away(), speed: away() }
}

export function distance(a: Dials, b: Dials): number {
    return Math.max(
        Math.abs(a.warp - b.warp),
        Math.abs(a.hue - b.hue),
        Math.abs(a.speed - b.speed),
    )
}

export function isTuned(a: Dials, b: Dials): boolean {
    return distance(a, b) <= TOLERANCE
}

/**
 * Per dial closeness, 0 to 1, for the meter beside each one.
 *
 * The meter is the whole game: without it you are guessing at a picture, and
 * with it you are converging on one.
 */
export function closeness(a: number, b: number): number {
    return clamp01(1 - Math.abs(a - b) / 0.5)
}

/**
 * Score for a solved round. Faster is worth more, and every round is worth
 * something, because a round that pays nothing reads as a punishment for
 * playing rather than a reward for finishing.
 */
export function roundScore(secondsLeft: number): number {
    return 100 + Math.round(Math.max(0, secondsLeft) * 20)
}
