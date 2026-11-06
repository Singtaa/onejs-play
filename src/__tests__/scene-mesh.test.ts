/**
 * `scene.mesh`: a model made from arrays, as the calls it makes on OneJS's
 * ModelBridge (CreateMesh and SetMesh, tested in OneJS's MeshModelEditModeTests),
 * and as the triangles a physics world reads from it.
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

function recorder(): any {
    let next = 40
    return new Proxy({}, {
        get(_t, name: string) {
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "CreateMesh" || name === "Spawn") return ++next
                if (name === "SetMesh") return answer
                if (name === "Unload") return unloads
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
