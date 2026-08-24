export const SIZE = 4

export type Direction = "left" | "right" | "up" | "down"

export interface Tile {
    id: number
    value: number
    row: number
    col: number
    merged: boolean
    fresh: boolean
}

export interface Game {
    tiles: Tile[]
    score: number
    over: boolean
    /** A 2048 has been made. The player may keep going. */
    won: boolean
}

export interface Source {
    /** A float in [0, 1). */
    next(): number
}

let nextId = 1

function tile(value: number, row: number, col: number, fresh = false): Tile {
    return { id: nextId++, value, row, col, merged: false, fresh }
}

export function newGame(source: Source): Game {
    const game: Game = { tiles: [], score: 0, over: false, won: false }
    spawn(game, source)
    spawn(game, source)
    return game
}

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

export function spawn(game: Game, source: Source): void {
    const free = emptyCells(game.tiles)
    if (free.length === 0) return
    const cell = free[Math.floor(source.next() * free.length)]!
    game.tiles.push(tile(source.next() < 0.1 ? 4 : 2, cell.row, cell.col, true))
}

/** The cells of each row or column, ordered from the wall the player pushed against. */
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
    /** Something shifted or merged. A new tile appears only then. */
    moved: boolean
    gained: number
}

export function move(game: Game, direction: Direction): MoveResult {
    const at = new Map<number, Tile>()
    for (const t of game.tiles) at.set(t.row * SIZE + t.col, t)

    const result: Tile[] = []
    let moved = false
    let gained = 0

    for (const line of lines(direction)) {
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

            // i++ consumes the second tile, so what the merge produced cannot merge again this move.
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

export function stuck(game: Game): boolean {
    if (game.tiles.length < SIZE * SIZE) return false
    for (const direction of ["left", "right", "up", "down"] as const) {
        if (move(game, direction).moved) return false
    }
    return true
}

export function highest(game: Game): number {
    let best = 0
    for (const t of game.tiles) if (t.value > best) best = t.value
    return best
}
