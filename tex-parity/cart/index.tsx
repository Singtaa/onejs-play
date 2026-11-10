// Draws every case and prints its stored bytes as hex, one console line a
// case, for run.mjs. A case that throws prints why instead, so a broken node
// fails the run by name rather than by a missing line.
import { mount, View, Label } from "oj"
import { tex, TexImage, TEX_SOURCE } from "./tex"
import { CASES, type Case } from "./cases"
import { OJPLAY } from "./ojplay.gen"
import { CHAIN } from "./chain.gen"
import { GROUND } from "./ground.gen"
import { BUILDINGS, SET_NAME } from "./buildings.gen"
import { grain } from "./ground"

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

const unhex = (s: string) => Uint8Array.from(s.match(/../g)!, (b) => parseInt(b, 16))

/**
 * A manifest case as the call Magerie's exporter writes: the node's function
 * with its inputs in port order and every parameter, by Magerie's own name,
 * as an option. A multi-output node's record is read by tex's name for the
 * port: the port less "out-", unless tex-nodes.json names it otherwise.
 */
/** A case for a node tex does not have yet: reported apart from a failure, so set C can land before its nodes. */
class Pending extends Error {}

type Input = { port: string, tiles?: boolean, w?: number, h?: number, hex?: string, node?: string, params?: unknown, inputs?: Input[], output?: string }

/** One Magerie node on its inputs, each a file's bytes or a node run first. */
function run(node: string, params: unknown, inputs: readonly Input[]): unknown {
    // A multi-output input node is read at the port `output` names, "out-image" when it names none.
    const images = inputs.map((i) => i.node !== undefined
        ? pick(run(i.node, i.params, i.inputs ?? []), (i.output ?? "out-image").replace(/^out-/, ""))
        : tex.pixels(i.w!, i.h!, unhex(i.hex!), { tile: i.tiles }))
    const fn = (tex as unknown as Record<string, (...a: unknown[]) => unknown>)[node]
    if (typeof fn !== "function") throw new Pending(node)
    // Material takes its maps by name, as Magerie's script API does: material({ albedo, normal, ... }).
    if (node === "material") return fn({ ...(params as object), ...Object.fromEntries(inputs.map((i, n) => [i.port.replace(/^in-/, ""), images[n]])) })
    return fn(...images, params)
}

/** An output by tex's name for it: an image first (sdfShape) carries the others, so it is whole only for its image. */
function pick(r: unknown, key: string): unknown {
    if ((r as { kind?: unknown }).kind === "material") return r
    if (r instanceof TexImage && (key === "image" || !(key in r))) return r
    return (r as Record<string, unknown>)[key]
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
        float: o.float,
        make: () => {
            const r = made()
            // By tex's name for the port, so an image-first node's other outputs (sdfShape's sdf) are not read as its image.
            const img = pick(r, o.key)
            if (!(img instanceof TexImage)) throw new Error(`${c.node} has no output ${o.port}`)
            return img
        },
    }))
}

/**
 * A whole board from Magerie's per-node dump, built in tex from its own
 * outputs, every node's picture printed: drift shows at the node that
 * starts it. Exporters draw nothing of their own and are skipped.
 */
async function chain() {
    const made = new Map<string, unknown>()
    // Inputs held to Magerie's bytes: a node checked in isolation never replaces one.
    const dumped = new Set(CHAIN.filter((n) => n.type === "pixels").map((n) => n.id))
    for (const n of CHAIN) {
        if (n.type === "export") continue
        // A dumped input, for a node checked in isolation: Magerie's bytes, not drawn here.
        if (n.type === "pixels") {
            const bytes = unhex(n.hex!)
            made.set(n.id, tex.pixels(n.w!, n.h!, n.float ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4) : bytes, { tile: n.tiles }))
            continue
        }
        const name = `chain/${n.id}`
        const inputs = n.inputs ?? []
        try {
            const missing = inputs.find((i) => !made.has(i.from))
            if (missing !== undefined) throw new Pending(`${n.type}, after ${missing.from}`)
            const fn = (tex as unknown as Record<string, (...a: unknown[]) => unknown>)[n.type]
            if (typeof fn !== "function") throw new Pending(n.type)
            const values = inputs.map((i) => {
                const v = pick(made.get(i.from), i.key)
                if (v === undefined) throw new Error(`${i.from} has no output ${i.out}`)
                return v
            })
            const r = n.type === "material"
                ? fn({ ...(n.params as object), ...Object.fromEntries(inputs.map((i, k) => [i.port.replace(/^in-/, ""), values[k]])) })
                : fn(...values, n.params)
            if (!dumped.has(n.id)) made.set(n.id, r)
            // Each picture Magerie stored, at the precision it stored it.
            for (const o of n.outs ?? []) {
                const img = pick(r, o.key)
                if (!(img instanceof TexImage)) { console.log(`[tex-parity] error ${o.name} ${n.type} gave no picture at ${o.port}`); continue }
                const px = o.float ? `f:${hex(new Uint8Array((await img.pixels({ float: true })).buffer))}` : hex(await img.pixels())
                console.log(`[tex-parity] case ${o.name} ${img.width}x${img.height} ${img.tiles ? "tiles" : "edges"} ${px}`)
            }
        } catch (e) {
            if (e instanceof Pending) { console.log(`[tex-parity] pending ${name} ${e.message}`); continue }
            console.log(`[tex-parity] error ${name} ${e instanceof Error ? e.message : String(e)}`)
        }
    }
    console.log("[tex-parity] done")
}

/** primoeden-three's ground pictures, each the grain of a colour export, drawn here by tex. */
async function ground() {
    for (const g of GROUND) {
        try {
            const lit = tex.pixels(g.w, g.h, unhex(g.lit), { tile: true })
            const height = tex.pixels(g.w, g.h, unhex(g.height), { tile: true })
            const img = await grain(lit, height, g.spread)
            console.log(`[tex-parity] case ${g.name} ${img.width}x${img.height} ${img.tiles ? "tiles" : "edges"} ${hex(await img.pixels())}`)
        } catch (e) {
            console.log(`[tex-parity] error ${g.name} ${e instanceof Error ? e.message : String(e)}`)
        }
    }
    console.log("[tex-parity] done")
}

/**
 * Magerie's emitted code for whole textures, each file as Magerie wrote it:
 * a file that throws (a node or an option tex lacks) fails every export it
 * names, by the error, so a gap shows as a failure and never as a pass.
 */
async function buildings() {
    for (const b of BUILDINGS) {
        let m: Record<string, unknown>
        try {
            m = await b.load()
        } catch (e) {
            const canvas = tex.canvas(1) as unknown as Record<string, unknown>
            const missing = b.names.filter((n) => typeof canvas[n] !== "function")
            const why = missing.length > 0 ? `tex has no ${missing.join(", ")}` : e instanceof Error ? e.message : String(e)
            for (const name of b.exports) console.log(`[tex-parity] error ${SET_NAME}/${name} ${b.file}.ts: ${why}`)
            continue
        }
        for (const name of b.exports) {
            try {
                const img = m[name]
                if (!(img instanceof TexImage)) throw new Error(`${b.file}.ts exports no picture ${name}`)
                console.log(`[tex-parity] case ${SET_NAME}/${name} ${img.width}x${img.height} ${img.tiles ? "tiles" : "edges"} ${hex(await img.pixels())}`)
            } catch (e) {
                console.log(`[tex-parity] error ${SET_NAME}/${name} ${e instanceof Error ? e.message : String(e)}`)
            }
        }
    }
    console.log("[tex-parity] done")
}

async function main() {
    console.log(`[tex-parity] tex ${TEX_SOURCE}`)
    if (CHAIN.length > 0) return chain()
    if (GROUND.length > 0) return ground()
    if (BUILDINGS.length > 0) return buildings()
    for (const c of [...CASES, ...OJPLAY.flatMap(fromManifest)]) {
        // Fused as a bake draws it, then every node a pass of its own: both against the one golden.
        for (const fuse of [true, false]) {
            const name = fuse ? c.name : `${c.name}@unfused`
            try {
                const img = c.make()
                // A float case's bytes are its float32s, marked so the harness reads them as floats.
                const bytes = c.float === true
                    ? `f:${hex(new Uint8Array((await img.pixels({ fuse, float: true })).buffer))}`
                    : hex(await img.pixels({ fuse }))
                console.log(`[tex-parity] case ${name} ${img.width}x${img.height} ${img.tiles ? "tiles" : "edges"} ${bytes}`)
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
