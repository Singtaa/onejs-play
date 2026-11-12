// Writes the gear fixture's files (cli/fixtures/gear), for worn gear measured and checked on a
// real container:
//
// - body.glb: the crowd's person (scripts/make-person.mjs), one skinned mesh of 1,600 triangles
//   on 20 joints with its own 256 px picture, copied as it is.
// - helm.glb, shoulder.L.glb, shoulder.R.glb, cloak.glb, sword.glb, shield.glb: six small rigid
//   pieces, each its own model with its own 64 px picture, to hang on joints with attachTo.
// - body.dressed.glb: the body with the same six pieces as parts of the file, each a node under
//   the joint it is hung on, to show and hide.
// - pieces.ts: which joint each piece hangs on, and where, for the cart.
// - paint.png: a 256 px layer painted over the body's picture, see-through but for a few bands,
//   one of them half see-through, for tex.composite.
//
//     node scripts/make-gear.mjs

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const DIR = path.resolve(import.meta.dirname, "..", "cli", "fixtures", "gear")
const PERSON = path.resolve(import.meta.dirname, "..", "cli", "fixtures", "crowd", "person.glb")

/** A PNG `size` square whose texel at (x, y) is `paint(x, y)` as r, g, b, a. */
export function png(size, paint) {
    const raw = Buffer.alloc(size * (size * 4 + 1))
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set(paint(x, y), y * (size * 4 + 1) + 1 + x * 4)
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data])
        const out = Buffer.alloc(body.length + 8)
        out.writeUInt32BE(data.length, 0)
        body.copy(out, 4)
        out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4)
        return out
    }
    const head = Buffer.alloc(13)
    head.writeUInt32BE(size, 0)
    head.writeUInt32BE(size, 4)
    head.set([8, 6, 0, 0, 0], 8)
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))])
}

/**
 * The paint layer's texel: rows 0 to 63 (the top quarter) solid red-brown, rows 128 to 159 a
 * half see-through blue, the rest clear. playtest.mjs reads these back through tex.
 */
export const PAINT = { solid: [150, 60, 40, 255], half: [40, 80, 200, 128], clear: [0, 0, 0, 0] }
export function paintAt(_x, y) {
    if (y < 64) return PAINT.solid
    if (y >= 128 && y < 160) return PAINT.half
    return PAINT.clear
}

// A piece's triangles: a box from `min` to `max`, its faces' uvs spanning the picture.
function box(min, max) {
    const positions = [], normals = [], uvs = [], indices = []
    const faces = [
        [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
        [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
        [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
        [[0, -1, 0], [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]]],
        [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
        [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
    ]
    for (const [n, corners] of faces) {
        const base = positions.length / 3
        corners.forEach((c, k) => {
            positions.push(...c.map((t, i) => min[i] + t * (max[i] - min[i])))
            normals.push(...n)
            uvs.push(k === 0 || k === 1 ? 0 : 1, k === 1 || k === 2 ? 1 : 0)
        })
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    return { positions, normals, uvs, indices }
}

// A dome over y = 0, `rings` by `sides`, of radius r: a helm.
function dome(r, rings, sides) {
    const positions = [], normals = [], uvs = [], indices = []
    for (let i = 0; i <= rings; i++) {
        const v = i / rings, phi = v * Math.PI / 2
        for (let j = 0; j <= sides; j++) {
            const u = j / sides, th = u * Math.PI * 2
            const n = [Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th)]
            positions.push(n[0] * r, n[1] * r, n[2] * r)
            normals.push(...n)
            uvs.push(u, v)
        }
    }
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < sides; j++) {
            const a = i * (sides + 1) + j, b = a + sides + 1
            indices.push(a, b, a + 1, a + 1, b, b + 1)
        }
    }
    return { positions, normals, uvs, indices }
}

function merge(...parts) {
    const out = { positions: [], normals: [], uvs: [], indices: [] }
    for (const p of parts) {
        const base = out.positions.length / 3
        out.positions.push(...p.positions)
        out.normals.push(...p.normals)
        out.uvs.push(...p.uvs)
        out.indices.push(...p.indices.map((i) => i + base))
    }
    return out
}

// Each piece: its file's name, the joint it hangs on, where from the joint, its mesh, its colour.
export const PIECES = [
    { name: "helm", joint: "head", at: [0, 0.1, 0], mesh: dome(0.13, 8, 12), color: [170, 170, 180] },
    { name: "shoulder.L", joint: "shoulder.L", at: [0.12, 0.03, 0], mesh: merge(box([-0.07, -0.02, -0.07], [0.07, 0.04, 0.07]), box([-0.05, 0.04, -0.05], [0.05, 0.07, 0.05])), color: [120, 90, 60] },
    { name: "shoulder.R", joint: "shoulder.R", at: [-0.12, 0.03, 0], mesh: merge(box([-0.07, -0.02, -0.07], [0.07, 0.04, 0.07]), box([-0.05, 0.04, -0.05], [0.05, 0.07, 0.05])), color: [120, 90, 60] },
    { name: "cloak", joint: "chest", at: [0, -0.25, -0.16], mesh: merge(box([-0.2, -0.45, -0.01], [0.2, 0.2, 0.01]), box([-0.2, 0.18, -0.01], [0.2, 0.2, 0.12])), color: [90, 30, 40] },
    { name: "sword", joint: "hand.R", at: [0, -0.05, 0], mesh: merge(box([-0.01, -0.02, 0.02], [0.01, 0.02, 0.7]), box([-0.08, -0.02, 0], [0.08, 0.02, 0.03]), box([-0.015, -0.015, -0.12], [0.015, 0.015, 0])), color: [200, 200, 210] },
    { name: "shield", joint: "hand.L", at: [0.06, -0.05, 0], mesh: merge(box([0, -0.25, -0.2], [0.03, 0.25, 0.2]), box([0.03, -0.05, -0.05], [0.06, 0.05, 0.05])), color: [60, 70, 140] },
]

/** A piece's 64 px picture: its colour, with a lighter rim. */
const piecePicture = (color) => png(64, (x, y) => (x < 4 || y < 4 || x > 59 || y > 59 ? color.map((c) => Math.min(255, c + 60)) : color).concat(255))

/** A .glb of a JSON document and its binary chunk. */
function glb(json, bin) {
    let text = Buffer.from(JSON.stringify(json))
    text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)])
    const binary = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)])
    const head = Buffer.alloc(12)
    head.writeUInt32LE(0x46546c67, 0)
    head.writeUInt32LE(2, 4)
    head.writeUInt32LE(12 + 8 + text.length + 8 + binary.length, 8)
    const chunkHead = (n, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(n, 0); h.writeUInt32LE(type, 4); return h }
    return Buffer.concat([head, chunkHead(text.length, 0x4e4f534a), text, chunkHead(binary.length, 0x004e4942), binary])
}

/** Reads a .glb into its JSON and its binary chunk. */
function readGlb(file) {
    const b = fs.readFileSync(file)
    const n = b.readUInt32LE(12)
    const json = JSON.parse(b.subarray(20, 20 + n).toString())
    const binAt = 20 + n
    return { json, bin: b.subarray(binAt + 8, binAt + 8 + b.readUInt32LE(binAt)) }
}

/** Adds bytes and accessors to a document whose single buffer is `chunks`, returning its writers. */
function writer(json, start) {
    const chunks = [start]
    let length = start.length
    json.bufferViews ??= []
    json.accessors ??= []
    const view = (bytes) => {
        const pad = (4 - length % 4) % 4
        if (pad > 0) { chunks.push(Buffer.alloc(pad)); length += pad }
        json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length })
        chunks.push(bytes)
        length += bytes.length
        return json.bufferViews.length - 1
    }
    const accessor = (data, type, componentType, extra = {}) => {
        const per = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type]
        json.accessors.push({ bufferView: view(Buffer.from(data.buffer, data.byteOffset, data.byteLength)), componentType, count: data.length / per, type, ...extra })
        return json.accessors.length - 1
    }
    /** A piece's mesh, material and picture in this document: the mesh's index. */
    const piece = (p) => {
        json.images ??= []
        json.textures ??= []
        json.materials ??= []
        json.meshes ??= []
        json.images.push({ bufferView: view(piecePicture(p.color)), mimeType: "image/png" })
        json.textures.push({ source: json.images.length - 1 })
        json.materials.push({ name: p.name, pbrMetallicRoughness: { baseColorTexture: { index: json.textures.length - 1 }, metallicFactor: 0, roughnessFactor: 0.7 } })
        const pos = new Float32Array(p.mesh.positions)
        const min = [0, 1, 2].map((i) => Math.min(...p.mesh.positions.filter((_, k) => k % 3 === i)))
        const max = [0, 1, 2].map((i) => Math.max(...p.mesh.positions.filter((_, k) => k % 3 === i)))
        json.meshes.push({
            name: p.name,
            primitives: [{
                attributes: {
                    POSITION: accessor(pos, "VEC3", 5126, { min, max }),
                    NORMAL: accessor(new Float32Array(p.mesh.normals), "VEC3", 5126),
                    TEXCOORD_0: accessor(new Float32Array(p.mesh.uvs), "VEC2", 5126),
                },
                indices: accessor(new Uint16Array(p.mesh.indices), "SCALAR", 5123),
                material: json.materials.length - 1,
            }],
        })
        return json.meshes.length - 1
    }
    const done = () => {
        const bin = Buffer.concat(chunks)
        json.buffers = [{ byteLength: bin.length }]
        return bin
    }
    return { piece, done }
}

fs.mkdirSync(DIR, { recursive: true })
fs.copyFileSync(PERSON, path.join(DIR, "body.glb"))

for (const p of PIECES) {
    const json = { asset: { version: "2.0", generator: "onejs-play scripts/make-gear.mjs" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [] }
    const w = writer(json, Buffer.alloc(0))
    json.nodes.push({ name: p.name, mesh: w.piece(p) })
    fs.writeFileSync(path.join(DIR, `${p.name}.glb`), glb(json, w.done()))
}

// The dressed body: each piece a node under its joint, the joint's children in glTF.
{
    const { json, bin } = readGlb(PERSON)
    json.asset.generator = "onejs-play scripts/make-gear.mjs"
    const w = writer(json, Buffer.from(bin))
    for (const p of PIECES) {
        const joint = json.nodes.findIndex((n) => n.name === p.joint)
        if (joint < 0) throw new Error(`person.glb has no joint ${p.joint}`)
        json.nodes.push({ name: p.name, mesh: w.piece(p), translation: p.at })
        ;(json.nodes[joint].children ??= []).push(json.nodes.length - 1)
    }
    fs.writeFileSync(path.join(DIR, "body.dressed.glb"), glb(json, w.done()))
}

fs.writeFileSync(path.join(DIR, "paint.png"), png(256, paintAt))
fs.writeFileSync(path.join(DIR, "pieces.ts"), `// Written by scripts/make-gear.mjs: each piece's file, the joint it hangs on, and where from the joint.
export const PIECES: { name: string, joint: string, at: [number, number, number] }[] = [
${PIECES.map(({ name, joint, at }) => `    { name: ${JSON.stringify(name)}, joint: ${JSON.stringify(joint)}, at: [${at.join(", ")}] },`).join("\n")}
]
`)
console.log(`wrote ${DIR}`)
