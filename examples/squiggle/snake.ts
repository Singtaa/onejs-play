/**
 * The rules of the field, with no screen and no network in them.
 *
 * SQUIGGLE IS A RELAY GAME, AND THAT DECIDES THE RULES
 *
 * There is no server simulating anything: the site passes messages between
 * players and knows nothing about what they mean. So the rules have to be
 * written for a world where every client is the authority on itself and on
 * nothing else, and the single rule that makes that safe is:
 *
 *     You may only report your own death.
 *
 * A player broadcasts where their head is and which way it is going. When a
 * head touches somebody's line, the client whose head it is decides that it
 * ran into something, and says so. Nobody kills anybody: a liar can refuse to
 * die, which makes them strange to watch and harms no one else's game, and can
 * never reach across the field and end somebody else's run.
 *
 * The alternative, letting the owner of the line declare the kill, is no
 * shorter and hands every client the power to kill anybody anywhere.
 *
 * WHAT A BODY IS, AND WHY IT IS SHAPED THIS WAY
 *
 * A snake is a head and a list of points it has been through, one every
 * NODE_GAP units. That spacing is the whole trick. It means a body of a given
 * length always costs the same number of points however it is coiled, so the
 * cost of a collision check is a function of length and nothing else, and it
 * means the wire never carries a body at all: everyone else records only where
 * a head was and lays the same trail behind it themselves.
 *
 * The spacing has to stay smaller than a body is wide, or a head could pass
 * between two consecutive points of a line without ever touching either. That
 * is the one invariant here that is not a matter of taste, and snake.test.ts
 * asserts it directly rather than trusting the numbers to stay sensible.
 */

export const WORLD_W = 3200
export const WORLD_H = 2400

/** Units a second, cruising and boosting. */
export const SPEED = 195
export const BOOST_SPEED = 345

/** Radians a second. Constant, so a turn is a shape a player can learn. */
export const TURN_RATE = 3.2

export const START_LENGTH = 130
export const MAX_LENGTH = 1500

/**
 * How far apart the points of a body are.
 *
 * Smaller is a smoother line and a more expensive one. Five units against a
 * body that is at least ten wide leaves a comfortable margin, and the test
 * suite refuses to let that relationship invert.
 */
export const NODE_GAP = 5

/** Body width, from new to fully grown. */
export const MIN_RADIUS = 5
export const MAX_RADIUS = 12

/**
 * How much of your own head has to be inside a line to count as hitting it.
 *
 * Less than all of it, deliberately. Everybody else's line is drawn from what
 * their client said a moment ago and filled in from there, so what you see is
 * always a little behind what they see. Forgiving the last fraction of a body
 * width means the disagreement lands on the side of both players staying
 * alive, which is the side to be wrong on.
 */
export const GRAZE = 0.5

/** Length a second paid for boosting, and the length it will not take you below. */
export const BOOST_COST = 26
export const BOOST_FLOOR = START_LENGTH + 30

/** Orbs on the field at once, what each is worth, and how big they are. */
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
    /** Where the head is pointing, in radians, y down like the rest of the stage. */
    angle: number
    length: number
    /** Where the body has been, head first, one point every NODE_GAP units. */
    nodes: Point[]
}

export interface Orb {
    x: number
    y: number
    /** Palette index, so an orb keeps its colour wherever it is described. */
    tone: number
    /**
     * Eaten orbs stay in the array with this cleared rather than being removed,
     * because an index is how everyone refers to one. Splicing would renumber
     * the field under every other client on it.
     */
    alive: boolean
}

export function makeSnake(x: number, y: number, angle: number): Snake {
    return { x, y, angle, length: START_LENGTH, nodes: [{ x, y }] }
}

/** An angle folded back into the half open turn, so it cannot drift forever. */
export function normalizeAngle(angle: number): number {
    const turn = Math.PI * 2
    const wrapped = angle % turn
    if (wrapped <= -Math.PI) return wrapped + turn
    if (wrapped > Math.PI) return wrapped - turn
    return wrapped
}

/**
 * Turns toward a heading at the fixed rate, the short way round.
 *
 * The short way is the part worth being careful about: without it a snake
 * pointing just past due west and asked to go just before it takes the long way
 * round the circle, which on screen is a full loop for a two degree correction.
 */
export function steer(angle: number, desired: number, dt: number): number {
    const difference = normalizeAngle(desired - angle)
    const most = TURN_RATE * Math.max(0, dt)
    const step = Math.max(-most, Math.min(most, difference))
    return normalizeAngle(angle + step)
}

/** How wide a body of this length is. */
export function radiusOf(length: number): number {
    const grown = (Math.max(START_LENGTH, length) - START_LENGTH) / (MAX_LENGTH - START_LENGTH)
    return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(Math.min(1, grown))
}

/** How many points a body of this length keeps. */
export function nodeBudget(length: number): number {
    return Math.max(2, Math.ceil(Math.max(0, length) / NODE_GAP))
}

export function grow(length: number, by: number): number {
    return Math.min(MAX_LENGTH, Math.max(0, length + by))
}

/**
 * Moves the head, lays down whatever body that covered, and drops the tail.
 *
 * Points are laid at exactly NODE_GAP from the last one rather than wherever
 * the head happened to land, which is what keeps the spacing a promise instead
 * of an average. A frame that covered three gaps lays three points, and a frame
 * that covered a fifth of one lays none.
 */
export function advance(snake: Snake, dt: number, boosting: boolean): void {
    const speed = boosting ? BOOST_SPEED : SPEED
    snake.x += Math.cos(snake.angle) * speed * dt
    snake.y += Math.sin(snake.angle) * speed * dt
    layTrail(snake)
}

/**
 * Records the path from the last point up to wherever the head is now.
 *
 * Named and exported separately from advance because it is a claim in its own
 * right: whatever moved the head, by swimming or by being corrected toward
 * where its owner says it is, the body records it. A version that only laid
 * points for the distance advance had just applied would leave a correction
 * unrecorded and draw the line somewhere the head has never been.
 */
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

/** Throws the whole body away and starts it again under the head. */
export function resetTrail(snake: Snake): void {
    snake.nodes.length = 0
    snake.nodes.push({ x: snake.x, y: snake.y })
}

/**
 * Whether a head of this size is touching that snake's body.
 *
 * Only ever asked about somebody else's snake. Running into your own line is
 * not a death here: a game where a tight turn kills you is a game about being
 * careful, and this one is meant to be about other people.
 *
 * The early return is not a guess. Every point of a body lies within `length`
 * of its own head, because that is the distance walked to get there and a
 * straight line cannot be longer than the path. So a head further away than the
 * length plus both radii cannot be touching any of it, and the check is exact
 * rather than approximate.
 */
export function hitsBody(hx: number, hy: number, headRadius: number, other: Snake): boolean {
    const bodyRadius = radiusOf(other.length)
    const reach = headRadius * GRAZE + bodyRadius
    const head = other.nodes[0]
    if (head !== undefined) {
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

/** Whether a body of this width is still on the field. */
export function insideWorld(x: number, y: number, radius: number): boolean {
    return x >= radius && y >= radius && x <= WORLD_W - radius && y <= WORLD_H - radius
}

/** Whether there is length to spare for a boost. */
export function canBoost(length: number): boolean {
    return length > BOOST_FLOOR
}

/** What a second of boosting costs, never taking a snake below the floor. */
export function boostDrain(length: number, dt: number): number {
    return Math.max(BOOST_FLOOR, length - BOOST_COST * Math.max(0, dt))
}

/** An orb field, laid out from a given source of randomness. */
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

/**
 * Which orbs a head just swallowed, by index.
 *
 * Indices rather than the orbs themselves, because the caller has to tell
 * everybody else which ones went, and an index is one small number where a
 * position is two large ones.
 */
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

/**
 * Where a dead snake leaves its length behind, spread along the body.
 *
 * Evenly spaced along the points rather than one per point: a long snake has
 * three hundred of those and a message describing three hundred orbs is both
 * over the size a room will carry and more food than the field is worth.
 */
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

/**
 * Where to put a snake that has just died, or has just arrived.
 *
 * Away from the edges, because a snake that appears against a wall has half a
 * circle of directions that kill it before it has touched anything.
 */
export function spawnPoint(next: () => number): { x: number; y: number; angle: number } {
    return {
        x: WORLD_W * (0.2 + next() * 0.6),
        y: WORLD_H * (0.2 + next() * 0.6),
        angle: normalizeAngle(next() * Math.PI * 2),
    }
}
