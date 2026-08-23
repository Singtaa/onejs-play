/**
 * Turning a finger into moves, with no oj and no board in sight.
 *
 * Separated from the display for the same reason the rules are: deciding
 * whether a drag was a tap is fiddly, easy to get subtly wrong, and much easier
 * to be sure of with a test than by playing on a phone and squinting.
 *
 * Everything is in stage units and seconds, which is what a frame loop already
 * has to hand.
 */

/** Travel that counts as one column of movement. */
export const SWIPE_STEP = 26
/** Movement still forgiven as a tap. A finger always drifts a little, and a
 *  rotate that needs a perfectly still finger feels broken. */
export const TAP_SLOP = 18
export const TAP_SECONDS = 0.25
/** Downward stage units per second that mean "drop it now". */
export const FLICK_SPEED = 900

export interface Gesture {
    x: number
    y: number
    /** Movement not yet spent on a column, so a long drag walks several. */
    dx: number
    /** Total downward travel, which decides a flick from a drag. */
    dy: number
    /** Distance travelled in any direction, which decides a tap from a drag. */
    travel: number
    held: number
    /**
     * Set when the piece this drag was aimed at has locked.
     *
     * A soft drop is aimed at one piece. When that piece lands, the next one
     * spawns under a finger that is still down and still counts as dragging
     * downward, so it drops too, and the player never gets the moment they
     * needed to lift. The intent was spent on the piece that landed, so the
     * drag stops dropping until the finger comes up.
     *
     * Sideways movement deliberately survives, because steering the new piece
     * with a finger already on the glass is the thing that feels right.
     */
    dropSpent: boolean
}

export function beginGesture(x: number, y: number): Gesture {
    return { x, y, dx: 0, dy: 0, travel: 0, held: 0, dropSpent: false }
}

/**
 * Folds a frame of finger movement in, and says how many columns to shift.
 *
 * Returns the count rather than moving anything, because whether a move fits is
 * the board's business and this file does not know about boards.
 */
export function advanceGesture(g: Gesture, x: number, y: number, dt: number): number {
    const mx = x - g.x
    const my = y - g.y
    g.x = x
    g.y = y
    g.dx += mx
    g.dy += my
    g.travel += Math.abs(mx) + Math.abs(my)
    g.held += dt

    let columns = 0
    while (Math.abs(g.dx) >= SWIPE_STEP) {
        const dir = g.dx > 0 ? 1 : -1
        columns += dir
        g.dx -= dir * SWIPE_STEP
    }
    return columns
}

export type Release = "rotate" | "drop" | "none"

/**
 * What lifting the finger meant.
 *
 * Tap first: a quick still touch is a rotate even if it drifted a pixel or two.
 * Then a flick, which is downward travel fast enough to read as a throw rather
 * than as a slow drag down the screen.
 */
export function releaseGesture(g: Gesture): Release {
    if (g.travel <= TAP_SLOP && g.held <= TAP_SECONDS) return "rotate"
    if (g.dropSpent) return "none"
    const speed = g.held > 0 ? g.dy / g.held : 0
    return speed >= FLICK_SPEED ? "drop" : "none"
}

/** Call when the piece this drag was driving has locked. */
export function spendDrop(g: Gesture): void {
    g.dropSpent = true
}

/** Whether a drag has gone far enough downward to read as a soft drop. */
export function isSoftDropping(g: Gesture): boolean {
    return !g.dropSpent && g.dy > SWIPE_STEP
}
