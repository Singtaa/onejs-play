/**
 * Flocking, which is three rules and one performance problem.
 *
 * THE RULES
 *
 * Every bird looks at its neighbours and does three things: steers away from
 * the ones that are too close, steers toward the average heading of the rest,
 * and steers toward where they all are. Separation, alignment, cohesion. That
 * is the whole model, and everything that looks like planning in the result is
 * an accident of a few hundred birds each doing only that.
 *
 * THE PROBLEM
 *
 * "Every bird looks at its neighbours" is a comparison against every other
 * bird, so three hundred birds is ninety thousand comparisons a frame. That is
 * nothing in a browser and a real cost in the QuickJS interpreter a OneJS
 * desktop build uses, and this game is meant to run in both.
 *
 * So the field is divided into buckets the size of the viewing range, and a
 * bird only compares against the nine buckets around it. The work stops growing
 * with the flock and starts growing with how crowded it is, which for birds
 * that spread out is close to linear.
 */

export interface Boid {
    x: number
    y: number
    vx: number
    vy: number
}

export interface Rules {
    /** How far a bird can see. Also the bucket size. */
    range: number
    /** Closer than this and a bird actively backs off. */
    personal: number
    separation: number
    alignment: number
    cohesion: number
    /** How hard a bird turns away from the edge, and from how far out. */
    margin: number
    edge: number
    minSpeed: number
    maxSpeed: number
}

export const DEFAULTS: Rules = {
    range: 46,
    personal: 17,
    separation: 0.34,
    alignment: 0.052,
    cohesion: 0.0016,
    margin: 90,
    edge: 240,
    minSpeed: 70,
    maxSpeed: 190,
}

/**
 * A uniform grid over the field, rebuilt each frame.
 *
 * Rebuilding rather than updating is deliberate: every bird moves every frame,
 * so a third of them would change bucket anyway, and clearing an array of
 * numbers is cheaper than tracking which ones did.
 */
export class Grid {
    readonly cols: number
    readonly rows: number
    private readonly cells: number[][]

    constructor(readonly width: number, readonly height: number, readonly cell: number) {
        this.cols = Math.max(1, Math.ceil(width / cell))
        this.rows = Math.max(1, Math.ceil(height / cell))
        this.cells = Array.from({ length: this.cols * this.rows }, () => [])
    }

    clear(): void {
        for (const cell of this.cells) cell.length = 0
    }

    /** Which bucket a point falls in, clamped so a bird just outside still lands. */
    indexOf(x: number, y: number): number {
        const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)))
        const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)))
        return row * this.cols + col
    }

    insert(index: number, boid: number): void {
        this.cells[index]!.push(boid)
    }

    /**
     * Calls back once for every bird in the nine buckets around a point.
     *
     * A callback rather than a returned array, because returning one would
     * allocate several hundred arrays a frame and the garbage collector would
     * be the thing this optimisation was supposed to avoid.
     */
    near(x: number, y: number, visit: (boid: number) => void): void {
        const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)))
        const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)))
        for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
            for (let c = Math.max(0, col - 1); c <= Math.min(this.cols - 1, col + 1); c++) {
                const cell = this.cells[r * this.cols + c]!
                for (let i = 0; i < cell.length; i++) visit(cell[i]!)
            }
        }
    }
}

export interface Predator {
    x: number
    y: number
    /** How far its influence reaches. */
    radius: number
    /** Positive pushes birds away, negative draws them in. */
    strength: number
}

/**
 * Last frame's velocities, so alignment reads what every bird *was* doing.
 *
 * Without this the pass is order dependent: bird 5 aligns to bird 3's new
 * heading and bird 3 aligned to bird 5's old one, so the same flock stored in a
 * different order drifts somewhere else. Reused and grown rather than allocated
 * per frame, because a fresh pair of arrays sixty times a second is exactly the
 * garbage the spatial grid above exists to avoid.
 *
 * Positions need no snapshot: they are all moved in a second pass, after every
 * velocity is settled.
 */
let wasVx = new Float64Array(0)
let wasVy = new Float64Array(0)

function snapshot(boids: Boid[]): void {
    if (wasVx.length < boids.length) {
        wasVx = new Float64Array(boids.length)
        wasVy = new Float64Array(boids.length)
    }
    for (let i = 0; i < boids.length; i++) {
        wasVx[i] = boids[i]!.vx
        wasVy[i] = boids[i]!.vy
    }
}

/**
 * Advances the whole flock one frame.
 *
 * Two passes. The first works out every bird's new velocity from a snapshot of
 * the old ones; the second moves them all. Doing it in one pass would let a
 * bird react to a neighbour that has already changed this frame, and the flock
 * would then depend on the order the array happens to be in.
 */
export function step(
    boids: Boid[],
    grid: Grid,
    rules: Rules,
    dt: number,
    predator: Predator | null,
): void {
    grid.clear()
    for (let i = 0; i < boids.length; i++) {
        const b = boids[i]!
        grid.insert(grid.indexOf(b.x, b.y), i)
    }
    snapshot(boids)

    const rangeSq = rules.range * rules.range
    const personalSq = rules.personal * rules.personal

    for (let i = 0; i < boids.length; i++) {
        const self = boids[i]!
        let pushX = 0, pushY = 0
        let flockVx = 0, flockVy = 0
        let flockX = 0, flockY = 0
        let seen = 0

        grid.near(self.x, self.y, (j) => {
            if (j === i) return
            const other = boids[j]!
            const dx = self.x - other.x
            const dy = self.y - other.y
            const distSq = dx * dx + dy * dy
            if (distSq > rangeSq || distSq === 0) return

            if (distSq < personalSq) {
                // A direction times a weight, never the offset itself. Using
                // the raw offset makes the push grow with distance, so a bird
                // twelve units away was shoved twice as hard as one three units
                // away: separation running exactly backwards, and hard to see
                // in motion because the flock still looked roughly alive.
                const dist = Math.sqrt(distSq)
                const push = (rules.personal - dist) / rules.personal
                pushX += (dx / dist) * push
                pushY += (dy / dist) * push
            }
            flockVx += wasVx[j]!
            flockVy += wasVy[j]!
            flockX += other.x
            flockY += other.y
            seen++
        })

        self.vx += pushX * rules.separation
        self.vy += pushY * rules.separation

        if (seen > 0) {
            self.vx += (flockVx / seen - wasVx[i]!) * rules.alignment
            self.vy += (flockVy / seen - wasVy[i]!) * rules.alignment
            self.vx += (flockX / seen - self.x) * rules.cohesion
            self.vy += (flockY / seen - self.y) * rules.cohesion
        }

        // The edges. A steadily growing nudge rather than a wall, so the flock
        // banks away instead of bouncing.
        if (self.x < rules.margin) self.vx += rules.edge * (1 - self.x / rules.margin) * dt
        if (self.x > grid.width - rules.margin) {
            self.vx -= rules.edge * (1 - (grid.width - self.x) / rules.margin) * dt
        }
        if (self.y < rules.margin) self.vy += rules.edge * (1 - self.y / rules.margin) * dt
        if (self.y > grid.height - rules.margin) {
            self.vy -= rules.edge * (1 - (grid.height - self.y) / rules.margin) * dt
        }

        if (predator !== null) {
            const dx = self.x - predator.x
            const dy = self.y - predator.y
            const dist = Math.hypot(dx, dy)
            if (dist < predator.radius && dist > 0.001) {
                const force = (1 - dist / predator.radius) * predator.strength
                self.vx += (dx / dist) * force * dt
                self.vy += (dy / dist) * force * dt
            }
        }

        // Speed is clamped at both ends. Without a floor the flock settles into
        // a stationary clump, which is a correct solution to the rules and a
        // dull one to watch.
        const speed = Math.hypot(self.vx, self.vy)
        // Any speed at all is normalised, however small: the floor exists to
        // stop the flock settling into a still clump, and a bird creeping at a
        // ten thousandth of a pixel a second has settled. Only an exactly zero
        // velocity is left alone, because it has no direction to scale up.
        if (speed > 1e-9) {
            const wanted = Math.min(rules.maxSpeed, Math.max(rules.minSpeed, speed))
            self.vx = (self.vx / speed) * wanted
            self.vy = (self.vy / speed) * wanted
        }
    }

    for (const b of boids) {
        b.x += b.vx * dt
        b.y += b.vy * dt
        // A last resort. The edge rule should have turned them long before, but
        // a bird spawned outside or shoved by the predator must not escape.
        b.x = Math.min(grid.width, Math.max(0, b.x))
        b.y = Math.min(grid.height, Math.max(0, b.y))
    }
}
