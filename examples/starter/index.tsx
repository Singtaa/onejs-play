import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, Mathf } from "oj"

const STAGE = 600
const PADDLE_W = 110
const PADDLE_H = 14
const PADDLE_Y = STAGE - 48
const BALL = 18
const KEY_SPEED = 520
const SPEEDUP = 1.04

const start = () => ({ x: STAGE / 2, y: STAGE / 3, vx: 170, vy: 240 })

function Rally() {
    const [score, setScore] = useState(0)
    const [best, setBest] = useState(0)
    const rally = useRef(0)
    const ball = useRef(start())
    const paddleX = useRef((STAGE - PADDLE_W) / 2)
    const lastPointerX = useRef<number | null>(null)
    const ballEl = useRef<any>(null)
    const paddleEl = useRef<any>(null)

    useFrame((dt) => {
        const keys = input.keyboard.arrows()
        const pointerX = input.mouse.position.x
        const pointerMoved = lastPointerX.current !== null && pointerX !== lastPointerX.current
        lastPointerX.current = pointerX

        if (keys.x !== 0) paddleX.current += keys.x * KEY_SPEED * dt
        else if (pointerMoved) paddleX.current = pointerX - PADDLE_W / 2
        paddleX.current = Mathf.Clamp(paddleX.current, 0, STAGE - PADDLE_W)

        const b = ball.current
        b.x += b.vx * dt
        b.y += b.vy * dt

        if (b.x < 0) b.vx = Math.abs(b.vx)
        if (b.x > STAGE - BALL) b.vx = -Math.abs(b.vx)
        if (b.y < 0) b.vy = Math.abs(b.vy)

        const onPaddle = b.vy > 0
            && b.y + BALL >= PADDLE_Y && b.y + BALL <= PADDLE_Y + PADDLE_H
            && b.x + BALL > paddleX.current && b.x < paddleX.current + PADDLE_W

        if (onPaddle) {
            const offset = (b.x + BALL / 2 - paddleX.current) / PADDLE_W - 0.5
            b.vx = Mathf.Clamp(b.vx + offset * 420, -560, 560)
            b.vy = -b.vy * SPEEDUP
            rally.current += 1
            setScore(rally.current)
        }

        if (b.y > STAGE) {
            setBest((high) => Math.max(high, rally.current))
            rally.current = 0
            setScore(0)
            ball.current = start()
        }

        if (ballEl.current) {
            ballEl.current.style.left = b.x
            ballEl.current.style.top = b.y
        }
        if (paddleEl.current) paddleEl.current.style.left = paddleX.current
    }, [])

    return (
        <View style={{ width: STAGE, height: STAGE, backgroundColor: "#12151b" }}>
            <Text style={{ position: "absolute", left: 20, top: 16, fontSize: 34, color: "#f2f5fb" }}>
                {score}
            </Text>
            <Text style={{ position: "absolute", left: 20, top: 58, fontSize: 13, color: "#6d7789" }}>
                {best > 0 ? `best ${best}` : "move with the pointer or arrow keys"}
            </Text>

            <View ref={ballEl} style={{
                position: "absolute", left: ball.current.x, top: ball.current.y,
                width: BALL, height: BALL, borderRadius: BALL / 2, backgroundColor: "#ffd166",
            }} />

            <View ref={paddleEl} style={{
                position: "absolute", left: paddleX.current, top: PADDLE_Y,
                width: PADDLE_W, height: PADDLE_H, borderRadius: PADDLE_H / 2,
                backgroundColor: "#5ac8fa",
            }} />
        </View>
    )
}

mount(<Rally />)
