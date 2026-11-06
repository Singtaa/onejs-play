// Writes the examples' simple models: boxes and cylinders in flat colours,
// each part one primitive with its own material, so no binary in the
// examples is without something to rebuild it from.
//
//     node scripts/make-models.mjs              every set
//     node scripts/make-models.mjs crate-yard   one set

import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")

const WOOD = [0.72, 0.5, 0.3, 1]
const SLATE = [0.22, 0.25, 0.3, 1]

/** Each example's models: name, then its parts. A model is centred on its origin, as a physics body is. */
const SETS = {
    "falling-boxes": {
        // A 1 m cube, and a slab 12 m square and 1 m deep.
        crate: [box([1, 1, 1], WOOD)],
        floor: [box([12, 1, 12], SLATE)],
    },
    "crate-yard": {
        crate: [box([1, 1, 1], WOOD)],
        // The yard: 80 m square, 1 m deep, and the walls round it.
        ground: [box([80, 1, 80], [0.3, 0.33, 0.3, 1])],
        wall: [box([80, 2, 1], [0.55, 0.52, 0.48, 1])],
        ramp: [box([6, 1, 10], [0.85, 0.62, 0.2, 1])],
        // The chassis as world.car makes it by default, 1.8 by 0.5 by 4, with a
        // cabin on top toward the back, which the physics does not know about.
        car: [
            box([1.8, 0.5, 4], [0.8, 0.16, 0.14, 1]),
            box([1.5, 0.45, 1.9], [0.16, 0.2, 0.26, 1], [0, 0.475, -0.35]),
        ],
        // A wheel of world.car's default radius, its axle along x, with a hub
        // on each side so its turning shows on whichever side it is fitted.
        wheel: [
            cylinder(0.35, 0.26, [0.12, 0.12, 0.13, 1]),
            box([0.3, 0.18, 0.18], [0.75, 0.75, 0.78, 1]),
        ],
    },
}

const only = process.argv[2]
if (only !== undefined && !(only in SETS)) throw new Error(`no set "${only}": ${Object.keys(SETS).join(", ")}`)
for (const [dir, models] of Object.entries(SETS)) {
    if (only !== undefined && dir !== only) continue
    for (const [name, parts] of Object.entries(models)) writeModel(path.join(ROOT, "examples", dir), name, parts)
}

/** A box `size` wide, high and deep, its middle at `at`. */
function box(size, color, at = [0, 0, 0]) {
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
            for (let i = 0; i < 3; i++) positions.push(at[i] + 0.5 * size[i] * (n[i] + su * u[i] + sv * v[i]))
            normals.push(...n)
        }
        // Counterclockwise seen from outside: u then v turns towards n.
        indices.push(...(outward(u, v, n) ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((k) => base + k))
    }
    return { positions, normals, indices, color }
}

/** A cylinder of `radius`, `width` long along x, its middle at `at`: smooth round its side, flat at its ends. */
function cylinder(radius, width, color, at = [0, 0, 0], sides = 24) {
    const positions = [], normals = [], indices = []
    const vertex = (p, n) => {
        positions.push(at[0] + p[0], at[1] + p[1], at[2] + p[2])
        normals.push(...n)
        return positions.length / 3 - 1
    }
    const ring = (k) => [Math.cos((2 * Math.PI * k) / sides), Math.sin((2 * Math.PI * k) / sides)]
    // The side: two vertices per step round, at either end.
    for (let k = 0; k <= sides; k++) {
        const [c, s] = ring(k)
        vertex([-width / 2, radius * c, radius * s], [0, c, s])
        vertex([width / 2, radius * c, radius * s], [0, c, s])
    }
    for (let k = 0; k < sides; k++) {
        const a = 2 * k, b = a + 1, c = a + 2, d = a + 3
        triangle(indices, positions, [a, c, b], [0, ...ring(k + 0.5)])
        triangle(indices, positions, [b, c, d], [0, ...ring(k + 0.5)])
    }
    // The ends: a fan round a middle vertex, facing out along x.
    for (const sign of [-1, 1]) {
        const n = [sign, 0, 0]
        const middle = vertex([(sign * width) / 2, 0, 0], n)
        const first = positions.length / 3
        for (let k = 0; k <= sides; k++) {
            const [c, s] = ring(k)
            vertex([(sign * width) / 2, radius * c, radius * s], n)
        }
        for (let k = 0; k < sides; k++) triangle(indices, positions, [middle, first + k, first + k + 1], n)
    }
    return { positions, normals, indices, color }
}

/** Adds a triangle wound counterclockwise as seen from the side `facing` points to. */
function triangle(indices, positions, [a, b, c], facing) {
    const p = (i) => positions.slice(3 * i, 3 * i + 3)
    const [pa, pb, pc] = [p(a), p(b), p(c)]
    const u = pb.map((x, i) => x - pa[i]), v = pc.map((x, i) => x - pa[i])
    indices.push(...(outward(u, v, facing) ? [a, b, c] : [a, c, b]))
}

function outward(u, v, n) {
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    return cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0
}

function writeModel(dir, name, parts) {
    const chunks = [], bufferViews = [], accessors = [], primitives = [], materials = []
    let offset = 0
    const view = (data, target) => {
        chunks.push(data)
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target })
        offset += data.length
        const pad = (4 - (data.length % 4)) % 4
        if (pad > 0) {
            chunks.push(Buffer.alloc(pad))
            offset += pad
        }
        return bufferViews.length - 1
    }
    parts.forEach((part, i) => {
        const count = part.positions.length / 3
        const min = [0, 1, 2].map((k) => Math.min(...part.positions.filter((_, j) => j % 3 === k)))
        const max = [0, 1, 2].map((k) => Math.max(...part.positions.filter((_, j) => j % 3 === k)))
        const big = count > 65535
        const pos = view(Buffer.from(new Float32Array(part.positions).buffer), 34962)
        const nor = view(Buffer.from(new Float32Array(part.normals).buffer), 34962)
        const ind = view(Buffer.from((big ? new Uint32Array(part.indices) : new Uint16Array(part.indices)).buffer), 34963)
        accessors.push(
            { bufferView: pos, componentType: 5126, count, type: "VEC3", min, max },
            { bufferView: nor, componentType: 5126, count, type: "VEC3" },
            { bufferView: ind, componentType: big ? 5125 : 5123, count: part.indices.length, type: "SCALAR" },
        )
        const label = parts.length === 1 ? name : `${name}-${i}`
        materials.push({ name: label, pbrMetallicRoughness: { baseColorFactor: part.color, metallicFactor: 0, roughnessFactor: 0.85 } })
        primitives.push({ attributes: { POSITION: 3 * i, NORMAL: 3 * i + 1 }, indices: 3 * i + 2, material: i })
    })
    const bin = Buffer.concat(chunks)

    const gltf = {
        asset: { version: "2.0", generator: "onejs-play scripts/make-models.mjs" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name, mesh: 0 }],
        meshes: [{ name, primitives }],
        materials,
        buffers: [{ byteLength: bin.length }],
        bufferViews,
        accessors,
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
    const out = path.join(dir, `${name}.glb`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(out, Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]))
    console.log(`${path.relative(ROOT, out)}: ${fs.statSync(out).size} bytes`)
}
