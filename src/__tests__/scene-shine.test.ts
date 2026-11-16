/**
 * Shine as the calls it makes on OneJS's ModelBridge (drawn in OneJS's
 * ShinePlayModeTests): `scene.shine`'s two pictures, `loadModel`'s and
 * `scene.mesh`'s `shine`, and `actor.shine`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createScene, loadModel } from "../models"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
let answer: string
let missing: Set<string>

function recorder(): any {
    let next = 40
    return new Proxy({}, {
        get(_t, name: string) {
            if (name === "ActorCount") return 0
            if (missing.has(name)) return undefined
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "Load") return Promise.resolve(++next)
                if (name === "CreateMesh" || name === "Spawn") return ++next
                if (name === "SetMesh") return ""
                if (name === "SetModelShine" || name === "SetMeshShine" || name === "SetActorShine") return answer
                if (name === "Clips" || name === "Joints" || name === "Parts") return ""
                if (name === "Height") return 1
                return undefined
            }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name)

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

function scene(options = {}) {
    const made = createScene(options)
    dispose = made.dispose
    return made.scene
}

const SQUARE = { positions: [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0], indices: [0, 1, 2, 0, 2, 3] }
// A picture as loadTexture gives one: an object the bridge is handed as it is.
const STREAKS = { name: "streaks" } as any, BANDS = { name: "bands" } as any

describe("scene.shine", () => {
    it("sends nothing unless given, and reads back null", () => {
        const s = scene()
        expect(of("SetShinePictures")).toHaveLength(0)
        expect(s.shine).toBeNull()
    })

    it("sends both pictures, a missing one as null, from the options and when set", () => {
        const s = scene({ shine: { add: STREAKS } })
        expect(of("SetShinePictures")).toEqual([["SetShinePictures", STREAKS, null]])
        s.shine = { add: STREAKS, multiply: BANDS }
        expect(of("SetShinePictures")[1]).toEqual(["SetShinePictures", STREAKS, BANDS])
        expect(s.shine).toEqual({ add: STREAKS, multiply: BANDS })
        s.shine = null
        expect(of("SetShinePictures")[2]).toEqual(["SetShinePictures", null, null])
        expect(s.shine).toBeNull()
    })

    it("refuses what is not a picture, and a host without shine", () => {
        const s = scene()
        expect(() => { s.shine = { add: "streaks.png" as any } }).toThrow(/scene.shine add is a string; give a picture from loadTexture/)
        missing = new Set(["SetShinePictures"])
        expect(() => { s.shine = { add: STREAKS } }).toThrow(/scene.shine needs a newer OneJS.*runtime 1\.11/)
        expect(() => { s.shine = null }, "taking shine away from a host that never had it is nothing").not.toThrow()
    })
})

describe("loadModel shine", () => {
    it("gives the model its mode and strength, 1 by default, and keys the load by them", async () => {
        scene()
        const sword = await loadModel("sword.glb", { shine: { mode: "add" } })
        expect(of("SetModelShine")).toEqual([["SetModelShine", sword.id, "add", 1]])
        const dull = await loadModel("sword.glb", { shine: { mode: "add", strength: 0.5 } })
        expect(dull.id, "another strength is another load").not.toBe(sword.id)
        expect(await loadModel("sword.glb", { shine: { mode: "add" } })).toBe(sword)
        expect(of("SetModelShine")[1]).toEqual(["SetModelShine", dull.id, "add", 0.5])
    })

    it("refuses a mode or strength it does not take before loading anything", async () => {
        scene()
        await expect(loadModel("helm.glb", { shine: { mode: "gold" as any } })).rejects.toThrow(/shine: mode is "gold", and is "add" or "multiply"/)
        await expect(loadModel("helm.glb", { shine: { mode: "multiply", strength: 2 } })).rejects.toThrow(/strength is 2, and runs from 0 to 1/)
        expect(of("Load")).toHaveLength(0)
    })

    it("lets the model go when the bridge refuses it", async () => {
        scene()
        answer = "this project draws models with glTFast's own materials, which have no shine"
        await expect(loadModel("shield.glb", { shine: { mode: "multiply" } })).rejects.toThrow(/loadModel\("shield.glb"\) shine: this project draws/)
        expect(of("Unload")).toHaveLength(1)
    })

    it("needs a OneJS with shine", async () => {
        scene()
        missing = new Set(["SetModelShine"])
        await expect(loadModel("axe.glb", { shine: { mode: "add" } })).rejects.toThrow(/loadModel shine needs a newer OneJS.*runtime 1\.11/)
    })
})

describe("scene.mesh shine", () => {
    it("is set before the vertices, and refused on a splat and outside 0 to 1", () => {
        const s = scene()
        const blade = s.mesh({ ...SQUARE, shine: { mode: "add", strength: 0.75 } })
        expect(of("SetMeshShine")).toEqual([["SetMeshShine", blade.id, "add", 0.75]])
        const order = calls.map((c) => c[0]).filter((n) => n === "SetMeshShine" || n === "SetMesh")
        expect(order).toEqual(["SetMeshShine", "SetMesh"])
        expect(() => s.mesh({ ...SQUARE, shine: { mode: "add", strength: -1 } })).toThrow(/scene.mesh shine: strength is -1/)
        expect(of("CreateMesh"), "a refused shine makes nothing").toHaveLength(1)
    })
})

describe("actor.shine", () => {
    it("is 1 unless given, sent at spawn and when set, and refused outside 0 to 1", async () => {
        const s = scene()
        const model = await loadModel("mace.glb", { shine: { mode: "add" } })
        const plain = s.spawn(model)
        expect(plain.shine).toBe(1)
        expect(of("SetActorShine")).toHaveLength(0)
        const rusty = s.spawn(model, { shine: 0.25 })
        expect(of("SetActorShine")).toEqual([["SetActorShine", rusty.id, 0.25]])
        rusty.shine = 0
        expect(rusty.shine).toBe(0)
        expect(() => { rusty.shine = 1.5 }).toThrow(/actor.shine is 1.5, and runs from 0 to 1/)
        expect(rusty.shine).toBe(0)
        missing = new Set(["SetActorShine"])
        expect(() => s.spawn(model, { shine: 0.5 })).toThrow(/actor.shine needs a newer OneJS.*runtime 1\.11/)
    })
})
