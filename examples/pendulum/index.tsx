// One idea: the frame loop hands you dt, and everything that moves is
// multiplied by it.
//
// dt is the seconds since the last frame. Scale every change by it and the
// swing takes the same wall clock time on a machine drawing 30 frames a second
// and on one drawing 144. Leave it out and the pendulum runs at whatever speed
// the hardware felt like that day, which is the oldest bug in games.
import { useRef } from "react"
import { View, mount, useFrame, batchedVisualContent } from "oj"

const STAGE = 600
const PIVOT = { x: STAGE / 2, y: 110 }
const ARM = 330
const GRAVITY = 14

function Pendulum() {
    const angle = useRef(2.1) // radians from straight down
    const rate = useRef(0)    // radians per second
    const stage = useRef<any>(null)

    useFrame((dt) => {
        // Capped, because a backgrounded tab hands back one enormous dt on
        // return and a single step that large throws the weight into orbit.
        const step = Math.min(dt, 1 / 20)
        rate.current += -GRAVITY * Math.sin(angle.current) * step
        angle.current += rate.current * step
        stage.current?.MarkDirtyRepaint()
    }, [])

    return (
        <View ref={stage} style={{ width: STAGE, height: STAGE, backgroundColor: "#11141b" }}
            onGenerateVisualContent={batchedVisualContent((p) => {
                const x = PIVOT.x + Math.sin(angle.current) * ARM
                const y = PIVOT.y + Math.cos(angle.current) * ARM
                p.strokeColor("#39445c").lineWidth(3)
                    .beginPath().moveTo(PIVOT.x, PIVOT.y).lineTo(x, y).stroke()
                p.fillColor("#8892a8").beginPath().circle(PIVOT.x, PIVOT.y, 7).fill()
                p.fillColor("#ffd166").beginPath().circle(x, y, 34).fill()
            })} />
    )
}
mount(<Pendulum />)
