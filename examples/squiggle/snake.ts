export const WORLD_W = 3200
export const WORLD_H = 2400

export const SPEED = 195
export const BOOST_SPEED = 345

export const TURN_RATE = 3.2

export const START_LENGTH = 130
export const MAX_LENGTH = 1500

// Must stay below 2 * MIN_RADIUS, or a head slips between two points of a line.
export const NODE_GAP = 5

export const MIN_RADIUS = 5
export const MAX_RADIUS = 12

export const GRAZE = 0.5

export const BOOST_COST = 26
export const BOOST_FLOOR = START_LENGTH + 30

export const ORB_COUNT = 260
export const ORB_SIZE = 5
export const ORB_VALUE = 12

export interface Point {
    x: number
    y: number
}

export interface Snake {
    x: number
    y: number
    angle: number
    length: number
    nodes: Point[]
}

export interface Orb {
    x: number
    y: number
    tone: number
    alive: boolean
}

export function makeSnake(x: number, y: number, angle: number): Snake {
    return { x, y, angle, length: START_LENGTH, nodes: [{ x, y }] }
}

export function normalizeAngle(angle: number): number {
    const turn = Math.PI * 2
    const wrapped = angle % turn
    if (wrapped <= -Math.PI) return wrapped + turn
    if (wrapped > Math.PI) return wrapped - turn
    return wrapped
}

export function steer(angle: number, desired: number, dt: number): number {
    const difference = normalizeAngle(desired - angle)
    const most = TURN_RATE * Math.max(0, dt)
    const step = Math.max(-most, Math.min(most, difference))
    return normalizeAngle(angle + step)
}

export function radiusOf(length: number): number {
    const grown = (Math.max(START_LENGTH, length) - START_LENGTH) / (MAX_LENGTH - START_LENGTH)
    return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(Math.min(1, grown))
}

export function nodeBudget(length: number): number {
    return Math.max(2, Math.ceil(Math.max(0, length) / NODE_GAP))
}

export function grow(length: number, by: number): number {
    return Math.min(MAX_LENGTH, Math.max(0, length + by))
}

export function advance(snake: Snake, dt: number, boosting: boolean): void {
    const speed = boosting ? BOOST_SPEED : SPEED
    snake.x += Math.cos(snake.angle) * speed * dt
    snake.y += Math.sin(snake.angle) * speed * dt
    layTrail(snake)
}

export function layTrail(snake: Snake): void {
    let last = snake.nodes[0]
    if (last === undefined) {
        snake.nodes.unshift({ x: snake.x, y: snake.y })
        last = snake.nodes[0]!
    }
    for (let guard = 0; guard < 4096; guard++) {
        const dx = snake.x - last!.x
        const dy = snake.y - last!.y
        const distance = Math.hypot(dx, dy)
        if (distance < NODE_GAP) break
        const point = {
            x: last!.x + (dx / distance) * NODE_GAP,
            y: last!.y + (dy / distance) * NODE_GAP,
        }
        snake.nodes.unshift(point)
        last = point
    }
    const keep = nodeBudget(snake.length)
    if (snake.nodes.length > keep) snake.nodes.length = keep
}

export function resetTrail(snake: Snake): void {
    snake.nodes.length = 0
    snake.nodes.push({ x: snake.x, y: snake.y })
}

export function hitsBody(hx: number, hy: number, headRadius: number, other: Snake): boolean {
    const bodyRadius = radiusOf(other.length)
    const reach = headRadius * GRAZE + bodyRadius
    const head = other.nodes[0]
    if (head !== undefined) {
        // Every point is within one length of its own head, plus the head's own gap.
        const far = other.length + reach + NODE_GAP
        const dx = hx - head.x
        const dy = hy - head.y
        if (dx * dx + dy * dy > far * far) return false
    }
    const limit = reach * reach
    for (let i = 0; i < other.nodes.length; i++) {
        const node = other.nodes[i]!
        const dx = hx - node.x
        const dy = hy - node.y
        if (dx * dx + dy * dy <= limit) return true
    }
    return false
}

export function insideWorld(x: number, y: number, radius: number): boolean {
    return x >= radius && y >= radius && x <= WORLD_W - radius && y <= WORLD_H - radius
}

export function canBoost(length: number): boolean {
    return length > BOOST_FLOOR
}

export function boostDrain(length: number, dt: number): number {
    return Math.max(BOOST_FLOOR, length - BOOST_COST * Math.max(0, dt))
}

export function scatterOrbs(count: number, next: () => number): Orb[] {
    const out: Orb[] = []
    for (let i = 0; i < count; i++) {
        out.push({
            x: ORB_SIZE + next() * (WORLD_W - ORB_SIZE * 2),
            y: ORB_SIZE + next() * (WORLD_H - ORB_SIZE * 2),
            tone: Math.floor(next() * 6),
            alive: true,
        })
    }
    return out
}

export function orbsEaten(hx: number, hy: number, headRadius: number, orbs: readonly Orb[]): number[] {
    const reach = headRadius + ORB_SIZE * 1.6
    const limit = reach * reach
    const eaten: number[] = []
    for (let i = 0; i < orbs.length; i++) {
        const orb = orbs[i]!
        if (!orb.alive) continue
        const dx = hx - orb.x
        const dy = hy - orb.y
        if (dx * dx + dy * dy <= limit) eaten.push(i)
    }
    return eaten
}

export function corpseOrbs(snake: Snake, count: number): Point[] {
    const wanted = Math.max(0, Math.floor(count))
    if (wanted === 0 || snake.nodes.length === 0) return []
    const out: Point[] = []
    const stride = Math.max(1, snake.nodes.length / wanted)
    for (let i = 0; i < wanted; i++) {
        const node = snake.nodes[Math.min(snake.nodes.length - 1, Math.floor(i * stride))]!
        out.push({ x: node.x, y: node.y })
    }
    return out
}

export function spawnPoint(next: () => number): { x: number; y: number; angle: number } {
    return {
        x: WORLD_W * (0.2 + next() * 0.6),
        y: WORLD_H * (0.2 + next() * 0.6),
        angle: normalizeAngle(next() * Math.PI * 2),
    }
}
