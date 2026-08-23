/**
 * Turning a finger into one of four directions, with nothing else in sight.
 *
 * A swipe looks trivial and is not. Three things have to be right, and each of
 * them is a bug somebody has shipped:
 *
 *   it must fire once per gesture, not once per frame the finger is moving;
 *   a short drag must not count, or every tap becomes a swipe in whichever
 *   direction the finger wobbled;
 *   the two axes must be compared, or a mostly-sideways drag with a little
 *   downward drift is read as "down".
 *
 * Pure functions over a tiny bit of state, so all of that is testable without a
 * screen or a finger.
 */

export type Direction = "left" | "right" | "up" | "down"

/** How far a finger has to travel, in stage units, before it counts. */
export const THRESHOLD = 28

export interface SwipeState {
    /** Where the finger went down, or null when no finger is down. */
    from: { x: number; y: number } | null
    /** Set once this gesture has fired, so it cannot fire twice. */
    spent: boolean
}

export function newSwipe(): SwipeState {
    return { from: null, spent: false }
}

/** The finger touched down. Any gesture in progress is abandoned. */
export function begin(state: SwipeState, x: number, y: number): void {
    state.from = { x, y }
    state.spent = false
}

/** The finger lifted, or the gesture was cancelled. */
export function end(state: SwipeState): void {
    state.from = null
    state.spent = false
}

/**
 * The finger moved. Returns a direction the first time this gesture passes the
 * threshold, and null every other time, including for the rest of that gesture.
 *
 * Firing on movement rather than on release is what makes the board feel like
 * it is being pushed rather than commanded: the tiles go the moment the intent
 * is clear, while the finger is still down.
 */
export function moveTo(state: SwipeState, x: number, y: number): Direction | null {
    if (state.from === null || state.spent) return null

    const dx = x - state.from.x
    const dy = y - state.from.y
    // Compared as absolutes so the larger axis wins outright. Checking one axis
    // and then the other would let a diagonal report whichever was tested first.
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < THRESHOLD) return null

    state.spent = true
    // Screen coordinates count downward, so a positive dy is a swipe down.
    if (ax > ay) return dx > 0 ? "right" : "left"
    return dy > 0 ? "down" : "up"
}
