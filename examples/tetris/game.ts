/**
 * Tetris rules, with no rendering and no oj in them.
 *
 * Pure so it can be unit tested, which matters here because the fiddly parts
 * (rotation near a wall, what counts as a lock, scoring a multi-line clear) are
 * exactly the parts that are painful to verify by playing.
 */

export const COLS = 10
export const ROWS = 20

/** Empty is 0; a filled cell holds its piece index plus one, for colouring. */
export type Cell = number
export type Board = Cell[][]

export type PieceKind = "I" | "O" | "T" | "S" | "Z" | "J" | "L"
export const KINDS: readonly PieceKind[] = ["I", "O", "T", "S", "Z", "J", "L"]

/** Rotation states, each a list of [x, y] offsets from the piece origin. */
const SHAPES: Record<PieceKind, ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = {
    I: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]],
        [[0, 2], [1, 2], [2, 2], [3, 2]], [[1, 0], [1, 1], [1, 2], [1, 3]]],
    O: [[[1, 0], [2, 0], [1, 1], [2, 1]]],
    T: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]],
    S: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]],
        [[1, 1], [2, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2]]],
    Z: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 0], [0, 1], [1, 1], [0, 2]]],
    J: [[[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]]],
    L: [[[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]],
        [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]]],
}

export interface Piece {
    kind: PieceKind
    rotation: number
    x: number
    y: number
}

export function emptyBoard(): Board {
    return Array.from({ length: ROWS }, () => new Array<Cell>(COLS).fill(0))
}

export function cellsOf(piece: Piece): Array<readonly [number, number]> {
    const states = SHAPES[piece.kind]
    const shape = states[piece.rotation % states.length]!
    return shape.map(([dx, dy]) => [piece.x + dx, piece.y + dy] as const)
}

/** Whether a piece may occupy its current position. */
export function fits(board: Board, piece: Piece): boolean {
    for (const [x, y] of cellsOf(piece)) {
        if (x < 0 || x >= COLS || y >= ROWS) return false
        // Above the ceiling is allowed: a piece spawns partly off-screen.
        if (y >= 0 && board[y]![x] !== 0) return false
    }
    return true
}

export function spawn(kind: PieceKind): Piece {
    return { kind, rotation: 0, x: Math.floor((COLS - 4) / 2), y: -1 }
}

export function moved(piece: Piece, dx: number, dy: number): Piece {
    return { ...piece, x: piece.x + dx, y: piece.y + dy }
}

/**
 * Rotates, nudging sideways if the rotation would clip a wall or a stack.
 *
 * Without the kicks a piece flush against a wall simply refuses to turn, which
 * reads as an unresponsive game rather than as a rule.
 */
export function rotated(board: Board, piece: Piece): Piece {
    const states = SHAPES[piece.kind].length
    const turned = { ...piece, rotation: (piece.rotation + 1) % states }
    for (const dx of [0, -1, 1, -2, 2]) {
        const kicked = { ...turned, x: turned.x + dx }
        if (fits(board, kicked)) return kicked
    }
    return piece
}

/** Drops the piece as far as it will go. */
export function hardDropped(board: Board, piece: Piece): Piece {
    let p = piece
    while (fits(board, moved(p, 0, 1))) p = moved(p, 0, 1)
    return p
}

/** Writes a piece into the board. Cells above the ceiling are discarded. */
export function merge(board: Board, piece: Piece): Board {
    const next = board.map((row) => row.slice())
    const colour = KINDS.indexOf(piece.kind) + 1
    for (const [x, y] of cellsOf(piece)) {
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) next[y]![x] = colour
    }
    return next
}

/** Removes full rows, returning the new board and how many went. */
export function clearLines(board: Board): { board: Board; cleared: number } {
    const kept = board.filter((row) => row.some((c) => c === 0))
    const cleared = ROWS - kept.length
    if (cleared === 0) return { board, cleared: 0 }
    const empty = Array.from({ length: cleared }, () => new Array<Cell>(COLS).fill(0))
    return { board: [...empty, ...kept], cleared }
}

/** Standard scoring: clearing four at once is worth far more than four singles. */
export function scoreFor(cleared: number, level: number): number {
    const table = [0, 100, 300, 500, 800]
    return (table[cleared] ?? 0) * (level + 1)
}

export function levelFor(lines: number): number {
    return Math.floor(lines / 10)
}

/** Seconds between gravity steps, falling off as the level climbs. */
export function dropInterval(level: number): number {
    return Math.max(0.05, 0.8 - level * 0.07)
}
