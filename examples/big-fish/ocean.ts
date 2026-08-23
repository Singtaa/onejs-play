/**
 * The rules of the pond, with no screen and no network in them.
 *
 * BIG FISH IS A RELAY GAME, AND THAT DECIDES THE RULES
 *
 * There is no server simulating anything: the site passes messages between
 * players and knows nothing about what they mean. So the rules have to be
 * written for a world where every client is the authority on itself and on
 * nothing else, and the single rule that makes that safe is:
 *
 *     You may only report your own death.
 *
 * A player broadcasts where they are and how big. When two fish overlap, each
 * one checks whether IT is the smaller, and if so it reports being eaten. The
 * eater learns it grew from that report, not by claiming a kill. A liar can
 * therefore refuse to die, which makes them a nuisance nobody can see, and can
 * never reach into anybody else's game and kill them.
 *
 * The alternative, letting the bigger fish declare the kill, is one line
 * shorter and hands every client the ability to eat anybody at any distance.
 */

export const POND_W = 2400
export const POND_H = 1600

/** Where a fish starts and the smallest it can be. */
export const START_SIZE = 18
export const MAX_SIZE = 120

/** How much bigger you have to be to eat somebody. */
export const EAT_RATIO = 1.18

/** Pellets on the map at once, and what each is worth. */
export const PELLET_COUNT = 220
export const PELLET_SIZE = 5

export interface Fish {
    x: number
    y: number
    size: number
}

export interface Pellet {
    x: number
    y: number
    /** Palette index, so a pellet keeps its colour as it is broadcast. */
    tone: number
    /**
     * Eaten pellets stay in the array with this cleared rather than being
     * removed, because an index is how everyone refers to one. Splicing would
     * renumber the field under every other client in the pond.
     */
    alive: boolean
}

/**
 * A fish's speed, which falls as it grows.
 *
 * Without this the biggest fish is also the fastest and the game has one
 * strategy. The curve is gentle: a maximum-size fish still moves at about a
 * third of a new one, which is slow enough to be escapable and fast enough not
 * to feel like a punishment for doing well.
 */
export function speedOf(size: number): number {
    return 260 * Math.pow(START_SIZE / Math.max(START_SIZE, size), 0.55)
}

/** Area, which is what growing actually adds. */
const areaOf = (size: number) => size * size

/** The size a fish becomes after swallowing something of a given size. */
export function grow(size: number, byArea: number): number {
    return Math.min(MAX_SIZE, Math.sqrt(areaOf(size) + byArea))
}

/** What eating one pellet is worth, in area. */
export const PELLET_AREA = areaOf(PELLET_SIZE) * 3.2

/**
 * Whether `eater` can swallow `prey`.
 *
 * Both the size margin and the overlap are required. Touching a fish your own
 * size does nothing, which is what lets two equals circle each other.
 */
export function canEat(eater: Fish, prey: Fish): boolean {
    if (eater.size < prey.size * EAT_RATIO) return false
    return overlaps(eater, prey, 0.75)
}

/** Circles overlapping, with `bite` deciding how far in the centre must be. */
export function overlaps(a: Fish, b: Fish, bite: number): boolean {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const reach = a.size * bite
    return dx * dx + dy * dy <= reach * reach
}

/** Keeps a fish in the pond, allowing for its own radius. */
export function contain(fish: Fish): void {
    fish.x = Math.min(POND_W - fish.size, Math.max(fish.size, fish.x))
    fish.y = Math.min(POND_H - fish.size, Math.max(fish.size, fish.y))
}

/**
 * Moves a fish toward a point at its own speed.
 *
 * The dead zone is what stops a fish jittering when the pointer is sitting on
 * top of it: without it the fish overshoots by a fraction every frame and
 * vibrates in place.
 */
export function swim(fish: Fish, towardX: number, towardY: number, dt: number): void {
    const dx = towardX - fish.x
    const dy = towardY - fish.y
    const distance = Math.hypot(dx, dy)
    if (distance < 2) return
    const step = Math.min(distance, speedOf(fish.size) * dt)
    fish.x += (dx / distance) * step
    fish.y += (dy / distance) * step
    contain(fish)
}

/** A pellet field, laid out from a given source of randomness. */
export function scatterPellets(count: number, next: () => number): Pellet[] {
    const out: Pellet[] = []
    for (let i = 0; i < count; i++) {
        out.push({
            x: PELLET_SIZE + next() * (POND_W - PELLET_SIZE * 2),
            y: PELLET_SIZE + next() * (POND_H - PELLET_SIZE * 2),
            tone: Math.floor(next() * 6),
            alive: true,
        })
    }
    return out
}

/**
 * Which pellets a fish just swallowed.
 *
 * Indices rather than the pellets themselves, because the caller has to tell
 * everybody else which ones went and an index is four bytes where a position is
 * two floats.
 */
export function pelletsEaten(fish: Fish, pellets: readonly Pellet[]): number[] {
    const eaten: number[] = []
    for (let i = 0; i < pellets.length; i++) {
        const pellet = pellets[i]!
        if (!pellet.alive) continue
        const dx = fish.x - pellet.x
        const dy = fish.y - pellet.y
        const reach = fish.size + PELLET_SIZE
        if (dx * dx + dy * dy <= reach * reach) eaten.push(i)
    }
    return eaten
}

/**
 * Where to put a fish that has just been eaten, or has just arrived.
 *
 * Away from the edges, because a fish that respawns in a corner has one
 * direction to flee in and usually dies again immediately.
 */
export function spawnPoint(next: () => number): { x: number; y: number } {
    return {
        x: POND_W * (0.15 + next() * 0.7),
        y: POND_H * (0.15 + next() * 0.7),
    }
}
