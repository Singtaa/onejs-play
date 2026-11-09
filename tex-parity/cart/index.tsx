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
/** A case for a node tex does not have yet: reported apart from a failure, so set C can land before its nodes. */
class Pending extends Error {}

type Input = { port: string, tiles?: boolean, w?: number, h?: number, hex?: string, node?: string, params?: unknown, inputs?: Input[] }

/** One Magerie node on its inputs, each a file's bytes or a node run first. */
function run(node: string, params: unknown, inputs: readonly Input[]): unknown {
    const images = inputs.map((i) => i.node !== undefined
        ? run(i.node, i.params, i.inputs ?? [])
        : tex.pixels(i.w!, i.h!, unhex(i.hex!), { tile: i.tiles }))
    const fn = (tex as unknown as Record<string, (...a: unknown[]) => unknown>)[node]
    if (typeof fn !== "function") throw new Pending(node)
    // Material takes its maps by name, as Magerie's script API does: material({ albedo, normal, ... }).
    if (node === "material") return fn({ ...(params as object), ...Object.fromEntries(inputs.map((i, n) => [i.port.replace(/^in-/, ""), images[n]])) })
    return fn(...images, params)
}

function fromManifest(c: (typeof OJPLAY)[number]): Case[] {
    let result: unknown
    const made = () => {
        if (result === undefined) {
            result = run(c.node, c.params, c.inputs)
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
                if (e instanceof Pending) { console.log(`[tex-parity] pending ${name} ${e.message}`); continue }
                console.log(`[tex-parity] error ${name} ${e instanceof Error ? e.message : String(e)}`)
            }
        }
    }
    console.log("[tex-parity] done")
}

mount(<View><Label text="tex parity" /></View>)
main()
