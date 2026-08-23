/**
 * The rules of Twos Company, with no screen in them.
 *
 * Kept apart from the drawing for the same reason the board itself is a plain
 * array: the interesting part of this game is one function, and a function that
 * takes a board and a direction and returns a board can be tested exhaustively
 * in milliseconds. Nothing here imports oj, or React, or knows what a pixel is.
 *
 * THE RULE EVERYBODY GETS WRONG
 *
 * A tile may take part in at most one merge per move. Pushing 2 2 4 to the left
 * gives 4 4, never 8: the two 2s combine, and the 4 they became is finished for
 * this turn even though a 4 is now sitting next to it. Getting that wrong makes
 * the game far too easy and is the single most common bug in a clone of it.
 */

/** Four by four, like the game everyone knows. */
export const SIZE = 4

export type Direction = "left" | "right" | "up" | "down"

export interface Tile {
    /**
     * Stable across moves, which is what makes the animation possible: React
     * keys a tile by this, so a tile that changes position is the same element
     * moving rather than one element vanishing and another appearing.
     */
    id: number
    value: number
    row: number
    col: number
    /** Came out of a merge this move. The board uses it to pop the tile. */
    merged: boolean
    /** Appeared this move. The board uses it to fade the tile in. */
    fresh: boolean
}

export interface Game {
    tiles: Tile[]
    score: number
    /** No move left in any direction. */
    over: boolean
    /** A 2048 has been made. The player may keep going. */
    won: boolean
}

/** Just enough randomness to be a source of tiles, so tests can supply their own. */
export interface Source {
    /** A float in [0, 1). */
    next(): number
}

let nextId = 1

function tile(value: number, row: number, col: number, fresh = false): Tile {
    return { id: nextId++, value, row, col, merged: false, fresh }
}

/** An empty board with the two tiles a game starts with. */
export function newGame(source: Source): Game {
    const game: Game = { tiles: [], score: 0, over: false, won: false }
    spawn(game, source)
    spawn(game, source)
    return game
}

/** Which cells have nothing in them. */
function emptyCells(tiles: readonly Tile[]): { row: number; col: number }[] {
    const taken = new Set(tiles.map((t) => t.row * SIZE + t.col))
    const out: { row: number; col: number }[] = []
    for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
            if (!taken.has(row * SIZE + col)) out.push({ row, col })
        }
    }
    return out
}

/**
 * Drops one new tile into a free cell. A 4 one time in ten, which is the ratio
 * the original uses and the reason a run occasionally goes wrong early.
 */
export function spawn(game: Game, source: Source): void {
    const free = emptyCells(game.tiles)
    if (free.length === 0) return
    const cell = free[Math.floor(source.next() * free.length)]!
    game.tiles.push(tile(source.next() < 0.1 ? 4 : 2, cell.row, cell.col, true))
}

/**
 * The order cells are visited for a given direction.
 *
 * Travel is always toward the wall the player pushed against, so the tile
 * nearest that wall has to be resolved first: it is the one that gets to stop
 * where it is, and every tile behind it stacks against it. Reading each line in
 * that order turns four directions into one loop.
 */
function lines(direction: Direction): { row: number; col: number }[][] {
    const out: { row: number; col: number }[][] = []
    const forward = direction === "left" || direction === "up"
    const vertical = direction === "up" || direction === "down"

    for (let fixed = 0; fixed < SIZE; fixed++) {
        const line: { row: number; col: number }[] = []
        for (let i = 0; i < SIZE; i++) {
            const moving = forward ? i : SIZE - 1 - i
            line.push(vertical ? { row: moving, col: fixed } : { row: fixed, col: moving })
        }
        out.push(line)
    }
    return out
}

export interface MoveResult {
    game: Game
    /** Nothing shifted and nothing merged, so no new tile should appear. */
    moved: boolean
    /** Points scored by this move, which is the sum of what was created. */
    gained: number
}

/**
 * Pushes every tile as far as it will go, merging equal neighbours on the way.
 *
 * Returns a new game rather than editing the old one, so a caller can compare
 * the two, and so React sees a new object and re-renders.
 */
export function move(game: Game, direction: Direction): MoveResult {
    const at = new Map<number, Tile>()
    for (const t of game.tiles) at.set(t.row * SIZE + t.col, t)

    const result: Tile[] = []
    let moved = false
    let gained = 0

    for (const line of lines(direction)) {
        // Tiles in this line, already in travel order, with the gaps removed.
        const present: Tile[] = []
        for (const cell of line) {
            const found = at.get(cell.row * SIZE + cell.col)
            if (found !== undefined) present.push(found)
        }

        let slot = 0
        for (let i = 0; i < present.length; i++) {
            const current = present[i]!
            const next = present[i + 1]
            const destination = line[slot]!

            // A merge takes the two tiles and skips the second one entirely, so
            // the tile it became cannot merge again this move. That is the whole
            // "one merge per tile" rule, expressed as an increment.
            if (next !== undefined && next.value === current.value) {
                const value = current.value * 2
                result.push({
                    ...current, value,
                    row: destination.row, col: destination.col,
                    merged: true, fresh: false,
                })
                gained += value
                moved = true
                i++
            } else {
                if (current.row !== destination.row || current.col !== destination.col) moved = true
                result.push({
                    ...current,
                    row: destination.row, col: destination.col,
                    merged: false, fresh: false,
                })
            }
            slot++
        }
    }

    const next: Game = {
        tiles: result,
        score: game.score + gained,
        over: false,
        won: game.won || result.some((t) => t.value >= 2048),
    }
    return { game: next, moved, gained }
}

/** True when no direction would change anything, which is the end of the game. */
export function stuck(game: Game): boolean {
    // A gap anywhere means at least one direction shifts something, so the
    // expensive check below is only ever run on a full board.
    if (game.tiles.length < SIZE * SIZE) return false
    for (const direction of ["left", "right", "up", "down"] as const) {
        if (move(game, direction).moved) return false
    }
    return true
}

/** The largest tile on the board, which is really what a run is judged by. */
export function highest(game: Game): number {
    let best = 0
    for (const t of game.tiles) if (t.value > best) best = t.value
    return best
}
