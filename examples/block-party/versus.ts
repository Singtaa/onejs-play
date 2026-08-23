/**
 * What turns a well into a fight: garbage, cancelling, targets, and the wire.
 *
 * WHO IS ALLOWED TO DECIDE WHAT
 *
 * The site passes messages between players and knows nothing about what they
 * mean. There is no server running any of this, so the rules have to be written
 * for a world where every client is the authority on itself and on nothing
 * else. In a game where players attack each other, that line needs saying
 * carefully, because at a glance it looks like it has been crossed.
 *
 * It has not. An attack is not a kill. What arrives is "here are four junk
 * rows", and junk rows are just cells: they make your well harder, they never
 * end your game. Whether the stack has reached the ceiling is a question about
 * your own board, asked and answered on your own machine, exactly as it would
 * be in a solo game. Nobody can send you a message that tops you out, because
 * topping out is not something a message can say.
 *
 * The worst a liar can do is send more garbage than they earned, and even that
 * is bounded here: incoming rows are clamped per message and queue up rather
 * than landing all at once, so a client spamming attacks is a nuisance in one
 * player's well rather than an instant kill in everybody's. That is the same
 * shape of answer as Big Fish's, where a liar can refuse to die: annoying to
 * play against, harmless to the rules.
 *
 * WHY THERE IS A TARGET AT ALL
 *
 * A room holds up to twenty four people. Sending every clear to all of them
 * would mean one good move buries the entire room, and splitting it between
 * them would mean nobody ever feels anything. So an attack goes to one person,
 * and the person is whoever is winning. Everybody can work that out from the
 * scores that are already on the wire, with nothing extra sent and nobody
 * elected, and it makes a crowded room self correcting: the lead is worth
 * having and expensive to hold.
 *
 * The board codec lives here too. It is a pure string function with no socket
 * anywhere near it, and a round trip is exactly the kind of thing that is worth
 * a test and painful to check by eye.
 */

import { COLS, ROWS, GARBAGE, emptyBoard, type Board, type Cell } from "./blocks"

/**
 * Rows sent for clearing one, two, three or four at once.
 *
 * A single clear sends nothing. That is the rule the whole economy turns on:
 * clearing one row at a time keeps your own well tidy and does no damage, so
 * the only way to hurt anybody is to let rows pile up and take several at once,
 * which is also the way to lose. Wanting to attack and wanting to be safe pull
 * in opposite directions, and a game where they did not would be solitaire with
 * an audience.
 */
const SENT_FOR = [0, 0, 1, 2, 4]

/** The most a run of clears can add on top of the table. */
export const MAX_COMBO_BONUS = 4

/** More than this waiting and the rest is dropped: see the header on liars. */
export const MAX_PENDING = 20

/** Rows that actually land each time you lock a piece. */
export const GARBAGE_PER_LOCK = 4

/**
 * How many rows a clear is worth, given how long the run has been going.
 *
 * `combo` is the number of clearing locks immediately before this one, so the
 * first clear of a run passes zero. A lock that clears nothing is worth nothing
 * however good the run was, which is what ends the run.
 */
export function attackFor(cleared: number, combo: number): number {
    if (cleared <= 0) return 0
    const base = SENT_FOR[Math.min(cleared, SENT_FOR.length - 1)] ?? 0
    const bonus = Math.min(MAX_COMBO_BONUS, Math.floor(Math.max(0, combo) / 2))
    return base + bonus
}

/**
 * Spends an attack on the garbage already waiting, before any of it is sent.
 *
 * This is the part that makes the game a conversation rather than two people
 * taking turns being buried. Somebody sends you four rows; you clear two before
 * they land, and two of theirs disappear instead of two of yours arriving. What
 * is left over travels on to your own target.
 */
export function offset(pending: number, attack: number): { pending: number; sent: number } {
    const cancelled = Math.min(Math.max(0, pending), Math.max(0, attack))
    return { pending: Math.max(0, pending) - cancelled, sent: Math.max(0, attack) - cancelled }
}

/**
 * How much of the queue lands on this lock.
 *
 * Garbage waits for a piece to settle rather than appearing under the one that
 * is falling, which is both what every game of this kind does and the only
 * version that is fair: rows shoved in mid drop would move the stack out from
 * under a piece the player had already aimed.
 */
export function takeGarbage(pending: number): { taken: number; left: number } {
    const safe = Math.max(0, pending)
    const taken = Math.min(safe, GARBAGE_PER_LOCK)
    return { taken, left: safe - taken }
}

/** Adds to the queue, keeping a flood from becoming an unpayable debt. */
export function queue(pending: number, rows: number): number {
    return Math.min(MAX_PENDING, Math.max(0, pending) + Math.max(0, Math.floor(rows || 0)))
}

/**
 * Where the hole in the next batch of junk goes.
 *
 * Never the same column twice running. If it were, two batches would line up
 * into a clean shaft and a player would be handed a free four row clear for
 * having done nothing, which is a strange reward for being attacked twice.
 *
 * Pass a previous of -1 for the first batch of a life, when there is no column
 * to avoid and every one of them is fair.
 */
export function nextHole(previous: number, roll: number): number {
    const r = Math.max(0, Math.min(0.999999, roll))
    if (previous < 0 || previous >= COLS) return Math.floor(r * COLS)
    const choice = Math.floor(r * (COLS - 1))
    return choice >= previous ? choice + 1 : choice
}

/**
 * Whether that much junk would push the stack out through the ceiling.
 *
 * Asked before the rows are added, because the addition itself cannot report
 * it: junk arrives at the bottom and everything above shuffles up, so the cells
 * that no longer fit are simply gone by the time the new board exists. This
 * looks at the rows about to be pushed out and says whether anything was in
 * them.
 */
export function buries(board: Board, rows: number): boolean {
    const n = Math.min(ROWS, Math.max(0, Math.floor(rows)))
    for (let y = 0; y < n; y++) {
        if (board[y]!.some((cell) => cell !== 0)) return true
    }
    return false
}

/** Shoves junk rows in at the bottom, each with one hole in the same column. */
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

/**
 * Who to send to: whoever is winning, and if that is you, whoever is second.
 *
 * Ties go to the lowest id so that everybody in the room independently reaches
 * the same answer about the same pair of players, which is what lets a target
 * be an agreed fact rather than a negotiation. Returns 0 when there is nobody
 * to hit, and 0 is never a real peer id: the site hands those out from one.
 */
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

/**
 * A well as a string, one character a cell, read left to right and top down.
 *
 * Two hundred characters, which is small enough that compressing it would buy
 * less than the code would cost. What keeps this off the wire is not the
 * encoding but the rate: a well only goes out when it has actually changed,
 * which is when a piece locks, roughly once a second per player, rather than
 * on every frame.
 */
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

/**
 * Reads one back.
 *
 * Anything that is not exactly a well comes back empty rather than throwing.
 * This is fed straight from a message, so its input is whatever another player
 * chose to send, and a game that crashed on a malformed one would hand every
 * player in the room a way to end everybody else's session.
 */
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

/** How high the stack is, which is how a mini board says "this one is in trouble". */
export function stackHeight(board: Board): number {
    for (let y = 0; y < ROWS; y++) {
        if (board[y]!.some((cell) => cell !== 0)) return ROWS - y
    }
    return 0
}
