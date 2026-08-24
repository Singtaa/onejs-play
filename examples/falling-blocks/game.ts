export const COLS = 10
export const ROWS = 20

// Empty is 0, so a filled cell holds its index in KINDS plus one.
export type Cell = number
export type Board = Cell[][]

export type PieceKind = "I" | "O" | "T" | "S" | "Z" | "J" | "L"
export const KINDS: readonly PieceKind[] = ["I", "O", "T", "S", "Z", "J", "L"]

// Per kind, a list of rotation states, each a list of [x, y] offsets from the piece origin.
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

export function shapeOf(kind: PieceKind, rotation = 0): ReadonlyArray<readonly [number, number]> {
    const states = SHAPES[kind]
    return states[rotation % states.length]!
}

export function cellsOf(piece: Piece): Array<readonly [number, number]> {
    const states = SHAPES[piece.kind]
    const shape = states[piece.rotation % states.length]!
    return shape.map(([dx, dy]) => [piece.x + dx, piece.y + dy] as const)
}

export function fits(board: Board, piece: Piece): boolean {
    for (const [x, y] of cellsOf(piece)) {
        if (x < 0 || x >= COLS || y >= ROWS) return false
        // Above the ceiling is allowed, because a piece spawns partly off-screen.
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

export function rotated(board: Board, piece: Piece): Piece {
    const states = SHAPES[piece.kind].length
    const turned = { ...piece, rotation: (piece.rotation + 1) % states }
    for (const dx of [0, -1, 1, -2, 2]) {
        const kicked = { ...turned, x: turned.x + dx }
        if (fits(board, kicked)) return kicked
    }
    return piece
}

export function hardDropped(board: Board, piece: Piece): Piece {
    let p = piece
    while (fits(board, moved(p, 0, 1))) p = moved(p, 0, 1)
    return p
}

export function merge(board: Board, piece: Piece): Board {
    const next = board.map((row) => row.slice())
    const colour = KINDS.indexOf(piece.kind) + 1
    for (const [x, y] of cellsOf(piece)) {
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) next[y]![x] = colour
    }
    return next
}

export function clearLines(board: Board): { board: Board; cleared: number } {
    const kept = board.filter((row) => row.some((c) => c === 0))
    const cleared = ROWS - kept.length
    if (cleared === 0) return { board, cleared: 0 }
    const empty = Array.from({ length: cleared }, () => new Array<Cell>(COLS).fill(0))
    return { board: [...empty, ...kept], cleared }
}

export function scoreFor(cleared: number, level: number): number {
    const table = [0, 100, 300, 500, 800]
    return (table[cleared] ?? 0) * (level + 1)
}

export function levelFor(lines: number): number {
    return Math.floor(lines / 10)
}

export function dropInterval(level: number): number {
    return Math.max(0.05, 0.8 - level * 0.07)
}
