/**
 * What foliage asks of the scene, as the calls it makes on OneJS's
 * ModelBridge (tested in OneJS's MeshLookEditModeTests and
 * ScatterLookEditModeTests): `scene.mesh`'s cutout, twoSided, unlit, blend and sway, a
 * scatter's tint, tilt and range, and `scene.wind`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createScene, SCENE_DEFAULTS } from "../models"
import { createRuntime } from "../runtime"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
// What the look's setters answer: "" took it, anything else is what was wrong.
let lookAnswer: string
// Bridge methods this host does not have, as an older OneJS would not.
let missing: Set<string>

function recorder(): any {
    let next = 40
    return new Proxy({}, {
        get(_t, name: string) {
            if (missing.has(name)) return undefined
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "Scatter" || name === "ScatterWith" || name === "CreateMesh" || name === "Spawn") return ++next
                if (name === "SetMesh") return ""
                if (name === "SetMeshCutout" || name === "SetMeshTwoSided" || name === "SetMeshUnlit" || name === "SetMeshAdditive" || name === "SetMeshDepthFade" || name === "SetMeshSway" || name === "SetMeshSwayLayers" || name === "SetMeshTexture") return lookAnswer
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
    lookAnswer = ""
    missing = new Set()
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: recorder() } } }
})

afterEach(() => {
    dispose?.()
    dispose = undefined
    ;(globalThis as any).CS = savedCS
})

function scene(options = {}) {
    const made = createScene(options)
    dispose = made.dispose
    return made.scene
}

const SQUARE = { positions: [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0], indices: [0, 1, 2, 0, 2, 3] }
const UVS = [0, 0, 0, 1, 1, 1, 1, 0]
const picture = { width: 4, height: 4 } as any

describe("scene.mesh cutout and twoSided", () => {
    it("are set after the picture and before the vertices, only when asked", () => {
        const s = scene()
        s.mesh(SQUARE)
        expect(of("SetMeshCutout")).toHaveLength(0)
        expect(of("SetMeshTwoSided")).toHaveLength(0)
        const card = s.mesh({ ...SQUARE, uvs: UVS, texture: picture, cutout: 0.5, twoSided: true })
        expect(of("SetMeshCutout")).toEqual([["SetMeshCutout", card.id, 0.5]])
        expect(of("SetMeshTwoSided")).toEqual([["SetMeshTwoSided", card.id]])
        expect(order("SetMeshTexture", "SetMeshCutout", "SetMeshTwoSided", "SetMesh").slice(-4)).toEqual(["SetMeshTexture", "SetMeshCutout", "SetMeshTwoSided", "SetMesh"])
        s.mesh({ ...SQUARE, twoSided: false })
        expect(of("SetMeshTwoSided"), "false asks for nothing").toHaveLength(1)
    })

    it("refuses what it cannot draw before making anything", () => {
        const s = scene()
        for (const bad of [-0.1, 1.5, Number.NaN, "0.5" as any]) {
            expect(() => s.mesh({ ...SQUARE, cutout: bad })).toThrow(`scene.mesh: cutout is ${bad}, and runs from 0 to 1`)
        }
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, cutout: 0.5, splat: { layers: [picture], weights: [1, 1, 1, 1] } })).toThrow("a splat has no alpha to cut out")
        expect(() => s.mesh({ ...SQUARE, twoSided: "yes" as any })).toThrow("twoSided is yes, and is true or false")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("says what the bridge refused, and keeps nothing", () => {
        const s = scene()
        lookAnswer = "this host draws models with a renderer OneJS's ModelLit has no pass for (HDRP)"
        expect(() => s.mesh({ ...SQUARE, cutout: 0.5 })).toThrow("[oj] scene.mesh cutout: this host draws models with a renderer")
        expect(of("Unload")).toHaveLength(1)
    })

    it("needs a OneJS that has them, and says so before making anything", () => {
        missing = new Set(["SetMeshCutout", "SetMeshTwoSided", "SetMeshSway"])
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, cutout: 0.5 })).toThrow("scene.mesh cutout needs a newer OneJS")
        expect(() => s.mesh({ ...SQUARE, twoSided: true })).toThrow("scene.mesh twoSided needs a newer OneJS")
        expect(() => s.mesh({ ...SQUARE, sway: [0, 1, 1, 0] })).toThrow("scene.mesh sway needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
        s.mesh(SQUARE)
        expect(of("CreateMesh"), "a mesh without them is made as ever").toHaveLength(1)
    })
})

describe("scene.mesh unlit and blend", () => {
    it("are set before the vertices, only when asked, the blend before a fade", () => {
        const s = scene()
        s.mesh({ ...SQUARE, unlit: false, blend: "alpha" })
        expect(of("SetMeshUnlit")).toHaveLength(0)
        expect(of("SetMeshAdditive")).toHaveLength(0)
        const glow = s.mesh({ ...SQUARE, unlit: true, blend: "add", soften: 0.5 })
        expect(of("SetMeshUnlit")).toEqual([["SetMeshUnlit", glow.id]])
        expect(of("SetMeshAdditive")).toEqual([["SetMeshAdditive", glow.id]])
        expect(order("SetMeshUnlit", "SetMeshAdditive", "SetMeshDepthFade", "SetMesh").slice(-4)).toEqual(["SetMeshUnlit", "SetMeshAdditive", "SetMeshDepthFade", "SetMesh"])
    })

    it("refuses what it cannot draw before making anything", () => {
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, unlit: "yes" as any })).toThrow("unlit is yes, and is true or false")
        expect(() => s.mesh({ ...SQUARE, blend: "screen" as any })).toThrow(`blend is "screen", and is "alpha" or "add"`)
        expect(() => s.mesh({ ...SQUARE, blend: "add", cutout: 0.5 })).toThrow("a cutout draws it opaque")
        expect(() => s.mesh({ ...SQUARE, blend: "add" }, { depthOnly: true })).toThrow("a depthOnly mesh draws no colour")
        expect(() => s.mesh({ ...SQUARE, unlit: true }, { depthOnly: true })).toThrow("a depthOnly mesh draws no colour")
        expect(() => s.mesh({ ...SQUARE, uvs: UVS, blend: "add", splat: { layers: [picture], weights: [1, 1, 1, 1] } })).toThrow("a splat is ground")
        expect(() => s.mesh({ ...SQUARE, soften: 0.5 }), "an opaque alpha blend still has nothing to fade").toThrow("its color's alpha is 1")
        expect(of("CreateMesh")).toHaveLength(0)
    })

    it("says what the bridge refused, and keeps nothing", () => {
        const s = scene()
        lookAnswer = "a splat's ground cannot be added to what is behind it"
        expect(() => s.mesh({ ...SQUARE, blend: "add" })).toThrow("[oj] scene.mesh blend: a splat's ground")
        expect(of("Unload")).toHaveLength(1)
    })

    it("needs a OneJS that has them, and says so before making anything", () => {
        missing = new Set(["SetMeshUnlit", "SetMeshAdditive"])
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, unlit: true })).toThrow("scene.mesh unlit needs a newer OneJS")
        expect(() => s.mesh({ ...SQUARE, blend: "add" })).toThrow(`scene.mesh blend "add" needs a newer OneJS`)
        expect(of("CreateMesh")).toHaveLength(0)
        s.mesh({ ...SQUARE, blend: "alpha" })
        expect(of("CreateMesh"), "the default blend asks for nothing").toHaveLength(1)
    })
})

describe("scene.mesh sway", () => {
    it("adds its stream before the vertices, and every set carries it last", () => {
        const s = scene()
        const tree = s.mesh({ ...SQUARE, sway: [0, 1, 1, 0] })
        expect(of("SetMeshSway")).toEqual([["SetMeshSway", tree.id]])
        expect(order("SetMeshSway", "SetMesh")).toEqual(["SetMeshSway", "SetMesh"])
        const set = of("SetMesh")[0]!
        expect(set).toHaveLength(9)
        expect(set[7], "no splat's weights").toBeNull()
        expect(Array.from(set[8] as Float32Array)).toEqual([0, 1, 1, 0])
        tree.set({ positions: SQUARE.positions })
        expect(of("SetMesh")[1]![8], "left out, it stays").toBeNull()
        tree.set({ positions: SQUARE.positions, sway: new Float32Array([0, 2, 2, 0]) })
        expect(Array.from(of("SetMesh")[2]![8] as Float32Array)).toEqual([0, 2, 2, 0])
    })

    it("is refused by a mesh made without it", () => {
        const s = scene()
        const rock = s.mesh(SQUARE)
        expect(() => rock.set({ positions: SQUARE.positions, sway: [0, 1, 1, 0] })).toThrow("mesh.set: sway moves a mesh made with it, and this one was made without")
        expect(of("SetMesh")[0], "and a mesh without it sends six arguments, as every OneJS takes").toHaveLength(7)
    })
})

describe("scene.mesh sway in layers", () => {
    it("asks for layers before the vertices, and sends trunk, limb, leaf and phase four a vertex, 0 where left out", () => {
        const s = scene()
        const tree = s.mesh({ ...SQUARE, sway: { trunk: [0, 1, 1, 0], leaf: [0, 0.2, 0.3, 0], phase: [0.5, 0.5, 0.5, 0.5], leafPhase: [0.25, 0.25, 0.25, 0.25] } })
        expect(of("SetMeshSwayLayers")).toEqual([["SetMeshSwayLayers", tree.id]])
        expect(of("SetMeshSway"), "not the plain sway").toHaveLength(0)
        expect(order("SetMeshSwayLayers", "SetMesh")).toEqual(["SetMeshSwayLayers", "SetMesh"])
        expect(Array.from(of("SetMesh")[0]![8] as Float32Array)).toEqual([0, 0, 0, 128.25, 1, 0, 0.2, 128.25, 1, 0, 0.3, 128.25, 0, 0, 0, 128.25].map(Math.fround))
        tree.set({ positions: SQUARE.positions })
        expect(of("SetMesh")[1]![8], "left out, it stays").toBeNull()
        tree.set({ positions: SQUARE.positions, sway: { limb: [1, 1, 1, 1] } })
        expect(Array.from(of("SetMesh")[2]![8] as Float32Array)).toEqual([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0])
    })

    it("packs both phases in the fourth: the limb's in 256ths of a turn, whole, and the card's as the fraction", () => {
        const s = scene()
        s.mesh({ ...SQUARE, sway: { phase: [0, 0.25, 1, 1.75], leafPhase: [0.5, 0, 1.25, 0.9999] } })
        expect(Array.from(of("SetMesh")[0]![8] as Float32Array).filter((_, i) => i % 4 === 3)).toEqual([0.5, 64, 0.25, 192.999].map(Math.fround))
    })

    it("keeps the form a mesh was made with", () => {
        const s = scene()
        const layered = s.mesh({ ...SQUARE, sway: { trunk: [0, 1, 1, 0] } })
        expect(() => layered.set({ positions: SQUARE.positions, sway: [0, 1, 1, 0] })).toThrow("this mesh was made with sway in layers, and takes it that way")
        const plain = s.mesh({ ...SQUARE, sway: [0, 1, 1, 0] })
        expect(() => plain.set({ positions: SQUARE.positions, sway: { trunk: [0, 1, 1, 0] } })).toThrow("made with sway as one number a vertex")
    })

    it("refuses a layer it does not know, one the wrong length, or none, before making anything", () => {
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, sway: { trunk: [0, 1, 1, 0], branch: [0, 1, 1, 0] } as any })).toThrow("sway has branch, and its layers are trunk, limb, leaf, phase and leafPhase")
        expect(() => s.mesh({ ...SQUARE, sway: { limb: [0, 1] } })).toThrow("sway.limb has 2 numbers for 4 vertices")
        expect(() => s.mesh({ ...SQUARE, sway: {} })).toThrow("sway in layers names none")
        expect(of("SetMesh")).toHaveLength(0)
    })

    it("needs a OneJS that has them, and says so before making anything, while a plain sway is made as ever", () => {
        missing = new Set(["SetMeshSwayLayers"])
        const s = scene()
        expect(() => s.mesh({ ...SQUARE, sway: { trunk: [0, 1, 1, 0] } })).toThrow("scene.mesh sway in layers needs a newer OneJS")
        expect(of("CreateMesh")).toHaveLength(0)
        s.mesh({ ...SQUARE, sway: [0, 1, 1, 0] })
        expect(of("SetMeshSway")).toHaveLength(1)
    })
})

describe("scene.scatter shadows and visible", () => {
    it("sends nothing more for a scatter that casts and keeps its shadows, as 1.7 drew it", () => {
        const s = scene()
        const grass = s.scatter(s.mesh(SQUARE), [{ x: 0, z: 0 }])
        expect(of("SetScatterShadows")).toHaveLength(0)
        expect(of("SetScatterVisible")).toHaveLength(0)
        expect([grass.castShadows, grass.receiveShadows, grass.visible]).toEqual([true, true, true])
    })

    it("takes castShadows and receiveShadows as spawn does, right after the scatter is made", () => {
        const s = scene()
        const far = s.scatter(s.mesh(SQUARE), [{ x: 0, z: 0 }], { castShadows: false })
        const id = of("Scatter")[0]
        expect(order("Scatter", "SetScatterShadows")).toEqual(["Scatter", "SetScatterShadows"])
        expect(of("SetScatterShadows")[0]!.slice(2)).toEqual([false, true])
        expect(id).toBeDefined()
        expect([far.castShadows, far.receiveShadows]).toEqual([false, true])
        far.receiveShadows = false
        expect(of("SetScatterShadows")[1]!.slice(2)).toEqual([false, false])
    })

    it("hides and shows a batch without making it again", () => {
        const s = scene()
        const patch = s.scatter(s.mesh(SQUARE), [{ x: 0, z: 0 }])
        patch.visible = false
        patch.visible = false
        patch.visible = true
        expect(of("SetScatterVisible").map((c) => c[2])).toEqual([false, true])
        expect(of("Scatter")).toHaveLength(1)
        patch.destroy()
        patch.visible = false
        expect(of("SetScatterVisible"), "a destroyed scatter asks nothing").toHaveLength(2)
    })

    it("says which runtime it needs on a host without them, rather than drawing what it was told not to", () => {
        missing = new Set(["SetScatterShadows", "SetScatterVisible"])
        const s = scene()
        const model = s.mesh(SQUARE)
        expect(() => s.scatter(model, [{ x: 0, z: 0 }], { castShadows: false })).toThrow("came with runtime 1.8")
        const plain = s.scatter(model, [{ x: 0, z: 0 }], { castShadows: true })
        expect(() => { plain.visible = false }).toThrow("came with runtime 1.8")
        expect(() => { plain.receiveShadows = false }).toThrow("came with runtime 1.8")
        expect([plain.receiveShadows, plain.visible], "and the scatter stays as it was").toEqual([true, true])
        expect(of("DestroyScatter"), "the refused one is not left drawing").toHaveLength(1)
    })
})

describe("scene.scatter tint, tilt and range", () => {
    it("sends ten numbers a copy when any copy is tilted or tinted, with the tint in sRGB", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        const rocks = s.scatter(model, [{ x: 1, z: 2 }, { x: 3, y: 4, z: 5, yaw: 90, pitch: 10, roll: -5, scale: 2, tint: "#ff8000" }])
        expect(of("Scatter")).toHaveLength(0)
        const [, id, data, stride, from, to, fade] = of("ScatterWith")[0]!
        expect(id).toBe(model.id)
        expect([stride, from, to, fade]).toEqual([10, 0, Infinity, 0])
        expect(Array.from(data as Float32Array).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 2, 0, 0, 0, 1, 1, 1, 1, 3, 4, 5, 90, 10, -5, 2, 1, 0.502, 0])
        expect(rocks.count).toBe(2)
    })

    it("sends a plain list five a copy through Scatter, as every OneJS takes it", () => {
        const s = scene()
        s.scatter(s.mesh(SQUARE), [{ x: 1, z: 2, yaw: 30 }])
        expect(Array.from(of("Scatter")[0]![2] as Float32Array)).toEqual([1, 0, 2, 30, 1])
        expect(of("ScatterWith")).toHaveLength(0)
    })

    it("passes a Float32Array of ten a copy through with { stride: 10 }", () => {
        const s = scene()
        const copies = new Float32Array(30)
        const forest = s.scatter(s.mesh(SQUARE), copies, { stride: 10 })
        expect(of("ScatterWith")[0]![2]).toBe(copies)
        expect(forest.count).toBe(3)
    })

    it("sends a range with five a copy, near and far meeting at an edge", () => {
        const s = scene()
        const oak = s.mesh(SQUARE), far = s.mesh(SQUARE)
        s.scatter(oak, [{ x: 0, z: 0 }], { to: 140, fade: 12 })
        s.scatter(far, [{ x: 0, z: 0 }], { from: 140, fade: 12 })
        expect(of("ScatterWith").map((c) => c.slice(3))).toEqual([[5, 0, 140, 12], [5, 140, Infinity, 12]])
    })

    it("refuses what it cannot draw before asking the bridge", () => {
        const s = scene()
        const model = s.mesh(SQUARE)
        expect(() => s.scatter(model, new Float32Array(10), { stride: 6 as any })).toThrow("stride is 6, and is 5")
        expect(() => s.scatter(model, new Float32Array(15), { stride: 10 })).toThrow("with { stride: 10 } a copy is ten numbers")
        expect(() => s.scatter(model, new Float32Array(12))).toThrow("Ten a copy, with pitch, roll and a tint, take { stride: 10 }")
        expect(() => s.scatter(model, [{ x: 0, z: 0 }], { from: -1 })).toThrow("from is -1, and is 0 or more metres")
        expect(() => s.scatter(model, [{ x: 0, z: 0 }], { from: 50, to: 50 })).toThrow("to is 50, and is further than from (50)")
        expect(() => s.scatter(model, [{ x: 0, z: 0 }], { to: 50, fade: Number.NaN })).toThrow("fade is NaN")
        expect(() => s.scatter(model, [{ x: 0, z: 0, tint: "not a colour" }])).toThrow("scatter copy 0 tint")
        expect(of("Scatter")).toHaveLength(0)
        expect(of("ScatterWith")).toHaveLength(0)
    })

    it("needs a OneJS with ScatterWith for any of them, and draws a plain scatter without", () => {
        missing = new Set(["ScatterWith"])
        const s = scene()
        const model = s.mesh(SQUARE)
        expect(() => s.scatter(model, [{ x: 0, z: 0, tint: "#808080" }])).toThrow("scene.scatter pitch, roll and tint need a newer OneJS")
        expect(() => s.scatter(model, [{ x: 0, z: 0 }], { to: 40 })).toThrow("scene.scatter from, to and fade need a newer OneJS")
        s.scatter(model, [{ x: 0, z: 0 }])
        expect(of("Scatter")).toHaveLength(1)
    })
})

describe("scene.wind", () => {
    it("starts as a breeze along +x, takes the scene's own, and changes only what it names", () => {
        scene()
        expect(of("SetWind")).toEqual([["SetWind", 1, 0, 1, 0.3]])
        expect(SCENE_DEFAULTS.wind).toEqual({ direction: [1, 0], strength: 1, gust: 0.3 })
        dispose!()
        calls = []
        const s = scene({ wind: { strength: 2 } })
        expect(of("SetWind")).toEqual([["SetWind", 1, 0, 2, 0.3]])
        s.wind({ direction: [0, -1] })
        expect(of("SetWind").at(-1)).toEqual(["SetWind", 0, -1, 2, 0.3])
    })

    it("refuses what is no wind, changing nothing", () => {
        const s = scene()
        calls = []
        expect(() => s.wind({ direction: [0, 0] })).toThrow("scene.wind: direction is [0,0]")
        expect(() => s.wind({ direction: [Number.NaN, 1] })).toThrow("scene.wind: direction")
        expect(() => s.wind({ strength: -1 })).toThrow("scene.wind: strength is -1, and is 0 or more")
        expect(() => s.wind({ gust: 2 })).toThrow("scene.wind: gust is 2, and runs from 0 to 1")
        expect(of("SetWind")).toHaveLength(0)
        s.wind({ strength: 3 })
        expect(of("SetWind")).toEqual([["SetWind", 1, 0, 3, 0.3]])
        dispose!()
        expect(() => scene({ wind: { gust: -1 } }), "a scene's own is refused before the scene is made").toThrow("scene.wind: gust is -1")
    })

    it("on an older OneJS, says so when asked for and is quiet when not", () => {
        missing = new Set(["SetWind", "SetWindClock"])
        const warned: string[] = []
        const warn = console.warn
        console.warn = (m: unknown) => { warned.push(String(m)) }
        try {
            const s = scene()
            expect(warned).toHaveLength(0)
            s.wind({ strength: 2 })
            expect(warned[0]).toContain("scene.wind needs a newer OneJS")
        } finally {
            console.warn = warn
        }
    })

    describe("its clock", () => {
        let host: ReturnType<typeof createRuntime>
        beforeEach(() => { host = createRuntime({ root: {}, version: "0.0.0" }) })
        afterEach(() => host.dispose())

        it("runs by the scene's frames once a mesh sways, and holds while the scene is paused", () => {
            const s = scene()
            host.beginFrame(0.5)
            expect(of("SetWindClock"), "nothing sways yet").toHaveLength(0)
            s.mesh({ ...SQUARE, sway: [0, 1, 1, 0] })
            host.beginFrame(0.25)
            host.beginFrame(0.25)
            expect(of("SetWindClock").map((c) => c[1])).toEqual([0.25, 0.5])
            s.paused = true
            host.beginFrame(0.25)
            expect(of("SetWindClock").at(-1)![1]).toBe(0.5)
            s.paused = false
            host.beginFrame(0.1)
            expect(of("SetWindClock").at(-1)![1]).toBeCloseTo(0.6)
        })

        it("runs at the scene's speed, so a film shot slowly sees slow wind", () => {
            const s = scene()
            s.mesh({ ...SQUARE, sway: [0, 1, 1, 0] })
            s.speed = 0.25
            host.beginFrame(1)
            expect(of("SetWindClock").at(-1)![1]).toBeCloseTo(0.25)
            s.speed = 0
            host.beginFrame(1)
            expect(of("SetWindClock").at(-1)![1]).toBeCloseTo(0.25)
        })
    })
})
