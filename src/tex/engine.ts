/**
 * Turns a graph into passes and draws them.
 *
 * **Planning.** A node is drawn into a texture of its own (materialised) when
 * it is the picture asked for, when more than one node reads it, when an area
 * node reads it (a blur reads its input's neighbours, so the input must exist
 * as pixels first), when its reader is another size, or when it came from
 * outside. Every other node is recorded into its reader's program: a run of
 * generators and pointwise nodes is one pass, which on WebGL 2 saves about
 * half a millisecond a node (proposal 4.3).
 *
 * **Storage.** Magerie stores every node at 8 bits (spec 1.1), so each node's
 * value is rounded as its texture would round it, fused or not: fusing
 * changes the cost and never the pixels. A pass's own target is 16 bits, and
 * a texture read is rounded back to the 8-bit value it holds.
 *
 * **Drawing.** A program is compiled where it runs, which on the web is
 * asynchronous: the passes are stepped each frame until every one has drawn
 * compiled, and once more so the last draw saw every input compiled.
 */
import { sl, compile, SLError, type Vec4 } from "onejs-unity/sl"
import { createPass, type DrawnPass } from "onejs-react"
import type { Node } from "./graph"
import { topological } from "./graph"
import { ScopeRecorder, declareTexture, type Scope, type TexRead } from "./scope"
import { quantise8, deliver } from "./kernels"
import { uploadRGBA, destroyTexture } from "./upload"

/** What a kernel is handed for its inputs. */
export interface KernelInputs {
    /** Input `i`'s value at this texel: a pointwise read. */
    value(i: number): Vec4
    /** Input `i` as a texture, wrapped or clamped at its edges: an area read. */
    texture(i: number, wrap: boolean): TexRead
}

export type Kernel = (s: Scope, node: Node, inputs: KernelInputs) => Vec4

export interface PassPlan {
    readonly node: Node
     
    readonly program: any
    readonly uniforms: Record<string, number | number[]>
    /** The materialised nodes this pass reads, by texture name. */
    readonly reads: Record<string, Node>
}

/** How many nodes read each node, each reader once. */
function readerCounts(order: readonly Node[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const n of order) {
        for (const id of new Set(n.inputs.map((i) => i.id))) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
}

/** The nodes that get a texture of their own, before any limit splits a pass. Unfused, every one does. */
export function materialised(root: Node, fuse = true): Set<string> {
    const order = topological(root)
    const readers = readerCounts(order)
    const out = new Set<string>([root.id])
    for (const n of order) {
        if (n.kind === "source" || !fuse) out.add(n.id)
        for (const i of n.inputs) {
            if (n.kind === "area" || (readers.get(i.id) ?? 0) > 1 || i.width !== n.width || i.height !== n.height) out.add(i.id)
        }
    }
    return out
}

/** A node's value as its texture holds it: 8 bits, or 16 for the few Magerie stores in half floats (Alpha Merge). */
function stored(n: Node, v: Vec4): Vec4 {
    return n.params.half === true ? v : quantise8(v)
}

/** Records one pass: `node`'s program, reading the materialised nodes it reaches. */
function recordPass(node: Node, drawn: ReadonlySet<string>, kernels: Readonly<Record<string, Kernel>>, final: boolean): PassPlan {
    let uniforms: Record<string, number | number[]> = {}
    const reads: Record<string, Node> = {}
    const program = sl.program(({ uv, resolution }) => {
        const s = new ScopeRecorder(uv, resolution)
        uniforms = s.uniforms
        const textures = new Map<string, TexRead>()
        const textureOf = (n: Node, wrap: boolean): TexRead => {
            const key = `${n.id} ${wrap}`
            let t = textures.get(key)
            if (t === undefined) {
                const name = `t${textures.size}`
                reads[name] = n
                t = declareTexture(name, wrap)
                textures.set(key, t)
            }
            return t
        }
        const values = new Map<string, Vec4>()
        const valueOf = (n: Node, size: Node): Vec4 => {
            if (n.id !== node.id && drawn.has(n.id)) {
                const t = textureOf(n, n.tiles)
                const held = n.width === size.width && n.height === size.height
                    ? t.fetch(s.pixel)
                    // Another size is stretched corner to corner, bilinear (spec 1.3).
                    : t.sample(s.pixel.add(0.5).div(s.size))
                return stored(n, held)
            }
            let v = values.get(n.id)
            if (v === undefined) {
                const kernel = kernels[n.op]
                if (kernel === undefined) throw new Error(`[oj] tex: no kernel for ${n.op}`)
                v = stored(n, kernel(s, n, {
                    value: (i) => valueOf(n.inputs[i]!, n),
                    texture: (i, wrap) => textureOf(n.inputs[i]!, wrap),
                }))
                values.set(n.id, v)
            }
            return v
        }
        const v = valueOf(node, node)
        return final ? deliver(v, node.op === "alpha") : v
    })
    return { node, program: compile(program), uniforms, reads }
}

/** Whether an error is one of the shader language's per-program limits, which a split can cure. */
function isLimit(e: unknown): boolean {
    return e instanceof SLError && /a program may (hold|sample) /.test(e.message)
}

/** The inline input of `node`'s pass with the most nodes under it: the one to split off. */
function heaviestInline(node: Node, drawn: ReadonlySet<string>): Node | undefined {
    let best: Node | undefined, bestSize = 0
    const size = (n: Node): number => (drawn.has(n.id) ? 0 : 1 + n.inputs.reduce((t, i) => t + size(i), 0))
    const walk = (n: Node) => {
        for (const i of n.inputs) {
            if (drawn.has(i.id)) continue
            const k = size(i)
            if (k > bestSize) { best = i; bestSize = k }
            walk(i)
        }
    }
    walk(node)
    return best
}

/** The first pass over a limit, and what the limit said. */
function overLimit(root: Node, drawn: ReadonlySet<string>, kernels: Readonly<Record<string, Kernel>>): { node: Node, message: string } | undefined {
    for (const n of topological(root)) {
        if (!drawn.has(n.id) || n.kind === "source") continue
        try { recordPass(n, drawn, kernels, false) } catch (inner) {
            if (!isLimit(inner)) throw inner
            return { node: n, message: (inner as Error).message }
        }
    }
    return undefined
}

/**
 * The passes for a graph, inputs first. A pass over the shader language's
 * limits (8 textures, 64 uniforms, its node count) splits: its heaviest
 * inline input gets a pass of its own, and planning starts again.
 */
export interface PlanOptions {
    /** Writes the root as a texture shows it (linear, straight alpha), not as Magerie stores it. Default true. */
    delivered?: boolean
    /** Records pointwise runs into one pass. Off, every node is a pass: the same pixels, slower. Default true. */
    fuse?: boolean
}

export function plan(root: Node, kernels: Readonly<Record<string, Kernel>>, { delivered = true, fuse = true }: PlanOptions = {}): PassPlan[] {
    const drawn = materialised(root, fuse)
    for (;;) {
        let limit: unknown
        try {
            return topological(root)
                .filter((n) => drawn.has(n.id) && n.kind !== "source")
                .map((n) => recordPass(n, drawn, kernels, delivered && n.id === root.id))
        } catch (e) {
            if (!isLimit(e)) throw e
            limit = e
        }
        const over = overLimit(root, drawn, kernels)
        if (over === undefined) throw limit
        const split = heaviestInline(over.node, drawn)
        if (split === undefined) throw new Error(`[oj] tex: one ${over.node.op} node is past the shader language's limits on its own: ${over.message}`)
        drawn.add(split.id)
    }
}

const nextFrame = () => new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()))

/** The longest a bake waits for its programs to compile before saying so. */
const COMPILE_FRAMES = 600

/**
 * Draws the passes, hands the last one's output (a half-float render
 * texture) to `finish`, and frees them all once it has done with it.
 */
export async function draw<T>(plans: readonly PassPlan[], finish: (output: unknown) => T | Promise<T>): Promise<T> {
    const made = new Map<string, DrawnPass>()
    // Tables are uploaded for this draw and destroyed with its passes.
    const tables = new Map<string, unknown>()
    const sourceTexture = (n: Node): unknown => {
        if (n.texture !== undefined) return n.texture
        let t = tables.get(n.id)
        if (t === undefined) {
            t = uploadRGBA(n.width, n.height, n.params.rgba as number[], n.tiles)
            tables.set(n.id, t)
        }
        return t
    }
    try {
        for (const p of plans) {
            const textures: Record<string, unknown> = {}
            for (const [name, n] of Object.entries(p.reads)) {
                textures[name] = n.kind === "source" ? sourceTexture(n) : made.get(n.id)!.pass
            }
            made.set(p.node.id, createPass(p.program, {
                uniforms: p.uniforms, textures, resolution: [p.node.width, p.node.height],
            }))
        }
        const last = made.get(plans[plans.length - 1]!.node.id)!
        const all = [...made.values()]
        let frames = 0
        // A step draws the passes a pass reads before it, each once, so
        // stepping the last draws the whole graph.
        while (!(last.draw() && all.every((d) => d.compiled))) {
            if (++frames > COMPILE_FRAMES) throw new Error(`[oj] tex: the passes did not compile in ${COMPILE_FRAMES} frames`)
            await nextFrame()
        }
        if (frames > 0) last.draw()
        return await finish(last.texture)
    } finally {
        for (const d of made.values()) d.dispose()
        for (const t of tables.values()) destroyTexture(t)
    }
}

