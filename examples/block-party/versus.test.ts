import { describe, it, expect } from "vitest"
import {
    attackFor, offset, takeGarbage, queue, nextHole, buries, addGarbage,
    chooseTarget, encodeWell, decodeWell, stackHeight,
    MAX_PENDING, MAX_COMBO_BONUS, GARBAGE_PER_LOCK,
} from "./versus"
import { emptyBoard, COLS, ROWS, GARBAGE, type Board } from "./blocks"

function seeded(seed: number): () => number {
    let state = seed
    return () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

const boardWith = (rows: Array<[number, number[]]>): Board => {
    const board = emptyBoard()
    for (const [y, cells] of rows) board[y] = cells
    return board
}

const fullRow = (fill = 1) => new Array(COLS).fill(fill)

describe("what a clear is worth", () => {
    it("sends nothing for a single, which is what makes tidy play defensive", () => {
        expect(attackFor(1, 0)).toBe(0)
    })

    it("pays much better for taking rows together than one at a time", () => {
        expect(attackFor(4, 0)).toBeGreaterThan(attackFor(1, 0) * 4)
        expect(attackFor(4, 0)).toBeGreaterThan(attackFor(2, 0) * 2)
    })

    it("sends nothing at all when nothing was cleared, however good the run was", () => {
        for (let combo = 0; combo < 30; combo++) expect(attackFor(0, combo)).toBe(0)
    })

    it("never decreases as more rows go at once", () => {
        for (let combo = 0; combo < 12; combo++) {
            for (let cleared = 1; cleared <= 4; cleared++) {
                expect(attackFor(cleared, combo)).toBeGreaterThanOrEqual(attackFor(cleared - 1, combo))
            }
        }
    })

    it("never decreases as a run goes on, and stops climbing at the cap", () => {
        for (let cleared = 1; cleared <= 4; cleared++) {
            for (let combo = 1; combo < 40; combo++) {
                expect(attackFor(cleared, combo)).toBeGreaterThanOrEqual(attackFor(cleared, combo - 1))
            }
            expect(attackFor(cleared, 999)).toBe(attackFor(cleared, 0) + MAX_COMBO_BONUS)
        }
    })

    it("survives the nonsense a caller can reach it with", () => {
        expect(attackFor(-3, -3)).toBe(0)
        expect(attackFor(9, 0)).toBe(attackFor(4, 0))
    })
})

describe("cancelling", () => {
    it("spends the attack on the queue first and passes the rest on", () => {
        const roll = seeded(7)
        for (let i = 0; i < 500; i++) {
            const pending = Math.floor(roll() * 25)
            const attack = Math.floor(roll() * 12)
            const after = offset(pending, attack)
            expect(after.pending + attack).toBe(pending + after.sent)
            expect(after.pending).toBe(Math.max(0, pending - attack))
            expect(after.sent).toBe(Math.max(0, attack - pending))
        }
    })

    it("never sends anything while there is still garbage to answer", () => {
        expect(offset(6, 4)).toEqual({ pending: 2, sent: 0 })
    })

    it("passes the surplus on once the queue is clear", () => {
        expect(offset(1, 5)).toEqual({ pending: 0, sent: 4 })
    })

    it("is a no-op with nothing waiting and nothing cleared", () => {
        expect(offset(0, 0)).toEqual({ pending: 0, sent: 0 })
    })

    it("treats negative nonsense as zero rather than inventing rows", () => {
        expect(offset(-5, -5)).toEqual({ pending: 0, sent: 0 })
        expect(offset(-5, 3)).toEqual({ pending: 0, sent: 3 })
    })
})

describe("the queue", () => {
    it("lands a few rows at a time rather than all of them at once", () => {
        expect(takeGarbage(10)).toEqual({ taken: GARBAGE_PER_LOCK, left: 10 - GARBAGE_PER_LOCK })
    })

    it("drains completely when what is left is small", () => {
        expect(takeGarbage(2)).toEqual({ taken: 2, left: 0 })
        expect(takeGarbage(0)).toEqual({ taken: 0, left: 0 })
    })

    it("empties in a bounded number of locks however full it is", () => {
        let left = queue(0, 10000)
        let locks = 0
        while (left > 0) {
            left = takeGarbage(left).left
            locks++
            expect(locks).toBeLessThanOrEqual(MAX_PENDING)
        }
        expect(left).toBe(0)
    })

    it("caps what one player can pile on another", () => {
        expect(queue(0, 10000)).toBe(MAX_PENDING)
        expect(queue(MAX_PENDING, 5)).toBe(MAX_PENDING)
    })

    it("ignores the negative and the not-a-number a message might carry", () => {
        expect(queue(3, -9)).toBe(3)
        expect(queue(3, Number.NaN)).toBe(3)
    })
})

describe("where the hole goes", () => {
    it("never repeats the column, so two batches cannot form a free shaft", () => {
        const roll = seeded(3)
        let previous = -1
        for (let i = 0; i < 2000; i++) {
            const hole = nextHole(previous, roll())
            expect(hole).not.toBe(previous)
            expect(hole).toBeGreaterThanOrEqual(0)
            expect(hole).toBeLessThan(COLS)
            previous = hole
        }
    })

    it("can reach every column from the first batch of a life", () => {
        const seen = new Set<number>()
        for (let i = 0; i < COLS * 40; i++) seen.add(nextHole(-1, i / (COLS * 40)))
        expect(seen.size).toBe(COLS)
    })

    it("can reach every other column from any given one", () => {
        for (let previous = 0; previous < COLS; previous++) {
            const seen = new Set<number>()
            for (let i = 0; i < 600; i++) seen.add(nextHole(previous, i / 600))
            expect(seen.size).toBe(COLS - 1)
            expect(seen.has(previous)).toBe(false)
        }
    })

    it("stays in range for a roll at either end", () => {
        expect(nextHole(4, 0)).toBeGreaterThanOrEqual(0)
        expect(nextHole(4, 1)).toBeLessThan(COLS)
        expect(nextHole(4, -1)).toBeGreaterThanOrEqual(0)
    })
})

describe("junk arriving", () => {
    it("pushes the stack up and leaves exactly one gap in each new row", () => {
        const board = addGarbage(emptyBoard(), 3, 4)
        expect(board).toHaveLength(ROWS)
        for (let y = ROWS - 3; y < ROWS; y++) {
            expect(board[y]!.filter((cell) => cell === 0)).toHaveLength(1)
            expect(board[y]![4]).toBe(0)
            expect(board[y]![0]).toBe(GARBAGE)
        }
    })

    it("carries what was already there upward rather than overwriting it", () => {
        const board = addGarbage(boardWith([[ROWS - 1, fullRow(2)]]), 2, 0)
        expect(board[ROWS - 3]).toEqual(fullRow(2))
    })

    it("leaves the board alone when nothing is sent", () => {
        const before = emptyBoard()
        expect(addGarbage(before, 0, 3)).toBe(before)
    })

    it("does not modify the board it was given", () => {
        const before = emptyBoard()
        addGarbage(before, 4, 2)
        expect(before.every((row) => row.every((cell) => cell === 0))).toBe(true)
    })

    it("stays the right shape for any amount and any hole a message could claim", () => {
        const roll = seeded(11)
        for (let i = 0; i < 400; i++) {
            const board = addGarbage(emptyBoard(), Math.floor(roll() * 60) - 10, Math.floor(roll() * 40) - 10)
            expect(board).toHaveLength(ROWS)
            for (const row of board) expect(row).toHaveLength(COLS)
        }
    })
})

describe("being buried", () => {
    it("reports the stack going through the ceiling before the rows are added", () => {
        expect(buries(boardWith([[1, fullRow()]]), 2)).toBe(true)
        expect(buries(boardWith([[1, fullRow()]]), 1)).toBe(false)
    })

    it("says no on an empty well however much is coming", () => {
        expect(buries(emptyBoard(), ROWS)).toBe(false)
    })

    it("agrees with what the addition actually loses", () => {
        const roll = seeded(23)
        for (let i = 0; i < 300; i++) {
            const board = emptyBoard()
            const top = Math.floor(roll() * ROWS)
            board[top] = fullRow()
            const rows = 1 + Math.floor(roll() * 6)
            const before = board.flat().filter((cell) => cell !== 0).length
            const kept = addGarbage(board, rows, 0).flat().filter((cell) => cell !== 0).length
            const junk = Math.min(ROWS, rows) * (COLS - 1)
            expect(kept - junk < before).toBe(buries(board, rows))
        }
    })
})

describe("choosing a target", () => {
    it("goes after whoever is winning", () => {
        expect(chooseTarget(1, [{ id: 2, score: 400 }, { id: 3, score: 900 }])).toBe(3)
    })

    it("goes after the runner up when the leader is you", () => {
        expect(chooseTarget(1, [{ id: 1, score: 9000 }, { id: 2, score: 400 }, { id: 3, score: 100 }])).toBe(2)
    })

    it("breaks a tie the same way for everybody", () => {
        const rivals = [{ id: 7, score: 500 }, { id: 3, score: 500 }, { id: 5, score: 500 }]
        expect(chooseTarget(1, rivals)).toBe(3)
        expect(chooseTarget(1, [...rivals].reverse())).toBe(3)
    })

    it("returns nobody when the room is empty, and nobody is never a real id", () => {
        expect(chooseTarget(1, [])).toBe(0)
        expect(chooseTarget(1, [{ id: 1, score: 100 }])).toBe(0)
    })

    it("does not depend on the order the room happened to arrive in", () => {
        const roll = seeded(41)
        for (let i = 0; i < 200; i++) {
            const rivals = Array.from({ length: 1 + Math.floor(roll() * 10) }, (_, n) => ({
                id: n + 2, score: Math.floor(roll() * 5) * 100,
            }))
            const shuffled = [...rivals].sort(() => roll() - 0.5)
            expect(chooseTarget(1, shuffled)).toBe(chooseTarget(1, rivals))
        }
    })
})

describe("the board on the wire", () => {
    it("survives a round trip unchanged", () => {
        const roll = seeded(97)
        for (let i = 0; i < 200; i++) {
            const board = emptyBoard().map((row) => row.map(() => (roll() < 0.4 ? 0 : Math.floor(roll() * 9))))
            expect(decodeWell(encodeWell(board))).toEqual(board)
        }
    })

    it("is one character a cell, which is what keeps it worth sending whole", () => {
        expect(encodeWell(emptyBoard())).toHaveLength(ROWS * COLS)
    })

    it("answers with an empty well for anything that is not one", () => {
        const empty = emptyBoard()
        for (const junk of [null, undefined, 42, {}, [], "", "abc", "0".repeat(199), "0".repeat(201)]) {
            expect(decodeWell(junk)).toEqual(empty)
        }
    })

    it("reads unexpected characters as empty cells rather than refusing", () => {
        const decoded = decodeWell("Z".repeat(ROWS * COLS))
        expect(decoded).toEqual(emptyBoard())
    })

    it("puts the cells back where they were, not transposed", () => {
        const board = emptyBoard()
        board[0]![0] = 3
        board[ROWS - 1]![COLS - 1] = 5
        const back = decodeWell(encodeWell(board))
        expect(back[0]![0]).toBe(3)
        expect(back[ROWS - 1]![COLS - 1]).toBe(5)
    })
})

describe("stack height", () => {
    it("is zero on an empty well and full on a full one", () => {
        expect(stackHeight(emptyBoard())).toBe(0)
        expect(stackHeight(boardWith([[0, fullRow()]]))).toBe(ROWS)
    })

    it("measures from the highest occupied row, holes underneath included", () => {
        expect(stackHeight(boardWith([[ROWS - 4, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]]]))).toBe(4)
    })

    it("rises by exactly the rows that arrived, until the ceiling takes some", () => {
        const roll = seeded(59)
        for (let i = 0; i < 400; i++) {
            const board = emptyBoard()
            const top = Math.floor(roll() * ROWS)
            board[top] = fullRow()
            const rows = Math.floor(roll() * 6)
            const before = stackHeight(board)
            const after = stackHeight(addGarbage(board, rows, 0))
            expect(after).toBeLessThanOrEqual(ROWS)
            if (buries(board, rows)) expect(after).toBeLessThan(before + rows)
            else expect(after).toBe(before + rows)
        }
    })
})
