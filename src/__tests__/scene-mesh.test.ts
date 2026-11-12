/**
 * `scene.mesh` and `scene.scatter`, as the calls they make on OneJS's
 * ModelBridge (CreateMesh, SetMesh and Scatter, tested in OneJS's
 * MeshModelEditModeTests and ScatterEditModeTests), and a mesh model as the
 * triangles a physics world reads from it.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { createScene } from "../models"
import { setWasmModule } from "../wasm"
import { RAPIER_VERSION } from "../physics3d/rapier.version"
import { createWorld } from "../physics3d/world"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
// What SetMesh answers next: "" takes the arrays, anything else is what was wrong.
let answer: string
let unloads: boolean
// What Scatter answers: a handle, or 0 for a model it cannot draw that way.
let scatterAnswer: number | null
// What SetDepthOnly answers: false where the renderer cannot mask colour.
let depthAnswer: boolean
// What SetMeshTexture and SetMeshSplat answer: "" took it, anything else is what was wrong.
let paintAnswer: string

function recorder(): any {
    let next = 40
    return new Proxy({}, {
        get(_t, name: string) {
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "Scatter") return scatterAnswer ?? ++next
                if (name === "CreateMesh" || name === "Spawn") return ++next
                if (name === "SetMesh") return answer
                if (name === "Unload") return unloads
                if (name === "SetDepthOnly") return depthAnswer
                if (name === "SetMeshTexture" || name === "SetMeshSplat" || name === "SetMeshSplatTriplanar" || name === "SetMeshSplatFar") return paintAnswer
                if (name === "Height") return 2.5
                return undefined
            }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name)

const WA = (globalThis as any).WebAssembly
beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

let dispose: () => void
beforeEach(() => {
    calls = []
    answer = ""
    unloads = true
    scatterAnswer = null
    depthAnswer = true
    paintAnswer = ""
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: recorder() } } }
})

afterEach(() => {
    dispose?.()
    ;(globalThis as any).CS = savedCS
})

function scene() {
    const made = createScene()
    dispose = made.dispose
    return made.scene
}

const SQUARE = { positions: [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0], indices: [0, 1, 2, 0, 2, 3] }

describe("scene.mesh", () => {
    it("makes the model with the streams it was given, then gives it the arrays as typed arrays", () => {
        const s = scene()
        const model = s.mesh({ ...SQUARE, colors: new Float32Array(12), color: "#ff000080" })
        const [, normals, colors, uvs, r, g, b, a] = of("CreateMesh")[0]!
        expect([normals, colors, uvs]).toEqual([false, true, false])
        expect([r, g, b]).toEqual([1, 0, 0])
        expect(a).toBeCloseTo(128 / 255, 3)
        const [, id, positions, indices, givenNormals, givenColors, givenUvs] = of("SetMesh")[0]!
        expect(id).toBe(model.id)
        expect(positions).toBeInstanceOf(Float32Array)
        expect(indices).toBeInstanceOf(Uint32Array)
        expect(Array.from(indices as Uint32Array)).toEqual(SQUARE.indices)
        expect([givenNormals, givenUvs]).toEqual([null, null])
        expect(givenColors).toBeInstanceOf(Float32Array)
    })

    it("is a model the scene spawns, with no clips and the bridge's height", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        const actor = s.spawn(model, { position: [1, 0, 0] })
        expect(of("Spawn")[0]![1]).toBe(model.id)
        expect(actor.model).toBe(model)
        expect(model.clips).toEqual([])
        expect(model.height).toBe(2.5)
    })

    it("passes a typed array through as it is, so a set each frame copies nothing in JS", () => {
        const s = scene()
        const positions = new Float32Array(SQUARE.positions)
        const indices = new Uint16Array(SQUARE.indices)
        const model = s.mesh({ positions, indices })
        model.set({ positions })
        const [first, second] = of("SetMesh")
        expect(first![2]).toBe(positions)
        expect(first![3]).toBe(indices)
        expect(second![2]).toBe(positions)
        expect(second![3]).toBeNull()
    })

    it("says what the bridge found wrong, and frees the model it could not fill", () => {
        const s = scene()
        answer = "index 2 is 9, and there are 4 vertices (0 to 3)"
        expect(() => s.mesh(SQUARE)).toThrow("[oj] scene.mesh: index 2 is 9, and there are 4 vertices (0 to 3)")
        expect(of("Unload")).toHaveLength(1)
        answer = ""
        const model = s.mesh(SQUARE)
        answer = "colors are required whenever the number of vertices changes"
        expect(() => model.set({ positions: [0, 0, 0] })).toThrow("[oj] mesh.set: colors are required")
    })

    it("refuses what cannot cross before asking the bridge", () => {
        const s = scene()
        expect(() => s.mesh({ positions: [0, 0], indices: [0, 0, 0] })).toThrow("positions has 2 numbers, which is not 3 a vertex")
        expect(() => s.mesh({ ...SQUARE, uvs: [0, 0, 1] })).toThrow("uvs has 3 numbers, which is not 2 a vertex")
        expect(() => s.mesh({ positions: "0 0 0" as any, indices: [0, 0, 0] })).toThrow("positions is a String")
        expect(() => s.mesh({ positions: SQUARE.positions, indices: new Float32Array(3) as any })).toThrow("indices are a Float32Array")
        expect(() => s.mesh({ ...SQUARE, color: "#nope" })).toThrow("[oj] scene.mesh color")
        expect(of("SetMesh")).toHaveLength(0)
    })

    it("needs a OneJS that can make one, and says so", () => {
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: new Proxy({}, { get: (_t, name) => name === "CreateMesh" ? undefined : () => undefined }) } } }
        const s = scene()
        expect(() => s.mesh(SQUARE)).toThrow("needs a newer OneJS")
    })

    it("is freed by destroy, and kept with a word while an actor of it is in the world", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        unloads = false
        model.destroy()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("still in the scene"))
        warn.mockRestore()
        unloads = true
        model.destroy()
        expect(of("Unload").map((c) => c[1])).toEqual([model.id, model.id])
    })

    it("goes with its scene: a set after the scene is gone says so", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        dispose()
        expect(() => model.set(SQUARE)).toThrow("made for a scene that is gone")
    })
})

describe("a mesh model as a physics collider", () => {
    it("is its own triangles, as last set", async () => {
        const s = scene()
        // A floor 10 by 10 at y = 0, facing up.
        const model = s.mesh({ positions: [-5, 0, -5, -5, 0, 5, 5, 0, 5, 5, 0, -5], indices: new Uint16Array([0, 1, 2, 0, 2, 3]) })
        model.set({ positions: [-5, 1, -5, -5, 1, 5, 5, 1, 5, 5, 1, -5] })
        const world = await createWorld({ gravity: [0, 0, 0] })
        try {
            await world.mesh(model)
            const hit = world.raycast([0, 5, 0], [0, -5, 0])
            expect(hit).not.toBeNull()
            expect(hit!.point[1]).toBeCloseTo(1, 4)
        } finally {
            world.dispose()
        }
    })

    it("keeps the shape it was made with: set refuses once it is one", async () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        const world = await createWorld({ gravity: [0, 0, 0] })
        try {
            await world.mesh(model)
            expect(() => model.set(SQUARE)).toThrow("is a physics collider")
        } finally {
            world.dispose()
        }
    })
})

describe("scene.scatter", () => {
    it("sends the copies as one Float32Array, five numbers a copy, with y, yaw and scale defaulted", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        const forest = s.scatter(model, [{ x: 1, z: 2 }, { x: 3, y: 4, z: 5, yaw: 90, scale: 2 }])
        const [, id, data] = of("Scatter")[0]!
        expect(id).toBe(model.id)
        expect(data).toBeInstanceOf(Float32Array)
        expect(Array.from(data as Float32Array)).toEqual([1, 0, 2, 0, 1, 3, 4, 5, 90, 2])
        expect(forest.count).toBe(2)
    })

    it("passes a Float32Array through as it is", () => {
        const s = scene()
        const copies = new Float32Array(10)
        s.scatter(s.mesh(SQUARE), copies)
        expect(of("Scatter")[0]![2]).toBe(copies)
    })

    it("refuses copies it cannot read, before asking the bridge", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        expect(() => s.scatter(model, new Float32Array(7))).toThrow("five numbers a copy (x, y, z, yaw, scale), and this one has 7")
        expect(() => s.scatter(model, [{ x: 1, z: 1 }, { x: 2 } as any])).toThrow("copy 1 needs an x and a z")
        expect(() => s.scatter(model, "trees" as any)).toThrow("a list of { x, z } or a Float32Array")
        expect(of("Scatter")).toHaveLength(0)
    })

    it("says why when the bridge cannot draw a model this way", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        scatterAnswer = 0
        expect(() => s.scatter(model, [{ x: 0, z: 0 }])).toThrow("has a skinned mesh")
    })

    it("is destroyed once, and not after its scene took it along", () => {
        const s = scene()
        const forest = s.scatter(s.mesh(SQUARE), [{ x: 0, z: 0 }])
        forest.destroy()
        forest.destroy()
        expect(of("DestroyScatter")).toHaveLength(1)
        const rocks = s.scatter(s.mesh(SQUARE), [{ x: 0, z: 0 }])
        dispose()
        rocks.destroy()
        expect(of("DestroyScatter")).toHaveLength(1)
    })
})

describe("scene.mesh depthOnly", () => {
    it("makes the model depth alone before it holds any vertices, and only when asked", () => {
        const s = scene()
        s.mesh(SQUARE)
        expect(of("SetDepthOnly")).toHaveLength(0)
        const fan = s.mesh(SQUARE, { depthOnly: true })
        expect(of("SetDepthOnly")).toEqual([["SetDepthOnly", fan.id]])
        const order = calls.map((c) => c[0]).filter((n) => n === "SetDepthOnly" || n === "SetMesh")
        expect(order.slice(-2)).toEqual(["SetDepthOnly", "SetMesh"])
    })

    it("throws, keeping nothing, where the renderer cannot draw depth without colour", () => {
        depthAnswer = false
        const s = scene()
        expect(() => s.mesh(SQUARE, { depthOnly: true })).toThrow(/cannot write depth without colour/)
        expect(of("Unload")).toHaveLength(1)
        expect(of("SetMesh")).toHaveLength(0)
    })

    it("throws before making anything on a OneJS without SetDepthOnly", () => {
        const bridge = recorder()
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: new Proxy({}, {
            get: (_t, name: string) => name === "SetDepthOnly" ? undefined : bridge[name],
        }) } } }
        const s = scene()
        expect(() => s.mesh(SQUARE, { depthOnly: true })).toThrow(/depthOnly needs a newer OneJS/)
        expect(of("CreateMesh")).toHaveLength(0)
        expect(() => s.mesh(SQUARE)).not.toThrow()
    })
})

describe("scene.mesh texture and splat", () => {
    const UVS = [0, 0, 0, 1, 1, 1, 1, 0]
    const grass = { name: "grass" }, dirt = { name: "dirt" }, rock = { name: "rock" }

    it("tiles a texture across the uvs, before the vertices, with one number for both directions or two", () => {
        const s = scene()
        const model = s.mesh({ ...SQUARE, uvs: UVS, texture: grass, tiling: 8 })
        expect(of("SetMeshTexture")).toEqual([["SetMeshTexture", model.id, grass, 8, 8]])
        const order = calls.map((c) => c[0]).filter((n) => n === "SetMeshTexture" || n === "SetMesh")
        expect(order).toEqual(["SetMeshTexture", "SetMesh"])
        s.mesh({ ...SQUARE, uvs: UVS, texture: grass, tiling: [2, 4] })
        s.mesh({ ...SQUARE, uvs: UVS, texture: grass })
        expect(of("SetMeshTexture").slice(1).map((c) => c.slice(3))).toEqual([[2, 4], [1, 1]])
        expect(of("SetMesh").every((c) => c.length === 7), "a mesh without a splat sends the six arguments every OneJS takes").toBe(true)
    })

    it("hands back the texture it was given as model.texture, and null for none or a splat", () => {
        const s = scene()
        expect(s.mesh({ ...SQUARE, uvs: UVS, texture: grass }).texture).toBe(grass)
        expect(s.mesh(SQUARE).texture).toBeNull()
    })

    it("paints a splat by weights a vertex, one a layer, and sends new weights with a set", () => {
        const s = scene()
        const weights = new Float32Array(8).fill(0.5)
        const model = s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass, dirt], weights, tiling: 8, heightBlend: 0.2 } })
        const [splat] = of("SetMeshSplat")
        expect(splat![1]).toBe(model.id)
        expect(splat!.slice(2, 6)).toEqual([grass, dirt, null, null])
        expect(splat![6]).toBe(8)
        expect(splat![7]).toBe(8)
        expect(splat![8]).toBeCloseTo(0.2, 6)
        const [made] = of("SetMesh")
        expect(made).toHaveLength(8)
        expect(made![7]).toBe(weights)
        const worn = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1])
        model.set({ positions: SQUARE.positions, weights: worn })
        expect(of("SetMesh")[1]![7]).toBe(worn)
        model.set({ positions: SQUARE.positions })
        expect(of("SetMesh")[2]![7], "left out, they stay").toBeNull()
    })

    it("projects a layer given as { picture, triplanar } from the sides, after the splat and before the vertices", () => {
        const s = scene()
        const model = s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass, { picture: rock, triplanar: 4 }], weights: new Float32Array(8) } })
        expect(of("SetMeshSplat")[0]!.slice(2, 6), "the picture goes as a layer").toEqual([grass, rock, null, null])
        expect(of("SetMeshSplatTriplanar")).toEqual([["SetMeshSplatTriplanar", model.id, 0, 4, 0, 0]])
        const order = calls.map((c) => c[0]).filter((n) => n === "SetMeshSplat" || n === "SetMeshSplatTriplanar" || n === "SetMesh")
        expect(order).toEqual(["SetMeshSplat", "SetMeshSplatTriplanar", "SetMesh"])
        s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass, dirt], weights: new Float32Array(8) } })
        expect(of("SetMeshSplatTriplanar"), "a splat with none never asks").toHaveLength(1)
        for (const bad of [0, -2, Infinity, Number.NaN, "4" as any, undefined as any]) {
            expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [{ picture: rock, triplanar: bad }], weights: [1, 1, 1, 1] } })).toThrow(`scene.mesh splat layer 0: triplanar is ${bad}, the metres one repeat`)
        }
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [{ picture: null as any, triplanar: 4 }], weights: [1, 1, 1, 1] } })).toThrow("scene.mesh splat layer 0 picture is a null")
    })

    it("fades a splat past 60 m and varies it by 0.15 unless the cart says otherwise, after the splat and before the vertices", () => {
        const s = scene()
        const model = s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass, { picture: rock, triplanar: 8 }], weights: new Float32Array(8) } })
        expect(of("SetMeshSplatFar")).toEqual([["SetMeshSplatFar", model.id, 60, 0.15]])
        const order = calls.map((c) => c[0]).filter((n) => n === "SetMeshSplat" || n === "SetMeshSplatTriplanar" || n === "SetMeshSplatFar" || n === "SetMesh")
        expect(order).toEqual(["SetMeshSplat", "SetMeshSplatTriplanar", "SetMeshSplatFar", "SetMesh"])
        const other = s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1], fadeDistance: 0, variation: 0 } })
        expect(of("SetMeshSplatFar")[1]).toEqual(["SetMeshSplatFar", other.id, 0, 0])
        for (const bad of [-1, Infinity, Number.NaN, "60" as any]) {
            expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1], fadeDistance: bad } })).toThrow(`scene.mesh splat: fadeDistance is ${bad}`)
        }
        for (const bad of [-0.1, 1.5, Number.NaN, "0.2" as any]) {
            expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1], variation: bad } })).toThrow(`scene.mesh splat: variation is ${bad}`)
        }
        expect(of("CreateMesh"), "a refusal makes nothing").toHaveLength(2)
        paintAnswer = "variation is 2: from 0 to 1"
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1] } })).toThrow("[oj] scene.mesh splat: variation is 2: from 0 to 1")
    })

    it("draws a splat on a OneJS that cannot fade one as it always has, and refuses fadeDistance or variation asked for by name", () => {
        const older = recorder()
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: new Proxy({}, { get: (_t, name: string) => name === "SetMeshSplatFar" ? undefined : older[name] }) } } }
        const s = scene()
        s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1] } })
        expect(of("CreateMesh")).toHaveLength(1)
        expect(of("SetMeshSplatFar")).toHaveLength(0)
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1], fadeDistance: 80 } })).toThrow("fadeDistance and variation need a newer OneJS")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1], variation: 0 } })).toThrow("fadeDistance and variation need a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(1)
    })

    it("needs a OneJS that can project a layer, and says so, while a splat without one still paints", () => {
        const older = recorder()
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: new Proxy({}, { get: (_t, name: string) => name === "SetMeshSplatTriplanar" ? undefined : older[name] }) } } }
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [{ picture: rock, triplanar: 4 }], weights: [1, 1, 1, 1] } })).toThrow("scene.mesh splat triplanar needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
        s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [rock], weights: [1, 1, 1, 1] } })
        expect(of("CreateMesh")).toHaveLength(1)
    })

    it("refuses what it cannot draw before asking the bridge, and says why", () => {
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, texture: grass })).toThrow("[oj] scene.mesh texture: a texture is read at the mesh's uvs, and it has none")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: grass, splat: { layers: [grass], weights: [1, 1, 1, 1] } })).toThrow("give texture or splat, not both")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, tiling: 4 })).toThrow("tiling repeats a texture, and this mesh has none")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: grass, tiling: 0 })).toThrow("scene.mesh tiling is 0")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: grass, tiling: [1] as any })).toThrow("give a number above 0, or [u, v]")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: null as any })).toThrow("scene.mesh texture is a null")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: grass }, { depthOnly: true })).toThrow("a depthOnly mesh draws no colour")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass, dirt, rock, grass, dirt], weights: [] } })).toThrow("layers are one to four pictures from loadTexture, and these are 5")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass] } as any })).toThrow("weights are required, 1 a vertex")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1], heightBlend: 2 } })).toThrow("heightBlend is 2")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, tiling: 2, splat: { layers: [grass], weights: [1, 1, 1, 1] } })).toThrow("a splat's tiling goes inside it")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass, dirt], weights: [1, 1, 1] } })).toThrow("weights has 3 numbers, which is not 2 a vertex")
        expect(of("CreateMesh"), "every refusal but the last came before a model was made").toHaveLength(1)
        expect(of("Unload")).toHaveLength(1)
        const plain = s.mesh({ ...SQUARE, uvs: UVS })
        expect(() => plain.set({ positions: SQUARE.positions, weights: [1, 1, 1, 1] })).toThrow("[oj] mesh.set: weights paint a splat, and this mesh was made without one")
    })

    it("says what the bridge found wrong, and frees the model", () => {
        const s = scene()
        paintAnswer = "layer 0 has no pixels"
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1] } })).toThrow("[oj] scene.mesh splat: layer 0 has no pixels")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: grass })).toThrow("[oj] scene.mesh texture: layer 0 has no pixels")
        expect(of("Unload")).toHaveLength(2)
        expect(of("SetMesh")).toHaveLength(0)
    })

    it("needs a OneJS that can paint a mesh, and says so", () => {
        const older = recorder()
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: new Proxy({}, { get: (_t, name: string) => name === "SetMeshTexture" || name === "SetMeshSplat" ? undefined : older[name] }) } } }
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: grass })).toThrow("scene.mesh texture needs a newer OneJS")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [grass], weights: [1, 1, 1, 1] } })).toThrow("scene.mesh splat needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
        s.mesh({ ...SQUARE, uvs: UVS })
        expect(of("CreateMesh"), "a mesh without either still draws on it").toHaveLength(1)
    })
})
