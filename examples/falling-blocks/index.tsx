import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, random } from "oj"
import "onejs:tailwind"
import styles from "./falling-blocks.module.uss"
import {
    beginGesture, advanceGesture, releaseGesture, isSoftDropping, spendDrop, type Gesture,
} from "./gestures"
import {
    emptyBoard, spawn, moved, rotated, fits, merge, clearLines, hardDropped,
    scoreFor, levelFor, dropInterval, cellsOf, shapeOf, KINDS,
    COLS, ROWS, type Board, type Piece, type PieceKind,
} from "./game"

const COLOURS = ["", styles.i, styles.o, styles.t, styles.s, styles.z, styles.j, styles.l]

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
        over: !fits(board, piece),
    }
}

function Cell({ tone }: { tone: string }) {
    return <View className={`${styles.cell} ${tone}`} />
}

function Preview({ kind }: { kind: PieceKind }) {
    const cells = shapeOf(kind)
    const xs = cells.map(([x]) => x)
    const ys = cells.map(([, y]) => y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const width = Math.max(...xs) - minX + 1
    const height = Math.max(...ys) - minY + 1
    const filled = new Set(cells.map(([x, y]) => `${x},${y}`))
    const tone = COLOURS[KINDS.indexOf(kind) + 1] ?? ""

    return (
        <View className="items-start justify-center h-20">
            {Array.from({ length: height }, (_, row) => (
                <View key={row} className="flex-row">
                    {Array.from({ length: width }, (_, col) => (
                        <View
                            key={col}
                            className={`${styles.previewCell} ${filled.has(`${minX + col},${minY + row}`) ? tone : ""}`}
                        />
                    ))}
                </View>
            ))}
        </View>
    )
}

function FallingBlocks() {
    const pick = useRef(bag(Math.floor(Date.now() / 86400000))).current
    const [game, setGame] = useState<Game>(() => start(pick))
    const timers = useRef({ drop: 0, left: 0, right: 0, down: 0 }).current
    const drag = useRef<{ id: number; g: Gesture } | null>(null)

    useFrame((dt) => {
        const touch = input.touchCount > 0 ? input.touches[0] : null
        const began = touch !== null && touch.phase === "began"
        const lifted = touch !== null && (touch.phase === "ended" || touch.phase === "canceled")

        if (game.over) {
            if (input.keyboard.wasKeyPressed("Enter") || began) setGame(start(pick))
            return
        }

        let piece = game.piece
        const board = game.board
        const shift = (dx: number, key: "left" | "right") => {
            const next = moved(piece, dx, 0)
            if (fits(board, next)) piece = next
            timers[key] = timers[key] === 0 ? REPEAT_DELAY : REPEAT_RATE
        }

        for (const [key, code, dx] of [["left", "LeftArrow", -1], ["right", "RightArrow", 1]] as const) {
            if (input.keyboard.isKeyDown(code)) {
                if (input.keyboard.wasKeyPressed(code)) { timers[key] = 0; shift(dx, key) }
                else if ((timers[key] -= dt) <= 0) shift(dx, key)
            } else timers[key] = 0
        }

        if (input.keyboard.wasKeyPressed("UpArrow")) piece = rotated(board, piece)

        let flicked = false
        if (began) {
            drag.current = { id: touch!.fingerId, g: beginGesture(touch!.position.x, touch!.position.y) }
        } else if (touch !== null && drag.current !== null && touch.fingerId === drag.current.id) {
            const columns = advanceGesture(drag.current.g, touch.position.x, touch.position.y, dt)
            for (let i = 0; i < Math.abs(columns); i++) {
                const next = moved(piece, Math.sign(columns), 0)
                if (!fits(board, next)) break
                piece = next
            }
            if (lifted) {
                const release = releaseGesture(drag.current.g)
                if (release === "rotate") piece = rotated(board, piece)
                else if (release === "drop") flicked = true
                drag.current = null
            }
        }

        let settled = false
        if (input.keyboard.wasKeyPressed("Space") || flicked) {
            piece = hardDropped(board, piece)
            settled = true
        }

        const soft = input.keyboard.isKeyDown("DownArrow")
            || (drag.current !== null && isSoftDropping(drag.current.g))
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
            if (drag.current !== null) spendDrop(drag.current.g)
            setGame(lock({ ...game, piece }, pick))
        } else if (piece !== game.piece) {
            setGame({ ...game, piece })
        }
    }, [game])

    const view = game.board.map((row) => row.slice())
    if (!game.over) {
        for (const [x, y] of cellsOf(game.piece)) {
            if (y >= 0 && y < ROWS && x >= 0 && x < COLS) view[y]![x] = KINDS.indexOf(game.piece.kind) + 1
        }
    }

    return (
        <View className="flex-1 flex-row items-center justify-center bg-neutral-900">
            <View className={styles.well}>
                {view.map((row, y) => (
                    <View key={y} className="flex-row">
                        {row.map((c, x) => <Cell key={x} tone={COLOURS[c] ?? ""} />)}
                    </View>
                ))}
            </View>

            {/* ml-6 and mb-* rather than gap classes: USS has no gap property, so
                gap-* compiles to nothing and everything sits flush. */}
            <View className="w-32 ml-6">
                <Text className="text-2xl font-bold text-white mb-3">FALLING BLOCKS</Text>
                <View className="mb-3">
                    <Text className="text-xs text-neutral-500">SCORE</Text>
                    <Text className="text-xl font-bold text-white">{String(game.score)}</Text>
                </View>
                <View className="mb-3">
                    <Text className="text-xs text-neutral-500">LINES</Text>
                    <Text className="text-xl font-bold text-white">{String(game.lines)}</Text>
                </View>
                <View className="mb-3">
                    <Text className="text-xs text-neutral-500">LEVEL</Text>
                    <Text className="text-xl font-bold text-white">{String(levelFor(game.lines))}</Text>
                </View>
                <View className="mb-3">
                    <Text className="text-xs text-neutral-500 mb-1">NEXT</Text>
                    <Preview kind={game.next} />
                </View>
                    <Text className="text-xs text-neutral-600">
                    {game.over
                        ? "GAME OVER\nEnter or tap\nto restart"
                        : "arrows move\nup rotates\nspace drops\n\ndrag to move\ntap to rotate\nflick down\nto drop"}
                </Text>
            </View>
        </View>
    )
}

mount(<FallingBlocks />)
