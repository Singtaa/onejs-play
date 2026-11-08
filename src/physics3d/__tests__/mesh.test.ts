import fs from "node:fs"
import path from "node:path"
import v8 from "node:v8"
import vm from "node:vm"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { RECAST_VERSION } from "../../nav/recast.version"
import { createWorld } from "../world"
import { glbTriangles } from "../gltf"
import { modelUrls, setFileLoader, loadFileBytes } from "../sources"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/recast-${RECAST_VERSION}.wasm`))))
})

/**
 * A .glb with one mesh: a 2 m square in glTF's x-y plane at z = 0, under a node
 * at glTF x = +3 and scaled `scale`. glTF's +x is Unity's -x, so the square
 * stands at Unity x = -3.
 */
function wallGlb({ scale = [1, 1, 1], strip = false, quantized = false } = {}): Uint8Array {
    const pos = [-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 2, 0]
    const idx = strip ? [0, 1, 3, 2] : [0, 1, 2, 0, 2, 3]
    const posBytes = quantized ? new Uint8Array(new Int16Array(pos.map((v) => Math.round(v / 2 * 32767))).buffer) : new Uint8Array(new Float32Array(pos).buffer)
    const idxBytes = new Uint8Array(new Uint16Array(idx).buffer)
    const bin = new Uint8Array(align4(posBytes.length) + align4(idxBytes.length))
    bin.set(posBytes, 0)
    bin.set(idxBytes, align4(posBytes.length))
    const json = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ children: [1], translation: [3, 0, 0] }, { mesh: 0, scale: quantized ? scale.map((s) => s * 2) : scale }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: strip ? 5 : 4 }] }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
            { buffer: 0, byteOffset: align4(posBytes.length), byteLength: idxBytes.length },
        ],
        accessors: [
            { bufferView: 0, componentType: quantized ? 5122 : 5126, normalized: quantized, count: 4, type: "VEC3" },
            { bufferView: 1, componentType: 5123, count: idx.length, type: "SCALAR" },
        ],
    }
    const text = new TextEncoder().encode(JSON.stringify(json))
    const jsonChunk = new Uint8Array(align4(text.length)).fill(0x20)
    jsonChunk.set(text)
    const out = new Uint8Array(12 + 8 + jsonChunk.length + 8 + bin.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true)
    v.setUint32(12, jsonChunk.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(jsonChunk, 20)
    const b = 20 + jsonChunk.length
    v.setUint32(b, bin.length, true); v.setUint32(b + 4, 0x004e4942, true); out.set(bin, b + 8)
    return out
}
const align4 = (n: number) => Math.ceil(n / 4) * 4

describe("a .glb's triangles", () => {
    it("are placed as glTFast places them: node transforms applied, x mirrored", () => {
        const t = glbTriangles(wallGlb({ scale: [2, 1, 1] }))
        const xs = [0, 3, 6, 9].map((i) => t.vertices[i])
        expect(new Set(xs)).toEqual(new Set([-1, -5]))
        expect(t.indices.length).toBe(6)
    })

    it("read strips and quantized positions to the same square", () => {
        const plain = glbTriangles(wallGlb())
        const strip = glbTriangles(wallGlb({ strip: true }))
        const quantized = glbTriangles(wallGlb({ quantized: true }))
        expect(strip.indices.length).toBe(6)
        for (let i = 0; i < 12; i++) expect(quantized.vertices[i]).toBeCloseTo(plain.vertices[i]!, 3)
    })

    it("refuse what they cannot read, by name", () => {
        expect(() => glbTriangles(new Uint8Array(40))).toThrow(/not a \.glb/)
        const glb = wallGlb()
        const text = new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true)))
        const json = JSON.parse(text)
        json.extensionsRequired = ["KHR_draco_mesh_compression"]
        const swapped = new TextEncoder().encode(JSON.stringify(json).padEnd(text.length + 64, " "))
        const out = new Uint8Array(20 + swapped.length)
        const v = new DataView(out.buffer)
        v.setUint32(0, 0x46546c67, true); v.setUint32(12, swapped.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(swapped, 20)
        expect(() => glbTriangles(out)).toThrow(/compressed.*Export it uncompressed/)
    })
})

describe("world.mesh", () => {
    it("collides where the model stands, from bytes, a name or a model", async () => {
        const w = await createWorld()
        const body = await w.mesh(wallGlb(), { layer: "level" })
        expect(body.kind).toBe("mesh")
        const hit = w.raycast([-3, 1, -5], [-3, 1, 5])!
        expect(hit.body).toBe(body)
        expect(hit.distance).toBeCloseTo(5, 4)
        expect(w.raycast([3, 1, -5], [3, 1, 5])).toBeNull()

        const files = new Map([["wall.glb", wallGlb()]])
        setFileLoader(async (name) => files.get(name)!)
        try {
            const named = await w.mesh("wall.glb", { at: [0, 0, 10] })
            expect(w.raycast([-3, 1, 5], [-3, 1, 15])!.body).toBe(named)
            const model = { id: 1 }
            modelUrls.set(model, "wall.glb")
            const fromModel = await w.mesh(model, { at: [0, 0, 20], scale: 2 })
            expect(w.raycast([-6, 3, 15], [-6, 3, 25])!.body).toBe(fromModel)
            await expect(w.mesh({ id: 2 })).rejects.toThrow(/not loaded with loadModel/)
        } finally {
            setFileLoader(async (name) => new Uint8Array(await (await fetch(name)).arrayBuffer()))
        }
        void loadFileBytes
        w.dispose()
    })

    it("a character stands on a mesh floor and a dynamic mesh is refused", async () => {
        const w = await createWorld()
        const floor = {
            vertices: new Float32Array([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5]),
            indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
        }
        await w.mesh(floor)
        const me = w.character({ at: [0, 1, 0] })
        for (let i = 0; i < 60; i++) w.step()
        expect(me.grounded).toBe(true)
        expect(me.position[1]).toBeCloseTo(0, 1)
        await expect(w.mesh(floor, { dynamic: true })).rejects.toThrow(/static or kinematic/)
        w.dispose()
    })

    it("lets a destroyed mesh's triangles go, seen by nav and visibility or not, and a restore brings the ground back", async () => {
        const gc = collector()
        const w = await createWorld()
        // A 64 by 64 grid of quads, about 50 KB of vertices and 100 KB of indices a body.
        const n = 65
        const grid = () => {
            const vertices = new Float32Array(n * n * 3), indices = new Uint32Array((n - 1) * (n - 1) * 6)
            for (let i = 0; i < n * n; i++) vertices.set([(i % n) * 0.25, 0, Math.floor(i / n) * 0.25], i * 3)
            let k = 0
            for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
                const a = x + z * n
                indices.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k)
                k += 6
            }
            return { vertices, indices }
        }
        const lap = async () => {
            for (let i = 0; i < 40; i++) {
                const body = await w.mesh(grid())
                // Each seen by visibility, which keeps what it read of a shape.
                w.visibility([4, 1, 4], { within: 3 })
                body.destroy()
            }
            return gc()
        }
        const warm = await lap()
        const after = await lap()
        // 12 MB stayed before: each body's own arrays, and visibility's copy of them.
        expect(after - warm).toBeLessThan(1_000_000)

        // A floor destroyed after a snapshot comes back to nav and to rays with its triangles.
        const floor = await w.mesh(grid())
        const before = w.snapshot()
        floor.destroy()
        await expect(w.nav()).rejects.toThrow(/no static bodies/)
        w.restore(before)
        expect(floor.alive).toBe(true)
        const nav = await w.nav()
        const p = nav.path([1, 0, 1], [15, 0, 15])
        expect(Math.hypot(p.at(-1)![0] - 15, p.at(-1)![2] - 15)).toBeLessThan(0.5)
        // Rays see a restored world after its next step, for every body (a separate finding).
        w.step()
        expect(w.raycast([8.1, 1, 8.1], [8.1, -1, 8.1])!.body).toBe(floor)
        w.dispose()
    })
})

/**
 * Collects garbage, waits for finalizers, and says how many bytes of array
 * buffers are still reachable, which the engine's own memory (grown once and
 * kept) does not move between two equal laps.
 */
function collector(): () => Promise<number> {
    v8.setFlagsFromString("--expose-gc")
    const gc = vm.runInNewContext("gc") as () => void
    return async () => {
        for (let i = 0; i < 3; i++) {
            gc()
            await new Promise((r) => setImmediate(r))
        }
        return process.memoryUsage().arrayBuffers
    }
}
