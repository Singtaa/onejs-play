// A cart with its own font (fonts/Pixelify.ttf, Pixelify Sans under OFL.txt),
// loaded first through oj.json's preload and applied with
// fontFamily on a container, so it reaches the Text inside. The same words
// under the default face are measured beside it: font.playtest.mjs reads both.
import { useRef } from "react"
import { View, Text, mount, useFont } from "oj"

const WORDS = "Pack 12 crates by dusk"

function Line({ font, id }: { font?: ReturnType<typeof useFont>, id: string }) {
    const ref = useRef<any>(null)
    ;(globalThis as any).__lines ??= {}
    ;(globalThis as any).__lines[id] = ref
    return (
        <View style={{ fontFamily: font ?? null, flexDirection: "row" }}>
            <Text ref={ref} text={WORDS} style={{ fontSize: 28, color: "#f4f1de" }} />
        </View>
    )
}

function Cart() {
    const pixel = useFont("fonts/Pixelify.ttf")
    // What the first render had: preloaded, the font is already there.
    ;(globalThis as any).__fontOnFirstRender ??= pixel !== null
    return (
        <View style={{ flexGrow: 1, backgroundColor: "#16181d", padding: 24, justifyContent: "center" }}>
            <Line id="plain" />
            <View style={{ height: 24 }} />
            <Line id="pixel" font={pixel} />
        </View>
    )
}

mount(<Cart />)
