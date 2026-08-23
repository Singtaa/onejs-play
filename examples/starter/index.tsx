/**
 * Catch: move the white square, touch the yellow one, score.
 *
 * This is the starting point for a new game, and it is meant to be read and
 * then taken apart. Everything a game needs is here and nothing else is.
 *
 * The screen is React. View and Text are the building blocks, roughly a div
 * and a span, and Unity draws them rather than a browser. They come from "oj",
 * the small runtime this game runs on, along with the keyboard and a few
 * helpers.
 *
 * The one thing that works differently from the web: useFrame runs once per
 * frame and is handed the seconds since the last one. Movement is multiplied
 * by that number, so the square travels at the same speed whether the display
 * runs at 60 frames a second or 144.
 */

import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, random } from "oj"

const STAGE = 600          // the square play area, in points
const PLAYER = 44
const TARGET = 30
const SPEED = 260          // points per second

/** Somewhere inside the stage that the given square fits entirely within. */
function somewhere(size: number) {
    return {
        x: random().range(0, STAGE - size),
        y: random().range(0, STAGE - size),
    }
}

function Catch() {
    const [score, setScore] = useState(0)
    const [target, setTarget] = useState(() => somewhere(TARGET))

    // The player's position lives in a ref rather than in state. It changes
    // every frame, and putting it in state would re-render the whole game
    // sixty times a second to move one square.
    const player = useRef({ x: (STAGE - PLAYER) / 2, y: (STAGE - PLAYER) / 2 })
    const box = useRef<any>(null)

    useFrame((dt) => {
        // Held arrow keys, as a direction: x and y are each -1, 0 or 1.
        const dir = input.keyboard.arrows()
        const p = player.current
        p.x += dir.x * SPEED * dt
        // Screen coordinates count downward, so "up" has to subtract.
        p.y -= dir.y * SPEED * dt

        // Keep the square on the stage.
        p.x = Math.max(0, Math.min(STAGE - PLAYER, p.x))
        p.y = Math.max(0, Math.min(STAGE - PLAYER, p.y))

        // Moved directly, not through React, for the same reason as above.
        if (box.current) {
            box.current.style.left = p.x
            box.current.style.top = p.y
        }

        // Two squares overlap when they overlap on both axes.
        const hit = p.x < target.x + TARGET && p.x + PLAYER > target.x
            && p.y < target.y + TARGET && p.y + PLAYER > target.y
        if (hit) {
            setScore((n) => n + 1)
            setTarget(somewhere(TARGET))
        }
    }, [target])

    return (
        <View style={{ width: STAGE, height: STAGE, backgroundColor: "#14181d" }}>
            <Text style={{ position: "absolute", left: 16, top: 12, fontSize: 20, color: "#e8edf7" }}>
                {`Score ${score}`}
            </Text>
            <Text style={{ position: "absolute", left: 16, top: 40, fontSize: 12, color: "#7b869c" }}>
                Arrow keys to move
            </Text>

            <View style={{
                position: "absolute", left: target.x, top: target.y,
                width: TARGET, height: TARGET, backgroundColor: "#ffd166", borderRadius: 6,
            }} />

            <View ref={box} style={{
                position: "absolute", left: player.current.x, top: player.current.y,
                width: PLAYER, height: PLAYER, backgroundColor: "#e8edf7", borderRadius: 8,
            }} />
        </View>
    )
}

mount(<Catch />)
