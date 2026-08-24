export function wrap(value: number, size: number): number {
    if (size <= 0) return 0
    // Twice, not once: JavaScript's remainder keeps the sign of the left side.
    return ((value % size) + size) % size
}

export function shortest(a: number, b: number, size: number): number {
    if (size <= 0) return 0
    let delta = wrap(b, size) - wrap(a, size)
    if (delta > size / 2) delta -= size
    if (delta < -size / 2) delta += size
    return delta
}

export interface Field {
    width: number
    height: number
}

export function touching(
    field: Field,
    ax: number, ay: number, ar: number,
    bx: number, by: number, br: number,
): boolean {
    const dx = shortest(ax, bx, field.width)
    const dy = shortest(ay, by, field.height)
    const reach = ar + br
    return dx * dx + dy * dy <= reach * reach
}

export interface Rock {
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    angle: number
    spin: number
    /** One radius multiplier per vertex, evenly spaced around the circle. */
    outline: number[]
}

export const SIZES = [42, 24, 13]

export const VALUES = [20, 50, 100]

export function sizeOf(radius: number): number {
    return SIZES.findIndex((size) => Math.abs(size - radius) < 0.5)
}

export function outlineFor(points: number, next: () => number): number[] {
    const out: number[] = []
    for (let i = 0; i < points; i++) out.push(0.72 + next() * 0.43)
    return out
}

export function shatter(rock: Rock, next: () => number): Rock[] {
    const band = sizeOf(rock.radius)
    if (band < 0 || band >= SIZES.length - 1) return []
    const radius = SIZES[band + 1]!

    const pieces: Rock[] = []
    for (let i = 0; i < 2; i++) {
        const angle = next() * Math.PI * 2
        const speed = 26 + next() * 46
        pieces.push({
            x: rock.x,
            y: rock.y,
            vx: rock.vx + Math.cos(angle) * speed,
            vy: rock.vy + Math.sin(angle) * speed,
            radius,
            angle: next() * Math.PI * 2,
            spin: (next() - 0.5) * 2.4,
            outline: outlineFor(rock.outline.length, next),
        })
    }
    return pieces
}

export function edgeSpawn(field: Field, next: () => number): { x: number; y: number } {
    return next() < 0.5
        ? { x: next() * field.width, y: next() < 0.5 ? 0 : field.height }
        : { x: next() < 0.5 ? 0 : field.width, y: next() * field.height }
}
