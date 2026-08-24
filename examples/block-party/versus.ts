import { COLS, ROWS, GARBAGE, emptyBoard, type Board, type Cell } from "./blocks"

const SENT_FOR = [0, 0, 1, 2, 4]
export const MAX_COMBO_BONUS = 4
export const MAX_PENDING = 20
export const GARBAGE_PER_LOCK = 4

export function attackFor(cleared: number, combo: number): number {
    if (cleared <= 0) return 0
    const base = SENT_FOR[Math.min(cleared, SENT_FOR.length - 1)] ?? 0
    const bonus = Math.min(MAX_COMBO_BONUS, Math.floor(Math.max(0, combo) / 2))
    return base + bonus
}

export function offset(pending: number, attack: number): { pending: number; sent: number } {
    const cancelled = Math.min(Math.max(0, pending), Math.max(0, attack))
    return { pending: Math.max(0, pending) - cancelled, sent: Math.max(0, attack) - cancelled }
}

export function takeGarbage(pending: number): { taken: number; left: number } {
    const safe = Math.max(0, pending)
    const taken = Math.min(safe, GARBAGE_PER_LOCK)
    return { taken, left: safe - taken }
}

export function queue(pending: number, rows: number): number {
    return Math.min(MAX_PENDING, Math.max(0, pending) + Math.max(0, Math.floor(rows || 0)))
}

export function nextHole(previous: number, roll: number): number {
    const r = Math.max(0, Math.min(0.999999, roll))
    if (previous < 0 || previous >= COLS) return Math.floor(r * COLS)
    const choice = Math.floor(r * (COLS - 1))
    return choice >= previous ? choice + 1 : choice
}

export function buries(board: Board, rows: number): boolean {
    const n = Math.min(ROWS, Math.max(0, Math.floor(rows)))
    for (let y = 0; y < n; y++) {
        if (board[y]!.some((cell) => cell !== 0)) return true
    }
    return false
}

export function addGarbage(board: Board, rows: number, hole: number): Board {
    const n = Math.min(ROWS, Math.max(0, Math.floor(rows)))
    if (n === 0) return board
    const gap = Math.min(COLS - 1, Math.max(0, Math.floor(hole)))
    const kept = board.slice(n).map((row) => row.slice())
    const junk = Array.from({ length: n }, () =>
        Array.from({ length: COLS }, (_, x) => (x === gap ? 0 : GARBAGE) as Cell))
    return [...kept, ...junk]
}

export interface Rival {
    id: number
    score: number
}

export function chooseTarget(myId: number, rivals: readonly Rival[]): number {
    let best: Rival | null = null
    for (const rival of rivals) {
        if (rival.id === myId) continue
        if (best === null || rival.score > best.score || (rival.score === best.score && rival.id < best.id)) {
            best = rival
        }
    }
    return best === null ? 0 : best.id
}

export function encodeWell(board: Board): string {
    let out = ""
    for (let y = 0; y < ROWS; y++) {
        const row = board[y]!
        for (let x = 0; x < COLS; x++) {
            const cell = row[x]!
            out += cell >= 0 && cell <= 9 ? String(cell) : "0"
        }
    }
    return out
}

export function decodeWell(text: unknown): Board {
    if (typeof text !== "string" || text.length !== ROWS * COLS) return emptyBoard()
    const board = emptyBoard()
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const code = text.charCodeAt(y * COLS + x) - 48
            board[y]![x] = code >= 0 && code <= 9 ? code : 0
        }
    }
    return board
}

export function stackHeight(board: Board): number {
    for (let y = 0; y < ROWS; y++) {
        if (board[y]!.some((cell) => cell !== 0)) return ROWS - y
    }
    return 0
}
