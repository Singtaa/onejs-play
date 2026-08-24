export const POND_W = 2400
export const POND_H = 1600

export const START_SIZE = 18
export const MAX_SIZE = 120

export const EAT_RATIO = 1.18

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
    tone: number
    /**
     * Eaten pellets stay in the array with this cleared. An index is how
     * everyone refers to a pellet, so splicing would renumber the field under
     * every other client in the pond.
     */
    alive: boolean
}

export function speedOf(size: number): number {
    return 260 * Math.pow(START_SIZE / Math.max(START_SIZE, size), 0.55)
}

const areaOf = (size: number) => size * size

export function grow(size: number, byArea: number): number {
    return Math.min(MAX_SIZE, Math.sqrt(areaOf(size) + byArea))
}

export const PELLET_AREA = areaOf(PELLET_SIZE) * 3.2

export function canEat(eater: Fish, prey: Fish): boolean {
    if (eater.size < prey.size * EAT_RATIO) return false
    return overlaps(eater, prey, 0.75)
}

export function overlaps(a: Fish, b: Fish, bite: number): boolean {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const reach = a.size * bite
    return dx * dx + dy * dy <= reach * reach
}

export function contain(fish: Fish): void {
    fish.x = Math.min(POND_W - fish.size, Math.max(fish.size, fish.x))
    fish.y = Math.min(POND_H - fish.size, Math.max(fish.size, fish.y))
}

export function swim(fish: Fish, towardX: number, towardY: number, dt: number): void {
    const dx = towardX - fish.x
    const dy = towardY - fish.y
    const distance = Math.hypot(dx, dy)
    // A dead zone. Without it the fish overshoots the pointer every frame and
    // vibrates in place.
    if (distance < 2) return
    const step = Math.min(distance, speedOf(fish.size) * dt)
    fish.x += (dx / distance) * step
    fish.y += (dy / distance) * step
    contain(fish)
}

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

export function spawnPoint(next: () => number): { x: number; y: number } {
    return {
        x: POND_W * (0.15 + next() * 0.7),
        y: POND_H * (0.15 + next() * 0.7),
    }
}
