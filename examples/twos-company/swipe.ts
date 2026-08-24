export type Direction = "left" | "right" | "up" | "down"

/** How far a finger has to travel, in stage units, before it counts. */
export const THRESHOLD = 28

export interface SwipeState {
    from: { x: number; y: number } | null
    /** Set once this gesture has fired, so it cannot fire twice. */
    spent: boolean
}

export function newSwipe(): SwipeState {
    return { from: null, spent: false }
}

export function begin(state: SwipeState, x: number, y: number): void {
    state.from = { x, y }
    state.spent = false
}

export function end(state: SwipeState): void {
    state.from = null
    state.spent = false
}

/** Returns a direction the first time this gesture passes the threshold, null otherwise. */
export function moveTo(state: SwipeState, x: number, y: number): Direction | null {
    if (state.from === null || state.spent) return null

    const dx = x - state.from.x
    const dy = y - state.from.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < THRESHOLD) return null

    state.spent = true
    // Screen coordinates count downward, so a positive dy is a swipe down.
    if (ax > ay) return dx > 0 ? "right" : "left"
    return dy > 0 ? "down" : "up"
}
