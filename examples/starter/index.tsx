// An OJPlay cart: runs on play.onejs.com, built by the site on every push.
// To work on it here: npx ojplay init && npm install, then npx ojplay run.
// For AI agents: https://play.onejs.com/agents.md
import { useRef, useState } from "react"
import { View, Text, mount, useFrame, useStage, useDrawing, input, random } from "oj"
import "onejs:tailwind"

// The stage is the window.
// useStage() is how big it is right now, and the cart re-renders when that changes.
// Everything below is a percentage, a flex rule, or a number derived from these two.
function Pop() {
    const stage = useStage()
    const [score, setScore] = useState(0)
    const board = useRef(null)
    // Where the dot is, as a FRACTION of the stage rather than in pixels, so resizing the window moves it with the layout instead of leaving it somewhere off the edge.
    const dot = useRef({ u: 0.5, v: 0.5, r: 1 })

    // The dot in pixels. Its radius is a share of the smaller side, which keeps it the same size relative to the cart on a phone and on a wide monitor.
    const place = () => ({
        x: dot.current.u * stage.width,
        y: dot.current.v * stage.height,
        radius: dot.current.r * Math.min(stage.width, stage.height) * 0.12,
    })

    const spawn = () => { dot.current = { u: random.range(0.15, 0.85), v: random.range(0.2, 0.85), r: 1 } }

    // The dot shrinks every frame without a re-render, so it lives in a ref and is drawn every frame from there.
    useFrame((dt) => {
        dot.current.r -= 0.42 * dt
        if (dot.current.r < 0.08) { spawn(); setScore(0) }
    })
    useDrawing(board, (p) => {
        const { x, y, radius } = place()
        p.fillColor("#ffd166").beginPath().circle(x, y, radius).fill()
    }, "frame")

    const tap = () => {
        // input.mouse.position is in the same units as useStage(): the window, in logical pixels, so it compares directly with the dot.
        const m = input.mouse.position
        const { x, y, radius } = place()
        if (Math.hypot(m.x - x, m.y - y) > radius) return
        setScore((n) => n + Math.round(60 - dot.current.r * 50))
        spawn()
    }

    return (
        <View ref={board} className="w-full h-full items-center bg-neutral-900" onPointerDown={tap}>
            <Text className="mt-6 text-4xl text-white tracking-wide">{score}</Text>
        </View>
    )
}
mount(<Pop />)
