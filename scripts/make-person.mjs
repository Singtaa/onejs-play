// Writes the crowd fixture's person: one skinned mesh of about 1,600 triangles on 20 joints,
// with a 256 px picture and ten one-second clips, the size of a low-poly villager. Tubes on a
// stick figure, so the binary in cli/fixtures/crowd has something to rebuild it from.
//
//     node scripts/make-person.mjs

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const OUT = path.resolve(import.meta.dirname, "..", "cli", "fixtures", "crowd", "person.glb")
const MASK = path.resolve(import.meta.dirname, "..", "cli", "fixtures", "crowd", "person.mask.png")

// name, parent, where the joint is, where its tube ends, the tube's radius
const JOINTS = [
    ["hips", -1, [0, 0.92, 0], [0, 1.08, 0], 0.13],
    ["spine", 0, [0, 1.08, 0], [0, 1.25, 0], 0.12],
    ["chest", 1, [0, 1.25, 0], [0, 1.45, 0], 0.14],
    ["neck", 2, [0, 1.45, 0], [0, 1.53, 0], 0.045],
    ["head", 3, [0, 1.53, 0], [0, 1.76, 0], 0.1],
    ["shoulder.L", 2, [0.06, 1.42, 0], [0.2, 1.42, 0], 0.05],
    ["shoulder.R", 2, [-0.06, 1.42, 0], [-0.2, 1.42, 0], 0.05],
    ["upperarm.L", 5, [0.2, 1.42, 0], [0.2, 1.15, 0], 0.045],
    ["upperarm.R", 6, [-0.2, 1.42, 0], [-0.2, 1.15, 0], 0.045],
    ["forearm.L", 7, [0.2, 1.15, 0], [0.2, 0.9, 0], 0.04],
    ["forearm.R", 8, [-0.2, 1.15, 0], [-0.2, 0.9, 0], 0.04],
    ["hand.L", 9, [0.2, 0.9, 0], [0.2, 0.8, 0], 0.035],
    ["hand.R", 10, [-0.2, 0.9, 0], [-0.2, 0.8, 0], 0.035],
    ["thigh.L", 0, [0.09, 0.92, 0], [0.09, 0.5, 0], 0.07],
    ["thigh.R", 0, [-0.09, 0.92, 0], [-0.09, 0.5, 0], 0.07],
    ["shin.L", 13, [0.09, 0.5, 0], [0.09, 0.08, 0], 0.055],
    ["shin.R", 14, [-0.09, 0.5, 0], [-0.09, 0.08, 0], 0.055],
    ["foot.L", 15, [0.09, 0.08, 0], [0.09, 0.03, 0.2], 0.04],
    ["foot.R", 16, [-0.09, 0.08, 0], [-0.09, 0.03, 0.2], 0.04],
    // What the right hand holds: a clip shows and hides it by this joint's scale.
    ["held.R", 12, [-0.2, 0.82, 0], [-0.2, 0.82, 0.3], 0.02],
]
const SIDES = 8
const RINGS = 5
const CLIPS = ["Idle", "Walk", "Run", "Gather", "Hammer", "Eat", "Drink", "Sit", "Sleep", "Wave"]
const KEYS = 31

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l] }

const positions = [], normals = [], uvs = [], joints = [], weights = [], indices = []

JOINTS.forEach(([, parent, from, to, radius], j) => {
    const axis = unit(sub(to, from))
    const u = unit(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
    const v = cross(axis, u)
    const base = positions.length / 3
    const put = (p, n, t, s) => {
        positions.push(...p)
        normals.push(...n)
        uvs.push((j + s) / JOINTS.length, t)
        // The quarter of a tube nearest its joint bends with the parent too: two joints a vertex at
        // most. What is held is its own joint's alone, so that joint's scale hides all of it.
        const shared = parent >= 0 && t < 0.25 && j !== JOINTS.length - 1 ? 0.5 - t * 2 : 0
        joints.push(j, shared > 0 ? parent : 0, 0, 0)
        weights.push(1 - shared, shared, 0, 0)
    }
    for (let k = 0; k < RINGS; k++) {
        const t = k / (RINGS - 1)
        // Narrower at each end, so a tube reads as a limb and not a pipe.
        const r = radius * (0.75 + 0.25 * Math.sin(t * Math.PI))
        for (let s = 0; s < SIDES; s++) {
            const a = s / SIDES * Math.PI * 2
            const n = [0, 1, 2].map((i) => Math.cos(a) * u[i] + Math.sin(a) * v[i])
            put([0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * t + n[i] * r), n, t, s / SIDES)
        }
    }
    const start = positions.length / 3
    put(from, axis.map((x) => -x), 0, 0.5)
    put(to, axis, 1, 0.5)
    const tri = (a, b, c, out) => {
        const pa = positions.slice(a * 3, a * 3 + 3), pb = positions.slice(b * 3, b * 3 + 3), pc = positions.slice(c * 3, c * 3 + 3)
        if (dot(cross(sub(pb, pa), sub(pc, pa)), out) < 0) indices.push(a, c, b)
        else indices.push(a, b, c)
    }
    for (let k = 0; k + 1 < RINGS; k++) {
        for (let s = 0; s < SIDES; s++) {
            const a = base + k * SIDES + s, b = base + k * SIDES + (s + 1) % SIDES
            const out = normals.slice(a * 3, a * 3 + 3)
            tri(a, b, a + SIDES, out)
            tri(b, b + SIDES, a + SIDES, out)
        }
    }
    for (let s = 0; s < SIDES; s++) {
        tri(start, base + s, base + (s + 1) % SIDES, axis.map((x) => -x))
        const top = base + (RINGS - 1) * SIDES
        tri(start + 1, top + s, top + (s + 1) % SIDES, axis)
    }
})

// A square PNG whose texel in a joint's band of the uvs, at row y, is `paint(band, y)` as r, g, b, a.
function png(size, paint) {
    const raw = Buffer.alloc(size * (size * 4 + 1))
    for (let y = 0; y < size; y++) {
        const row = y * (size * 4 + 1)
        for (let x = 0; x < size; x++) {
            raw.set(paint(Math.floor(x / size * JOINTS.length), y), row + 1 + x * 4)
        }
    }
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

// The clips: every joint turns on every clip, by an amount and a phase that differ a clip and a
// joint, the hips bob, and held.R is whole in Hammer and 0.001 in the other nine.
const times = Float32Array.from({ length: KEYS }, (_, k) => k / (KEYS - 1))
function turn(clip, j, k) {
    const swing = 0.15 + ((clip * 7 + j * 3) % 5) * 0.1
    const a = Math.sin(k / (KEYS - 1) * Math.PI * 2 + j * 0.7 + clip) * swing * (j === 0 ? 0.2 : 1)
    const axis = unit([1, ((clip + j) % 3) * 0.3, ((clip * 2 + j) % 4) * 0.2])
    const s = Math.sin(a / 2)
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)]
}

const buffers = []
const views = [], accessors = []
let length = 0
function view(data, target) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const pad = (4 - bytes.length % 4) % 4
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) })
    buffers.push(bytes, Buffer.alloc(pad))
    length += bytes.length + pad
    return views.length - 1
}
function accessor(data, type, componentType, extra = {}, target) {
    const per = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]
    accessors.push({ bufferView: view(data, target), componentType, count: data.length / per, type, ...extra })
    return accessors.length - 1
}
const FLOAT = 5126, USHORT = 5123, UBYTE = 5121
const bounds = (a) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < a.length; i++) { min[i % 3] = Math.min(min[i % 3], a[i]); max[i % 3] = Math.max(max[i % 3], a[i]) }
    return { min, max }
}

const aPosition = accessor(new Float32Array(positions), "VEC3", FLOAT, bounds(positions), 34962)
const aNormal = accessor(new Float32Array(normals), "VEC3", FLOAT, {}, 34962)
const aUv = accessor(new Float32Array(uvs), "VEC2", FLOAT, {}, 34962)
const aJoints = accessor(new Uint8Array(joints), "VEC4", UBYTE, {}, 34962)
const aWeights = accessor(new Float32Array(weights), "VEC4", FLOAT, {}, 34962)
const aIndices = accessor(new Uint16Array(indices), "SCALAR", USHORT, {}, 34963)
const inverse = new Float32Array(JOINTS.length * 16)
JOINTS.forEach(([, , at], j) => inverse.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -at[0], -at[1], -at[2], 1], j * 16))
const aInverse = accessor(inverse, "MAT4", FLOAT)
const aTimes = accessor(times, "SCALAR", FLOAT, { min: [0], max: [1] })

const animations = CLIPS.map((name, clip) => {
    const samplers = [], channels = []
    const track = (node, pathName, data, type) => {
        samplers.push({ input: aTimes, output: accessor(data, type, FLOAT), interpolation: "LINEAR" })
        channels.push({ sampler: samplers.length - 1, target: { node, path: pathName } })
    }
    JOINTS.forEach((_, j) => {
        const q = new Float32Array(KEYS * 4)
        for (let k = 0; k < KEYS; k++) q.set(turn(clip, j, k), k * 4)
        track(j, "rotation", q, "VEC4")
    })
    const bob = new Float32Array(KEYS * 3)
    for (let k = 0; k < KEYS; k++) bob.set([0, JOINTS[0][2][1] + Math.sin(k / (KEYS - 1) * Math.PI * 4) * 0.02, 0], k * 3)
    track(0, "translation", bob, "VEC3")
    const held = new Float32Array(KEYS * 3).fill(name === "Hammer" ? 1 : 0.001)
    track(JOINTS.length - 1, "scale", held, "VEC3")
    return { name, samplers, channels }
})

// The picture: 256 px of banded colour, so the material samples a texture as a villager's does.
const picture = png(256, (band, y) => [90 + (band * 53) % 140, 80 + (band * 97) % 120, 70 + (band * 31) % 110 + (y >> 3 & 1) * 12, 255])
// Its colour mask, laid out as the picture: the trunk takes colour 1 (red), the legs colour 2
// (green), the arms colour 3 (blue) and the head colour 4 (alpha). What is held takes none.
const part = (band) => band <= 2 ? 0 : band <= 4 ? 3 : band <= 12 ? 2 : band <= 18 ? 1 : -1
const mask = png(256, (band) => [0, 1, 2, 3].map((channel) => part(band) === channel ? 255 : 0))
const imageView = view(picture)

const nodes = JOINTS.map(([name, parent, at], j) => ({
    name,
    translation: parent < 0 ? at : sub(at, JOINTS[parent][2]),
    ...(JOINTS.some((o) => o[1] === j) ? { children: JOINTS.flatMap((o, i) => o[1] === j ? [i] : []) } : {}),
}))
nodes.push({ name: "person", mesh: 0, skin: 0 })

const gltf = {
    asset: { version: "2.0", generator: "onejs-play scripts/make-person.mjs" },
    scene: 0,
    scenes: [{ nodes: [0, JOINTS.length] }],
    nodes,
    skins: [{ joints: JOINTS.map((_, j) => j), inverseBindMatrices: aInverse, skeleton: 0 }],
    meshes: [{ name: "person", primitives: [{ attributes: { POSITION: aPosition, NORMAL: aNormal, TEXCOORD_0: aUv, JOINTS_0: aJoints, WEIGHTS_0: aWeights }, indices: aIndices, material: 0 }] }],
    materials: [{ name: "person", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images: [{ bufferView: imageView, mimeType: "image/png" }],
    animations,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length }],
}

let json = Buffer.from(JSON.stringify(gltf))
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
const bin = Buffer.concat(buffers)
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
const chunkHead = (n, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.writeUInt32LE(type, 4); return b }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, Buffer.concat([header, chunkHead(json.length, 0x4e4f534a), json, chunkHead(bin.length, 0x004e4942), bin]))
fs.writeFileSync(MASK, mask)
console.log(`${path.relative(process.cwd(), OUT)}: ${indices.length / 3} triangles, ${positions.length / 3} vertices, ${JOINTS.length} joints, ${CLIPS.length} clips, ${(12 + 16 + json.length + bin.length) / 1024 | 0} KB`)
