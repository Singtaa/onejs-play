// copy() from the frame of a press, three ways: a Button's onClick, a key read
// in a frame callback, and a timer with no press behind it. Each call is
// written down with what copy() answered and whether the browser still
// counted the page as just pressed, for share.playtest.mjs.
import { useState } from "react"
import { Text, View, copy, input, mount, useFrame } from "oj"

type Copied = { from: string, answer: string, active: boolean | null, ruled: boolean }
const probe = globalThis as typeof globalThis & { __copies: Copied[], __late: () => void }
probe.__copies = []

/**
 * Whether a refusal was share.ts's own rule (no press in the frame) rather
 * than the browser's: the rule says so once on the console, so every call
 * after the first is told apart by a counter of its own instead.
 */
let ruledOut = 0
const warn = console.warn
console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes("frame of a press")) ruledOut++
    warn(...args)
}

/** What the browser says, read through globalThis since a cart's own `navigator` is shadowed. */
const active = (): boolean | null => (globalThis as any).navigator?.userActivation?.isActive ?? null

function record(from: string, text: string) {
    const was = active()
    const before = ruledOut
    copy(text).then((answer) => { probe.__copies.push({ from, answer, active: was, ruled: ruledOut > before }) })
}

probe.__late = () => { setTimeout(() => record("timer", "from-timer"), 1500) }

function Cart() {
    const [copies, setCopies] = useState(0)
    useFrame(() => {
        if (input.keyboard.wasKeyPressed("C")) record("key", "from-key")
    })
    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "#14181d" }}>
            <View onClick={() => { record("click", "from-click"); setCopies(copies + 1) }}
                style={{ position: "absolute", left: 10, top: 10, width: 120, height: 40, backgroundColor: "#2a3140", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#ffffff" }}>{`Copy ${copies}`}</Text>
            </View>
        </View>
    )
}

mount(<Cart />)
