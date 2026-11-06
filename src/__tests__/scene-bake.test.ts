/**
 * `scene.bake` as the calls it makes on OneJS's ModelBridge: LightMesh,
 * SetLightUnwrap, BeginBake, StepBake, LightFile and LoadLight (tested in
 * OneJS's ModelLightPlayModeTests). The unwrap is xatlas's own, so what
 * reaches the bridge is what a cart's would be. A named bake reads its light
 * file from the cart's own origin, which `fetch` stands in for here.
 */
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import { createScene } from "../models"
import { createRuntime } from "../runtime"
import { setWasmModule } from "../wasm"
import { RAPIER_VERSION } from "../physics3d/rapier.version"
import { createWorld } from "../physics3d/world"
import { XATLAS_VERSION } from "../light/xatlas.version"
import { decodeLightMesh, PATHS_PER_FRAME } from "../light/bake"
import { readText, writeText } from "../light/png"
import { parseSaved, type SavedLight } from "../light/record"
import { setLightHost, type BakedLight, type BakeEnd } from "../light/host"
import { setAssetBase, setAssetMap } from "../asset"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
// Models whose LightMesh answers "": what the bridge cannot bake into.
let refused: Set<number>
let beginAnswer: string
// What StepBake answers, in turn; the last repeats.
let steps: number[]
let loadAnswer: string
let lightFileAnswer: string
// The cart's files by name, as its origin serves them.
let served: Map<string, Uint8Array>
let fetched: string[]
let baked: BakedLight[]

/** A 1 by 1 PNG: what LightFile answers, before oj adds its record. */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

/** A 2 m square on the ground, as LightMesh lays it out: counts, positions, indices. */
function squareMesh(): string {
    const positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]
    const indices = [0, 3, 2, 0, 2, 1]
    const buffer = Buffer.alloc(8 + positions.length * 4 + indices.length * 4)
    buffer.writeUInt32LE(4, 0)
    buffer.writeUInt32LE(6, 4)
    positions.forEach((p, i) => buffer.writeFloatLE(p, 8 + i * 4))
    indices.forEach((x, i) => buffer.writeUInt32LE(x, 8 + positions.length * 4 + i * 4))
    return buffer.toString("base64")
}

function recorder(): any {
    let next = 40
    return new Proxy({}, {
        get(_t, name: string) {
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "CreateMesh" || name === "Spawn" || name === "Scatter") return ++next
                if (name === "SetMesh" || name === "SetLightUnwrap") return ""
                if (name === "SetDepthOnly") return true
                if (name === "Height") return 1
                if (name === "LightMesh") return refused.has(args[0] as number) ? "" : squareMesh()
                if (name === "BeginBake") return beginAnswer
                if (name === "StepBake") return steps.length > 1 ? steps.shift() : steps[0]
                if (name === "LightFile") return lightFileAnswer
                if (name === "FileSha256") return "c".repeat(64)
                if (name === "LoadLight") return loadAnswer
                if (name === "Load") return ++next
                if (name === "Clips") return ""
                return undefined
            }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name)
const ROOT = path.resolve(import.meta.dirname, "../..")
const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.join(ROOT, `assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("xatlas", new WA.Module(fs.readFileSync(path.join(ROOT, `assets/@ojplay/wasm/xatlas-${XATLAS_VERSION}.wasm`))))
})

let runtime: ReturnType<typeof createRuntime>
let dispose: () => void
beforeEach(() => {
    calls = []
    refused = new Set()
    beginAnswer = ""
    steps = [1]
    loadAnswer = ""
    lightFileAnswer = PIXEL
    served = new Map()
    fetched = []
    baked = []
    vi.stubGlobal("fetch", async (url: string) => {
        fetched.push(url)
        const bytes = served.get(url.replace("https://cart.test/assets/", ""))
        return bytes === undefined
            ? { ok: false, status: 404 }
            : { ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer }
    })
    setLightHost({ baked: (light) => baked.push(light) })
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: recorder() } } }
    runtime = createRuntime({ root: {}, version: "1.0.0", assetBase: "https://cart.test/assets" })
})

afterEach(() => {
    dispose?.()
    runtime.dispose()
    ;(globalThis as any).CS = savedCS
    setLightHost(null)
    setAssetBase(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function scene() {
    const made = createScene()
    dispose = made.dispose
    return made.scene
}

const SQUARE = { positions: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], indices: [0, 3, 2, 0, 2, 1] }

/** Lets the bake's charts be cut: xatlas is asynchronous. */
async function started() {
    await vi.waitFor(() => { if (of("BeginBake").length === 0 && of("StepBake").length === 0) throw new Error("not yet") })
}

const frame = () => runtime.beginFrame(1 / 60)

describe("scene.bake", () => {
    it("bakes the actors spawned static and every scattered copy, each in a rectangle of the atlas", async () => {
        const s = scene()
        const ground = s.mesh(SQUARE)
        const still = s.spawn(ground, { static: true, position: [3, 0, 0], scale: 2 })
        s.spawn(ground, { position: [0, 1, 0] })
        s.scatter(ground, [{ x: -3, z: 0 }, { x: -6, z: 0 }])
        s.bake()
        await started()

        expect(of("LightMesh")).toEqual([["LightMesh", ground.id]])
        const [, model, xref, uv, indices] = of("SetLightUnwrap")[0]!
        expect(model).toBe(ground.id)
        expect(xref).toBeInstanceOf(Uint32Array)
        expect(uv).toBeInstanceOf(Float32Array)
        expect((indices as Uint32Array).length).toBe(6)

        const [, actors, copies, grid, width, height, detail, samples] = of("BeginBake")[0]! as [string, Float32Array, Float32Array, Float32Array, number, number, number, number]
        expect(Array.from(actors.slice(0, 1))).toEqual([still.id])
        expect(actors.length).toBe(5)
        expect(copies.length).toBe(12)
        expect([copies[1], copies[7]]).toEqual([0, 1])
        expect(copies[0]).toBe(copies[6])
        for (const st of [actors.slice(1, 5), copies.slice(2, 6), copies.slice(8, 12)]) {
            for (const v of st) expect(v).toBeGreaterThanOrEqual(0)
            // Inside the atlas, to a float32's rounding.
            expect(st[0]! + st[2]!).toBeLessThanOrEqual(1 + 1e-6)
            expect(st[1]! + st[3]!).toBeLessThanOrEqual(1 + 1e-6)
        }
        expect(actors[1]! / copies[2]!).toBeCloseTo(2, 1)
        expect(width).toBeGreaterThan(0)
        expect(height).toBeGreaterThan(0)
        expect(detail).toBeGreaterThan(0)
        expect(samples).toBe(256)
        // The box round the copies and the static actor, a metre past it: x from -7 to 5.
        expect(grid.length).toBe(7)
        expect(grid[0]).toBeCloseTo(-8, 3)
        expect(grid[0]! + (grid[4]! - 1) * grid[3]!).toBeGreaterThanOrEqual(5)
    })

    it("bakes into a static body's actor without being told, and not a dynamic one's", async () => {
        const s = scene()
        const world = await createWorld()
        try {
            const ground = s.mesh(SQUARE)
            const wall = s.spawn(ground)
            const crate = s.spawn(ground, { position: [0, 2, 0] })
            world.box({ actor: wall })
            world.box({ actor: crate, dynamic: true, at: [0, 2, 0] })
            s.bake()
            await started()
            const actors = of("BeginBake")[0]![1] as Float32Array
            expect(actors.length).toBe(5)
            expect(actors[0]).toBe(wall.id)
        } finally {
            world.dispose()
        }
    })

    it("follows StepBake's progress each frame and resolves done at 1", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.25, 0.5, 1]
        const light = s.bake()
        await started()
        let resolved = false
        light.done.then(() => { resolved = true })
        frame()
        expect(light.progress).toBe(0.25)
        expect(of("StepBake")[0]).toEqual(["StepBake", PATHS_PER_FRAME])
        frame()
        expect(light.progress).toBe(0.5)
        frame()
        await light.done
        expect(resolved).toBe(true)
        expect(light.progress).toBe(1)
        frame()
        expect(of("StepBake").length).toBe(3)
    })

    it("says why and resolves when nothing is static, leaving the bridge alone", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        s.spawn(s.mesh(SQUARE))
        const light = s.bake()
        await light.done
        expect(warn.mock.calls[0]![0]).toMatch(/nothing in the scene is static.*keeps its ambient light/)
        expect(light.progress).toBe(1)
        expect(of("LightMesh")).toEqual([])
        expect(of("BeginBake")).toEqual([])
    })

    it("leaves out a depth-only mesh, which is never seen", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        const shadow = s.mesh(SQUARE, { depthOnly: true })
        s.spawn(shadow, { static: true })
        await s.bake().done
        expect(of("LightMesh")).toEqual([])
    })

    it("names a model the bridge cannot bake into and bakes the rest", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        const odd = s.mesh(SQUARE), ground = s.mesh(SQUARE)
        refused.add(odd.id)
        const a = s.spawn(odd, { static: true })
        const b = s.spawn(ground, { static: true })
        s.bake()
        await started()
        expect(warn.mock.calls[0]![0]).toMatch(/a scene.mesh model cannot be baked into/)
        const actors = of("BeginBake")[0]![1] as Float32Array
        expect(Array.from(actors).filter((_, i) => i % 5 === 0)).toEqual([b.id])
        expect(a.id).not.toBe(b.id)
    })

    it("says what the bridge refused, and resolves", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        beginAnswer = "this GPU cannot bake light: it cannot draw into float textures"
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        const light = s.bake()
        await light.done
        expect(warn.mock.calls[0]![0]).toBe("[oj] scene.bake: this GPU cannot bake light: it cannot draw into float textures. The scene keeps its ambient light.")
        frame()
        expect(of("StepBake")).toEqual([])
    })

    it("resolves a bake another replaced, and steps only the new one", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.5]
        const first = s.bake()
        await started()
        frame()
        const second = s.bake()
        await first.done
        expect(first.progress).toBe(0.5)
        await vi.waitFor(() => expect(of("BeginBake").length).toBe(2))
        frame()
        expect(second.progress).toBe(0.5)
        expect(of("StepBake").length).toBe(2)
    })

    it("resolves when the scene goes", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.5]
        const light = s.bake()
        await started()
        dispose()
        await light.done
    })

    it("cuts a model's charts once a scene, and again after mesh.set", async () => {
        const s = scene()
        const ground = s.mesh(SQUARE)
        s.spawn(ground, { static: true })
        const first = s.bake()
        await started()
        frame()
        await first.done
        s.bake()
        await vi.waitFor(() => expect(of("BeginBake").length).toBe(2))
        expect(of("LightMesh").length).toBe(1)
        ground.set(SQUARE)
        s.bake()
        await vi.waitFor(() => expect(of("BeginBake").length).toBe(3))
        expect(of("LightMesh").length).toBe(2)
    })

    it("tells a host without the baker once, and resolves", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const older = recorder()
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: new Proxy({}, { get: (_t, name: string) => name === "BeginBake" ? undefined : older[name] }) } } }
        const s = scene()
        await s.bake().done
        await s.bake().done
        expect(warn.mock.calls.filter((c) => /needs a newer OneJS/.test(String(c[0]))).length).toBe(1)
    })
})

describe("scene.bake with a name", () => {
    const NAME = "room.light.png"
    /** Two squares on the ground, spawned in the order given. */
    const room = (s: ReturnType<typeof scene>, xs: readonly number[]) => {
        const ground = s.mesh(SQUARE)
        return xs.map((x) => s.spawn(ground, { static: true, position: [x, 0, 0] }))
    }
    const recordOf = (bytes: Uint8Array) => parseSaved(readText(bytes)) as SavedLight
    /** A fresh scene, as the next Run is. */
    const again = () => {
        dispose()
        calls = []
        return scene()
    }

    /** Bakes the room here and returns the file the host was handed. */
    async function bakeAndSave(xs: readonly number[]): Promise<Uint8Array> {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        room(s, xs)
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(baked.length).toBe(1)
        const bytes = baked[0]!.bytes
        baked = []
        return bytes
    }

    it("bakes here when the cart lacks the file, then says so once and hands the host the file with its record", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        room(s, [0, 3])
        const light = s.bake(NAME)
        await started()
        expect(of("BeginBake").length).toBe(1)
        expect(baked).toEqual([])
        frame()
        await light.done
        expect(fetched).toEqual([`https://cart.test/assets/${NAME}`])
        expect(baked.length).toBe(1)
        expect(baked[0]!.name).toBe(NAME)
        expect(baked[0]!.line).toBe(`[oj] ${NAME} is not in the cart yet: baked here.`)
        expect(warn.mock.calls.map((c) => c[0])).toEqual([baked[0]!.line])
        const saved = recordOf(baked[0]!.bytes)
        expect(saved.actors.map((r) => r[2])).toEqual([0, 3])
        expect(saved.actors[0]![0]).toBe("scene.mesh")
        expect(saved.layout.atlas[0]).toBe(of("BeginBake")[0]![4])
        expect(of("LightFile").length).toBe(1)
    })

    it("loads the file when it was baked for this scene, and bakes nothing", async () => {
        served.set(NAME, await bakeAndSave([0, 3]))
        const s = again()
        const [a, b] = room(s, [0, 3])
        const light = s.bake(NAME)
        await light.done
        expect(light.progress).toBe(1)
        expect(of("BeginBake")).toEqual([])
        const [, file, actors, copies, grid, width, height] = of("LoadLight")[0]! as [string, string, Float32Array, Float32Array, Float32Array, number, number]
        expect(Buffer.from(file, "base64")).toEqual(Buffer.from(served.get(NAME)!))
        expect(Array.from(actors).filter((_, i) => i % 5 === 0)).toEqual([a!.id, b!.id])
        expect(copies.length).toBe(0)
        expect(grid.length).toBe(7)
        expect(width).toBe(recordOf(served.get(NAME)!).layout.atlas[0])
        expect(height).toBe(recordOf(served.get(NAME)!).layout.atlas[1])
        expect(baked).toEqual([])
    })

    it("gives each actor the rectangle it was baked with, whatever order the scene spawned them in", async () => {
        served.set(NAME, await bakeAndSave([0, 3]))
        const first = of("BeginBake")[0]![1] as Float32Array
        const s = again()
        const [right, left] = room(s, [3, 0])
        await s.bake(NAME).done
        const loaded = of("LoadLight")[0]![2] as Float32Array
        const rectOf = (list: Float32Array, i: number) => Array.from(list.slice(i * 5 + 1, i * 5 + 5))
        // The first bake's list starts with the actor at x 0, as the record's order does.
        expect(loaded[0]).toBe(left!.id)
        expect(loaded[5]).toBe(right!.id)
        expect(rectOf(loaded, 0)).toEqual(rectOf(first, 0))
        expect(rectOf(loaded, 1)).toEqual(rectOf(first, 1))
    })

    it("bakes here, naming what changed, when the file was baked for a different scene", async () => {
        served.set(NAME, await bakeAndSave([0, 3]))
        const s = again()
        room(s, [0, 4])
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(of("LoadLight")).toEqual([])
        expect(baked[0]!.line).toBe(`[oj] ${NAME} was baked for a different scene (scene.mesh moved from [3, 0, 0] to [4, 0, 0]): baked here instead.`)
    })

    it("bakes here when the file is not a light file, or OneJS cannot show it", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        served.set(NAME, new Uint8Array(Buffer.from(PIXEL, "base64")))
        const s = scene()
        room(s, [0])
        let light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(baked[0]!.line).toBe(`[oj] ${NAME} is not a light file oj can read (it holds no light record): baked here instead.`)

        served.set(NAME, baked[0]!.bytes)
        baked = []
        loadAnswer = "the light file is 1 by 1, and a 64 by 64 atlas with 27 probes needs 64 by 66"
        const t = again()
        room(t, [0])
        light = t.bake(NAME)
        await started()
        expect(of("LoadLight").length).toBe(1)
        frame()
        await light.done
        expect(baked[0]!.line).toBe(`[oj] ${NAME} is not a light file oj can read (${loadAnswer}): baked here instead.`)
    })

    it("asks for no file a build's file map does not list", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        setAssetMap({ "other.png": ["abc", 3] })
        const s = scene()
        room(s, [0])
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(fetched).toEqual([])
        expect(baked[0]!.line).toMatch(/is not in the cart yet/)
    })

    it("asks for no file when the build listed the cart's files and there were none, which a 404 would fail a run for", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        setAssetMap(null, { names: [] })
        const s = scene()
        room(s, [0])
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(fetched).toEqual([])
        expect(baked[0]!.line).toMatch(/is not in the cart yet/)
    })

    it("names a file model as it was loaded, by its file map hash, or by its bytes' hash where there is no map", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const crate = new Uint8Array([1, 2, 3, 4])
        served.set("crate.glb", crate)
        const { loadModel } = await import("../models")
        let s = scene()
        s.spawn(await loadModel("crate.glb"), { static: true })
        let light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(recordOf(baked[0]!.bytes).actors[0]!.slice(0, 2)).toEqual(["crate.glb", createHash("sha256").update(crate).digest("hex")])

        baked = []
        setAssetMap({ "crate.glb": ["f".repeat(64), 4] })
        s = again()
        s.spawn(await loadModel("crate.glb"), { static: true })
        light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(recordOf(baked[0]!.bytes).actors[0]!.slice(0, 2)).toEqual(["crate.glb", "f".repeat(64)])
    })

    it("hashes a scene.mesh model's colour and streams, so a mesh made again in another colour is stale", async () => {
        served.set(NAME, await bakeAndSave([0]))
        const s = again()
        s.spawn(s.mesh({ ...SQUARE, color: "#ff0000" }), { static: true, position: [0, 0, 0] })
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(baked[0]!.line).toMatch(/scene\.mesh changed/)
    })

    it("loads the file under float noise in a placement, which the record rounds away", async () => {
        served.set(NAME, await bakeAndSave([0, 3]))
        const s = again()
        room(s, [2e-5, 3 - 3e-5])
        await s.bake(NAME).done
        expect(of("LoadLight").length).toBe(1)
        expect(of("BeginBake")).toEqual([])
    })

    it("bakes here when the file's layout is not the one this oj makes for its record", async () => {
        const bytes = await bakeAndSave([0, 3])
        const saved = recordOf(bytes)
        served.set(NAME, writeText(bytes, JSON.stringify({ ...saved, layout: { ...saved.layout, rects: "0000000000000000" } })))
        const s = again()
        room(s, [0, 3])
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(of("LoadLight")).toEqual([])
        expect(baked[0]!.line).toMatch(/its atlas is laid out differently by this oj/)
    })

    it("refuses an empty name", () => {
        expect(() => scene().bake("")).toThrow(/name the light file/)
    })
})

describe("scene.bake for a host that waits on it", () => {
    const NAME = "room.light.png"
    let told: string[]
    beforeEach(() => {
        told = []
        const tell = (end: BakeEnd) => end.how === "failed" ? `failed: ${end.why}` : end.how
        setLightHost({
            baked: (light) => { baked.push(light); told.push(`baked ${light.name}`) },
            begun: (name) => told.push(`begun ${name}`),
            ended: (name, end) => told.push(`ended ${name} ${tell(end)}`),
        })
        vi.spyOn(console, "warn").mockImplementation(() => {})
    })

    it("tells each named bake's start, then its file, then its end", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        const light = s.bake(NAME)
        expect(told).toEqual([`begun ${NAME}`])
        await started()
        frame()
        await light.done
        expect(told).toEqual([`begun ${NAME}`, `baked ${NAME}`, `ended ${NAME} baked`])
    })

    it("tells a current file's end, and nothing of a bake with no name", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        let light = s.bake(NAME)
        await started()
        frame()
        await light.done
        served.set(NAME, baked[0]!.bytes)
        dispose()
        told = []
        const t = scene()
        t.spawn(t.mesh(SQUARE), { static: true })
        await t.bake(NAME).done
        expect(told).toEqual([`begun ${NAME}`, `ended ${NAME} current`])
        told = []
        light = t.bake()
        await vi.waitFor(() => expect(of("BeginBake").length).toBe(2))
        frame()
        await light.done
        expect(told).toEqual([])
    })

    it("tells a failure with the console's reason, and a stop when a later bake or the scene's end cuts it short", async () => {
        let s = scene()
        await s.bake(NAME).done
        expect(told).toEqual([`begun ${NAME}`, `ended ${NAME} failed: nothing in the scene is static. Spawn what never moves with { static: true }, or give it a static body`])

        dispose()
        told = []
        steps = [0.5]
        s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        s.bake(NAME)
        await started()
        frame()
        s.bake("other.light.png")
        expect(told).toEqual([`begun ${NAME}`, `ended ${NAME} stopped`, "begun other.light.png"])
        dispose()
        expect(told.at(-1)).toBe("ended other.light.png stopped")
    })

    it("fails a finished bake whose light cannot be read back, saying the light is showing", async () => {
        lightFileAnswer = ""
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(baked).toEqual([])
        expect(told).toEqual([`begun ${NAME}`, `ended ${NAME} failed: its light is showing, but could not be read back as a file to save`])
    })

    it("fails a named bake on a host without the baker", async () => {
        const older = recorder()
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: new Proxy({}, { get: (_t, name: string) => name === "BeginBake" ? undefined : older[name] }) } } }
        await scene().bake(NAME).done
        expect(told).toEqual([`begun ${NAME}`, `ended ${NAME} failed: this host's ModelBridge cannot bake light`])
    })

    it("keeps telling the cart's bakes when the host throws", async () => {
        setLightHost({ baked: () => {}, begun: () => { throw new Error("full") } })
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(vi.mocked(console.warn).mock.calls.map((c) => String(c[0]))).toContain(`[oj] the host could not take ${NAME}: full`)
    })
})

describe("a file model in a Unity project", () => {
    it("is hashed by OneJS where it lies on disk, so its bytes never cross into JS", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        setAssetBase("/project/Assets/Cart")
        const { loadModel } = await import("../models")
        const s = scene()
        s.spawn(await loadModel("crate.glb"), { static: true })
        const light = s.bake("room.light.png")
        await started()
        frame()
        await light.done
        expect(of("FileSha256")).toEqual([["FileSha256", "/project/Assets/Cart/crate.glb"]])
        expect(fetched.filter((u) => u.endsWith("crate.glb"))).toEqual([])
        expect((parseSaved(readText(baked[0]!.bytes)) as SavedLight).actors[0]!.slice(0, 2)).toEqual(["crate.glb", "c".repeat(64)])
    })
})

describe("decodeLightMesh", () => {
    it("reads LightMesh's counts, positions and indices, and refuses a length its counts do not give", () => {
        const t = decodeLightMesh(squareMesh())!
        expect(Array.from(t.vertices)).toEqual(SQUARE.positions)
        expect(Array.from(t.indices)).toEqual(SQUARE.indices)
        expect(decodeLightMesh("")).toBeNull()
        expect(() => decodeLightMesh(Buffer.from(Buffer.from(squareMesh(), "base64").subarray(0, 20)).toString("base64"))).toThrow(/bytes/)
    })
})
