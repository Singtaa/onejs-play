/**
 * A wrapping playfield, and the things that collide in it.
 *
 * The whole file exists because of one deceptively simple rule: the field has
 * no edges. Fly off the right and you arrive on the left, and that is true for
 * drawing, for movement, and, most easily forgotten, for working out whether
 * two things are touching.
 *
 * A shot at x = 895 and a rock at x = 5 on a 900 wide field are ten apart, not
 * eight hundred and ninety. Measuring them the obvious way makes shots pass
 * straight through rocks near an edge, which looks like bad aim rather than a
 * bug and is why this is the part with the tests.
 */

/** Brings a coordinate back inside [0, size), including from far outside it. */
export function wrap(value: number, size: number): number {
    if (size <= 0) return 0
    // Not a bare `%`: JavaScript's remainder keeps the sign of the left hand
    // side, so -5 % 900 is -5 rather than 895. Adding a field and taking the
    // remainder again is also what turns the -0 that -900 % 900 produces back
    // into an ordinary zero, which matters because -0 compares equal to 0 but
    // prints and serialises differently.
    return ((value % size) + size) % size
}

/**
 * The shortest distance from a to b on one wrapping axis, signed.
 *
 * Never more than half the field: past that, going the other way round is
 * shorter, and the wrap is what makes that possible.
 */
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

/** Whether two circles overlap, measured the short way round on both axes. */
export function touching(
    field: Field,
    ax: number, ay: number, ar: number,
    bx: number, by: number, br: number,
): boolean {
    const dx = shortest(ax, bx, field.width)
    const dy = shortest(ay, by, field.height)
    const reach = ar + br
    // Squared, to keep a square root out of the inner loop of every frame.
    return dx * dx + dy * dy <= reach * reach
}

export interface Rock {
    x: number
    y: number
    vx: number
    vy: number
    /** Collision radius. Also the scale the outline is drawn at. */
    radius: number
    angle: number
    spin: number
    /**
     * The outline, as a radius multiplier per vertex, evenly spaced around the
     * circle. Stored rather than regenerated so a rock keeps its shape while it
     * turns, and inherited by its pieces so a split looks like a break.
     */
    outline: number[]
}

/** The three sizes a rock can be, largest first. */
export const SIZES = [42, 24, 13]

/** Points scored for breaking a rock of each size. */
export const VALUES = [20, 50, 100]

/** Which size band a radius belongs to, or -1 for something off the scale. */
export function sizeOf(radius: number): number {
    return SIZES.findIndex((size) => Math.abs(size - radius) < 0.5)
}

/**
 * An irregular outline, as multipliers around a circle.
 *
 * Kept between 0.72 and 1.15 of the nominal radius: lumpier than that and the
 * shape stops reading as a rock, rounder and it may as well be a circle. The
 * collision radius is the nominal one, so a shot can graze a dent and miss,
 * which is a fair trade for one cheap test per pair.
 */
export function outlineFor(points: number, next: () => number): number[] {
    const out: number[] = []
    for (let i = 0; i < points; i++) out.push(0.72 + next() * 0.43)
    return out
}

/**
 * What a rock leaves behind when it is hit.
 *
 * Two pieces of the next size down, thrown apart, or nothing at all for the
 * smallest. The pieces inherit the parent's drift so a break scatters forward
 * rather than exploding symmetrically out of a standstill.
 */
export function shatter(rock: Rock, next: () => number): Rock[] {
    const band = sizeOf(rock.radius)
    if (band < 0 || band >= SIZES.length - 1) return []
    const radius = SIZES[band + 1]!

    const pieces: Rock[] = []
    for (let i = 0; i < 2; i++) {
        // Thrown roughly apart rather than exactly, so a break is never a
        // mirror image of itself.
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

/**
 * Where a new wave's rocks come in.
 *
 * Along an edge rather than anywhere, because a rock materialising in the
 * middle of the field is indistinguishable from one that was already there and
 * feels like a cheat when it lands on the ship.
 */
export function edgeSpawn(field: Field, next: () => number): { x: number; y: number } {
    return next() < 0.5
        ? { x: next() * field.width, y: next() < 0.5 ? 0 : field.height }
        : { x: next() < 0.5 ? 0 : field.width, y: next() * field.height }
}
