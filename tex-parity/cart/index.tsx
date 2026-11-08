// Draws every case and prints its stored bytes as hex, one console line a
// case, for run.mjs. A case that throws prints why instead, so a broken node
// fails the run by name rather than by a missing line.
import { mount, View, Label, tex, TexImage } from "oj"
import { CASES, type Case } from "./cases"
import { OJPLAY } from "./ojplay.gen"

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

const unhex = (s: string) => Uint8Array.from(s.match(/../g)!, (b) => parseInt(b, 16))

/**
 * A manifest case as the call Magerie's exporter writes: the node's function
 * with its inputs in port order and every parameter, by Magerie's own name,
 * as an option. A multi-output node's record is read by port, less "out-".
 */
function fromManifest(c: (typeof OJPLAY)[number]): Case[] {
    let result: unknown
    const made = () => {
        if (result === undefined) {
            const images = c.inputs.map((i) => tex.pixels(i.w, i.h, unhex(i.hex), { tile: i.tiles }))
            const fn = (tex as unknown as Record<string, (...a: unknown[]) => unknown>)[c.node]
            if (typeof fn !== "function") throw new Error(`tex has no ${c.node}`)
            result = fn(...images, c.params)
        }
        return result
    }
    return c.outputs.map((o) => ({
        name: o.name,
        make: () => {
            const r = made()
            const img = r instanceof TexImage ? r : (r as Record<string, TexImage>)[o.port.replace(/^out-/, "")]
            if (!(img instanceof TexImage)) throw new Error(`${c.node} has no output ${o.port}`)
            return img
        },
    }))
}

async function main() {
    for (const c of [...CASES, ...OJPLAY.flatMap(fromManifest)]) {
        // Fused as a bake draws it, then every node a pass of its own: both against the one golden.
        for (const fuse of [true, false]) {
            const name = fuse ? c.name : `${c.name}@unfused`
            try {
                const img = c.make()
                const bytes = await img.pixels({ fuse })
                console.log(`[tex-parity] case ${name} ${img.width}x${img.height} ${img.tiles ? "tiles" : "edges"} ${hex(bytes)}`)
            } catch (e) {
                console.log(`[tex-parity] error ${name} ${e instanceof Error ? e.message : String(e)}`)
            }
        }
    }
    console.log("[tex-parity] done")
}

mount(<View><Label text="tex parity" /></View>)
main()
