import { describe, it, expect } from "vitest"
import { move, stuck, newGame, spawn, highest, SIZE, type Game, type Tile, type Direction } from "./game"

/**
 * The board is written out as rows of numbers, because a test that reads like
 * the thing it is testing is a test somebody will still trust in a year. 0 is
 * an empty cell.
 */
let id = 1
function board(rows: number[][]): Game {
    const tiles: Tile[] = []
    rows.forEach((cells, row) => cells.forEach((value, col) => {
        if (value !== 0) tiles.push({ id: id++, value, row, col, merged: false, fresh: false })
    }))
    return { tiles, score: 0, over: false, won: false }
}

function grid(game: Game): number[][] {
    const out = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0))
    for (const t of game.tiles) out[t.row]![t.col] = t.value
    return out
}

const push = (rows: number[][], direction: Direction) => grid(move(board(rows), direction).game)

describe("sliding", () => {
    it("packs a row against the wall it was pushed at", () => {
        expect(push([[0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left"))
            .toEqual([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])
    })

    it("closes gaps without merging unequal tiles", () => {
        expect(push([[2, 0, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left")[0])
            .toEqual([2, 4, 0, 0])
    })

    it("works in all four directions", () => {
        const one = [[0, 0, 0, 0], [0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
        expect(push(one, "left")[1]).toEqual([2, 0, 0, 0])
        expect(push(one, "right")[1]).toEqual([0, 0, 0, 2])
        expect(push(one, "up")[0]![1]).toBe(2)
        expect(push(one, "down")[3]![1]).toBe(2)
    })

    it("reports nothing moved when the board is already packed", () => {
        const packed = board([[2, 4, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]])
        expect(move(packed, "left").moved).toBe(false)
        expect(move(packed, "up").moved).toBe(false)
    })
})

describe("merging", () => {
    it("combines two equal neighbours", () => {
        expect(push([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left")[0])
            .toEqual([4, 0, 0, 0])
    })

    it("combines across a gap", () => {
        expect(push([[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left")[0])
            .toEqual([4, 0, 0, 0])
    })

    /**
     * The rule this genre gets wrong most often. A tile that has just been made
     * by a merge is finished for the turn, so 2 2 4 gives 4 4 and never 8, and
     * 4 2 2 gives 4 4 rather than one 8 as well.
     */
    it("lets a tile merge only once per move", () => {
        expect(push([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left")[0])
            .toEqual([4, 4, 0, 0])
        expect(push([[4, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left")[0])
            .toEqual([4, 4, 0, 0])
    })

    it("merges the pair nearest the wall when four are equal", () => {
        // 2 2 2 2 to the left is two 4s, not one 8 and not a 4 and two 2s.
        expect(push([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left")[0])
            .toEqual([4, 4, 0, 0])
    })

    it("resolves from the pushed wall, so direction changes which pair combines", () => {
        // 4 4 8 pushed right leaves the 8 alone and combines the 4s behind it.
        expect(push([[0, 4, 4, 8], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "right")[0])
            .toEqual([0, 0, 8, 8])
    })

    it("scores the value it created, not the values it consumed", () => {
        const result = move(board([[2, 2, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), "left")
        expect(result.gained).toBe(4 + 8)
        expect(result.game.score).toBe(12)
    })

    it("marks the tile a merge produced, so the board can pop it", () => {
        const result = move(board([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), "left")
        expect(result.game.tiles.filter((t) => t.merged)).toHaveLength(1)
    })

    it("keeps a tile's identity across a move, which is what animates it", () => {
        const start = board([[0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])
        const moved = move(start, "left").game
        expect(moved.tiles[0]!.id).toBe(start.tiles[0]!.id)
    })

    it("clears the merged and fresh marks on the next move", () => {
        const first = move(board([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), "left").game
        const second = move(first, "right").game
        expect(second.tiles.every((t) => !t.merged && !t.fresh)).toBe(true)
    })
})

describe("winning and losing", () => {
    it("notices a 2048", () => {
        expect(move(board([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), "left").game.won)
            .toBe(true)
    })

    it("stays won once won, even after the tile is merged away", () => {
        const won = move(board([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), "left").game
        expect(move(won, "right").game.won).toBe(true)
    })

    it("is not stuck while a gap remains", () => {
        expect(stuck(board([[2, 4, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 0]]))).toBe(false)
    })

    it("is not stuck on a full board that still has a pair", () => {
        expect(stuck(board([[2, 2, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]]))).toBe(false)
    })

    it("is stuck when a full board has no equal neighbours", () => {
        expect(stuck(board([[2, 4, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]]))).toBe(true)
    })
})

describe("spawning", () => {
    /** A source that hands back a fixed sequence, so a test can place a tile exactly. */
    const scripted = (values: number[]) => {
        let i = 0
        return { next: () => values[i++ % values.length]! }
    }

    it("starts with two tiles", () => {
        expect(newGame(scripted([0.5, 0.5, 0.2, 0.9])).tiles).toHaveLength(2)
    })

    it("only ever puts a 2 or a 4 down", () => {
        const source = { next: () => Math.random() }
        const game = newGame(source)
        for (let i = 0; i < 200; i++) spawn(game, source)
        expect(game.tiles.every((t) => t.value === 2 || t.value === 4)).toBe(true)
    })

    it("puts a 4 down roughly one time in ten", () => {
        const source = { next: () => Math.random() }
        let fours = 0
        for (let run = 0; run < 400; run++) {
            const game: Game = { tiles: [], score: 0, over: false, won: false }
            spawn(game, source)
            if (game.tiles[0]!.value === 4) fours++
        }
        expect(fours).toBeGreaterThan(15)
        expect(fours).toBeLessThan(85)
    })

    it("never lands on an occupied cell", () => {
        const source = { next: () => Math.random() }
        const game: Game = { tiles: [], score: 0, over: false, won: false }
        for (let i = 0; i < SIZE * SIZE; i++) spawn(game, source)
        const cells = new Set(game.tiles.map((t) => `${t.row},${t.col}`))
        expect(cells.size).toBe(SIZE * SIZE)
    })

    it("does nothing on a full board rather than overwriting", () => {
        const full = board([[2, 4, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]])
        spawn(full, { next: () => 0.5 })
        expect(full.tiles).toHaveLength(SIZE * SIZE)
    })

    it("marks a new tile fresh, so the board can fade it in", () => {
        const game: Game = { tiles: [], score: 0, over: false, won: false }
        spawn(game, { next: () => 0.5 })
        expect(game.tiles[0]!.fresh).toBe(true)
    })
})

describe("highest", () => {
    it("reports the largest tile", () => {
        expect(highest(board([[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]))).toBe(16)
    })

    it("is zero on an empty board", () => {
        expect(highest(board([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]))).toBe(0)
    })
})
