export type Kind = "breadth" | "dijkstra" | "astar"

export interface Maze {
    cols: number
    rows: number
    walls: boolean[]
    /** What it costs to enter each square. */
    cost: number[]
}

export const index = (maze: Maze, col: number, row: number) => row * maze.cols + col

// The cheapest a square can be to enter, which is what keeps the A star guess honest.
export const MIN_COST = 1

export interface Search {
    readonly kind: Kind
    readonly visited: Uint8Array
    readonly frontier: Uint8Array
    /** Cheapest known cost to reach each square. Infinity where unreached. */
    readonly cost: Float64Array
    readonly cameFrom: Int32Array
    readonly done: boolean
    readonly found: boolean
    readonly expanded: number
    /** Settles one square and returns the cells whose state changed. */
    step(): number[]
    /** The route home from the goal, goal first. Empty until one is found. */
    path(): number[]
}

export class Heap {
    private readonly items: number[] = []
    private readonly keys: number[] = []

    get size(): number {
        return this.items.length
    }

    push(item: number, key: number): void {
        this.items.push(item)
        this.keys.push(key)
        let i = this.items.length - 1
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (this.keys[parent]! <= this.keys[i]!) break
            this.swap(i, parent)
            i = parent
        }
    }

    pop(): number | undefined {
        if (this.items.length === 0) return undefined
        const top = this.items[0]!
        const lastItem = this.items.pop()!
        const lastKey = this.keys.pop()!
        if (this.items.length > 0) {
            this.items[0] = lastItem
            this.keys[0] = lastKey
            let i = 0
            for (;;) {
                const left = i * 2 + 1
                const right = left + 1
                let smallest = i
                if (left < this.keys.length && this.keys[left]! < this.keys[smallest]!) smallest = left
                if (right < this.keys.length && this.keys[right]! < this.keys[smallest]!) smallest = right
                if (smallest === i) break
                this.swap(i, smallest)
                i = smallest
            }
        }
        return top
    }

    private swap(a: number, b: number): void {
        const item = this.items[a]!
        this.items[a] = this.items[b]!
        this.items[b] = item
        const key = this.keys[a]!
        this.keys[a] = this.keys[b]!
        this.keys[b] = key
    }
}

function manhattan(maze: Maze, from: number, to: number): number {
    const fromCol = from % maze.cols
    const fromRow = (from - fromCol) / maze.cols
    const toCol = to % maze.cols
    const toRow = (to - toCol) / maze.cols
    return Math.abs(fromCol - toCol) + Math.abs(fromRow - toRow)
}

export function createSearch(maze: Maze, start: number, goal: number, kind: Kind): Search {
    const cells = maze.cols * maze.rows
    const visited = new Uint8Array(cells)
    const frontier = new Uint8Array(cells)
    const cost = new Float64Array(cells).fill(Infinity)
    const cameFrom = new Int32Array(cells).fill(-1)

    const queue: number[] = []
    const heap = new Heap()

    cost[start] = 0
    frontier[start] = 1
    if (kind === "breadth") queue.push(start)
    else heap.push(start, kind === "astar" ? manhattan(maze, start, goal) * MIN_COST : 0)

    let done = false
    let found = false
    let expanded = 0

    const take = (): number | undefined => (kind === "breadth" ? queue.shift() : heap.pop())
    const waiting = () => (kind === "breadth" ? queue.length : heap.size)

    const search: Search = {
        kind, visited, frontier, cost, cameFrom,
        get done() { return done },
        get found() { return found },
        get expanded() { return expanded },

        step(): number[] {
            if (done) return []
            const current = take()
            if (current === undefined) {
                done = true
                return []
            }
            // Reaching a square more cheaply pushes it again, so stale copies turn up here.
            if (visited[current] === 1) return []

            const changed: number[] = [current]
            visited[current] = 1
            frontier[current] = 0
            expanded++

            if (current === goal) {
                done = true
                found = true
                return changed
            }

            const col = current % maze.cols
            const row = (current - col) / maze.cols
            const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]]
            for (const [dc, dr] of steps) {
                const nc = col + dc!
                const nr = row + dr!
                if (nc < 0 || nc >= maze.cols || nr < 0 || nr >= maze.rows) continue
                const next = nr * maze.cols + nc
                if (maze.walls[next] === true || visited[next] === 1) continue

                const stepCost = kind === "breadth" ? 1 : maze.cost[next]!
                const reached = cost[current]! + stepCost
                if (reached >= cost[next]!) continue

                cost[next] = reached
                cameFrom[next] = current
                frontier[next] = 1
                changed.push(next)
                if (kind === "breadth") queue.push(next)
                else heap.push(next, kind === "astar" ? reached + manhattan(maze, next, goal) * MIN_COST : reached)
            }

            if (waiting() === 0) done = true
            return changed
        },

        path(): number[] {
            if (!found) return []
            const route: number[] = []
            let at = goal
            while (at !== -1) {
                route.push(at)
                if (at === start) break
                at = cameFrom[at]!
            }
            return route
        },
    }
    return search
}

export function generate(
    cols: number, rows: number, next: () => number, slowCost = 4,
): Maze {
    const cells = cols * rows
    const maze: Maze = {
        cols, rows,
        walls: new Array<boolean>(cells).fill(false),
        cost: new Array<number>(cells).fill(1),
    }

    // One wall run per 26 squares, chosen by eye.
    const runs = Math.round((cols * rows) / 26)
    for (let i = 0; i < runs; i++) {
        let col = Math.floor(next() * cols)
        let row = Math.floor(next() * rows)
        const horizontal = next() < 0.5
        const length = 2 + Math.floor(next() * 5)
        for (let s = 0; s < length; s++) {
            if (col < 0 || col >= cols || row < 0 || row >= rows) break
            maze.walls[row * cols + col] = true
            if (horizontal) col++
            else row++
        }
    }

    const patches = 2 + Math.floor(next() * 2)
    for (let i = 0; i < patches; i++) {
        const cx = Math.floor(next() * cols)
        const cy = Math.floor(next() * rows)
        const radius = 3 + Math.floor(next() * 3)
        for (let row = cy - radius; row <= cy + radius; row++) {
            for (let col = cx - radius; col <= cx + radius; col++) {
                if (col < 0 || col >= cols || row < 0 || row >= rows) continue
                if (Math.hypot(col - cx, row - cy) > radius) continue
                maze.cost[row * cols + col] = slowCost
            }
        }
    }
    return maze
}

export function clearAround(maze: Maze, cell: number, reach = 1): void {
    const col = cell % maze.cols
    const row = (cell - col) / maze.cols
    for (let r = row - reach; r <= row + reach; r++) {
        for (let c = col - reach; c <= col + reach; c++) {
            if (c < 0 || c >= maze.cols || r < 0 || r >= maze.rows) continue
            maze.walls[r * maze.cols + c] = false
            maze.cost[r * maze.cols + c] = 1
        }
    }
}

export function routeCost(maze: Maze, route: readonly number[], start: number): number {
    let total = 0
    for (const cell of route) {
        if (cell === start) continue
        total += maze.cost[cell]!
    }
    return total
}
