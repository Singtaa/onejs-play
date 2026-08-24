import { useEffect, useRef, useState } from "react"
import { View, Text, mount, useFrame, input, random } from "oj"
import "onejs:tailwind"
import styles from "./twos-company.module.uss"
import { newGame, move, spawn, stuck, highest, SIZE, type Direction, type Game } from "./game"
import { newSwipe, begin, moveTo, end } from "./swipe"

const CELL = 100
const GAP = 12
const BOARD = GAP + SIZE * CELL + (SIZE - 1) * GAP + GAP
const BOARD_X = 30
const BOARD_Y = 196

// Tiles are placed at an absolute left and top so a USS transition can slide them.
const at = (index: number) => GAP + index * (CELL + GAP)

function toneOf(value: number): string {
    const named: Record<number, string> = {
        2: styles.v2, 4: styles.v4, 8: styles.v8, 16: styles.v16,
        32: styles.v32, 64: styles.v64, 128: styles.v128, 256: styles.v256,
        512: styles.v512, 1024: styles.v1024, 2048: styles.v2048,
    }
    return named[value] ?? styles.vHuge
}

// The colour ramp is bright from 256 to 1024, so those need dark text.
const inkOf = (value: number) => (value >= 256 && value < 2048 ? styles.dark : styles.light)

function sizeOf(value: number): number {
    if (value < 100) return 44
    if (value < 1000) return 38
    if (value < 10000) return 30
    return 24
}

const BEST_KEY = "twos-company.best"

function readBest(): number {
    try {
        const stored = Number(localStorage.getItem(BEST_KEY))
        return Number.isFinite(stored) && stored > 0 ? stored : 0
    } catch {
        return 0
    }
}

function writeBest(score: number): void {
    try {
        localStorage.setItem(BEST_KEY, String(score))
    } catch {
        // A refused write costs a remembered number, not the game.
    }
}

function Score({ label, value }: { label: string; value: number }) {
    return (
        <View className="items-center px-5 py-2 rounded-lg" style={{ backgroundColor: "rgb(30, 34, 42)" }}>
            <Text className="text-xs tracking-wide" style={{ color: "rgb(122, 134, 156)" }}>{label}</Text>
            <Text className="text-2xl font-bold" style={{ color: "rgb(226, 234, 247)" }}>{String(value)}</Text>
        </View>
    )
}

function TwosCompany() {
    const rng = useRef(random()).current
    const [game, setGame] = useState<Game>(() => newGame(rng))
    const [best, setBest] = useState(readBest)
    const [dismissed, setDismissed] = useState(false)
    const swipe = useRef(newSwipe()).current
    /** The finger currently driving the board, so a second one cannot fight it. */
    const finger = useRef<number | null>(null)

    const push = (direction: Direction) => {
        setDismissed(true)
        setGame((current) => {
            if (current.over) return current
            const result = move(current, direction)
            if (!result.moved) return current

            spawn(result.game, rng)
            result.game.over = stuck(result.game)
            return result.game
        })
    }

    const restart = () => {
        setDismissed(false)
        setGame(newGame(rng))
    }

    // Tiles pop and fade by wearing a class for a moment, so something has to take it off again.
    useEffect(() => {
        if (!game.tiles.some((t) => t.merged || t.fresh)) return
        const timer = setTimeout(() => setGame((current) => ({
            ...current,
            tiles: current.tiles.map((t) => (t.merged || t.fresh ? { ...t, merged: false, fresh: false } : t)),
        })), 30)
        return () => clearTimeout(timer)
    }, [game])

    useEffect(() => {
        if (game.score <= best) return
        setBest(game.score)
        writeBest(game.score)
    }, [game.score, best])

    useFrame(() => {
        const keys = input.keyboard
        if (keys.wasKeyPressed("LeftArrow") || keys.wasKeyPressed("A")) push("left")
        if (keys.wasKeyPressed("RightArrow") || keys.wasKeyPressed("D")) push("right")
        if (keys.wasKeyPressed("UpArrow") || keys.wasKeyPressed("W")) push("up")
        if (keys.wasKeyPressed("DownArrow") || keys.wasKeyPressed("S")) push("down")
        if (keys.wasKeyPressed("R")) restart()

        for (const touch of input.touches) {
            if (finger.current === null && touch.phase === "began") {
                finger.current = touch.fingerId
                begin(swipe, touch.position.x, touch.position.y)
            }
            if (touch.fingerId !== finger.current) continue

            if (touch.phase === "moved" || touch.phase === "stationary") {
                const direction = moveTo(swipe, touch.position.x, touch.position.y)
                if (direction !== null) push(direction)
            }
            if (touch.phase === "ended" || touch.phase === "canceled") {
                end(swipe)
                finger.current = null
            }
        }
    }, [])

    const celebrating = game.won && !dismissed

    return (
        <View style={{ width: 520, height: 700, backgroundColor: "rgb(20, 24, 29)" }}>
            <View className="flex-row items-end justify-between"
                style={{ marginTop: 34, marginLeft: 30, marginRight: 30 }}>
                <View>
                    <Text className="text-3xl font-bold" style={{ color: "rgb(226, 234, 247)" }}>TWOS COMPANY</Text>
                    <Text className="text-xs mt-1" style={{ color: "rgb(122, 134, 156)" }}>
                        Arrows or swipe. R starts over.
                    </Text>
                </View>
                <View className="flex-row" style={{ marginBottom: 2 }}>
                    <Score label="SCORE" value={game.score} />
                    <View style={{ width: 10 }} />
                    <Score label="BEST" value={Math.max(best, game.score)} />
                </View>
            </View>

            <View className={styles.board}
                style={{ position: "absolute", left: BOARD_X, top: BOARD_Y, width: BOARD, height: BOARD }}>
                {Array.from({ length: SIZE * SIZE }, (_, i) => (
                    <View key={`cell-${i}`} className={styles.cell}
                        style={{ left: at(i % SIZE), top: at(Math.floor(i / SIZE)) }} />
                ))}

                {game.tiles.map((tile) => (
                    <View
                        key={tile.id}
                        className={[
                            styles.tile,
                            toneOf(tile.value),
                            tile.merged ? styles.popped : "",
                            tile.fresh ? styles.fresh : "",
                        ].join(" ")}
                        style={{ left: at(tile.col), top: at(tile.row) }}>
                        <Text className={`${styles.label} ${inkOf(tile.value)}`}
                            style={{ fontSize: sizeOf(tile.value) }}>
                            {String(tile.value)}
                        </Text>
                    </View>
                ))}

                {(game.over || celebrating) && (
                    <View className={styles.veil}>
                        <Text className="text-4xl font-bold" style={{ color: "rgb(226, 234, 247)" }}>
                            {game.over ? "No moves left" : "2048"}
                        </Text>
                        <Text className="text-sm mt-2" style={{ color: "rgb(150, 162, 184)" }}>
                            {game.over ? `You reached ${highest(game)}` : "Keep going for more"}
                        </Text>
                        <Text className="text-xs mt-6" style={{ color: "rgb(122, 134, 156)" }}>
                            {game.over ? "Press R to play again" : "Press any arrow to continue"}
                        </Text>
                    </View>
                )}
            </View>
        </View>
    )
}

mount(<TwosCompany />)
