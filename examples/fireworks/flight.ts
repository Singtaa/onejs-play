// Screen y counts down, so up is negative and a shell is rising while vy is below zero.

export const GRAVITY = 620

export interface Rocket {
    x: number
    y: number
    vx: number
    vy: number
    shell: number
    heavy: boolean
}

export function speedToReach(rise: number): number {
    return Math.sqrt(2 * GRAVITY * Math.max(0, rise))
}

export function aim(
    fromX: number, groundY: number, targetX: number, targetY: number, shell: number, heavy: boolean,
): Rocket {
    const rise = groundY - targetY
    const vy = -speedToReach(rise)
    const climb = Math.abs(vy) / GRAVITY
    const vx = climb > 0.001 ? (targetX - fromX) / climb : 0
    return { x: fromX, y: groundY, vx, vy, shell, heavy }
}

export function advance(rocket: Rocket, dt: number): boolean {
    rocket.x += rocket.vx * dt
    // The dt squared term is not optional: without it a shell bursts short of the tap,
    // and further short the slower the display runs.
    rocket.y += rocket.vy * dt + 0.5 * GRAVITY * dt * dt
    rocket.vy += GRAVITY * dt
    return rocket.vy >= 0
}

export function wander(
    width: number, height: number, next: () => number,
): { x: number; y: number } {
    return {
        x: width * (0.15 + next() * 0.7),
        y: height * (0.12 + next() * 0.33),
    }
}
