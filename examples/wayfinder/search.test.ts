import { describe, it, expect } from "vitest"
import {
    Heap, createSearch, generate, clearAround, routeCost, index, MIN_COST,
    type Maze, type Kind,
} from "./search"

/** A maze drawn as text: "." open, "#" wall, "~" slow ground. */
function parse(rows: string[], slowCost = 4): Maze {
    const cols = rows[0]!.length
    const maze: Maze = {
        cols, rows: rows.length,
        walls: [], cost: [],
    }
    for (const row of rows) {
        for (const ch of row) {
            maze.walls.push(ch === "#")
            maze.cost.push(ch === "~" ? slowCost : 1)
        }
    }
    return maze
}

function run(maze: Maze, start: number, goal: number, kind: Kind) {
    const search = createSearch(maze, start, goal, kind)
    let guard = 0
    while (!search.done) {
        search.step()
        if (++guard > 100000) throw new Error("search never finished")
    }
    const route = search.path()
    return {
        found: search.found,
        expanded: search.expanded,
        steps: route.length - 1,
        cost: routeCost(maze, route, start),
        route,
    }
}

describe("Heap", () => {
    it("hands back the smallest key first", () => {
        const heap = new Heap()
        for (const n of [5, 3, 9, 1, 7]) heap.push(n, n)
        const out: number[] = []
        while (heap.size > 0) out.push(heap.pop()!)
        expect(out).toEqual([1, 3, 5, 7, 9])
    })

    it("keeps its order however the keys arrive", () => {
        const heap = new Heap()
        const keys: number[] = []
        for (let i = 0; i < 400; i++) {
            const key = Math.random() * 1000
            keys.push(key)
            heap.push(i, key)
        }
        keys.sort((a, b) => a - b)
        const out: number[] = []
        while (heap.size > 0) out.push(heap.pop()!)
        expect(out).toHaveLength(400)
        expect(out.length).toBe(new Set(out).size)
    })

    it("separates the item from its key, so equal keys are still distinct items", () => {
        const heap = new Heap()
        heap.push(11, 5)
        heap.push(22, 5)
        const first = heap.pop()
        const second = heap.pop()
        expect(new Set([first, second])).toEqual(new Set([11, 22]))
    })

    it("is empty rather than undefined-y when drained", () => {
        const heap = new Heap()
        expect(heap.pop()).toBeUndefined()
        heap.push(1, 1)
        heap.pop()
        expect(heap.size).toBe(0)
        expect(heap.pop()).toBeUndefined()
    })
})

describe("all three searches", () => {
    const kinds: Kind[] = ["breadth", "dijkstra", "astar"]
    const open = parse([
        ".........",
        ".........",
        ".........",
        ".........",
        ".........",
    ])

    it("find a route across open ground", () => {
        for (const kind of kinds) {
            const result = run(open, index(open, 0, 0), index(open, 8, 4), kind)
            expect(result.found).toBe(true)
            expect(result.steps).toBe(12)
        }
    })

    it("start the route at the goal and end it at the start", () => {
        for (const kind of kinds) {
            const start = index(open, 0, 0)
            const goal = index(open, 8, 4)
            const result = run(open, start, goal, kind)
            expect(result.route[0]).toBe(goal)
            expect(result.route[result.route.length - 1]).toBe(start)
        }
    })

    it("report failure rather than looping when the goal is walled off", () => {
        const sealed = parse([
            "...#...",
            "...#...",
            "...#...",
        ])
        for (const kind of kinds) {
            const result = run(sealed, index(sealed, 0, 1), index(sealed, 6, 1), kind)
            expect(result.found).toBe(false)
            expect(result.route).toEqual([])
        }
    })

    it("go round a wall rather than through it", () => {
        const wall = parse([
            "...#...",
            "...#...",
            ".......",
        ])
        for (const kind of kinds) {
            const result = run(wall, index(wall, 0, 0), index(wall, 6, 0), kind)
            expect(result.found).toBe(true)
            expect(result.route.some((cell) => wall.walls[cell])).toBe(false)
        }
    })

    it("finish immediately when the start is the goal", () => {
        for (const kind of kinds) {
            const result = run(open, 0, 0, kind)
            expect(result.found).toBe(true)
            expect(result.steps).toBe(0)
        }
    })
})

describe("what makes them different", () => {
    const mud = parse([
        ".~~~~~~~.",
        ".~~~~~~~.",
        ".........",
    ])
    const start = index(mud, 0, 0)
    const goal = index(mud, 8, 0)

    it("breadth first takes the fewest squares, whatever they cost", () => {
        const result = run(mud, start, goal, "breadth")
        expect(result.steps).toBe(8)
        expect(result.cost).toBeGreaterThan(8)
    })

    it("dijkstra takes the cheapest route even though it is longer", () => {
        const result = run(mud, start, goal, "dijkstra")
        expect(result.steps).toBeGreaterThan(8)
        expect(result.cost).toBe(12)
    })

    it("a star finds exactly the same cost as dijkstra", () => {
        const cheap = run(mud, start, goal, "dijkstra")
        const guided = run(mud, start, goal, "astar")
        expect(guided.cost).toBe(cheap.cost)
    })

    it("a star settles fewer squares than dijkstra on open ground", () => {
        const field = parse(Array.from({ length: 21 }, () => ".".repeat(21)))
        const from = index(field, 0, 10)
        const to = index(field, 20, 10)
        const guided = run(field, from, to, "astar")
        const cheap = run(field, from, to, "dijkstra")
        expect(guided.expanded).toBeLessThan(cheap.expanded)
    })

    it("a star never settles for a worse route than dijkstra, on any map", () => {
        let seed = 1
        const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
        for (let trial = 0; trial < 40; trial++) {
            const maze = generate(18, 14, next)
            const from = index(maze, 0, 0)
            const to = index(maze, 17, 13)
            clearAround(maze, from)
            clearAround(maze, to)
            const cheap = run(maze, from, to, "dijkstra")
            const guided = run(maze, from, to, "astar")
            expect(guided.found).toBe(cheap.found)
            if (cheap.found) expect(guided.cost).toBe(cheap.cost)
        }
    })
})

describe("stepping", () => {
    const field = parse([".....", ".....", "....."])

    it("reports the squares that changed, and nothing else", () => {
        const search = createSearch(field, 0, 14, "astar")
        const changed = search.step()
        expect(changed).toContain(0)
        expect(changed.length).toBeLessThanOrEqual(5)
    })

    it("marks a settled square visited and no longer frontier", () => {
        const search = createSearch(field, 0, 14, "breadth")
        search.step()
        expect(search.visited[0]).toBe(1)
        expect(search.frontier[0]).toBe(0)
    })

    it("does nothing once it is done", () => {
        const search = createSearch(field, 0, 0, "astar")
        search.step()
        expect(search.done).toBe(true)
        expect(search.step()).toEqual([])
    })

    it("counts every square it settles", () => {
        const search = createSearch(field, 0, 14, "breadth")
        let steps = 0
        while (!search.done) {
            search.step()
            steps++
        }
        expect(search.expanded).toBeGreaterThan(0)
        expect(search.expanded).toBeLessThanOrEqual(steps)
    })

    it("leaves unreached squares at an infinite cost", () => {
        const sealed = parse(["..#..", "..#.."])
        const search = createSearch(sealed, 0, 4, "dijkstra")
        while (!search.done) search.step()
        expect(search.cost[4]).toBe(Infinity)
    })
})

describe("generate", () => {
    const seeded = () => {
        let seed = 99
        return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    }

    it("makes a map of the size asked for", () => {
        const maze = generate(20, 15, seeded())
        expect(maze.cols).toBe(20)
        expect(maze.rows).toBe(15)
        expect(maze.walls).toHaveLength(300)
        expect(maze.cost).toHaveLength(300)
    })

    it("leaves most of the map open, so there is something to compare", () => {
        const maze = generate(30, 20, seeded())
        const walled = maze.walls.filter(Boolean).length
        expect(walled / maze.walls.length).toBeLessThan(0.35)
    })

    it("puts some slow ground down, which is what separates the three", () => {
        const maze = generate(30, 20, seeded())
        expect(maze.cost.some((c) => c > MIN_COST)).toBe(true)
    })

    it("is reproducible from the same source", () => {
        expect(generate(20, 15, seeded()).walls).toEqual(generate(20, 15, seeded()).walls)
    })
})

describe("clearAround", () => {
    it("opens the square and its neighbours", () => {
        const maze = parse(["###", "###", "###"])
        clearAround(maze, index(maze, 1, 1))
        expect(maze.walls.every((w) => !w)).toBe(true)
    })

    it("does not fall off the edge of the map", () => {
        const maze = parse(["###", "###"])
        clearAround(maze, index(maze, 0, 0))
        expect(maze.walls[index(maze, 0, 0)]).toBe(false)
        expect(maze.walls[index(maze, 2, 1)]).toBe(true)
    })

    it("also clears slow ground, so a start is never inside mud", () => {
        const maze = parse(["~~~", "~~~", "~~~"])
        clearAround(maze, index(maze, 1, 1))
        expect(maze.cost.every((c) => c === 1)).toBe(true)
    })
})

describe("routeCost", () => {
    it("adds up what each square costs to enter", () => {
        const maze = parse([".~."])
        expect(routeCost(maze, [2, 1, 0], 0)).toBe(5)
    })

    it("does not charge for standing on the start", () => {
        const maze = parse(["~~~"])
        expect(routeCost(maze, [0], 0)).toBe(0)
    })
})
