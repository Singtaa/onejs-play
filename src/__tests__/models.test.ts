/**
 * The scene a cart builds, as the calls it makes on OneJS's ModelBridge.
 *
 * The bridge is C#; here it is a recorder, so these tests pin the contract the
 * C# side implements (OneJS Runtime/Models/ModelBridge.cs) and the defaults a
 * cart gets for writing nothing: a sun that casts soft shadows, sky and ground
 * ambient, models that cast and receive shadows. Colours cross as sRGB floats
 * from the hex a cart writes, the same convention as fx and the painter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createScene, watchModel, SCENE_DEFAULTS, type Model } from "../models"
import { createRuntime } from "../runtime"
import { setInputBackend } from "onejs-unity/input"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
let nextId: number

function recorder(): any {
    return new Proxy({}, {
        get(_t, name: string) {
            if (name === "ActorCount") return 0
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "Spawn" || name === "AddPointLight") return ++nextId
                if (name === "Pick") return 0
                if (name === "PanelPoint") return { x: 10, y: 20 }
                return undefined
            }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name)
const last = (name: string) => of(name).at(-1)!

const MODEL: Model = { id: 7, clips: ["idle"], height: 1 }

beforeEach(() => {
    calls = []
    nextId = 100
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: recorder() } } }
})

afterEach(() => {
    ;(globalThis as any).CS = savedCS
})

describe("a scene with no options", () => {
    it("begins a scene before configuring it", () => {
        createScene({})
        expect(calls[0][0]).toBe("BeginScene")
    })

    it("has a sun that casts shadows", () => {
        createScene({})
        const [, enabled, , , , , , , , shadows] = last("SetSun")
        expect(enabled).toBe(true)
        expect(shadows).toBe(true)
    })

    it("uses the documented defaults for the camera, sun, ambient and background", () => {
        createScene({})
        const d = SCENE_DEFAULTS
        expect(last("SetCamera")).toEqual(["SetCamera", ...d.camera.position, ...d.camera.lookAt, d.camera.fov])
        expect(last("SetSun").slice(2, 5)).toEqual(d.sun.direction)
        expect(last("SetSun")[8]).toBe(d.sun.intensity)
        expect(last("SetAmbient")[7]).toBe(d.ambient.intensity)
        expect(of("SetFog")).toEqual([["SetFog", false, 0, 0, 0, 0, 0]])
    })

    it("spawns models that cast and receive shadows", () => {
        const scene = createScene({}).scene
        scene.spawn(MODEL, { position: [1, 2, 3] })
        expect(last("Spawn")).toEqual(["Spawn", 7, 1, 2, 3, 0, 1, true, true])
    })
})

describe("colours", () => {
    it("cross as sRGB floats from hex", () => {
        createScene({ background: "#ff8000", sun: { color: "#00ff00" } })
        expect(last("SetBackground")).toEqual(["SetBackground", 1, 128 / 255, 0])
        expect(last("SetSun").slice(5, 8)).toEqual([0, 1, 0])
    })

    it("take the short form too", () => {
        createScene({ ambient: { sky: "#fff", ground: "#000" } })
        expect(last("SetAmbient").slice(1, 7)).toEqual([1, 1, 1, 0, 0, 0])
    })

    it("name the option a cart got wrong", () => {
        expect(() => createScene({ background: "teal" })).toThrow(/invalid color "teal"/)
    })
})

describe("opting out", () => {
    it("sun: false is a scene with no sun", () => {
        createScene({ sun: false })
        expect(last("SetSun")[1]).toBe(false)
    })

    it("sun.shadows: false keeps the sun and drops its shadows", () => {
        createScene({ sun: { shadows: false } })
        expect(last("SetSun")[1]).toBe(true)
        expect(last("SetSun")[9]).toBe(false)
    })

    it("an actor can stop casting or receiving at spawn", () => {
        const scene = createScene({}).scene
        scene.spawn(MODEL, { castShadows: false })
        expect(last("Spawn").slice(7)).toEqual([false, true])
        scene.spawn(MODEL, { receiveShadows: false })
        expect(last("Spawn").slice(7)).toEqual([true, false])
    })

    it("and later, one property at a time", () => {
        const scene = createScene({}).scene
        const a = scene.spawn(MODEL)
        a.castShadows = false
        expect(last("SetShadows")).toEqual(["SetShadows", a.id, false, true])
        a.receiveShadows = false
        expect(last("SetShadows")).toEqual(["SetShadows", a.id, false, false])
        expect(a.castShadows).toBe(false)
    })
})

describe("fog", () => {
    it("fades into the background colour unless told otherwise", () => {
        createScene({ background: "#102030", fog: { near: 5, far: 30 } })
        expect(last("SetFog")).toEqual(["SetFog", true, 16 / 255, 32 / 255, 48 / 255, 5, 30])
    })

    it("takes its own colour", () => {
        createScene({ fog: { color: "#ffffff" } })
        const [, on, r, g, b] = last("SetFog")
        expect([on, r, g, b]).toEqual([true, 1, 1, 1])
    })
})

describe("point lights", () => {
    it("are added, moved, retuned and removed through their handle", () => {
        const scene = createScene({}).scene
        const lamp = scene.pointLight({ position: [0, 2, 0], color: "#ff0000", intensity: 3, range: 6 })
        expect(last("AddPointLight")).toEqual(["AddPointLight", 0, 2, 0, 1, 0, 0, 3, 6])
        lamp.position = [1, 2, 3]
        expect(last("PlaceLight")).toEqual(["PlaceLight", lamp.id, 1, 2, 3])
        lamp.intensity = 5
        expect(last("SetLight")).toEqual(["SetLight", lamp.id, 1, 0, 0, 5, 6])
        lamp.destroy()
        expect(last("DestroyLight")).toEqual(["DestroyLight", lamp.id])
    })

    it("have defaults a cart can rely on", () => {
        const scene = createScene({}).scene
        scene.pointLight({ position: [0, 1, 0] })
        const [, , , , r, g, b, intensity, range] = last("AddPointLight")
        expect([r, g, b]).toEqual([1, 1, 1])
        expect(intensity).toBe(SCENE_DEFAULTS.pointLight.intensity)
        expect(range).toBe(SCENE_DEFAULTS.pointLight.range)
    })
})

describe("teardown", () => {
    it("disposes everything the scene made, once", () => {
        const { dispose } = createScene({})
        dispose()
        expect(of("DisposeAll")).toHaveLength(1)
    })
})

describe("a model that loads after its component is gone", () => {
    // Pressing Play or a hot reload disposes the scene mid-load, and the bridge cancels the load.
    it("is dropped without an error", async () => {
        ;(globalThis as any).CS.OneJS.Models.ModelBridge = { Load: () => Promise.reject(new Error("the scene was disposed while the model loaded")) }
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        const got = vi.fn()
        const stop = watchModel("ghost.glb", got)
        stop()
        await new Promise((r) => setTimeout(r, 0))
        expect(got).not.toHaveBeenCalled()
        expect(error).not.toHaveBeenCalled()
        error.mockRestore()
    })

    it("still says so while the component is there", async () => {
        ;(globalThis as any).CS.OneJS.Models.ModelBridge = { Load: () => Promise.reject(new Error("no such file")) }
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        watchModel("ghost.glb", () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(error).toHaveBeenCalledOnce()
        error.mockRestore()
    })
})

describe("the handles a cart holds", () => {
    // Every one of these reads like ordinary JavaScript and used to do something else.
    it("lets a cart destroy every actor in a for...of over scene.actors", () => {
        const scene = createScene({}).scene
        for (let i = 0; i < 4; i++) scene.spawn(MODEL)
        for (const a of scene.actors) a.destroy()
        expect(scene.actors).toHaveLength(0)
        expect(of("Destroy")).toHaveLength(4)
    })

    it("keeps the camera's other settings when one is changed", () => {
        const scene = createScene({ camera: { position: [0, 10, -3], lookAt: [0, 1, 0] } }).scene
        scene.camera({ fov: 30 })
        expect(last("SetCamera")).toEqual(["SetCamera", 0, 10, -3, 0, 1, 0, 30])
    })

    it("never hands out the position it moves an actor or a light by", () => {
        const scene = createScene({}).scene
        const boo = scene.spawn(MODEL, { position: [1, 2, 3] })
        try { boo.position[1] = 99 } catch { /* frozen: assigning throws in strict code */ }
        expect(boo.position).toEqual([1, 2, 3])
        const to: [number, number, number] = [4, 5, 6]
        boo.position = to
        to[0] = 0
        expect(boo.position).toEqual([4, 5, 6])

        const lamp = scene.pointLight({ position: [0, 2, 0] })
        try { lamp.position[1] = 99 } catch { /* as above */ }
        expect(lamp.position).toEqual([0, 2, 0])
    })

    it("lifts a label by the height the actor was spawned at", () => {
        const scene = createScene({}).scene
        scene.spawn({ ...MODEL, height: 2 }, { scale: 1.5 }).screenPoint()
        expect(last("PanelPoint")[3]).toBe(3)
    })

    it("keeps the defaults the same for every scene", () => {
        expect(Object.isFrozen(SCENE_DEFAULTS)).toBe(true)
        expect(Object.isFrozen(SCENE_DEFAULTS.camera.position)).toBe(true)
    })
})

describe("dissolve", () => {
    let host: ReturnType<typeof createRuntime>
    beforeEach(() => { host = createRuntime({ root: {}, version: "0.0.0" }) })
    afterEach(() => { host.dispose(); setInputBackend(null) })

    const settled = (p: Promise<void>) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 20))])

    it("turns back from where it is when interrupted, not from where it was going", async () => {
        const boo = createScene({}).scene.spawn(MODEL)
        const first = boo.dissolve(1, 1)
        host.beginFrame(0.5)
        expect(last("SetDissolve")[2]).toBeCloseTo(0.5)
        boo.dissolve(0, 1)
        expect(await settled(first)).toBe(true)
        host.beginFrame(0.1)
        expect(last("SetDissolve")[2]).toBeCloseTo(0.45)
    })

    it("settles when the actor is destroyed or the scene goes, so an await never hangs", async () => {
        const { scene, dispose } = createScene({})
        const a = scene.spawn(MODEL), b = scene.spawn(MODEL)
        const gone = a.dissolve(1)
        a.destroy()
        expect(await settled(gone)).toBe(true)
        const disposed = b.dissolve(1)
        dispose()
        expect(await settled(disposed)).toBe(true)
    })
})
