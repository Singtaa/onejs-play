/**
 * One well: the board, the shapes, and what happens when a row fills.
 *
 * This is Falling Blocks' game.ts, copied rather than imported. Every example
 * on this site is built on its own, from the files sitting beside it, so an
 * import reaching into a sibling folder would not resolve at build time and
 * would not survive an eject either. Duplication across two shipped games is
 * the cheaper problem.
 *
 * Three things were changed on the way in, and all of them are because this
 * well is one of several rather than the only one:
 *
 *   gravity stops getting faster at level nine, because in a fight the ending
 *   that matters is somebody burying you, not the piece outrunning your hands;
 *
 *   a cell can now hold GARBAGE, which is a junk row an opponent sent, drawn in
 *   its own colour so a player can see how much of the mess is theirs;
 *
 *   pieces come out of a shuffled bag rather than being drawn at random, so
 *   that losing is something you did and not something the sequence did to you.
 *
 * Everything here is pure, with no screen and no network in it. That is what
 * lets the fiddly parts (rotating against a wall, scoring a four line clear,
 * whether a stack has reached the ceiling) be checked in blocks.test.ts instead
 * of by playing until they look right.
 */

export const COLS = 10
export const ROWS = 20

/** Empty is 0; a filled cell holds its piece index plus one, for colouring. */
export type Cell = number
export type Board = Cell[][]

/**
 * A junk cell, one past the seven piece colours.
 *
 * Junk is worth telling apart on sight: a well that is half somebody else's
 * garbage is a different situation from a well you filled yourself, and the
 * player should not have to remember which rows came from where.
 */
export const GARBAGE: Cell = 8

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

/**
 * The piece sequence: all seven, shuffled, then all seven again.
 *
 * Drawing each piece at random is simpler and is what the solo game does, but
 * it also means a player can go twenty pieces without the one they are waiting
 * for, and in a game against other people that reads as the game having decided
 * the outcome. A shuffled bag keeps the order unpredictable while promising
 * that everything arrives, so a well that fills up is a well the player filled.
 *
 * Takes its randomness as an argument rather than reaching for one, which is
 * what lets a test hand it a repeatable source.
 */
export function sevenBag(next: () => number): () => PieceKind {
    let bag: PieceKind[] = []
    return () => {
        if (bag.length === 0) {
            bag = [...KINDS]
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1))
                const swap = bag[i]!
                bag[i] = bag[j]!
                bag[j] = swap
            }
        }
        return bag.pop()!
    }
}

/**
 * The offsets a kind occupies, unpositioned.
 *
 * cellsOf needs a placed Piece, which a preview does not have: the next piece
 * has no position yet, and giving it a fake one only to subtract it again is
 * the long way round.
 */
export function shapeOf(kind: PieceKind, rotation = 0): ReadonlyArray<readonly [number, number]> {
    const states = SHAPES[kind]
    return states[rotation % states.length]!
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

/**
 * Seconds between gravity steps, falling off as the level climbs.
 *
 * The floor is much higher than a solo game would set it. Falling Blocks bottoms
 * out at a twentieth of a second, which is a test of reflexes and a fine way for
 * a solo run to end. Here the interesting death is the one an opponent caused,
 * so gravity stops accelerating while the game is still comfortably playable and
 * the pressure after that comes from other people.
 */
export function dropInterval(level: number): number {
    return Math.max(0.15, 0.8 - level * 0.07)
}
