import { useRef, useState } from "react"
import { View, Text, mount, useFrame, useStage, batchedVisualContent } from "oj"

/**
 * A ball, bouncing. Click it to send it somewhere else.
 *
 * The game is not the point of this example. Open cover.tsx: that file is the
 * lesson, and this is here so it has something to be a card for.
 */

/** Positions are fractions of the stage, so the game fits any window. */
const R = 0.045
const START = { x: 0.3, y: 0.35, dx: 0.31, dy: 0.23 }

function Bounce() {
    const stage = useStage()
    const ball = useRef({ ...START })
    const [taps, setTaps] = useState(0)
    const view = useRef<any>(null)

    useFrame((dt) => {
        const b = ball.current
        b.x += b.dx * dt
        b.y += b.dy * dt
        if (b.x < R || b.x > 1 - R) b.dx = -b.dx
        if (b.y < R || b.y > 1 - R) b.dy = -b.dy
        view.current?.MarkDirtyRepaint()
    }, [])

    const nudge = () => {
        const b = ball.current
        const angle = Math.random() * Math.PI * 2
        const speed = Math.hypot(b.dx, b.dy)
        b.dx = Math.cos(angle) * speed
        b.dy = Math.sin(angle) * speed
        setTaps((n) => n + 1)
    }

    const size = Math.min(stage.width, stage.height)
    return (
        <View ref={view} onPointerDown={nudge}
            style={{ width: "100%", height: "100%", backgroundColor: "#0b0b12", alignItems: "center" }}
            onGenerateVisualContent={batchedVisualContent((p) => {
                p.fillColor(1, 0.72, 0.28, 1)
                p.beginPath()
                p.arc(ball.current.x * stage.width, ball.current.y * stage.height,
                      R * size, 0, Math.PI * 2)
                p.fill()
            })}>
            <Text style={{ color: "#5a5a68", fontSize: 13, marginTop: 16 }}>
                {taps === 0 ? "click the ball" : `${taps} nudges`}
            </Text>
        </View>
    )
}

mount(<Bounce />)
