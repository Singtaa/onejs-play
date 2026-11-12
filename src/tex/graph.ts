/**
 * The graph a `tex` chain describes. Nothing here draws: a node is a value,
 * and two calls with the same op, parameters and inputs have the same `id`,
 * which the planner draws once, so a shared subgraph costs one pass however
 * it was spelt.
 */

export type Edges = "auto" | "wrap" | "clamp"

/** How a node reads its inputs, which decides what the planner may fuse. */
export type NodeKind =
    /** Makes a value at this texel from nothing: fuses into whatever reads it. */
    | "generator"
    /** Reads its inputs at this texel only: fuses, and its inputs fuse into it. */
    | "pointwise"
    /** Reads its inputs anywhere: each input is drawn into a texture first. */
    | "area"
    /**
     * Pixels the planner never draws: a texture handed in from outside the
     * graph (`tex.pixels`), or a table a node computes on the CPU, such as
     * Curves' lookup table, uploaded when the graph is drawn.
     */
    | "source"

export interface Node {
    readonly op: string
    readonly kind: NodeKind
    readonly inputs: readonly Node[]
    /** Parameters, resolved: every default filled, nothing a caller can still change. */
    readonly params: Readonly<Record<string, unknown>>
    readonly width: number
    readonly height: number
    /** Whether the picture repeats seamlessly (spec 1.4): what an `edges: "auto"` filter reads. */
    readonly tiles: boolean
    /** The node's identity: op, parameters and inputs. Equal ids draw equal pixels. */
    readonly id: string
    /** A `tex.pixels` or `tex.image` source's texture. A table has none: it is uploaded from `params.rgba` when drawn. */
    readonly texture?: unknown
}

/**
 * Whether a node is held in 32-bit floats (`params.float`): a generator
 * asked for `bitDepth: "32"`, and every node reading one, as Magerie's float
 * wins. Otherwise 8 bits, or the half floats a few nodes keep (`params.half`).
 */
export function isFloat(n: Node): boolean {
    return n.params.float === true
}

/** FNV-1a over a string, as eight hex digits. */
function hash32(text: string, seed = 0x811c9dc5): string {
    let h = seed >>> 0
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, "0")
}

let sourceCount = 0
/** Each texture a source holds, its key: one texture is one source however often it is handed in. */
const sourceKeys = new WeakMap<object, string>()

function sourceKey(texture: unknown): string {
    if (typeof texture !== "object" || texture === null) return `source#${++sourceCount}`
    let key = sourceKeys.get(texture)
    if (key === undefined) {
        key = `source#${++sourceCount}`
        sourceKeys.set(texture, key)
    }
    return key
}

export function makeNode(
    op: string, kind: NodeKind, inputs: readonly Node[], params: Record<string, unknown>,
    width: number, height: number, tiles: boolean, texture?: unknown,
): Node {
    // Float wins: a node reading a 32-bit picture is 32-bit.
    if (params.float !== true && inputs.some(isFloat)) params = { ...params, float: true }
    // A source's identity is the texture it holds, which has no stable text:
    // each texture is its own node, the same one each time it is handed in.
    const key = texture !== undefined
        ? `${sourceKey(texture)}|${op}|${tiles ? 1 : 0}`
        : `${op}|${width}x${height}|${tiles ? 1 : 0}|${JSON.stringify(params)}|${inputs.map((n) => n.id).join(",")}`
    // Two hashes of the key, 64 bits: the planner treats equal ids as one node.
    const id = hash32(key) + hash32(key, 0x01000193)
    return { op, kind, inputs, params, width, height, tiles, id, texture }
}

/** Every node a graph reaches, inputs before readers, each once. */
export function topological(root: Node): Node[] {
    const out: Node[] = []
    const seen = new Set<string>()
    const visit = (n: Node) => {
        if (seen.has(n.id)) return
        seen.add(n.id)
        for (const i of n.inputs) visit(i)
        out.push(n)
    }
    visit(root)
    return out
}
