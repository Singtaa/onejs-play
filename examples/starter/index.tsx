// An OJPlay game: runs on play.onejs.com, built by the site when published.
// To work on it here: npx onejs-play init && npm install, then npx oj run.
// Docs: https://play.onejs.com/docs/unity.md#from-your-own-machine
import { useRef, useState } from "react"
import { View, Text, mount, useFrame, useStage, input, random, batchedVisualContent } from "oj"
import "onejs:tailwind"

// No stage in oj.json, so the stage is the window. useStage is how big it is
// right now, and it re-renders when that changes. Everything below is either a
// percentage, a flex rule, or a number derived from these two.
function Pop() {
    const stage = useStage()
    const [score, setScore] = useState(0)
    const board = useRef<any>(null)
    // Where the dot is, as a FRACTION of the stage rather than in pixels, so
    // resizing the window moves it with the layout instead of leaving it
    // somewhere off the edge.
    const dot = useRef({ u: 0.5, v: 0.5, r: 1 })

    // The radius is a share of the smaller side, which keeps the dot the same
    // size relative to the sketch on a phone and on a wide monitor.
    const short = Math.min(stage.width, stage.height)
    const radius = dot.current.r * short * 0.12
    const x = dot.current.u * stage.width
    const y = dot.current.v * stage.height

    const spawn = () => { dot.current = { u: random().range(0.15, 0.85), v: random().range(0.2, 0.85), r: 1 } }

    useFrame((dt) => {
        dot.current.r -= 0.42 * dt
        if (dot.current.r < 0.08) { spawn(); setScore(0) }
        board.current?.MarkDirtyRepaint()
    }, [])

    const tap = () => {
        // input.mouse.position is in stage units, which under a fluid stage is
        // the window in logical pixels, so it compares directly with x and y.
        const m = input.mouse.position
        if (Math.hypot(m.x - x, m.y - y) > radius) return
        setScore((n) => n + Math.round(60 - dot.current.r * 50))
        spawn()
    }

    return (
        <View ref={board} className="w-full h-full items-center bg-neutral-900"
            onPointerDown={tap} onGenerateVisualContent={batchedVisualContent((p) => p.fillColor("#ffd166")
                .beginPath().circle(x, y, radius).fill())}>
            <Text className="mt-6 text-4xl text-white tracking-wide">{score}</Text>
        </View>
    )
}
mount(<Pop />)
