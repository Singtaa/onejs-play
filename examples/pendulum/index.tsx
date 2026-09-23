// One idea: the frame loop hands you dt, and everything that moves is
// multiplied by it.
//
// dt is the seconds since the last frame. Scale every change by it and the
// swing takes the same wall clock time on a machine drawing 30 frames a second
// and on one drawing 144. Leave it out and the pendulum runs at whatever speed
// the hardware felt like that day, which is the oldest bug in games.
import { useRef } from "react"
import { View, mount, useStage, useFrame, batchedVisualContent } from "oj"

const W = 600, H = 600   // the board, in board units

// A fixed W x H board, scaled to fit the window and centred.
function useBoard() {
    const { width, height } = useStage()
    const scale = Math.min(width / W, height / H)
    const left = (width - W * scale) / 2, top = (height - H * scale) / 2
    return {
        scale,
        style: { position: "absolute", left: (width - W) / 2, top: (height - H) / 2, width: W, height: H, scale } as const,
        toBoard: (p: { x: number; y: number }) => ({ x: (p.x - left) / scale, y: (p.y - top) / scale }),
    }
}

// The board on a full-window matte, the colour the bars around it have always been.
function Board({ children }: { children: React.ReactNode }) {
    const board = useBoard()
    return (
        <View style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", backgroundColor: "#14181d" }}>
            <View style={board.style}>{children}</View>
        </View>
    )
}

const PIVOT = { x: W / 2, y: 110 }
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
        <View ref={stage} style={{ width: W, height: H, backgroundColor: "#11141b" }}
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
mount(<Board><Pendulum /></Board>)
