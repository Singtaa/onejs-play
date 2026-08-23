/**
 * Three ways to cross the same map, run one step at a time so they can be
 * watched rather than just measured.
 *
 * The three differ in one line each, which is easier to believe once they are
 * side by side:
 *
 *   Breadth first takes whichever square it reached first, so it finds the
 *   route with the fewest squares and does not care that some are slow to cross.
 *   Dijkstra takes the cheapest square reached so far, so it finds the cheapest
 *   route, and explores outward in every direction to be sure of it.
 *   A star takes the cheapest square reached so far plus a guess at what is
 *   left, so it finds the same cheapest route while barely looking behind it.
 *
 * The guess is what makes A star fast, and it only works because the guess never
 * overestimates. Manhattan distance times the cheapest a square can be to enter
 * can never be more than the real remaining cost on a four-way grid, so the
 * route it settles on is genuinely the cheapest and not merely a quick one.
 *
 * Everything here is steppable rather than a loop that returns an answer,
 * because the point of the game is the shape of the search rather than the path
 * at the end of it.
 */

export type Kind = "breadth" | "dijkstra" | "astar"

export interface Maze {
    cols: number
    rows: number
    /** True where nothing can pass. */
    walls: boolean[]
    /** What it costs to enter each square. 1 is open ground. */
    cost: number[]
}

export const index = (maze: Maze, col: number, row: number) => row * maze.cols + col

/** The cheapest any square can be to enter, which is what keeps A star honest. */
export const MIN_COST = 1

export interface Search {
    readonly kind: Kind
    /** Squares taken off the frontier and finished with. */
    readonly visited: Uint8Array
    /** Squares seen but not yet settled. */
    readonly frontier: Uint8Array
    /** Cheapest known cost to reach each square. Infinity where unreached. */
    readonly cost: Float64Array
    readonly cameFrom: Int32Array
    readonly done: boolean
    readonly found: boolean
    /** How many squares have been settled, which is the real cost of a search. */
    readonly expanded: number
    /**
     * Settles one square. Returns the cells whose state changed, so a caller can
     * repaint those and leave the rest of the grid alone.
     */
    step(): number[]
    /** The route home from the goal, goal first. Empty until one is found. */
    path(): number[]
}

/**
 * A binary heap keyed by a number.
 *
 * Written out rather than sorting an array each time: a search settles
 * thousands of squares and re-sorting the frontier for each one turns an
 * O(n log n) algorithm into something much worse, which is exactly the
 * difference these three are here to show.
 */
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

/** Manhattan distance, in squares. */
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

    // Breadth first settles in arrival order, so it needs a plain queue rather
    // than a heap. Modelling it as a heap keyed by arrival would work and would
    // also quietly hide the thing that makes it different.
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
            // A square can sit in the heap more than once, because reaching it
            // more cheaply pushes it again rather than paying to find and
            // rewrite the old entry. The stale copies are skipped here, which
            // is cheaper than keeping the heap perfectly tidy.
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

                // Breadth first is the one that ignores what a square costs,
                // which is the whole reason it can be beaten on a map that has
                // slow ground on it.
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

/**
 * A map with rooms of slow ground and scattered walls.
 *
 * Not a perfect maze on purpose. A maze with one route through it makes all
 * three searches produce the same answer and hides the difference between them;
 * open ground with obstacles and patches of mud is where they disagree.
 */
export function generate(
    cols: number, rows: number, next: () => number, slowCost = 4,
): Maze {
    const cells = cols * rows
    const maze: Maze = {
        cols, rows,
        walls: new Array<boolean>(cells).fill(false),
        cost: new Array<number>(cells).fill(1),
    }

    // Walls in short runs rather than as scattered pixels, which produces
    // something to go round rather than a fog to squeeze through.
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

    // Two or three patches of slow ground, big enough to be worth going round.
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

/** Clears whatever is on a square, so a start or a goal is never buried. */
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

/** What a route actually costs, which is the number the three are judged on. */
export function routeCost(maze: Maze, route: readonly number[], start: number): number {
    let total = 0
    for (const cell of route) {
        if (cell === start) continue
        total += maze.cost[cell]!
    }
    return total
}
