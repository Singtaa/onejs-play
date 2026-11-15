// Looks composed at run time and let go, as a game that dresses characters
// makes one per outfit: `make(n)` bakes n pictures of 512 by 256 from bytes
// (tex.pixels(...).texture(), each its own), `forget()` hands every one to
// tex.forget and drops it. tex-forget.playtest.mjs reads what is left.
import { View, Text, mount, tex } from "oj"

const W = 512, H = 256
let looks: unknown[] = []
let made = 0

function picture(seed: number): Uint8Array {
    const rgba = new Uint8Array(W * H * 4)
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (seed * 37 + i) & 255
        rgba[i + 1] = (seed * 11) & 255
        rgba[i + 2] = (i >> 10) & 255
        rgba[i + 3] = 255
    }
    return rgba
}

/** Whether Unity still holds a texture's pixels: false once it was released or destroyed. */
function held(t: any): boolean {
    try {
        return t.IsCreated() === true
    } catch {
        return false
    }
}

;(globalThis as any).texForget = {
    has: typeof (tex as { forget?: unknown }).forget === "function",
    async make(n: number) {
        const t0 = performance.now()
        const batch: Promise<unknown>[] = []
        for (let i = 0; i < n; i++) batch.push(tex.pixels(W, H, picture(++made)).ready({ cache: false }))
        looks.push(...await Promise.all(batch))
        return JSON.stringify({ looks: looks.length, held: looks.filter(held).length, ms: Math.round((performance.now() - t0) / n) })
    },
    forget() {
        const gone = looks
        looks = []
        const forget = (tex as { forget?: (t: unknown) => boolean }).forget
        const said = forget === undefined ? 0 : gone.filter((t) => forget(t as never)).length
        ;(globalThis as any).texForget.last = gone
        return JSON.stringify({ forgot: said, of: gone.length })
    },
    /** How many of the textures the last forget() let go of Unity still holds, once their release has run. */
    stillHeld() {
        const last: unknown[] = (globalThis as any).texForget.last ?? []
        const n = last.filter(held).length
        ;(globalThis as any).texForget.last = []
        return n
    },
}

mount(
    <View style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#1d1f24" }}>
        <Text text="tex.forget" style={{ fontSize: 24, color: "#f4f1de" }} />
    </View>,
)
