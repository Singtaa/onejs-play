// A game behind a HUD button, as Gunyard's Invite sits over its yard: a
// stage-sized View, a button at 10, 10 (84 by 30) with a label inside, and the
// left stick. Each press is written down with what input said about it, for
// over-ui.playtest.mjs.
import { useState } from "react"
import { Stick, Text, View, input, mount, useFrame, useStick } from "oj"

type Press = { by: "mouse" | "touch", x: number, y: number, overUI: boolean, stick: boolean }
const probe = globalThis as typeof globalThis & { __presses: Press[], __clicks: number }
probe.__presses = []
probe.__clicks = 0

function Game() {
    const move = useStick("left")
    const [clicks, setClicks] = useState(0)
    useFrame(() => {
        // The edge, not leftButton: a click shorter than a frame is down and up in one.
        if (input.mouse.wasLeftPressed) probe.__presses.push({ by: "mouse", ...input.mouse.position, overUI: input.mouse.overUI, stick: move.active })
        for (const t of input.touches) {
            if (t.phase === "began") probe.__presses.push({ by: "touch", ...t.position, overUI: t.overUI, stick: move.active })
        }
    })
    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "#14181d" }}>
            <View onClick={() => { probe.__clicks++; setClicks(clicks + 1) }}
                style={{ position: "absolute", left: 10, top: 10, width: 84, height: 30, backgroundColor: "#2a3140", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#ffffff" }}>{`Invite ${clicks}`}</Text>
            </View>
            <Stick stick={move} />
        </View>
    )
}

mount(<Game />)
