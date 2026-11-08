// Draws every case and prints its stored bytes as hex, one console line a
// case, for run.mjs. A case that throws prints why instead, so a broken node
// fails the run by name rather than by a missing line.
import { mount, View, Label } from "oj"
import { CASES } from "./cases"

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

async function main() {
    for (const c of CASES) {
        try {
            const img = c.make()
            const bytes = await img.pixels()
            console.log(`[tex-parity] case ${c.name} ${img.width}x${img.height} ${hex(bytes)}`)
        } catch (e) {
            console.log(`[tex-parity] error ${c.name} ${e instanceof Error ? e.message : String(e)}`)
        }
    }
    console.log("[tex-parity] done")
}

mount(<View><Label text="tex parity" /></View>)
main()
