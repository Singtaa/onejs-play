/**
 * The triangles of a .glb, where the scene draws them: what a mesh collider is
 * made of.
 *
 * Read here rather than asked of Unity, so that a room script, which has no
 * Unity, builds the same collider from the same file. Positions come out the
 * way glTFast places them (glTF's x mirrored into Unity's left-handed space,
 * winding reversed to match), with every node's transform applied, so a
 * collider from a model and an actor spawned from it line up.
 *
 * Triangles, strips and fans; float and quantized positions; 8, 16 and 32 bit
 * indices. A Draco-compressed or sparse mesh is refused by name, since neither
 * can be read without a decoder this does not carry.
 */

type Mat4 = Float64Array

export interface Triangles {
    vertices: Float32Array
    indices: Uint32Array
}

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

export function glbTriangles(bytes: ArrayBuffer | Uint8Array): Triangles {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (data.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("[oj] not a .glb file (no glTF header)")
    let json: any = null
    let bin: Uint8Array | null = null
    for (let at = 12; at + 8 <= data.byteLength;) {
        const length = view.getUint32(at, true), type = view.getUint32(at + 4, true)
        const chunk = data.subarray(at + 8, at + 8 + length)
        if (type === CHUNK_JSON) json = JSON.parse(utf8(chunk))
        else if (type === CHUNK_BIN && bin === null) bin = chunk
        at += 8 + length
    }
    if (json === null) throw new Error("[oj] a .glb with no JSON chunk")
    const used: string[] = json.extensionsRequired ?? []
    if (used.includes("KHR_draco_mesh_compression") || used.includes("EXT_meshopt_compression")) {
        throw new Error(`[oj] this .glb's meshes are compressed (${used.join(", ")}), which a collider cannot read. Export it uncompressed for physics.`)
    }

    const buffers: Uint8Array[] = (json.buffers ?? []).map((b: any, i: number) => {
        if (b.uri === undefined) {
            if (i !== 0 || bin === null) throw new Error("[oj] a .glb buffer with no data")
            return bin
        }
        const m = /^data:[^;]*;base64,(.*)$/.exec(b.uri)
        if (m === null) throw new Error(`[oj] a .glb that points at another file (${b.uri}); pack it into one .glb`)
        return base64(m[1]!)
    })

    const positions: number[] = []
    const indices: number[] = []
    const scene = json.scenes?.[json.scene ?? 0]
    const roots: number[] = scene?.nodes ?? (json.nodes ?? []).map((_: unknown, i: number) => i)
    const visit = (index: number, parent: Mat4) => {
        const node = json.nodes[index]
        const m = multiply(parent, local(node))
        if (node.mesh !== undefined) {
            for (const p of json.meshes[node.mesh].primitives) addPrimitive(p, m)
        }
        for (const child of node.children ?? []) visit(child, m)
    }
    const addPrimitive = (p: any, m: Mat4) => {
        const mode = p.mode ?? 4
        if (mode !== 4 && mode !== 5 && mode !== 6) return
        if (p.attributes?.POSITION === undefined) return
        const base = positions.length / 3
        const pos = read(json, buffers, p.attributes.POSITION)
        for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!
            // Transformed in glTF's space, then x mirrored into Unity's, as glTFast does.
            positions.push(
                -(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!),
                m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
                m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
            )
        }
        const count = pos.length / 3
        const order = p.indices !== undefined ? read(json, buffers, p.indices) : Array.from({ length: count }, (_, i) => i)
        // A mirror reverses winding, and a node scaled negatively once more.
        const flip = determinant(m) > 0
        const tri = (a: number, b: number, c: number) => {
            if (flip) indices.push(base + a, base + c, base + b)
            else indices.push(base + a, base + b, base + c)
        }
        if (mode === 4) for (let i = 0; i + 2 < order.length; i += 3) tri(order[i]!, order[i + 1]!, order[i + 2]!)
        else if (mode === 5) {
            for (let i = 0; i + 2 < order.length; i++) {
                if (i % 2 === 0) tri(order[i]!, order[i + 1]!, order[i + 2]!)
                else tri(order[i + 1]!, order[i]!, order[i + 2]!)
            }
        }
        else for (let i = 1; i + 1 < order.length; i++) tri(order[0]!, order[i]!, order[i + 1]!)
    }
    for (const r of roots) visit(r, identity())
    if (indices.length === 0) throw new Error("[oj] this .glb has no triangles to collide with")
    return { vertices: new Float32Array(positions), indices: new Uint32Array(indices) }
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

/** An accessor's values as plain numbers, normalized integers scaled as glTF says. */
function read(json: any, buffers: Uint8Array[], index: number): number[] {
    const a = json.accessors[index]
    if (a.sparse !== undefined) throw new Error("[oj] a .glb with a sparse accessor, which a collider cannot read")
    const n = COMPONENTS[a.type] ?? 1
    const out = new Array<number>(a.count * n).fill(0)
    if (a.bufferView === undefined) return out
    const bv = json.bufferViews[a.bufferView]
    const buf = buffers[bv.buffer]!
    const view = new DataView(buf.buffer, buf.byteOffset + (bv.byteOffset ?? 0), bv.byteLength)
    const size = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType]!
    const stride = bv.byteStride ?? size * n
    const start = a.byteOffset ?? 0
    for (let i = 0; i < a.count; i++) {
        for (let k = 0; k < n; k++) {
            const at = start + i * stride + k * size
            let v: number
            switch (a.componentType) {
                case 5120: v = view.getInt8(at); if (a.normalized) v = Math.max(v / 127, -1); break
                case 5121: v = view.getUint8(at); if (a.normalized) v /= 255; break
                case 5122: v = view.getInt16(at, true); if (a.normalized) v = Math.max(v / 32767, -1); break
                case 5123: v = view.getUint16(at, true); if (a.normalized) v /= 65535; break
                case 5125: v = view.getUint32(at, true); break
                default: v = view.getFloat32(at, true)
            }
            out[i * n + k] = v
        }
    }
    return out
}

function identity(): Mat4 {
    const m = new Float64Array(16)
    m[0] = m[5] = m[10] = m[15] = 1
    return m
}

/** A node's own transform, column-major as glTF writes it. */
function local(node: any): Mat4 {
    if (node.matrix !== undefined) return Float64Array.from(node.matrix)
    const [tx, ty, tz] = node.translation ?? [0, 0, 0]
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
    const [sx, sy, sz] = node.scale ?? [1, 1, 1]
    const m = new Float64Array(16)
    m[0] = (1 - 2 * (y * y + z * z)) * sx; m[1] = 2 * (x * y + z * w) * sx; m[2] = 2 * (x * z - y * w) * sx
    m[4] = 2 * (x * y - z * w) * sy; m[5] = (1 - 2 * (x * x + z * z)) * sy; m[6] = 2 * (y * z + x * w) * sy
    m[8] = 2 * (x * z + y * w) * sz; m[9] = 2 * (y * z - x * w) * sz; m[10] = (1 - 2 * (x * x + y * y)) * sz
    m[12] = tx; m[13] = ty; m[14] = tz; m[15] = 1
    return m
}

function multiply(a: Mat4, b: Mat4): Mat4 {
    const m = new Float64Array(16)
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            m[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
        }
    }
    return m
}

function determinant(m: Mat4): number {
    return m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
}

function utf8(bytes: Uint8Array): string {
    // TextDecoder is on every host oj runs on but not in every type library it is checked against.
    const Decoder = (globalThis as any).TextDecoder
    if (Decoder !== undefined) return new Decoder().decode(bytes)
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return decodeURIComponent(escape(s))
}

function base64(s: string): Uint8Array {
    const atob = (globalThis as any).atob as (s: string) => string
    const raw = atob(s)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
}
