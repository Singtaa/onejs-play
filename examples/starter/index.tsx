import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, random, batchedVisualContent } from "oj"
import "onejs:tailwind"

const STAGE = 600
const spawn = () => ({ x: random().range(80, STAGE - 80), y: random().range(80, STAGE - 80), r: 70 })
function Pop() {
    const [score, setScore] = useState(0)
    const dot = useRef(spawn())
    const stage = useRef<any>(null)
    useFrame((dt) => {
        dot.current.r -= 26 * dt
        if (dot.current.r < 6) { dot.current = spawn(); setScore(0) }
        stage.current?.MarkDirtyRepaint()
    }, [])

    const tap = () => {
        const d = dot.current, m = input.mouse.position
        if (Math.hypot(m.x - d.x, m.y - d.y) > d.r) return
        setScore((n) => n + Math.round(76 - d.r)); dot.current = spawn()
    }
    return (
        <View ref={stage} className="items-center bg-neutral-900" style={{ width: STAGE, height: STAGE }}
            onPointerDown={tap} onGenerateVisualContent={batchedVisualContent((p) => p.fillColor(1, .82, .4, 1)
                .beginPath().arc(dot.current.x, dot.current.y, dot.current.r, 0, Math.PI * 2).fill())}>
            <Text className="mt-6 text-4xl text-white tracking-wide">{score}</Text>
        </View>
    )
}
mount(<Pop />)
