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
import { createScene as createSceneRaw, forgetModel, loadModel, watchModel, SCENE_DEFAULTS, type Model, type SceneOptions } from "../models"
import { createRuntime } from "../runtime"
import { setInputBackend } from "onejs-unity/input"
import { Color } from "../color"

// A colour mask's picture, which loadTexture would ask Unity for.
const PICTURE = { picture: "mask" }
vi.mock("onejs-unity/assets", async (actual) => ({ ...(await actual<typeof import("onejs-unity/assets")>()), loadImageAsync: async () => PICTURE }))

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
let nextId: number
// Methods this recorder stands in for an older OneJS without.
let missing: Set<string>
// Whether the recorder's host has counted a frame's draws yet.
let counted = true

function recorder(): any {
    return new Proxy({}, {
        get(_t, name: string) {
            if (name === "ActorCount") return 0
            if (missing.has(name)) return undefined
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "Load") return Promise.resolve(7)
                if (name === "Clips") return "idle"
                if (name === "Joints") return "hips\nhead"
                if (name === "Parts") return "body\nskirt"
                if (name === "Detach") return [1, 2, 3, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0.5]
                if (name === "Height") return 1
                if (name === "Spawn" || name === "AddPointLight") return ++nextId
                if (name === "Pick") return 0
                if (name === "SetSunShadows") return ""
                if (name === "PanelPoint") return { x: 10, y: 20 }
                if (name === "DrawCalls") return counted ? 42 : -1
                if (name === "SetPassCalls") return counted ? 7 : -1
                return undefined
            }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name)
const last = (name: string) => of(name).at(-1)!

let MODEL: Model

// One scene at a time, so every scene a test makes is disposed after it.
const made: (() => void)[] = []
const createScene = (options: SceneOptions = {}) => {
    const created = createSceneRaw(options)
    made.push(created.dispose)
    return created
}

beforeEach(async () => {
    calls = []
    missing = new Set()
    counted = true
    nextId = 100
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: recorder() } } }
    MODEL = await loadModel("cubes.glb")
    calls = []
})

afterEach(() => {
    for (const dispose of made.splice(0)) dispose()
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

describe("sun shadows", () => {
    // A scene a test is done with, so the next can be made.
    const lived = (options: SceneOptions) => createSceneRaw(options).dispose()

    it("are the project's own when a cart asks for nothing: every setting crosses as -1", () => {
        lived({})
        expect(last("SetSun")[9]).toBe(true)
        expect(last("SetSunShadows")).toEqual(["SetSunShadows", -1, -1, -1, -1])
        lived({ sun: { shadows: true } })
        expect(last("SetSunShadows")).toEqual(["SetSunShadows", -1, -1, -1, -1])
        lived({ sun: { shadows: {} } })
        expect(last("SetSunShadows")).toEqual(["SetSunShadows", -1, -1, -1, -1])
    })

    it("cross as metres, cascades, softness from 0 (hard) to 3 (high), and resolution, after the sun", () => {
        lived({ sun: { shadows: { distance: 150, cascades: 4, softness: "medium", resolution: 4096 } } })
        expect(last("SetSun")[9]).toBe(true)
        expect(last("SetSunShadows")).toEqual(["SetSunShadows", 150, 4, 2, 4096])
        expect(calls.findIndex((c) => c[0] === "SetSunShadows")).toBeGreaterThan(calls.findIndex((c) => c[0] === "SetSun"))
        lived({ sun: { shadows: { softness: "hard" } } })
        expect(last("SetSunShadows")).toEqual(["SetSunShadows", -1, -1, 0, -1])
        lived({ sun: { shadows: { softness: "low" } } })
        expect(last("SetSunShadows")[3]).toBe(1)
        lived({ sun: { shadows: { softness: "high" } } })
        expect(last("SetSunShadows")[3]).toBe(3)
    })

    it("follow scene.sun, and go back to the project's own when a cart stops asking", () => {
        const { scene } = createScene({ sun: { shadows: { distance: 300, cascades: 4 } } })
        scene.sun({ direction: [0, -1, 1] })
        expect(last("SetSunShadows")).toEqual(["SetSunShadows", 300, 4, -1, -1])
        scene.sun({ shadows: true })
        expect(last("SetSunShadows")).toEqual(["SetSunShadows", -1, -1, -1, -1])
    })

    it("are not asked for when the sun casts none", () => {
        lived({ sun: { shadows: false } })
        expect(last("SetSun")[9]).toBe(false)
        expect(of("SetSunShadows")).toEqual([])
    })

    it("refuse what cannot be set, naming it, before anything is made", () => {
        const bad: [unknown, RegExp][] = [
            [{ distance: 0 }, /shadows distance is 0/],
            [{ distance: Infinity }, /shadows distance is Infinity/],
            [{ cascades: 5 }, /shadows cascades is 5: 1, 2, 3 or 4/],
            [{ softness: "soft" }, /shadows softness is "soft": "hard", "low", "medium" or "high"/],
            [{ resolution: 3000 }, /shadows resolution is 3000: 1024, 2048 or 4096/],
            [{ distnace: 100 }, /sun shadows has no option "distnace"/],
            ["yes", /sun shadows is "yes"/],
        ]
        for (const [shadows, message] of bad) {
            calls = []
            expect(() => createScene({ sun: { shadows: shadows as any } })).toThrow(message)
            expect(of("CreateMesh").concat(of("SetSun"))).toEqual([])
        }
    })

    it("on a OneJS without them, a cart that asks is told, and one that does not is not", () => {
        missing.add("SetSunShadows")
        lived({ sun: { shadows: true } })
        expect(last("SetSun")[9]).toBe(true)
        expect(() => createScene({ sun: { shadows: { distance: 200 } } })).toThrow(/need a newer OneJS.*runtime 1\.7/)
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

    it("take any colour the rest of oj does: names, rgb() and a Color", () => {
        createScene({ background: "orange", sun: { color: "rgb(0, 255, 0)" }, ambient: { sky: new Color(0, 0, 1) } })
        expect(last("SetBackground")).toEqual(["SetBackground", 1, 0.647, 0])
        expect(last("SetSun").slice(5, 8)).toEqual([0, 1, 0])
        expect(last("SetAmbient").slice(1, 4)).toEqual([0, 0, 1])
    })

    it("name the option a cart got wrong", () => {
        expect(() => createScene({ background: "tael" })).toThrow(/scene background: "tael" is not a colour/)
        expect(() => createScene({ sun: { color: "#12" } })).toThrow(/sun color: "#12"/)
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

    it("is linear unless given a mode, which the host is told after SetFog with no height", () => {
        createScene({ fog: { near: 5, far: 30 } })
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "linear", 3 / 25, 0, 0])
        const order = calls.map((c) => c[0]).filter((n) => n === "SetFog" || n === "SetFogLaw")
        expect(order.slice(-2)).toEqual(["SetFog", "SetFogLaw"])
    })

    it("takes exp and exp2 with a density, or the one that is 95% whole at far", () => {
        const scene = createScene({ fog: { mode: "exp", density: 0.0017, near: 0 } }).scene
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "exp", 0.0017, 0, 0])
        scene.fog({ mode: "exp2", density: undefined, near: 100, far: 400 })
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "exp2", Math.sqrt(3) / 300, 0, 0])
        // A partial update changes what it names and never the law.
        scene.fog({ density: 0.0009 })
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "exp2", 0.0009, 0, 0])
    })

    it("takes height fog in metres, merging its parts, and false takes it away", () => {
        const scene = createScene({ fog: { mode: "exp", density: 0.0017, near: 0, height: { base: 0, thickness: 45 } } }).scene
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "exp", 0.0017, 0, 45])
        scene.fog({ height: { base: -20 } })
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "exp", 0.0017, -20, 45])
        scene.fog({ height: false })
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "exp", 0.0017, 0, 0])
        scene.fog({ mode: "exp2", height: {} })
        expect(last("SetFogLaw")).toEqual(["SetFogLaw", "exp2", 0.0017, 0, 50])
    })

    it("refuses what it cannot draw, saying why, before changing anything", () => {
        const scene = createScene({ fog: { near: 5, far: 30 } }).scene
        const before = calls.length
        expect(() => scene.fog({ height: { thickness: 45 } })).toThrow(/height needs mode "exp" or "exp2": a linear ramp has no density/)
        expect(() => scene.fog({ mode: "exp3" as any })).toThrow(/mode is "exp3": "linear", "exp" or "exp2"/)
        expect(() => scene.fog({ mode: "exp", density: -1 })).toThrow(/density is -1/)
        expect(() => scene.fog({ mode: "exp", height: { thickness: 0 } })).toThrow(/height thickness is 0/)
        expect(() => scene.fog({ mode: "exp", height: { base: NaN } })).toThrow(/height base is NaN/)
        expect(calls.length).toBe(before)
    })

    it("refuses a scene whose fog cannot be drawn, before building it", () => {
        expect(() => createScene({ fog: { height: {} } })).toThrow(/height needs mode/)
    })

    it("on an older host draws linear fog, telling a cart that asked for more once", () => {
        missing.add("SetFogLaw")
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        try {
            const scene = createScene({ fog: { near: 5, far: 30 } }).scene
            expect(warn).not.toHaveBeenCalled()
            scene.fog({ mode: "exp2", height: { thickness: 45 } })
            scene.fog({ density: 0.01 })
            expect(warn).toHaveBeenCalledTimes(1)
            expect(String(warn.mock.calls[0][0])).toMatch(/mode and height need a newer OneJS/)
            expect(last("SetFog")).toEqual(["SetFog", true, ...last("SetBackground").slice(1), 5, 30])
        } finally {
            warn.mockRestore()
        }
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

    it("sends ambient occlusion only once a cart names it: off, the host's, or an intensity and radius", () => {
        const scene = createScene({ ambient: { occlusion: false } }).scene
        expect(of("SetAmbientOcclusion")).toEqual([["SetAmbientOcclusion", false, -1, -1]])
        scene.ambient({ intensity: 0.5 })
        expect(of("SetAmbientOcclusion"), "a change that does not name it leaves it").toHaveLength(1)
        scene.ambient({ occlusion: { radius: 0.25 } })
        expect(last("SetAmbientOcclusion")).toEqual(["SetAmbientOcclusion", true, -1, 0.25])
        scene.ambient({ occlusion: true })
        expect(last("SetAmbientOcclusion")).toEqual(["SetAmbientOcclusion", true, -1, -1])
        expect(() => scene.ambient({ occlusion: { intensity: 5 } })).toThrow("intensity is 5, and runs from 0 to 4")
        expect(() => scene.ambient({ occlusion: { radius: 0 } })).toThrow("radius is 0, and is metres above 0")
        expect(() => scene.ambient({ occlusion: "off" as any })).toThrow("is true, false or { intensity, radius }")
        expect(of("SetAmbientOcclusion"), "a refused value sends nothing").toHaveLength(3)
    })

    it("leaves occlusion alone on a scene that never names it, and needs a OneJS that has it", () => {
        missing = new Set(["SetAmbientOcclusion"])
        const scene = createScene().scene
        scene.ambient({ intensity: 0.4 })
        expect(() => scene.ambient({ occlusion: false })).toThrow(/occlusion needs a newer OneJS.*runtime 1\.10/)
    })

    it("keeps the camera's other settings when one is changed", () => {
        const scene = createScene({ camera: { position: [0, 10, -3], lookAt: [0, 1, 0] } }).scene
        scene.camera({ fov: 30 })
        expect(last("SetCamera")).toEqual(["SetCamera", 0, 10, -3, 0, 1, 0, 30])
    })

    it("rolls the camera through SetCameraRolled, keeps the roll, and sends SetCamera once it is 0 again", () => {
        const scene = createScene({ camera: { position: [0, 10, -3], lookAt: [0, 1, 0] } }).scene
        scene.camera({ roll: 5 })
        expect(last("SetCameraRolled")).toEqual(["SetCameraRolled", 0, 10, -3, 0, 1, 0, 50, 5])
        scene.camera({ position: [1, 10, -3] })
        expect(last("SetCameraRolled"), "a later call keeps the roll").toEqual(["SetCameraRolled", 1, 10, -3, 0, 1, 0, 50, 5])
        calls = []
        scene.camera({ roll: 0 })
        expect(of("SetCameraRolled")).toHaveLength(0)
        expect(last("SetCamera")).toEqual(["SetCamera", 1, 10, -3, 0, 1, 0, 50])
        expect(() => scene.camera({ roll: Number.NaN })).toThrow("roll is NaN, and is degrees")
    })

    it("needs a OneJS that can roll the camera, and an unrolled one never asks", () => {
        missing = new Set(["SetCameraRolled"])
        const scene = createScene().scene
        scene.camera({ fov: 40, roll: 0 })
        expect(() => scene.camera({ roll: 10 })).toThrow(/roll needs a newer OneJS.*runtime 1\.10/)
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
        scene.spawn(MODEL, { scale: 1.5 }).screenPoint()
        expect(last("PanelPoint")[3]).toBe(1.5)
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
        const first = boo.dissolve({ to: 1, seconds: 1 })
        host.beginFrame(0.5)
        expect(last("SetDissolve")[2]).toBeCloseTo(0.5)
        boo.dissolve({ to: 0, seconds: 1 })
        expect(await settled(first)).toBe(true)
        host.beginFrame(0.1)
        expect(last("SetDissolve")[2]).toBeCloseTo(0.45)
    })

    it("settles when the actor is destroyed or the scene goes, so an await never hangs", async () => {
        const { scene, dispose } = createScene({})
        const a = scene.spawn(MODEL), b = scene.spawn(MODEL)
        const gone = a.dissolve()
        a.destroy()
        expect(await settled(gone)).toBe(true)
        const disposed = b.dissolve()
        dispose()
        expect(await settled(disposed)).toBe(true)
    })
})

describe("one scene", () => {
    it("refuses a second live scene and says what to do instead", () => {
        createScene()
        expect(() => createScene()).toThrow(/one 3D scene at a time.*Call useScene once/)
    })

    it("takes a new scene once the last one is gone", () => {
        const first = createScene()
        first.dispose()
        expect(() => createScene()).not.toThrow()
    })

    it("clears a scene a previous cart left live rather than refusing every later cart", () => {
        const old = createRuntime({ root: {}, version: "0.0.0" })
        createSceneRaw()
        old.dispose()
        const next = createRuntime({ root: {}, version: "0.0.0" })
        try {
            expect(() => createScene()).not.toThrow()
            expect(of("DisposeAll")).toHaveLength(1)
        } finally {
            next.dispose()
            setInputBackend(null)
        }
    })
})

describe("loading a model", () => {
    it("loads a file once however many ask for it", async () => {
        const [a, b] = await Promise.all([loadModel("ghost.glb"), loadModel("ghost.glb")])
        expect(a).toBe(b)
        expect(of("Load")).toHaveLength(1)
    })

    it("loads again for the next scene, since a scene takes its models with it", async () => {
        createSceneRaw().dispose()
        await loadModel("cubes.glb")
        expect(of("Load")).toHaveLength(1)
    })

    it("says so when a model outlived its scene, instead of C#'s 'no model 7'", () => {
        createSceneRaw().dispose()
        const scene = createScene().scene
        expect(() => scene.spawn(MODEL)).toThrow(/loaded for a scene that is gone/)
    })
})

describe("turning, scaling and moving", () => {
    it("turns on all three axes, and yaw alone keeps the pitch and roll", () => {
        const boo = createScene().scene.spawn(MODEL, { rotation: { yaw: 90, pitch: 10 } })
        expect(last("SetRotation")).toEqual(["SetRotation", boo.id, 90, 10, 0])
        boo.yaw = 45
        expect(last("SetRotation")).toEqual(["SetRotation", boo.id, 45, 10, 0])
        boo.rotation = { roll: 5 }
        expect(boo.rotation).toEqual({ yaw: 0, pitch: 0, roll: 5 })
    })

    it("moves without turning, so a pitch survives a move", () => {
        const boo = createScene().scene.spawn(MODEL, { rotation: { pitch: 10 } })
        boo.position = [1, 2, 3]
        expect(last("Move")).toEqual(["Move", boo.id, 1, 2, 3])
        expect(of("Place")).toHaveLength(0)
    })

    it("scales after it spawns, and labels follow the new size", () => {
        const boo = createScene().scene.spawn(MODEL)
        boo.scale = 2
        expect(last("SetScale")).toEqual(["SetScale", boo.id, 2])
        boo.screenPoint()
        expect(last("PanelPoint")[3]).toBe(2)
    })
})

describe("speed and pausing", () => {
    let host: ReturnType<typeof createRuntime>
    beforeEach(() => { host = createRuntime({ root: {}, version: "0.0.0" }) })
    afterEach(() => { host.dispose(); setInputBackend(null) })

    it("plays an actor at its own speed", () => {
        const boo = createScene().scene.spawn(MODEL, { speed: 0.25 })
        expect(last("SetSpeed")).toEqual(["SetSpeed", boo.id, 0.25])
        boo.speed = 0
        expect(last("SetSpeed")).toEqual(["SetSpeed", boo.id, 0])
    })

    it("holds every actor while paused and gives each its own speed back", () => {
        const scene = createScene().scene
        const slow = scene.spawn(MODEL, { speed: 0.5 }), normal = scene.spawn(MODEL)
        scene.paused = true
        expect(of("SetSpeed").slice(-2)).toEqual([["SetSpeed", slow.id, 0], ["SetSpeed", normal.id, 0]])
        const late = scene.spawn(MODEL)
        expect(last("SetSpeed")).toEqual(["SetSpeed", late.id, 0])
        scene.paused = false
        expect(of("SetSpeed").slice(-3)).toEqual([["SetSpeed", slow.id, 0.5], ["SetSpeed", normal.id, 1], ["SetSpeed", late.id, 1]])
        expect(slow.speed).toBe(0.5)
    })

    it("runs every actor and every dissolve at the scene's speed, on top of its own", () => {
        const scene = createScene().scene
        const slow = scene.spawn(MODEL, { speed: 0.5 }), normal = scene.spawn(MODEL)
        scene.speed = 0.5
        expect(of("SetSpeed").slice(-2)).toEqual([["SetSpeed", slow.id, 0.25], ["SetSpeed", normal.id, 0.5]])
        normal.speed = 2
        expect(last("SetSpeed")).toEqual(["SetSpeed", normal.id, 1])
        expect(scene.spawn(MODEL).speed).toBe(1)
        expect(last("SetSpeed")[2]).toBe(0.5)
        normal.dissolve({ seconds: 1 })
        host.beginFrame(0.5)
        expect(last("SetDissolve")[2]).toBeCloseTo(0.5)
        scene.paused = true
        const held = of("SetSpeed").length
        scene.speed = 1
        expect(of("SetSpeed"), "a paused scene stays held").toHaveLength(held)
        scene.paused = false
        expect(of("SetSpeed").slice(-3).map((c) => c[2])).toEqual([0.5, 2, 1])
        expect(() => { scene.speed = -1 }).toThrow("[oj] scene.speed takes a number from 0 up, and got -1")
        expect(() => { scene.speed = NaN }).toThrow(/scene\.speed/)
        expect(scene.speed).toBe(1)
    })

    it("holds a dissolve while paused, and its promise waits", async () => {
        const scene = createScene().scene
        const boo = scene.spawn(MODEL)
        let finished = false
        boo.dissolve({ seconds: 1 }).then(() => { finished = true })
        host.beginFrame(0.5)
        scene.paused = true
        host.beginFrame(5)
        expect(last("SetDissolve")[2]).toBeCloseTo(0.5)
        scene.paused = false
        host.beginFrame(0.5)
        await Promise.resolve()
        expect(finished).toBe(true)
    })

    it("fades all the way out with no options", () => {
        const boo = createScene().scene.spawn(MODEL)
        boo.dissolve()
        host.beginFrame(10)
        expect(last("SetDissolve")[2]).toBe(1)
    })
})

describe("changing the scene while it runs", () => {
    it("changes only what each call names", () => {
        const scene = createScene({ sun: { intensity: 2 } }).scene
        scene.sun({ color: "#ff0000" })
        const sun = last("SetSun")
        expect(sun[5]).toBe(1)
        expect(sun[8]).toBe(2)
        scene.ambient({ intensity: 0.2 })
        expect(last("SetAmbient")[7]).toBe(0.2)
    })

    it("puts the sun out and turns fog on and off", () => {
        const scene = createScene().scene
        scene.sun(false)
        expect(last("SetSun")[1]).toBe(false)
        scene.fog({ near: 2, far: 9 })
        expect(last("SetFog")).toEqual(["SetFog", true, ...last("SetBackground").slice(1), 2, 9])
        scene.fog(false)
        expect(last("SetFog")[1]).toBe(false)
    })

    it("takes the fog's colour along with the background unless the fog has its own", () => {
        const scene = createScene({ fog: {} }).scene
        scene.background("#ffffff")
        expect(last("SetFog").slice(2, 5)).toEqual([1, 1, 1])
    })

    it("refuses a bad colour before changing anything", () => {
        const scene = createScene().scene
        const before = calls.length
        expect(() => scene.background("tael")).toThrow(/"tael" is not a colour/)
        expect(calls.length).toBe(before)
    })
})

// oj's unload: a level's models go when the level does (ModelBridge.Unload).
describe("forgetting a model", () => {
    /** The bridge, answering Unload with `answer`, or lacking it as an older OneJS does. */
    const unloadAnswers = (answer: boolean | null) => {
        const inner = recorder()
        ;(globalThis as any).CS.OneJS.Models.ModelBridge = new Proxy({}, {
            get(_t, name: string) {
                if (name !== "Unload") return inner[name]
                return answer === null ? undefined : (id: number) => { calls.push(["Unload", id]); return answer }
            },
        })
    }

    it("frees one nothing shows, and the next ask loads it again", async () => {
        unloadAnswers(true)
        const ship = await loadModel("ship-a.glb")
        await forgetModel("ship-a.glb")
        expect(of("Unload")).toEqual([["Unload", ship.id]])
        await loadModel("ship-a.glb")
        expect(of("Load")).toHaveLength(2)
    })

    it("keeps one with a copy still in the scene, and says so", async () => {
        unloadAnswers(false)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        await loadModel("ship-b.glb")
        await forgetModel("ship-b.glb")
        expect(warn.mock.calls[0]?.[0]).toBe("[oj] ship-b.glb is still in the scene, or another model plays its clips, so it stays loaded. Unload it after its last copy and those models are gone.")
        await loadModel("ship-b.glb")
        expect(of("Load")).toHaveLength(1)
        warn.mockRestore()
    })

    it("keeps it until the scene goes on a host that cannot free one model", async () => {
        unloadAnswers(null)
        await loadModel("ship-c.glb")
        await forgetModel("ship-c.glb")
        await loadModel("ship-c.glb")
        expect(of("Load")).toHaveLength(1)
    })
})

describe("an actor's colours", () => {
    const maskedModel = () => loadModel("villager.glb", { colorMask: "villager.mask.png" })

    it("tints at spawn and after, as sRGB, and reads back what was given", () => {
        const boo = createScene().scene.spawn(MODEL, { tint: "#ff8000" })
        expect(last("SetTint").slice(1).map((v) => +(v as number).toFixed(3))).toEqual([boo.id, 1, 0.502, 0])
        boo.tint = "#ffffff"
        expect(last("SetTint")).toEqual(["SetTint", boo.id, 1, 1, 1])
        expect(boo.tint).toBe("#ffffff")
        expect(of("SetColors")).toHaveLength(0)
    })

    it("flashes at spawn and after, as sRGB, and reads back what was given", () => {
        const { scene } = createScene()
        const boo = scene.spawn(MODEL, { flash: "#ffffff" })
        expect(last("SetFlash")).toEqual(["SetFlash", boo.id, 1, 1, 1])
        boo.flash = "#000000"
        expect(last("SetFlash")).toEqual(["SetFlash", boo.id, 0, 0, 0])
        expect(boo.flash).toBe("#000000")
        expect(of("SetTint"), "a flash is no tint").toHaveLength(0)
        scene.spawn(MODEL)
        expect(of("SetFlash")).toHaveLength(2)
    })

    it("needs a OneJS that can flash an actor", () => {
        missing = new Set(["SetFlash"])
        const { scene } = createScene()
        expect(() => scene.spawn(MODEL, { flash: "#ffffff" })).toThrow(/flash needs a newer OneJS.*runtime 1\.10/)
        expect(of("Destroy"), "the refused actor is not left in the world").toHaveLength(1)
        const boo = scene.spawn(MODEL)
        expect(() => { boo.flash = "#ffffff" }).toThrow(/flash needs a newer OneJS/)
    })

    it("gives a model its mask at load, and keeps it apart from the same file without one", async () => {
        const plain = await loadModel("villager.glb")
        calls = []
        const model = await maskedModel()
        expect(model).not.toBe(plain)
        expect(last("SetColorMask")).toEqual(["SetColorMask", model.id, PICTURE])
        expect(await maskedModel()).toBe(model)
        expect(of("Load")).toHaveLength(1)
    })

    it("paints up to four colours through the mask, three floats each", async () => {
        const model = await maskedModel()
        const tom = createScene().scene.spawn(model, { colors: ["#ff0000", "#0000ff"] })
        expect(Array.from(last("SetColors")[2] as Float32Array)).toEqual([1, 0, 0, 0, 0, 1])
        tom.colors = []
        expect((last("SetColors")[2] as Float32Array).length).toBe(0)
        expect(tom.colors).toEqual([])
        expect(() => { tom.colors = ["#000", "#000", "#000", "#000", "#000"] }).toThrow(/up to four/)
    })

    it("refuses colours for a model loaded without a mask, and leaves no actor behind", () => {
        const { scene } = createScene()
        expect(() => scene.spawn(MODEL, { colors: ["#ff0000"] })).toThrow(/without a colorMask/)
        expect(of("Destroy")).toHaveLength(1)
        const boo = scene.spawn(MODEL)
        expect(() => { boo.colors = ["#ff0000"] }).toThrow(/without a colorMask/)
        expect(of("SetColors")).toHaveLength(0)
    })

    it("says what the bridge refused, and keeps the colour it had", () => {
        let refuse = false
        const bridge = (globalThis as any).CS.OneJS.Models.ModelBridge
        ;(globalThis as any).CS.OneJS.Models.ModelBridge = new Proxy(bridge, {
            get: (t, name) => name === "SetTint" && refuse ? () => "too many" : t[name as string],
        })
        const boo = createScene().scene.spawn(MODEL, { tint: "#808080" })
        refuse = true
        expect(() => { boo.tint = "#ff0000" }).toThrow("[oj] actor.tint: too many")
        expect(boo.tint).toBe("#808080")
    })

    it("needs a OneJS that can colour an actor", async () => {
        missing = new Set(["SetTint", "SetColorMask"])
        const boo = createScene().scene.spawn(MODEL)
        expect(() => { boo.tint = "#ff0000" }).toThrow(/needs a newer OneJS.*runtime 1\.9/)
        await expect(loadModel("other.glb", { colorMask: "m.png" })).rejects.toThrow(/needs a newer OneJS.*runtime 1\.9/)
    })
})

describe("an actor's own texture", () => {
    const LOOK = { picture: "look" } as any

    it("wears a texture from spawn and after, and its model's own again with null", () => {
        const { scene } = createScene()
        const tom = scene.spawn(MODEL, { texture: LOOK })
        expect(last("SetTexture")).toEqual(["SetTexture", tom.id, LOOK])
        expect(tom.texture).toBe(LOOK)
        tom.texture = null
        expect(last("SetTexture")).toEqual(["SetTexture", tom.id, null])
        expect(tom.texture).toBeNull()
        const plain = scene.spawn(MODEL)
        expect(plain.texture).toBeNull()
        expect(of("SetTexture")).toHaveLength(2)
    })

    it("refuses what is not a picture, and says what the bridge refused, leaving no actor behind", () => {
        let refuse = false
        const bridge = (globalThis as any).CS.OneJS.Models.ModelBridge
        ;(globalThis as any).CS.OneJS.Models.ModelBridge = new Proxy(bridge, {
            get: (t, name) => name === "SetTexture" && refuse ? () => "a mesh model takes its texture through scene.mesh" : t[name as string],
        })
        const { scene } = createScene()
        const tom = scene.spawn(MODEL)
        expect(() => { tom.texture = "look.png" as any }).toThrow(/actor.texture is a string; give a picture from loadTexture/)
        refuse = true
        calls = []
        expect(() => scene.spawn(MODEL, { texture: LOOK })).toThrow("[oj] actor.texture: a mesh model takes its texture through scene.mesh")
        expect(of("Destroy")).toHaveLength(1)
        expect(tom.texture).toBeNull()
    })

    it("needs a OneJS that can draw a texture on an actor", () => {
        missing = new Set(["SetTexture"])
        const tom = createScene().scene.spawn(MODEL)
        expect(() => { tom.texture = LOOK }).toThrow(/needs a newer OneJS.*runtime 1\.9/)
    })
})

describe("the last frame's draws", () => {
    it("reads the host's counts, and null until it has counted a frame", () => {
        const { scene } = createScene()
        counted = false
        expect(scene.drawCounts).toBeNull()
        counted = true
        expect(scene.drawCounts).toEqual({ draws: 42, setPasses: 7 })
    })

    it("is null, said once, on a host that counts no draws", () => {
        missing = new Set(["DrawCalls", "SetPassCalls"])
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { scene } = createScene()
        expect(scene.drawCounts).toBeNull()
        expect(scene.drawCounts).toBeNull()
        expect(warn.mock.calls.filter((c) => String(c[0]).includes("scene.drawCounts"))).toHaveLength(1)
        warn.mockRestore()
    })
})

describe("an actor on another's joint", () => {
    it("lists a model's joints, and attaches by name at the place given", () => {
        expect(MODEL.joints).toEqual(["hips", "head"])
        const { scene } = createScene()
        const tom = scene.spawn(MODEL), hat = scene.spawn(MODEL, { position: [5, 0, 5], yaw: 30, scale: 2 })
        hat.attachTo(tom, "head", { position: [0, 0.12, 0] })
        expect(last("Attach")).toEqual(["Attach", hat.id, tom.id, "head", 0, 0.12, 0, 0, 0, 0, 2])
        // Measured from the joint now: where it stood in the world is gone.
        expect(hat.position).toEqual([0, 0.12, 0])
        expect(hat.yaw).toBe(0)
        expect(hat.scale).toBe(2)
    })

    it("refuses a joint the model does not have, with the ones it has", () => {
        const { scene } = createScene()
        const tom = scene.spawn(MODEL), hat = scene.spawn(MODEL)
        expect(() => hat.attachTo(tom, "hand.R")).toThrow("hand.R is not one of that model's joints: hips, head")
        tom.destroy()
        expect(() => hat.attachTo(tom, "head")).toThrow(/not in this scene, or was destroyed/)
        expect(of("Attach")).toHaveLength(0)
    })

    it("comes off where it stood in the world, as the bridge says", () => {
        const { scene } = createScene()
        const tom = scene.spawn(MODEL), hat = scene.spawn(MODEL)
        hat.detach()
        expect(of("Detach")).toHaveLength(0)
        hat.attachTo(tom, "head")
        hat.detach()
        expect(hat.position).toEqual([1, 2, 3])
        expect(hat.yaw).toBeCloseTo(90, 4)
        expect(hat.scale).toBe(0.5)
        hat.detach()
        expect(of("Detach")).toHaveLength(1)
    })

    it("is destroyed with what carries it, unless taken off first", () => {
        const { scene } = createScene()
        const tom = scene.spawn(MODEL), hat = scene.spawn(MODEL), feather = scene.spawn(MODEL), tool = scene.spawn(MODEL)
        hat.attachTo(tom, "head")
        feather.attachTo(hat, "head")
        tool.attachTo(tom, "hips")
        tool.detach()
        calls = []
        tom.destroy()
        expect(of("Destroy").map((c) => c[1]).sort()).toEqual([tom.id, hat.id, feather.id].sort())
        expect(() => { tool.position = [0, 0, 0] }).not.toThrow()
    })

    it("sends a move kept from this frame before it attaches", () => {
        const r = createRuntime({ root: {}, version: "0.0.0" })
        made.push(() => r.dispose())
        const { scene } = createScene()
        const tom = scene.spawn(MODEL), hat = scene.spawn(MODEL)
        r.oj.onFrame(() => {
            hat.position = [9, 9, 9]
            hat.attachTo(tom, "head")
            hat.position = [0, 1, 0]
        })
        calls = []
        r.beginFrame(1 / 60)
        expect(calls.map((c) => c[0])).toEqual(["PlaceMany", "Attach", "PlaceMany"])
        expect(Array.from(of("PlaceMany")[1]![1] as Float32Array).slice(0, 4)).toEqual([hat.id, 0, 1, 0])
    })
})

describe("a model's parts", () => {
    it("are listed, hidden at spawn and shown and hidden after", () => {
        expect(MODEL.parts).toEqual(["body", "skirt"])
        const tom = createScene().scene.spawn(MODEL, { hide: ["skirt"] })
        expect(last("ShowPart")).toEqual(["ShowPart", tom.id, "skirt", false])
        tom.show("skirt")
        expect(last("ShowPart")).toEqual(["ShowPart", tom.id, "skirt", true])
        tom.hide("body")
        expect(last("ShowPart")).toEqual(["ShowPart", tom.id, "body", false])
    })

    it("throw with the list for a part the model has not, and for no name at all", () => {
        const { scene } = createScene()
        const tom = scene.spawn(MODEL)
        expect(() => tom.hide("cape")).toThrow("[oj] actor.hide: cape is not one of this model's parts: body, skirt")
        expect(() => (tom.hide as any)()).toThrow("[oj] actor.hide: it takes the name of a part: body, skirt")
        expect(() => (tom.show as any)()).toThrow("[oj] actor.show: it takes the name of a part: body, skirt")
        expect(() => scene.spawn(MODEL, { hide: ["cape"] })).toThrow(/cape is not one/)
        expect(of("ShowPart")).toHaveLength(0)
    })
})

describe("a model that plays another's clips", () => {
    it("takes them at load, and is a model of its own for each giver", async () => {
        const moves = await loadModel("moves.glb")
        calls = []
        const tom = await loadModel("tom.glb", { clips: moves })
        expect(of("TakeClips")).toEqual([["TakeClips", tom.id, moves.id]])
        // The clips are read after they are taken.
        expect(calls.map((c) => c[0]).indexOf("TakeClips")).toBeLessThan(calls.map((c) => c[0]).indexOf("Clips"))
        expect(await loadModel("tom.glb", { clips: moves })).toBe(tom)
        expect(await loadModel("tom.glb")).not.toBe(tom)
    })

    it("rejects with what the bridge refused, and lets go of the file", async () => {
        const moves = await loadModel("moves.glb")
        const bridge = (globalThis as any).CS.OneJS.Models.ModelBridge
        ;(globalThis as any).CS.OneJS.Models.ModelBridge = new Proxy(bridge, {
            get: (t, name) => name === "TakeClips" ? () => "this model has no joint arm at root/arm, which the clips move" : t[name as string],
        })
        calls = []
        await expect(loadModel("ann.glb", { clips: moves })).rejects.toThrow('[oj] loadModel("ann.glb") clips: this model has no joint arm')
        expect(of("Unload")).toHaveLength(1)
    })

    it("needs a OneJS that can share clips", async () => {
        const moves = await loadModel("moves.glb")
        missing = new Set(["TakeClips"])
        await expect(loadModel("bob.glb", { clips: moves })).rejects.toThrow(/needs a newer OneJS.*runtime 1\.9/)
    })
})

describe("actors moved during a frame", () => {
    const framed = () => {
        const r = createRuntime({ root: {}, version: "0.0.0" })
        made.push(() => r.dispose())
        return r
    }
    const names = () => calls.map((c) => c[0])

    it("cross together when the frame ends, each where it was last put", () => {
        const r = framed()
        const { scene } = createScene({})
        const a = scene.spawn(MODEL), b = scene.spawn(MODEL), still = scene.spawn(MODEL)
        r.oj.onFrame(() => {
            a.position = [9, 9, 9]
            a.position = [1, 2, 3]
            b.yaw = 90
            b.scale = 2
        })
        // Late is still the frame: a move made there goes with the rest.
        r.oj.onLateFrame(() => { b.position = [4, 5, 6] })
        calls = []
        r.beginFrame(1 / 60)
        expect(names()).toEqual(["PlaceMany", "ScaleMany"])
        const data = Array.from(of("PlaceMany")[0]![1] as Float32Array)
        expect(data.length).toBe(16)
        expect(data.slice(0, 8)).toEqual([a.id, 1, 2, 3, 0, 0, 0, 1])
        expect(data.slice(8, 12)).toEqual([b.id, 4, 5, 6])
        expect(data[13]).toBeCloseTo(Math.SQRT1_2, 5)
        expect(Array.from(of("ScaleMany")[0]![1] as Float32Array)).toEqual([b.id, 2])
        expect(still.position).toEqual([0, 0, 0])
    })

    it("cross before a place is read back in the same frame", () => {
        const r = framed()
        const { scene } = createScene({})
        const a = scene.spawn(MODEL)
        const stop = r.oj.onFrame(() => {
            a.position = [1, 2, 3]
            a.screenPoint()
            a.position = [4, 5, 6]
            scene.pick(10, 10)
        })
        calls = []
        r.beginFrame(1 / 60)
        expect(names()).toEqual(["PlaceMany", "PanelPoint", "PlaceMany", "Pick"])
        expect(Array.from(of("PlaceMany")[1]![1] as Float32Array).slice(0, 4)).toEqual([a.id, 4, 5, 6])
        stop()
        calls = []
        r.beginFrame(1 / 60)
        expect(names()).toEqual([])
    })

    it("cross at once outside a frame, where nothing later would send them", () => {
        framed()
        const a = createScene({}).scene.spawn(MODEL)
        calls = []
        a.position = [1, 2, 3]
        a.yaw = 10
        a.scale = 3
        expect(names()).toEqual(["Move", "SetRotation", "SetScale"])
    })

    it("are not sent for an actor destroyed before the frame ends", () => {
        const r = framed()
        const { scene } = createScene({})
        const a = scene.spawn(MODEL)
        r.oj.onFrame(() => { a.position = [1, 2, 3]; a.scale = 2; a.destroy() })
        calls = []
        r.beginFrame(1 / 60)
        expect(names()).toEqual(["Destroy"])
    })

    it("cross one call each on a OneJS from before PlaceMany and ScaleMany", () => {
        missing = new Set(["PlaceMany", "ScaleMany"])
        const r = framed()
        const a = createScene({}).scene.spawn(MODEL)
        r.oj.onFrame(() => { a.position = [1, 2, 3]; a.scale = 2 })
        calls = []
        r.beginFrame(1 / 60)
        expect(names()).toEqual(["Move", "SetScale"])
    })
})

describe("actors a physics world moves", () => {
    it("move every actor with one PlaceMany, and read back where they were put", async () => {
        const { placeActors } = await import("../physics3d/actors")
        const { scene } = createScene({})
        const a = scene.spawn(MODEL), b = scene.spawn(MODEL, { yaw: 30 })
        calls = []
        placeActors([
            { actor: a, at: [1, 2, 3], rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } },
            { actor: b, at: [4, 5, 6], rotation: null },
        ])
        expect(calls.map((c) => c[0])).toEqual(["PlaceMany"])
        const data = Array.from(calls[0]![1] as Float32Array)
        expect(data.length).toBe(16)
        expect(data.slice(0, 4)).toEqual([a.id, 1, 2, 3])
        expect(data.slice(8, 12)).toEqual([b.id, 4, 5, 6])
        expect(a.position).toEqual([1, 2, 3])
        expect(a.yaw).toBeCloseTo(90, 4)
        // A null rotation keeps the actor's own facing, sent as its own quaternion.
        expect(b.yaw).toBe(30)
        expect(data[13]).toBeCloseTo(Math.sin((30 * Math.PI) / 360), 5)
    })

    it("fall back to one call an actor on a OneJS from before PlaceMany", async () => {
        const { placeActors } = await import("../physics3d/actors")
        const { scene } = createScene({})
        const a = scene.spawn(MODEL)
        const bridge = (globalThis as any).CS.OneJS.Models.ModelBridge
        ;(globalThis as any).CS.OneJS.Models.ModelBridge = new Proxy(bridge, {
            get: (t, name) => name === "PlaceMany" ? undefined : t[name as string],
        })
        calls = []
        placeActors([{ actor: a, at: [1, 2, 3], rotation: { x: 0, y: 0, z: 0, w: 1 } }])
        expect(calls.map((c) => c[0])).toEqual(["Move", "SetRotation"])
        expect(a.position).toEqual([1, 2, 3])
    })
})
