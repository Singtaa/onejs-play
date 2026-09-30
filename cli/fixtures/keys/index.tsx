// A sketch that only listens: every frame, which of these keys the game saw
// pressed, in the order a frame loop checks them. `oj test` drives it from
// keys.playtest.mjs and reads `__keyLog` back, so what is tested is what a
// game's own `wasKeyPressed` reports, through the real container.
import { View, Text, mount, useFrame, input } from "oj"

/** Unity key names, as a game asks for them. */
const NAMES = [
    "A", "C", "E", "N", "R",
    "Enter", "Backspace", "Escape", "Tab", "Space",
    "LeftArrow", "UpArrow", "RightArrow", "DownArrow",
    "Delete", "Home", "End", "PageUp", "PageDown", "Digit1",
]

const log: string[] = []
;(globalThis as { __keyLog?: string[] }).__keyLog = log

function Keys() {
    let frame = 0
    useFrame(() => {
        frame++
        for (const name of NAMES) {
            if (input.keyboard.wasKeyPressed(name)) log.push(`${frame}:${name}`)
        }
    }, [])
    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "#14181d" }}>
            <Text style={{ color: "#ffffff" }}>keys</Text>
        </View>
    )
}

mount(<Keys />)
