/**
 * A mesh's surface as the calls it makes on OneJS's ModelBridge (tested in
 * OneJS's MeshMaterialEditModeTests and MeshDepthFadeEditModeTests):
 * `scene.mesh({ roughness, metallic, soften, deepColor, normalMap })`, a texture's `frames`, and `mesh.color`,
 * `mesh.roughness` and `mesh.metallic` after it is made.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createScene } from "../models"
import { createRuntime } from "../runtime"

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
                if (name === "SetMeshSurface" || name === "SetMeshColor" || name === "SetMeshDepthFade" || name === "SetMeshNormalMap" || name === "SetWaterline" || name === "SetMeshTexture" || name === "SetMeshFlipbook" || name === "SetMeshFlipbookFrame") return answer
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

const WATER = { ...SQUARE, color: "#2e7fa8a0" }

describe("scene.mesh soften and deepColor", () => {
    it("ask for nothing when neither is given", () => {
        scene().mesh(WATER)
        expect(of("SetMeshDepthFade")).toHaveLength(0)
    })

    it("are sent together before the vertices, the deep colour in sRGB, each 0 when left out", () => {
        const s = scene()
        const lake = s.mesh({ ...WATER, soften: 0.6, deepColor: { color: "#ff0000", metres: 5 } })
        expect(of("SetMeshDepthFade")).toEqual([["SetMeshDepthFade", lake.id, 0.6, 1, 0, 0, 1, 5]])
        expect(order("CreateMesh", "SetMeshDepthFade", "SetMesh")).toEqual(["CreateMesh", "SetMeshDepthFade", "SetMesh"])
        const mist = s.mesh({ ...WATER, soften: 2 })
        expect(of("SetMeshDepthFade")[1]).toEqual(["SetMeshDepthFade", mist.id, 2, 0, 0, 0, 0, 0])
        const deep = s.mesh({ ...WATER, deepColor: { color: "#00000080", metres: 3 } })
        const [, , soften, r, g, b, a, metres] = of("SetMeshDepthFade")[2]!
        expect([soften, r, g, b, metres]).toEqual([0, 0, 0, 0, 3])
        expect(a).toBeCloseTo(128 / 255, 5)
        expect(deep.id).toBeGreaterThan(0)
    })

    it("are refused on a mesh that draws opaque, before making anything", () => {
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, soften: 1 })).toThrow("scene.mesh: soften fades a see-through mesh by what is behind it, and this one draws opaque (its color's alpha is 1)")
        expect(() => s.mesh({ ...SQUARE, color: "#ffffff", deepColor: { color: "#000000", metres: 1 } })).toThrow("scene.mesh: deepColor fades a see-through mesh")
        expect(() => s.mesh({ ...WATER, soften: 1, cutout: 0.5 })).toThrow("scene.mesh: soften fades a see-through mesh by what is behind it, and a cutout draws it opaque")
        expect(() => s.mesh({ ...WATER, soften: 1 }, { depthOnly: true })).toThrow("scene.mesh: soften fades a see-through mesh by what is behind it, and a depthOnly mesh draws no colour")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("are refused outside their range, before making anything", () => {
        const s = scene()
        for (const bad of [-1, Number.NaN, Infinity, "1" as any]) {
            expect(() => s.mesh({ ...WATER, soften: bad })).toThrow(`scene.mesh: soften is ${bad}, and is metres from 0`)
            expect(() => s.mesh({ ...WATER, deepColor: { color: "#000000", metres: bad } })).toThrow(`scene.mesh: deepColor's metres is ${bad}, and is metres above 0`)
        }
        expect(() => s.mesh({ ...WATER, deepColor: { color: "#000000", metres: 0 } })).toThrow("scene.mesh: deepColor's metres is 0, and is metres above 0")
        expect(() => s.mesh({ ...WATER, deepColor: { metres: 1 } as any })).toThrow("scene.mesh deepColor color")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("say what the bridge refused, and keep nothing", () => {
        const s = scene()
        answer = "this project's render pipeline is not URP, and OneJS fades a mesh by the depth behind it on URP alone"
        expect(() => s.mesh({ ...WATER, soften: 1 })).toThrow("[oj] scene.mesh soften: this project's render pipeline is not URP")
        expect(of("Unload")).toHaveLength(1)
    })

    it("need a OneJS that has them", () => {
        missing = new Set(["SetMeshDepthFade"])
        const s = scene()
        expect(() => s.mesh({ ...WATER, soften: 1 })).toThrow("scene.mesh soften needs a newer OneJS")
        expect(() => s.mesh({ ...WATER, deepColor: { color: "#000000", metres: 1 } })).toThrow("scene.mesh deepColor needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
    })
})

const UVS = [0, 0, 0, 1, 1, 1, 1, 0]
const waves = { width: 4, height: 4 } as any

describe("scene.mesh normalMap", () => {
    it("asks for nothing when not given", () => {
        scene().mesh({ ...SQUARE, uvs: UVS })
        expect(of("SetMeshNormalMap")).toHaveLength(0)
    })

    it("is sent before the vertices with its tiling, scale and flow, each at its default when left out", () => {
        const s = scene()
        const sea = s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves, tiling: 0.25, scale: 0.6, flow: [0.03, 0.01] } })
        expect(of("SetMeshNormalMap")).toEqual([["SetMeshNormalMap", sea.id, waves, 0.25, 0.25, 0.6, 0.03, 0.01]])
        expect(order("CreateMesh", "SetMeshNormalMap", "SetMesh")).toEqual(["CreateMesh", "SetMeshNormalMap", "SetMesh"])
        const road = s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves, tiling: [2, 4] } })
        expect(of("SetMeshNormalMap")[1]).toEqual(["SetMeshNormalMap", road.id, waves, 2, 4, 1, 0, 0])
        s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves } })
        expect(of("SetMeshNormalMap")[2]!.slice(2)).toEqual([waves, 1, 1, 1, 0, 0])
    })

    describe("its clock", () => {
        let host: ReturnType<typeof createRuntime>
        beforeEach(() => { host = createRuntime({ root: {}, version: "0.0.0" }) })
        afterEach(() => host.dispose())

        it("runs by the scene's frames once a normal map flows, and not for one that stands still", () => {
            const s = scene()
            s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves } })
            host.beginFrame(0.5)
            expect(of("SetWindClock"), "a normal map that stands still needs no clock").toHaveLength(0)
            s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves, flow: [0.03, 0] } })
            host.beginFrame(0.25)
            host.beginFrame(0.25)
            expect(of("SetWindClock").map((c) => c[1])).toEqual([0.25, 0.5])
        })
    })

    it("is refused before anything is made without uvs, on a splat, or outside its range", () => {
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, normalMap: { picture: waves } })).toThrow("scene.mesh normalMap: a normal map is read at the mesh's uvs, and it has none")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, splat: { layers: [waves], weights: [1, 1, 1, 1] }, normalMap: { picture: waves } })).toThrow("scene.mesh normalMap: a splat is lit by its vertex normals, and takes no normal map")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves, scale: Number.NaN } })).toThrow("scene.mesh normalMap: scale is NaN, and is a number")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves, flow: [1] as any } })).toThrow("scene.mesh normalMap: flow is [u, v], uvs a second")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves, tiling: 0 } })).toThrow("scene.mesh normalMap tiling")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, normalMap: {} as any })).toThrow("scene.mesh normalMap picture")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("says what the bridge refused, and keeps nothing", () => {
        const s = scene()
        answer = "this project's render pipeline is not URP, and OneJS draws a mesh's normal map on URP alone"
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves } })).toThrow("[oj] scene.mesh normalMap: this project's render pipeline is not URP")
        expect(of("Unload")).toHaveLength(1)
    })

    it("needs a OneJS that has it", () => {
        missing = new Set(["SetMeshNormalMap"])
        expect(() => scene().mesh({ ...SQUARE, uvs: UVS, normalMap: { picture: waves } })).toThrow("scene.mesh normalMap needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
    })
})

describe("scene.mesh texture frames", () => {
    const a = { width: 4, height: 4, name: "a" } as any, b = { width: 4, height: 4, name: "b" } as any, c = { width: 8, height: 8, name: "c" } as any

    it("starts the flipbook with its count, seconds and tiling, then gives each frame in order, before the vertices", () => {
        const pool = scene().mesh({ ...SQUARE, uvs: UVS, tiling: 1 / 16, texture: { frames: [a, b, c], seconds: 2 } })
        expect(of("SetMeshTexture")).toHaveLength(0)
        expect(of("SetMeshFlipbook")).toEqual([["SetMeshFlipbook", pool.id, 3, 2, 1 / 16, 1 / 16]])
        expect(of("SetMeshFlipbookFrame")).toEqual([["SetMeshFlipbookFrame", pool.id, 0, a], ["SetMeshFlipbookFrame", pool.id, 1, b], ["SetMeshFlipbookFrame", pool.id, 2, c]])
        expect(order("CreateMesh", "SetMeshFlipbook", "SetMeshFlipbookFrame", "SetMesh")).toEqual(["CreateMesh", "SetMeshFlipbook", "SetMeshFlipbookFrame", "SetMeshFlipbookFrame", "SetMeshFlipbookFrame", "SetMesh"])
    })

    it("is refused before anything is made without uvs, with a splat, with fewer than two frames or no seconds", () => {
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, texture: { frames: [a, b], seconds: 2 } })).toThrow("scene.mesh texture: a texture is read at the mesh's uvs")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: { frames: [a, b], seconds: 2 }, splat: { layers: [a], weights: [1, 1, 1, 1] } })).toThrow("give texture or splat, not both")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: { frames: [a], seconds: 2 } })).toThrow("frames are 2 to 256 pictures, and these are 1")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: { frames: [a, null as any], seconds: 2 } })).toThrow("scene.mesh texture frame 1 is a null")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, texture: { frames: [a, b], seconds: 0 } })).toThrow("seconds is 0, how long one time through the frames takes, above 0")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("says what the bridge refused, and keeps nothing", () => {
        answer = "no"
        expect(() => scene().mesh({ ...SQUARE, uvs: UVS, texture: { frames: [a, b], seconds: 2 } })).toThrow("[oj] scene.mesh texture: no")
        expect(of("SetMeshFlipbookFrame"), "no frame after a refused start").toHaveLength(0)
        expect(of("Unload")).toHaveLength(1)
    })

    it("needs a OneJS that has it", () => {
        missing = new Set(["SetMeshFlipbook"])
        expect(() => scene().mesh({ ...SQUARE, uvs: UVS, texture: { frames: [a, b], seconds: 2 } })).toThrow("scene.mesh texture frames need a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    describe("its clock", () => {
        let host: ReturnType<typeof createRuntime>
        beforeEach(() => { host = createRuntime({ root: {}, version: "0.0.0" }) })
        afterEach(() => host.dispose())

        it("runs by the scene's frames once a mesh plays a flipbook", () => {
            const s = scene()
            s.mesh({ ...SQUARE, uvs: UVS, texture: a })
            host.beginFrame(0.5)
            expect(of("SetWindClock"), "a still texture needs no clock").toHaveLength(0)
            s.mesh({ ...SQUARE, uvs: UVS, texture: { frames: [a, b], seconds: 2 } })
            host.beginFrame(0.25)
            expect(of("SetWindClock").map((c) => c[1])).toEqual([0.25])
        })
    })
})

describe("scene.waterline", () => {
    it("sends its height, colour and strength, 0.5 unless given, and a later call naming only y keeps the rest", () => {
        const s = scene()
        s.waterline({ y: 1.3, color: "#ff0000" })
        s.waterline({ y: 1.8 })
        expect(of("SetWaterline")).toEqual([["SetWaterline", true, 1.3, 1, 0, 0, 0.5], ["SetWaterline", true, 1.8, 1, 0, 0, 0.5]])
    })

    it("false takes it away, and the next call starts afresh", () => {
        const s = scene()
        s.waterline({ y: 1, color: "#ffffff", strength: 1 })
        s.waterline(false)
        expect(of("SetWaterline")[1]).toEqual(["SetWaterline", false, 0, 0, 0, 0, 0])
        expect(() => s.waterline({ y: 2 })).toThrow("scene.waterline: give the colour below it, color")
    })

    it("is refused without a height, outside its strength, or on a host without it, sending nothing", () => {
        const s = scene()
        expect(() => s.waterline({ color: "#ffffff" })).toThrow("scene.waterline: y is undefined")
        expect(() => s.waterline({ y: 1, color: "#ffffff", strength: 2 })).toThrow("strength is 2, and runs from 0 to 1")
        missing = new Set(["SetWaterline"])
        expect(() => s.waterline({ y: 1, color: "#ffffff" })).toThrow("scene.waterline needs a newer OneJS")
        expect(of("SetWaterline")).toHaveLength(0)
    })

    it("says what the bridge refused, and keeps nothing", () => {
        const s = scene()
        answer = "no"
        expect(() => s.waterline({ y: 1, color: "#ffffff" })).toThrow("[oj] scene.waterline: no")
        answer = ""
        expect(() => s.waterline({ y: 2 })).toThrow("give the colour below it")
    })
})
