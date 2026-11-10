/**
 * A mesh's surface as the calls it makes on OneJS's ModelBridge (tested in
 * OneJS's MeshMaterialEditModeTests): `scene.mesh({ roughness, metallic })`,
 * and `mesh.color`, `mesh.roughness` and `mesh.metallic` after it is made.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createScene } from "../models"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
let answer: string
let missing: Set<string>

function recorder(): any {
    let next = 40
    return new Proxy({}, {
        get(_t, name: string) {
            if (missing.has(name)) return undefined
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "CreateMesh" || name === "Spawn") return ++next
                if (name === "SetMesh") return ""
                if (name === "SetMeshSurface" || name === "SetMeshColor") return answer
                if (name === "Height") return 1
                return undefined
            }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name)
const order = (...names: string[]) => calls.map((c) => c[0]).filter((n) => names.includes(n))

let dispose: (() => void) | undefined
beforeEach(() => {
    calls = []
    answer = ""
    missing = new Set()
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: recorder() } } }
})

afterEach(() => {
    dispose?.()
    dispose = undefined
    ;(globalThis as any).CS = savedCS
})

function scene() {
    const made = createScene({})
    dispose = made.dispose
    return made.scene
}

const SQUARE = { positions: [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0], indices: [0, 1, 2, 0, 2, 3] }

describe("scene.mesh roughness and metallic", () => {
    it("asks for nothing when neither is given, as a 1.7 cart's mesh never did", () => {
        const s = scene()
        const m = s.mesh(SQUARE)
        expect(of("SetMeshSurface")).toHaveLength(0)
        expect(m.roughness).toBe(1)
        expect(m.metallic).toBe(0)
    })

    it("are set before the vertices, the other at its default", () => {
        const s = scene()
        const sea = s.mesh({ ...SQUARE, roughness: 0.15 })
        expect(of("SetMeshSurface")).toEqual([["SetMeshSurface", sea.id, 0.15, 0]])
        expect(order("CreateMesh", "SetMeshSurface", "SetMesh")).toEqual(["CreateMesh", "SetMeshSurface", "SetMesh"])
        const crate = s.mesh({ ...SQUARE, metallic: 1 })
        expect(of("SetMeshSurface")[1]).toEqual(["SetMeshSurface", crate.id, 1, 1])
        expect([sea.roughness, sea.metallic, crate.roughness, crate.metallic]).toEqual([0.15, 0, 1, 1])
    })

    it("are refused outside 0 to 1 before making anything", () => {
        const s = scene()
        for (const bad of [-0.1, 1.5, Number.NaN, "0.5" as any]) {
            expect(() => s.mesh({ ...SQUARE, roughness: bad })).toThrow(`scene.mesh: roughness is ${bad}, and runs from 0 to 1`)
            expect(() => s.mesh({ ...SQUARE, metallic: bad })).toThrow(`scene.mesh: metallic is ${bad}, and runs from 0 to 1`)
        }
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("say what the bridge refused, and keep nothing", () => {
        const s = scene()
        answer = "this host draws models with a renderer OneJS's ModelLit has no pass for (HDRP)"
        expect(() => s.mesh({ ...SQUARE, roughness: 0.5 })).toThrow("[oj] scene.mesh roughness: this host draws models")
        expect(of("Unload")).toHaveLength(1)
    })

    it("need a OneJS that has them, and say so before making anything", () => {
        missing = new Set(["SetMeshSurface", "SetMeshColor"])
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, roughness: 0.5 })).toThrow("scene.mesh roughness needs a newer OneJS")
        expect(() => s.mesh({ ...SQUARE, metallic: 0.5 })).toThrow("scene.mesh metallic needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
        const m = s.mesh(SQUARE)
        expect(of("CreateMesh"), "a mesh without them is made as ever").toHaveLength(1)
        expect(() => { m.color = "#ff0000" }).toThrow("mesh.color needs a newer OneJS")
        expect(() => { m.roughness = 0.5 }).toThrow("mesh.roughness needs a newer OneJS")
    })
})

describe("a mesh's colour, roughness and metallic after it is made", () => {
    it("set the model's material, and read back as given", () => {
        const s = scene()
        const sea = s.mesh({ ...SQUARE, color: "#1c609ebd", roughness: 0.15 })
        expect(sea.color).toBe("#1c609ebd")
        sea.color = "#ff000080"
        const [, id, r, g, b, a] = of("SetMeshColor")[0]!
        expect(id).toBe(sea.id)
        expect([r, g, b]).toEqual([1, 0, 0])
        expect(a).toBeCloseTo(128 / 255, 5)
        expect(sea.color).toBe("#ff000080")
        sea.roughness = 0.6
        expect(of("SetMeshSurface").at(-1)).toEqual(["SetMeshSurface", sea.id, 0.6, 0])
        sea.metallic = 0.25
        expect(of("SetMeshSurface").at(-1)).toEqual(["SetMeshSurface", sea.id, 0.6, 0.25])
        expect([sea.roughness, sea.metallic]).toEqual([0.6, 0.25])
    })

    it("refuse a bad value and keep the old one", () => {
        const s = scene()
        const m = s.mesh(SQUARE)
        expect(() => { m.roughness = 2 }).toThrow("mesh.roughness is 2, and runs from 0 to 1")
        expect(() => { m.metallic = -1 }).toThrow("mesh.metallic is -1, and runs from 0 to 1")
        expect(() => { m.color = "nope" as any }).toThrow("mesh.color")
        expect([m.roughness, m.metallic, m.color]).toEqual([1, 0, "#ffffff"])
        expect(of("SetMeshSurface")).toHaveLength(0)
        expect(of("SetMeshColor")).toHaveLength(0)
        answer = "there is no mesh model 41"
        expect(() => { m.roughness = 0.5 }).toThrow("[oj] mesh.roughness: there is no mesh model 41")
        expect(m.roughness).toBe(1)
    })

    it("are refused by a mesh whose scene is gone", () => {
        const first = createScene({})
        const m = first.scene.mesh(SQUARE)
        first.dispose()
        dispose = createScene({}).dispose
        expect(() => { m.color = "#000000" }).toThrow("this mesh was made for a scene that is gone")
        expect(() => { m.roughness = 0.5 }).toThrow("this mesh was made for a scene that is gone")
    })
})
