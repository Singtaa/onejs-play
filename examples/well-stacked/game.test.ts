import { describe, it, expect } from "vitest"
import {
    emptyBoard, spawn, moved, rotated, fits, merge, clearLines, hardDropped,
    scoreFor, levelFor, dropInterval, cellsOf, shapeOf, KINDS, COLS, ROWS,
} from "./game"

const filledRow = () => new Array(COLS).fill(1)

describe("board and pieces", () => {
    it("starts empty at the right size", () => {
        const b = emptyBoard()
        expect(b).toHaveLength(ROWS)
        expect(b[0]).toHaveLength(COLS)
        expect(b.every((r) => r.every((c) => c === 0))).toBe(true)
    })

    it("gives every kind exactly four cells in every rotation", () => {
        for (const kind of KINDS) {
            let p = spawn(kind)
            for (let i = 0; i < 4; i++) {
                expect(cellsOf(p)).toHaveLength(4)
                p = { ...p, rotation: p.rotation + 1 }
            }
        }
    })

    it("spawns inside the board horizontally", () => {
        for (const kind of KINDS) {
            for (const [x] of cellsOf(spawn(kind))) {
                expect(x).toBeGreaterThanOrEqual(0)
                expect(x).toBeLessThan(COLS)
            }
        }
    })
})

describe("fits", () => {
    it("rejects a piece past either wall", () => {
        const b = emptyBoard()
        expect(fits(b, moved(spawn("O"), -COLS, 0))).toBe(false)
        expect(fits(b, moved(spawn("O"), COLS, 0))).toBe(false)
    })

    it("rejects a piece below the floor", () => {
        expect(fits(emptyBoard(), moved(spawn("O"), 0, ROWS))).toBe(false)
    })

    // A piece spawns partly above the ceiling; treating that as a collision
    // would end the game the instant it starts.
    it("allows cells above the ceiling", () => {
        const p = { ...spawn("I"), y: -2 }
        expect(fits(emptyBoard(), p)).toBe(true)
    })

    it("rejects overlapping a settled cell", () => {
        const b = emptyBoard()
        b[ROWS - 1] = filledRow()
        expect(fits(b, { ...spawn("O"), y: ROWS - 2 })).toBe(false)
    })
})

describe("rotation", () => {
    it("rotates through its states and back", () => {
        const b = emptyBoard()
        let p = spawn("T")
        const start = p.rotation
        for (let i = 0; i < 4; i++) p = rotated(b, p)
        expect(p.rotation).toBe(start)
    })

    it("leaves O unchanged, since it has one state", () => {
        const p = spawn("O")
        expect(rotated(emptyBoard(), p).rotation).toBe(p.rotation)
    })

    // Without wall kicks a piece flush to the wall silently refuses to turn,
    // which reads as an unresponsive game rather than as a rule.
    it("kicks off the left wall instead of refusing", () => {
        const b = emptyBoard()
        const against = { ...spawn("I"), x: -2, rotation: 1 }
        const after = rotated(b, against)
        expect(fits(b, after)).toBe(true)
    })

    it("refuses when no kick can fit", () => {
        const b = emptyBoard()
        for (let y = 0; y < ROWS; y++) b[y] = filledRow()
        const p = spawn("T")
        expect(rotated(b, p)).toEqual(p)
    })
})

describe("hardDropped", () => {
    it("lands on the floor of an empty board", () => {
        const p = hardDropped(emptyBoard(), spawn("O"))
        expect(Math.max(...cellsOf(p).map(([, y]) => y))).toBe(ROWS - 1)
    })

    it("stacks on top of what is already there", () => {
        const b = emptyBoard()
        b[ROWS - 1] = filledRow()
        const p = hardDropped(b, spawn("O"))
        expect(Math.max(...cellsOf(p).map(([, y]) => y))).toBe(ROWS - 2)
    })

    it("is idempotent", () => {
        const b = emptyBoard()
        const once = hardDropped(b, spawn("T"))
        expect(hardDropped(b, once)).toEqual(once)
    })
})

describe("merge", () => {
    it("writes exactly four cells and leaves the source alone", () => {
        const b = emptyBoard()
        const p = hardDropped(b, spawn("O"))
        const next = merge(b, p)
        expect(next.flat().filter((c) => c !== 0)).toHaveLength(4)
        expect(b.flat().every((c) => c === 0)).toBe(true)
    })

    it("discards cells above the ceiling rather than throwing", () => {
        expect(() => merge(emptyBoard(), { ...spawn("I"), y: -3 })).not.toThrow()
    })
})

describe("clearLines", () => {
    it("removes a full row and drops what was above it", () => {
        const b = emptyBoard()
        b[ROWS - 1] = filledRow()
        b[ROWS - 2]![3] = 2
        const { board, cleared } = clearLines(b)
        expect(cleared).toBe(1)
        expect(board[ROWS - 1]![3]).toBe(2)
        expect(board).toHaveLength(ROWS)
    })

    it("clears four at once", () => {
        const b = emptyBoard()
        for (let i = 1; i <= 4; i++) b[ROWS - i] = filledRow()
        expect(clearLines(b).cleared).toBe(4)
    })

    it("leaves a board with no full rows untouched", () => {
        const b = emptyBoard()
        b[ROWS - 1]![0] = 1
        expect(clearLines(b).cleared).toBe(0)
    })

    it("keeps the board the right size after clearing", () => {
        const b = emptyBoard()
        for (let i = 1; i <= 3; i++) b[ROWS - i] = filledRow()
        const { board } = clearLines(b)
        expect(board).toHaveLength(ROWS)
        expect(board.every((r) => r.length === COLS)).toBe(true)
    })
})

describe("scoring and pace", () => {
    it("rewards clearing four rows at once far more than four singles", () => {
        expect(scoreFor(4, 0)).toBeGreaterThan(scoreFor(1, 0) * 4)
    })
    it("scales with level", () => {
        expect(scoreFor(1, 4)).toBe(scoreFor(1, 0) * 5)
    })
    it("scores nothing for no lines", () => {
        expect(scoreFor(0, 3)).toBe(0)
    })
    it("levels up every ten lines", () => {
        expect(levelFor(9)).toBe(0)
        expect(levelFor(10)).toBe(1)
        expect(levelFor(35)).toBe(3)
    })
    it("speeds up with level but never to zero", () => {
        expect(dropInterval(1)).toBeLessThan(dropInterval(0))
        expect(dropInterval(99)).toBeGreaterThan(0)
    })
})

describe("shapeOf", () => {
    it("returns the unpositioned offsets, which is what a preview needs", () => {
        // O is the one piece with a single rotation, so its shape is fixed.
        expect(shapeOf("O")).toEqual([[1, 0], [2, 0], [1, 1], [2, 1]])
    })

    it("gives every kind exactly four cells, in every rotation", () => {
        for (const kind of KINDS) {
            for (let rotation = 0; rotation < 4; rotation++) {
                expect(shapeOf(kind, rotation)).toHaveLength(4)
            }
        }
    })

    it("wraps rotation, so a preview cannot index past the end", () => {
        for (const kind of KINDS) {
            expect(shapeOf(kind, 4)).toEqual(shapeOf(kind, 0))
            expect(shapeOf(kind, 9)).toEqual(shapeOf(kind, 1 % SHAPE_STATES(kind)))
        }
    })

    it("fits every piece inside a 4x4 box, which bounds the preview", () => {
        for (const kind of KINDS) {
            for (let rotation = 0; rotation < 4; rotation++) {
                for (const [x, y] of shapeOf(kind, rotation)) {
                    expect(x).toBeGreaterThanOrEqual(0)
                    expect(y).toBeGreaterThanOrEqual(0)
                    expect(x).toBeLessThan(4)
                    expect(y).toBeLessThan(4)
                }
            }
        }
    })

    it("agrees with cellsOf once a piece is placed", () => {
        const piece = { kind: "T" as const, rotation: 0, x: 3, y: 5 }
        const expected = shapeOf("T", 0).map(([dx, dy]) => [piece.x + dx, piece.y + dy])
        expect(cellsOf(piece)).toEqual(expected)
    })
})

/** How many distinct rotations a kind has, derived rather than hard-coded. */
function SHAPE_STATES(kind: (typeof KINDS)[number]): number {
    let n = 1
    while (n < 4 && JSON.stringify(shapeOf(kind, n)) !== JSON.stringify(shapeOf(kind, 0))) n++
    return n
}
