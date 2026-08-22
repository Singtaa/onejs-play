/**
 * Tetris, written against oj.
 *
 * Where Wordle only reacts to keystrokes, this runs on a clock: gravity,
 * soft-drop repeat and lock timing all come off useFrame's delta rather than
 * off a timer, so the game keeps its pace whatever the frame rate does.
 */

import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, random } from "oj"
import "onejs:tailwind"
import styles from "./tetris.module.uss"
import {
    emptyBoard, spawn, moved, rotated, fits, merge, clearLines, hardDropped,
    scoreFor, levelFor, dropInterval, cellsOf, KINDS,
    COLS, ROWS, type Board, type Piece, type PieceKind,
} from "./game"

const COLOURS = ["", styles.i, styles.o, styles.t, styles.s, styles.z, styles.j, styles.l]

/** How long a held direction waits before repeating, and how fast after. */
const REPEAT_DELAY = 0.16
const REPEAT_RATE = 0.05

interface Game {
    board: Board
    piece: Piece
    next: PieceKind
    score: number
    lines: number
    over: boolean
}

function bag(seed: number) {
    const rng = random(seed)
    return () => rng.pick(KINDS)
}

function start(pick: () => PieceKind): Game {
    return { board: emptyBoard(), piece: spawn(pick()), next: pick(), score: 0, lines: 0, over: false }
}

/** Settles the piece, clears what it completed, and brings in the next one. */
function lock(game: Game, pick: () => PieceKind): Game {
    const merged = merge(game.board, game.piece)
    const { board, cleared } = clearLines(merged)
    const lines = game.lines + cleared
    const piece = spawn(game.next)
    return {
        board,
        piece,
        next: pick(),
        score: game.score + scoreFor(cleared, levelFor(game.lines)),
        lines,
        // Nowhere to put the new piece means the stack reached the top.
        over: !fits(board, piece),
    }
}

function Cell({ tone }: { tone: string }) {
    return <View className={`${styles.cell} ${tone}`} />
}

function Tetris() {
    const pick = useRef(bag(Math.floor(Date.now() / 86400000))).current
    const [game, setGame] = useState<Game>(() => start(pick))
    const timers = useRef({ drop: 0, left: 0, right: 0, down: 0 }).current

    useFrame((dt) => {
        if (game.over) {
            if (input.keyboard.wasKeyPressed("Enter")) setGame(start(pick))
            return
        }

        let piece = game.piece
        const board = game.board
        const shift = (dx: number, key: "left" | "right") => {
            const next = moved(piece, dx, 0)
            if (fits(board, next)) piece = next
            timers[key] = timers[key] === 0 ? REPEAT_DELAY : REPEAT_RATE
        }

        // Held directions repeat on a delay then a faster rate, which is what
        // makes a stack placeable rather than a test of tapping speed.
        for (const [key, code, dx] of [["left", "LeftArrow", -1], ["right", "RightArrow", 1]] as const) {
            if (input.keyboard.isKeyDown(code)) {
                if (input.keyboard.wasKeyPressed(code)) { timers[key] = 0; shift(dx, key) }
                else if ((timers[key] -= dt) <= 0) shift(dx, key)
            } else timers[key] = 0
        }

        if (input.keyboard.wasKeyPressed("UpArrow")) piece = rotated(board, piece)

        let settled = false
        if (input.keyboard.wasKeyPressed("Space")) {
            piece = hardDropped(board, piece)
            settled = true
        }

        const soft = input.keyboard.isKeyDown("DownArrow")
        timers.drop += dt
        const interval = soft ? 0.03 : dropInterval(levelFor(game.lines))
        if (!settled && timers.drop >= interval) {
            timers.drop = 0
            const down = moved(piece, 0, 1)
            if (fits(board, down)) piece = down
            else settled = true
        }

        if (settled) {
            timers.drop = 0
            setGame(lock({ ...game, piece }, pick))
        } else if (piece !== game.piece) {
            setGame({ ...game, piece })
        }
    }, [game])

    // The falling piece is drawn over a copy so the board itself stays settled.
    const view = game.board.map((row) => row.slice())
    if (!game.over) {
        for (const [x, y] of cellsOf(game.piece)) {
            if (y >= 0 && y < ROWS && x >= 0 && x < COLS) view[y]![x] = KINDS.indexOf(game.piece.kind) + 1
        }
    }

    return (
        <View className="flex-1 flex-row items-center justify-center bg-neutral-900 gap-6">
            <View className={styles.well}>
                {view.map((row, y) => (
                    <View key={y} className="flex-row">
                        {row.map((c, x) => <Cell key={x} tone={COLOURS[c] ?? ""} />)}
                    </View>
                ))}
            </View>

            <View className="gap-3 w-32">
                <Text className="text-2xl font-bold text-white">TETRIS</Text>
                <View>
                    <Text className="text-xs text-neutral-500">SCORE</Text>
                    <Text className="text-xl font-bold text-white">{String(game.score)}</Text>
                </View>
                <View>
                    <Text className="text-xs text-neutral-500">LINES</Text>
                    <Text className="text-xl font-bold text-white">{String(game.lines)}</Text>
                </View>
                <View>
                    <Text className="text-xs text-neutral-500">LEVEL</Text>
                    <Text className="text-xl font-bold text-white">{String(levelFor(game.lines))}</Text>
                </View>
                <Text className="text-xs text-neutral-600">
                    {game.over ? "GAME OVER\nEnter to restart" : "arrows move\nup rotates\nspace drops"}
                </Text>
            </View>
        </View>
    )
}

mount(<Tetris />)
