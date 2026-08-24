export const SWIPE_STEP = 26
export const TAP_SLOP = 18
export const TAP_SECONDS = 0.25
export const FLICK_SPEED = 900

export interface Gesture {
    x: number
    y: number
    dx: number
    dy: number
    travel: number
    held: number
    // Set when the piece this drag was aimed at has locked, so the next one
    // does not fall through under a finger that is still down.
    dropSpent: boolean
}

export function beginGesture(x: number, y: number): Gesture {
    return { x, y, dx: 0, dy: 0, travel: 0, held: 0, dropSpent: false }
}

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

export function releaseGesture(g: Gesture): Release {
    if (g.travel <= TAP_SLOP && g.held <= TAP_SECONDS) return "rotate"
    if (g.dropSpent) return "none"
    const speed = g.held > 0 ? g.dy / g.held : 0
    return speed >= FLICK_SPEED ? "drop" : "none"
}

export function spendDrop(g: Gesture): void {
    g.dropSpent = true
}

export function isSoftDropping(g: Gesture): boolean {
    return !g.dropSpent && g.dy > SWIPE_STEP
}
