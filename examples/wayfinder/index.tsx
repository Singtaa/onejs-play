/**
 * Wayfinder: three searches, one map, side by side.
 *
 * They all find a way across. Watching them do it is the point, because the
 * shapes they make while searching say more about how each one works than any
 * description of it: breadth first floods outward in rings, Dijkstra does the
 * same but slows down in the mud, and A star walks more or less straight at the
 * goal and barely looks anywhere else.
 *
 * WHY THIS IS MADE OF ELEMENTS AND NOT A DRAWING
 *
 * The other drawing-heavy games here paint themselves into one vector path
 * every frame, because everything in them moves. Almost nothing moves here. A
 * search settles a handful of squares per frame and leaves the other thousand
 * exactly as they were, so the cheap thing is to build the grid once and write
 * a colour onto the few squares that changed.
 *
 * That is what a retained mode renderer is for, and it is the reverse of the
 * advice for the arcade games. The rule is not "use elements" or "use a
 * painter", it is "match the tool to how much of the screen actually changes".
 *
 * The three searches are in search.ts and know nothing about any of this.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { View, Text, Button, mount, useFrame, random } from "oj"
import styles from "./wayfinder.module.uss"
import {
    createSearch, generate, clearAround, routeCost,
    type Maze, type Kind, type Search,
} from "./search"

const COLS = 18
const ROWS = 22
const CELL = 14
const GAP = 26
const PANE_W = COLS * CELL
const PANE_H = ROWS * CELL

const LANES: { kind: Kind; title: string; blurb: string }[] = [
    { kind: "breadth", title: "Breadth first", blurb: "fewest squares" },
    { kind: "dijkstra", title: "Dijkstra", blurb: "cheapest route" },
    { kind: "astar", title: "A star", blurb: "cheapest, guided" },
]

/** Squares settled per frame. Fast enough to watch, slow enough to follow. */
const PACE = 4

/**
 * A square's appearance is a class, not a colour written onto its style.
 *
 * Not a stylistic preference. Assigning a string to `element.style.background
 * Color` from a game hands that string to C#, which wants a StyleColor and has
 * no conversion from text: every write fails with an ArgumentException, the
 * console fills, and the grid stays the colour it started. Swapping a class
 * costs the same single crossing and actually works.
 */
const CLASS = {
    open: styles.open,
    slow: styles.slow,
    wall: styles.wall,
    frontier: styles.frontier,
    visited: styles.visited,
    route: styles.route,
    start: styles.start,
    goal: styles.goal,
}

/** Where a square sits in the flat arrays the maze and the searches share. */
const at = (col: number, row: number) => row * COLS + col

const START = at(1, ROWS - 2)
const GOAL = at(COLS - 2, 1)

interface Lane {
    kind: Kind
    /** Null until the first map exists, which is one frame after mounting. */
    search: Search | null
    /** One element per square, in the same order as the maze arrays. */
    cells: any[]
    /**
     * The class each square is currently wearing.
     *
     * Remembered so a repaint is two crossings rather than nine: without it,
     * setting a class means clearing all the others first, because a square
     * carrying both `visited` and `frontier` gets whichever the stylesheet
     * happens to list last.
     */
    worn: string[]
    pathLength: number
    pathCost: number
}

function Wayfinder() {
    const rng = useRef(random()).current
    const maze = useRef<Maze | null>(null)
    const lanes = useRef<Lane[]>([]).current
    const [running, setRunning] = useState(true)
    const [stats, setStats] = useState(LANES.map(() => ({ expanded: 0, steps: 0, cost: 0, done: false })))

    /** What a square looks like with no search on it. */
    const groundOf = (m: Maze, cell: number): string => {
        if (cell === START) return CLASS.start
        if (cell === GOAL) return CLASS.goal
        if (m.walls[cell] === true) return CLASS.wall
        return m.cost[cell]! > 1 ? CLASS.slow : CLASS.open
    }

    /** Puts one class on a square and takes the previous one off. */
    const wear = (lane: Lane, cell: number, want: string) => {
        if (lane.worn[cell] === want) return
        const element = lane.cells[cell]
        if (element === undefined || element === null) return
        const had = lane.worn[cell]
        if (had !== undefined && had !== "") element.RemoveFromClassList(had)
        element.AddToClassList(want)
        lane.worn[cell] = want
    }

    /** Repaints one square from whatever the lane currently knows about it. */
    const paintCell = (lane: Lane, m: Maze, cell: number) => {
        const search = lane.search
        if (search === null) return
        if (cell === START || cell === GOAL || m.walls[cell] === true) return
        wear(lane, cell, search.visited[cell] === 1 ? CLASS.visited
            : search.frontier[cell] === 1 ? CLASS.frontier
            : groundOf(m, cell))
    }

    const reset = () => {
        const built = generate(COLS, ROWS, () => rng.next())
        clearAround(built, START)
        clearAround(built, GOAL)
        maze.current = built

        for (const lane of lanes) {
            lane.search = createSearch(built, START, GOAL, lane.kind)
            lane.pathLength = 0
            lane.pathCost = 0
            // Every square at once. This is the one moment the whole grid
            // changes, and it is a button press rather than a frame, so paying
            // for it here keeps every other frame cheap.
            for (let cell = 0; cell < built.walls.length; cell++) wear(lane, cell, groundOf(built, cell))
        }
        setStats(LANES.map(() => ({ expanded: 0, steps: 0, cost: 0, done: false })))
        setRunning(true)
    }

    // Built once the cell refs exist, which is after the first render.
    useEffect(() => {
        reset()
    }, [])

    useFrame(() => {
        const m = maze.current
        if (m === null || !running) return

        let anyRunning = false
        let finishedNow = false

        for (const lane of lanes) {
            const search = lane.search
            if (search === null || search.done) continue
            anyRunning = true
            for (let i = 0; i < PACE && !search.done; i++) {
                for (const cell of search.step()) paintCell(lane, m, cell)
            }
            if (search.done) {
                finishedNow = true
                const route = search.path()
                lane.pathLength = Math.max(0, route.length - 1)
                lane.pathCost = routeCost(m, route, START)
                for (const cell of route) {
                    if (cell === START || cell === GOAL) continue
                    wear(lane, cell, CLASS.route)
                }
            }
        }

        if (finishedNow || !anyRunning) {
            setStats(lanes.map((lane) => ({
                expanded: lane.search?.expanded ?? 0,
                steps: lane.pathLength,
                cost: lane.pathCost,
                done: lane.search?.done ?? false,
            })))
        }
        if (!anyRunning) setRunning(false)
    }, [running])

    /**
     * The grid, rendered once and then never re-rendered.
     *
     * Memoised on nothing, because its contents genuinely never change: the
     * squares are plain boxes and everything that varies is written onto them
     * afterwards. Letting React rebuild this on a stats update would rebuild a
     * thousand elements to change three numbers.
     */
    const grids = useMemo(() => LANES.map((lane, laneIndex) => {
        if (lanes[laneIndex] === undefined) {
            lanes[laneIndex] = { kind: lane.kind, search: null, cells: [], worn: [], pathLength: 0, pathCost: 0 }
        }
        // Rows written out rather than one wrapping row. Wrapping would depend
        // on the cells adding up to exactly the pane's width, and a rounding
        // difference of one pixel would drop a square onto the next line and
        // shear the whole grid.
        return (
            <View key={lane.kind} style={{ width: PANE_W, height: PANE_H }}>
                {Array.from({ length: ROWS }, (_, row) => (
                    <View key={row} style={{ flexDirection: "row" }}>
                        {Array.from({ length: COLS }, (_, col) => (
                            <View
                                key={col}
                                ref={(el: any) => { lanes[laneIndex]!.cells[at(col, row)] = el }}
                                className={styles.cell}
                            />
                        ))}
                    </View>
                ))}
            </View>
        )
    }), [])

    return (
        <View style={{ width: 900, height: 540, backgroundColor: "rgb(15, 18, 24)" }}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 22, marginLeft: 46, marginRight: 46 }}>
                <View style={{ flexGrow: 1 }}>
                    <Text style={{ fontSize: 22, color: "rgb(226, 234, 247)" }}>WAYFINDER</Text>
                    <Text style={{ fontSize: 11, marginTop: 3, color: "rgb(122, 134, 156)" }}>
                        Same map, same start and finish. Dark orange ground costs four times as much to cross.
                    </Text>
                </View>
                <Button text="New map" onClick={reset} />
            </View>

            <View style={{ flexDirection: "row", marginTop: 18, marginLeft: 46 }}>
                {LANES.map((lane, i) => (
                    <View key={lane.kind} style={{ width: PANE_W, marginRight: i === LANES.length - 1 ? 0 : GAP }}>
                        <Text style={{ fontSize: 13, color: "rgb(210, 222, 240)" }}>{lane.title}</Text>
                        <Text style={{ fontSize: 10, marginTop: 1, marginBottom: 7, color: "rgb(112, 126, 150)" }}>
                            {lane.blurb}
                        </Text>
                        {grids[i]}
                        <View style={{ flexDirection: "row", marginTop: 8 }}>
                            <Text style={{ fontSize: 11, color: "rgb(150, 164, 188)" }}>
                                {`${stats[i]!.expanded} settled`}
                            </Text>
                            <Text style={{ fontSize: 11, marginLeft: 12, color: "rgb(255, 198, 96)" }}>
                                {stats[i]!.done ? `cost ${stats[i]!.cost}` : ""}
                            </Text>
                        </View>
                    </View>
                ))}
            </View>
        </View>
    )
}

mount(<Wayfinder />)
