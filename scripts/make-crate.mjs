// Writes falling-boxes' two models: crate.glb, a 1 m cube in a wood colour,
// and floor.glb, a slab 12 m square and 1 m deep in slate, each centred on its
// origin as a physics box is. Their source, so no binary in the examples is
// without something to rebuild it from.
//
//     node scripts/make-crate.mjs

import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const DIR = path.join(ROOT, "examples", "falling-boxes")

writeBox("crate", [1, 1, 1], [0.72, 0.5, 0.3, 1])
writeBox("floor", [12, 1, 12], [0.22, 0.25, 0.3, 1])

function writeBox(name, size, color) {
    // Six faces, four corners each, so every face has its own flat normal.
    const FACES = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
        [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
        [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
        [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
        [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ]
    const positions = [], normals = [], indices = []
    for (const [n, u, v] of FACES) {
        const base = positions.length / 3
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            for (let i = 0; i < 3; i++) positions.push(0.5 * size[i] * (n[i] + su * u[i] + sv * v[i]))
            normals.push(...n)
        }
        // Counterclockwise seen from outside: u then v turns towards n.
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const outward = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0
        indices.push(...(outward ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((k) => base + k))
    }

    const pos = Buffer.from(new Float32Array(positions).buffer)
    const nor = Buffer.from(new Float32Array(normals).buffer)
    const ind = Buffer.from(new Uint16Array(indices).buffer)
    const bin = Buffer.concat([pos, nor, ind, Buffer.alloc((4 - (ind.length % 4)) % 4)])

    const gltf = {
        asset: { version: "2.0", generator: "onejs-play scripts/make-crate.mjs" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name, mesh: 0 }],
        meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
        materials: [{ name, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.85 } }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
            { buffer: 0, byteOffset: pos.length, byteLength: nor.length, target: 34962 },
            { buffer: 0, byteOffset: pos.length + nor.length, byteLength: ind.length, target: 34963 },
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: size.map((x) => -x / 2), max: size.map((x) => x / 2) },
            { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
            { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
        ],
    }

    let json = Buffer.from(JSON.stringify(gltf))
    json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
    const header = Buffer.alloc(12)
    header.writeUInt32LE(0x46546c67, 0)
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
    const chunk = (type, data) => {
        const h = Buffer.alloc(8)
        h.writeUInt32LE(data.length, 0)
        h.writeUInt32LE(type, 4)
        return Buffer.concat([h, data])
    }
    const out = path.join(DIR, `${name}.glb`)
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(out, Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]))
    console.log(`${path.relative(ROOT, out)}: ${fs.statSync(out).size} bytes`)
}
