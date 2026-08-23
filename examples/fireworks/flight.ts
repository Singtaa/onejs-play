/**
 * The physics of a firework, with nothing on screen.
 *
 * A shell is thrown upward and bursts when it stops rising. That is the whole
 * model, and writing it as arithmetic rather than as animation buys two things:
 * a burst lands where the player aimed rather than approximately there, and the
 * awkward cases (a tap near the ground, a tap above where a shell could reach)
 * can be checked without watching for them.
 *
 * Screen coordinates count downward, which matters constantly here. Up is
 * negative, gravity is positive, and a shell is rising while `vy` is below zero.
 */

/** Downward acceleration, in stage units per second squared. */
export const GRAVITY = 620

export interface Rocket {
    x: number
    y: number
    vx: number
    vy: number
    /** Chosen at launch so every shell in the sky is not the same colour. */
    shell: number
    /** Bigger shells get the crackle. */
    heavy: boolean
}

/**
 * How fast something must leave the ground to just reach a given height.
 *
 * Straight out of `v² = 2gh`. Used rather than guessed at, because guessing
 * gives a shell that bursts above or below the tap and no amount of tuning
 * fixes the ones near the edges.
 */
export function speedToReach(rise: number): number {
    return Math.sqrt(2 * GRAVITY * Math.max(0, rise))
}

/**
 * A shell aimed at a point.
 *
 * It leaves from the bottom of the stage, under the target, and is given just
 * enough speed to arrive there with nothing left. The horizontal speed is
 * whatever covers the remaining distance in the time the climb takes, so the
 * shell leans toward the target rather than going straight up and drifting.
 */
export function aim(
    fromX: number, groundY: number, targetX: number, targetY: number, shell: number, heavy: boolean,
): Rocket {
    const rise = groundY - targetY
    const vy = -speedToReach(rise)
    // Time to the top, from v = at. Guarded because a target at or below the
    // ground gives a climb of zero, and dividing by it is how a shell ends up
    // at infinity.
    const climb = Math.abs(vy) / GRAVITY
    const vx = climb > 0.001 ? (targetX - fromX) / climb : 0
    return { x: fromX, y: groundY, vx, vy, shell, heavy }
}

/**
 * Moves a shell one frame. Returns true once it has stopped rising.
 *
 * Position is advanced by `v dt + ½ g dt²` rather than by `v dt`, which is not
 * a refinement: under constant acceleration it is exact, and the simpler form
 * is not. Stepping the velocity first and then moving at the new one loses
 * ½ g dt per second of flight, so at 120 frames a second a shell aimed at a tap
 * burst three units below it, and at 30 frames a second twelve. Aiming was
 * therefore visibly wrong on a slow display and fine on a fast one, which is
 * the worst way for a bug like this to present.
 */
export function advance(rocket: Rocket, dt: number): boolean {
    rocket.x += rocket.vx * dt
    rocket.y += rocket.vy * dt + 0.5 * GRAVITY * dt * dt
    rocket.vy += GRAVITY * dt
    // At or past the top. Checked after integrating, so a shell whose apex
    // falls between two frames bursts on the nearer one rather than visibly
    // dropping first.
    return rocket.vy >= 0
}

/**
 * Where an unaimed shell should go, for the ones that launch on their own.
 *
 * Kept away from the very edges and the very top: a burst clipped by the side
 * of the stage looks like a mistake, and one at the ceiling has nowhere to
 * fall. The fractions are of the stage, so this holds at any size.
 */
export function wander(
    width: number, height: number, next: () => number,
): { x: number; y: number } {
    return {
        x: width * (0.15 + next() * 0.7),
        y: height * (0.12 + next() * 0.33),
    }
}
