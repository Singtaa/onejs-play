/**
 * A mesh's leaf light as the calls it makes on OneJS's ModelBridge (drawn in OneJS's
 * LeafLightEditModeTests): `scene.mesh({ wrap, translucency })`, and `mesh.wrap` and
 * `mesh.translucency` after it is made.
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
                if (name === "SetMesh" || name === "SetMeshSplat" || name === "SetMeshCutout" || name === "SetMeshTwoSided") return ""
                if (name === "SetMeshLeafLight") return answer
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
const picture = { texture: {}, width: 4, height: 4 } as any

describe("scene.mesh wrap and translucency", () => {
    it("ask for nothing when neither is given, or both are 0, as a 1.8 cart's mesh never did", () => {
        const s = scene()
        const m = s.mesh(SQUARE)
        s.mesh({ ...SQUARE, wrap: 0, translucency: 0 })
        expect(of("SetMeshLeafLight")).toHaveLength(0)
        expect([m.wrap, m.translucency]).toEqual([0, 0])
    })

    it("are set before the vertices, the other at 0", () => {
        const s = scene()
        const crown = s.mesh({ ...SQUARE, twoSided: true, cutout: 0.5, wrap: 0.5 })
        expect(of("SetMeshLeafLight")).toEqual([["SetMeshLeafLight", crown.id, 0.5, 0]])
        expect(order("CreateMesh", "SetMeshLeafLight", "SetMesh")).toEqual(["CreateMesh", "SetMeshLeafLight", "SetMesh"])
        const leaf = s.mesh({ ...SQUARE, translucency: 0.7 })
        expect(of("SetMeshLeafLight")[1]).toEqual(["SetMeshLeafLight", leaf.id, 0, 0.7])
        expect([crown.wrap, crown.translucency, leaf.wrap, leaf.translucency]).toEqual([0.5, 0, 0, 0.7])
    })

    it("are refused outside 0 to 1 before making anything", () => {
        const s = scene()
        for (const bad of [-0.1, 1.5, Number.NaN, "0.5" as any]) {
            expect(() => s.mesh({ ...SQUARE, wrap: bad })).toThrow(`scene.mesh: wrap is ${bad}, and runs from 0 to 1`)
            expect(() => s.mesh({ ...SQUARE, translucency: bad })).toThrow(`scene.mesh: translucency is ${bad}, and runs from 0 to 1`)
        }
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("are refused with a splat, which is lit by its vertex normals", () => {
        const s = scene()
        const splat = { layers: [picture], weights: [1, 1, 1, 1] }
        expect(() => s.mesh({ ...SQUARE, uvs: [0, 0, 0, 1, 1, 1, 1, 0], splat, wrap: 0.5 })).toThrow("a splat is lit by its vertex normals, and takes no wrap")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("say what the bridge refused, and keep nothing", () => {
        const s = scene()
        answer = "this host draws models with a renderer OneJS's ModelLit has no pass for (HDRP)"
        expect(() => s.mesh({ ...SQUARE, wrap: 0.5 })).toThrow("[oj] scene.mesh wrap: this host draws models")
        expect(of("Unload")).toHaveLength(1)
    })

    it("need a OneJS that has them, and say so before making anything", () => {
        missing = new Set(["SetMeshLeafLight"])
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, wrap: 0.5 })).toThrow("scene.mesh wrap needs a newer OneJS")
        expect(() => s.mesh({ ...SQUARE, translucency: 0.5 })).toThrow("scene.mesh translucency needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
        const m = s.mesh(SQUARE)
        expect(of("CreateMesh"), "a mesh without them is made as ever").toHaveLength(1)
        expect(() => { m.wrap = 0.5 }).toThrow("mesh.wrap needs a newer OneJS")
    })
})

describe("a mesh's wrap and translucency after it is made", () => {
    it("set the model's material, and read back as given", () => {
        const s = scene()
        const crown = s.mesh({ ...SQUARE, wrap: 0.3 })
        crown.translucency = 0.6
        expect(of("SetMeshLeafLight").at(-1)).toEqual(["SetMeshLeafLight", crown.id, 0.3, 0.6])
        crown.wrap = 0
        expect(of("SetMeshLeafLight").at(-1)).toEqual(["SetMeshLeafLight", crown.id, 0, 0.6])
        expect([crown.wrap, crown.translucency]).toEqual([0, 0.6])
    })

    it("refuse a bad value and keep the old one", () => {
        const s = scene()
        const m = s.mesh(SQUARE)
        expect(() => { m.wrap = 2 }).toThrow("mesh.wrap is 2, and runs from 0 to 1")
        expect(() => { m.translucency = -1 }).toThrow("mesh.translucency is -1, and runs from 0 to 1")
        expect(of("SetMeshLeafLight")).toHaveLength(0)
        answer = "there is no mesh model 41"
        expect(() => { m.wrap = 0.5 }).toThrow("[oj] mesh.wrap: there is no mesh model 41")
        expect([m.wrap, m.translucency]).toEqual([0, 0])
    })
})
