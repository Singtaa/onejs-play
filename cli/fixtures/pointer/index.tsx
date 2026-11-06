// A surface the size of the stage that writes down where each press landed,
// as its pointer event says and as `input` says, for pointer.playtest.mjs to
// compare with where the press was sent.
import { View, mount, input, useFrame } from "oj"

type Press = { from: "event" | "input", x: number, y: number }
const probe = globalThis as typeof globalThis & { __presses: Press[] }
probe.__presses = []

function Surface() {
    let wasDown = false
    useFrame(() => {
        const down = input.mouse.leftButton
        if (down && !wasDown) probe.__presses.push({ from: "input", ...input.mouse.position })
        wasDown = down
    })
    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "#14181d" }}
            onPointerDown={(e) => { probe.__presses.push({ from: "event", x: e.x, y: e.y }) }} />
    )
}

mount(<Surface />)
