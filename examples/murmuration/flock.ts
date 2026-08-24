export interface Boid {
    x: number
    y: number
    vx: number
    vy: number
}

export interface Rules {
    range: number
    personal: number
    separation: number
    alignment: number
    cohesion: number
    margin: number
    edgeForce: number
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
    edgeForce: 240,
    minSpeed: 70,
    maxSpeed: 190,
}

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

    indexOf(x: number, y: number): number {
        const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)))
        const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)))
        return row * this.cols + col
    }

    insert(index: number, boid: number): void {
        this.cells[index]!.push(boid)
    }

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
    radius: number
    strength: number
}

// Alignment must read what every bird was doing at the start of the frame.
// Reading the live velocities instead makes the flock depend on array order.
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

        if (self.x < rules.margin) self.vx += rules.edgeForce * (1 - self.x / rules.margin) * dt
        if (self.x > grid.width - rules.margin) {
            self.vx -= rules.edgeForce * (1 - (grid.width - self.x) / rules.margin) * dt
        }
        if (self.y < rules.margin) self.vy += rules.edgeForce * (1 - self.y / rules.margin) * dt
        if (self.y > grid.height - rules.margin) {
            self.vy -= rules.edgeForce * (1 - (grid.height - self.y) / rules.margin) * dt
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

        const speed = Math.hypot(self.vx, self.vy)
        if (speed > 1e-9) {
            const wanted = Math.min(rules.maxSpeed, Math.max(rules.minSpeed, speed))
            self.vx = (self.vx / speed) * wanted
            self.vy = (self.vy / speed) * wanted
        }
    }

    for (const b of boids) {
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.x = Math.min(grid.width, Math.max(0, b.x))
        b.y = Math.min(grid.height, Math.max(0, b.y))
    }
}
