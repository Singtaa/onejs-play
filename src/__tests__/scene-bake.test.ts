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
import { createScene, type BakeOptions } from "../models"
import { preload, unload } from "../preload"
import { createRuntime } from "../runtime"
import { setWasmModule } from "../wasm"
import { RAPIER_VERSION } from "../physics3d/rapier.version"
import { createWorld } from "../physics3d/world"
import { DETAIL_FLOOR, sheetOf } from "../light/atlas"
import { XATLAS_VERSION } from "../light/xatlas.version"
import { decodeLightMesh, FILE_READ_FRAMES } from "../light/bake"
import { TILE_BUDGET } from "../light/budget"
import { readText, writeText } from "../light/png"
import { parseSaved, type SavedLight } from "../light/record"
import { bakeAgain, setLightHost, type BakedLight, type BakeEnd } from "../light/host"
import { bakeAgain as containerBakeAgain } from "../container"
import { setAssetBase, setAssetMap } from "../asset"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
// Models whose LightMesh answers "": what the bridge cannot bake into.
let refused: Set<number>
let beginAnswer: string
// What StepBake answers, in turn; the last repeats.
let steps: number[]
// What BakePhase answers: 1 the probes, 2 the lightmap while they read back, 3 the lightmap.
let phase: number
// What BakePage answers: the page the lightmap is on.
let page: number
let loadAnswer: string
let lightFileAnswer: string
// Calls LightFile answers "" before lightFileAnswer: its read landing, as on WebGPU.
let lightFileWaits: number
/** What the recorder's ProbeGridFloats answers: 9 as OneJS 1.5.0 does, or undefined for one before it. */
let gridFloats: number | undefined
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
                if (name === "SetMesh" || name === "SetLightUnwrap" || name === "SetMeshTexture" || name === "SetMeshUnlit" || name === "SetMeshAdditive" || name === "SetMeshPremultiplied") return ""
                if (name === "SetDepthOnly") return true
                if (name === "Height") return 1
                if (name === "LightMesh") return refused.has(args[0] as number) ? "" : squareMesh()
                if (name === "BeginBake") return beginAnswer
                if (name === "StepBake") return steps.length > 1 ? steps.shift() : steps[0]
                if (name === "BakePhase") return phase
                if (name === "BakePage") return page
                if (name === "LightFile") return lightFileWaits-- > 0 ? "" : lightFileAnswer
                if (name === "FileSha256") return "c".repeat(64)
                if (name === "LoadLight") return loadAnswer
                if (name === "BakeProblem") return "the bake's probes could not be read"
                if (name === "ProbeGridFloats") return gridFloats
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
    phase = 1
    page = 0
    loadAnswer = ""
    lightFileAnswer = PIXEL
    lightFileWaits = 0
    gridFloats = 9
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

        const [, actors, copies, grid, width, height, pages, detail, samples, bounces, occlusion] = of("BeginBake")[0]! as [string, Float32Array, Float32Array, Float32Array, number, number, number, number, number, number, number]
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
        expect(pages).toBe(1)
        // With no options, the first version's bake.
        expect([detail, samples, bounces, occlusion]).toEqual([24, 256, 2, 0])
        // The box round the copies and the static actor, a metre past it: x from -7 to 5, a metre apart across and two up.
        expect(grid.length).toBe(9)
        expect(grid[0]).toBeCloseTo(-8, 3)
        expect(Array.from(grid.subarray(3, 6))).toEqual([1, 2, 1])
        expect(grid[0]! + (grid[6]! - 1) * grid[3]!).toBeGreaterThanOrEqual(5)
    })

    it("gives a OneJS before 1.5.0, which takes one probe spacing, seven floats a metre apart every way", async () => {
        gridFloats = undefined
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true, scale: 3 })
        s.bake()
        await started()
        const grid = of("BeginBake")[0]![3] as Float32Array
        expect(grid.length).toBe(7)
        expect(grid[3]).toBe(1)
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
        // The warm-up's count: no frame has a baseline yet.
        expect(of("StepBake")[0]).toEqual(["StepBake", TILE_BUDGET.min])
        frame()
        expect(light.progress).toBe(0.5)
        frame()
        await light.done
        expect(resolved).toBe(true)
        expect(light.progress).toBe(1)
        frame()
        expect(of("StepBake").length).toBe(3)
    })

    it("sizes each frame's tiles from the frames' real intervals, from a bake started before the first frame", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.1]
        s.bake()
        await started()
        // The cart's first frames are its load: two long ones, then the game's own.
        const real = [0.4, 0.3, ...Array.from({ length: TILE_BUDGET.warmup - 2 }, () => 1 / 60)]
        for (const r of real) runtime.beginFrame(1 / 60, r)
        const asked = () => of("StepBake").map((c) => c[1])
        expect(asked()).toEqual(Array.from({ length: TILE_BUDGET.warmup }, () => TILE_BUDGET.min))
        // The baseline is the game's interval, not the load's: one at it grows the count, one 5 ms over halves it.
        runtime.beginFrame(1 / 60, 1 / 60)
        expect(asked().at(-1)).toBe(TILE_BUDGET.min + 1)
        runtime.beginFrame(1 / 60, 1 / 60 + 0.005)
        expect(asked().at(-1)).toBe(TILE_BUDGET.min)
    })

    it("does not read the frames after the bake changes phase, which are slow whatever its count", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.1]
        s.bake()
        await started()
        for (let i = 0; i <= TILE_BUDGET.warmup; i++) runtime.beginFrame(1 / 60, 1 / 60)
        const asked = () => of("StepBake").map((c) => c[1])
        expect(asked().at(-1)).toBe(TILE_BUDGET.min + 1)
        // The probes end: the frames that show it are a refresh over, and the count holds through them.
        phase = 2
        for (let i = 0; i < TILE_BUDGET.phaseSkip; i++) runtime.beginFrame(1 / 60, 2 / 60)
        expect(asked().slice(-TILE_BUDGET.phaseSkip)).toEqual(Array.from({ length: TILE_BUDGET.phaseSkip }, () => TILE_BUDGET.min + 1))
        // Then it reads them again: one 5 ms over halves it.
        runtime.beginFrame(1 / 60, 1 / 60 + 0.005)
        expect(asked().at(-1)).toBe(TILE_BUDGET.min)
    })

    // The probes' passes queue unseen and land with their read: ramped on clean frames, a 4-bounce bake's read took a 100 ms frame (review L2).
    it("sends at most TILE_BUDGET.probes tiles a frame while the bake traces probes, however clean its frames", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.1]
        s.bake()
        await started()
        for (let i = 0; i < TILE_BUDGET.warmup + 40; i++) runtime.beginFrame(1 / 60, 1 / 60)
        const asked = () => of("StepBake").map((c) => c[1] as number)
        expect(Math.max(...asked())).toBe(TILE_BUDGET.probes)
        // The lightmap's tiles are the budget's again.
        phase = 3
        for (let i = 0; i < TILE_BUDGET.phaseSkip + 1; i++) runtime.beginFrame(1 / 60, 1 / 60)
        expect(asked().at(-1)).toBeGreaterThan(TILE_BUDGET.probes)
    })

    it("does not read the frames after the bake finishes a page either", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.1]
        phase = 3
        s.bake()
        await started()
        for (let i = 0; i <= TILE_BUDGET.warmup; i++) runtime.beginFrame(1 / 60, 1 / 60)
        const asked = () => of("StepBake").map((c) => c[1])
        page = 1
        for (let i = 0; i < TILE_BUDGET.phaseSkip; i++) runtime.beginFrame(1 / 60, 2 / 60)
        expect(asked().slice(-TILE_BUDGET.phaseSkip)).toEqual(Array.from({ length: TILE_BUDGET.phaseSkip }, () => TILE_BUDGET.min + 1))
    })

    // Given no detail, the light takes one page while that holds DETAIL_FLOOR, so a scene's file is not four pages it could do without (review L4).
    it("chooses a default detail from the scene's size: one page while it holds the floor, else the floor on as few pages as hold it", async () => {
        const detailFor = async (scale: number) => {
            calls.length = 0
            const s = scene()
            const ground = s.mesh(SQUARE)
            s.spawn(ground, { static: true, position: [0, 0, 0], scale })
            s.bake()
            await started()
            const [, , , , , , pages, detail] = of("BeginBake")[0]! as [string, Float32Array, Float32Array, Float32Array, number, number, number, number]
            dispose()
            return { pages, detail }
        }
        // 6 m: one page at 24, as always.
        expect(await detailFor(3)).toEqual({ pages: 1, detail: 24 })
        // 30 m: 720 texels at 24, which took four pages; at about 16 it is one.
        const court = await detailFor(15)
        expect(court.pages).toBe(1)
        expect(court.detail).toBeGreaterThanOrEqual(DETAIL_FLOOR)
        expect(court.detail).toBeLessThan(24)
        // 60 m: one page would be 8 texels a metre, so the floor, on the pages that takes.
        expect(await detailFor(30)).toEqual({ pages: 4, detail: DETAIL_FLOOR })
    })

    it("packs what does not fit one page into the sheet at the detail asked, its offsets in pages, a rectangle across the seam", async () => {
        const s = scene()
        const ground = s.mesh(SQUARE)
        // A small square, and one of 30 m: 720 texels at 24 texels a metre, bigger than a page.
        s.spawn(ground, { static: true, position: [0, 0, 40], scale: 15 })
        s.spawn(ground, { static: true, position: [40, 0, 0] })
        s.bake({ detail: 24 })
        await started()
        const [, actors, , , width, height, pages, detail] = of("BeginBake")[0]! as [string, Float32Array, Float32Array, Float32Array, number, number, number, number]
        expect([pages, detail]).toEqual([4, 24])
        const sheet = sheetOf(width, height, pages)
        expect(width).toBeLessThanOrEqual(512)
        expect(sheet.width).toBeLessThanOrEqual(1022)
        const st = Array.from({ length: 2 }, (_, i) => Array.from(actors.subarray(i * 5 + 1, i * 5 + 5)))
        // Scale and offset in pages: the sheet's texels over a page's, so a whole sheet is a little under 2.
        for (const [w, h, x, y] of st) {
            expect(x! + w!).toBeLessThanOrEqual(sheet.width / width + 1e-6)
            expect(y! + h!).toBeLessThanOrEqual(sheet.height / height + 1e-6)
        }
        const big = st[0]!
        expect(big[0]! * width).toBeGreaterThanOrEqual(720)
        // It starts on the first page and ends on the second: across the seam, one rectangle.
        expect(big[2]!).toBeLessThan(1)
        expect(big[2]! + big[0]!).toBeGreaterThan(1)
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

    it("leaves out an added or premultiplied mesh, which neither blocks light nor takes it", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        const glow = s.mesh({ ...SQUARE, unlit: true, blend: "add" })
        s.spawn(glow, { static: true })
        const heart = s.mesh({ ...SQUARE, unlit: true, blend: "premultiplied" })
        s.spawn(heart, { static: true })
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

    it("clears the bridge's light when a bake that replaced a running one fails, as its line says", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        const ground = s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.5]
        const first = s.bake()
        await started()
        frame()
        ground.destroy()
        const second = s.bake()
        await Promise.all([first.done, second.done])
        expect(warn.mock.calls[0]![0]).toMatch(/nothing in the scene is static.*keeps its ambient light/)
        // The first bake, never stepped again, is not left on the bridge holding its draft.
        expect(calls.map((c) => c[0]).filter((n) => n === "BeginBake" || n === "ClearLight")).toEqual(["BeginBake", "ClearLight"])
        frame()
        expect(of("StepBake").length).toBe(1)
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

    it("resolves done to how the bake ended: baked, failed or stopped", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        expect(await s.bake().done).toBe("failed")
        s.spawn(s.mesh(SQUARE), { static: true })
        let light = s.bake()
        await started()
        frame()
        expect(await light.done).toBe("baked")
        steps = [0.5]
        light = s.bake()
        const later = s.bake()
        expect(await light.done).toBe("stopped")
        dispose()
        expect(await later.done).toBe("stopped")
    })

    it("fails a bake the bridge says failed, with its reason, where 1.4.0 read it as stopped", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.2, -2]
        const light = s.bake()
        await started()
        frame()
        frame()
        expect(await light.done).toBe("failed")
        expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["[oj] scene.bake: the bake's probes could not be read. The scene keeps its ambient light."])
    })

    it("still reads -1 from StepBake as a bake another took, with no line", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [-1]
        const light = s.bake()
        await started()
        frame()
        expect(await light.done).toBe("stopped")
        expect(warn).not.toHaveBeenCalled()
    })

    it("clears the light with clearLight, stopping a bake under way", async () => {
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.5]
        const light = s.bake()
        await started()
        frame()
        s.clearLight()
        expect(await light.done).toBe("stopped")
        expect(of("ClearLight").length).toBe(1)
        frame()
        expect(of("StepBake").length).toBe(1)
        s.clearLight()
        expect(of("ClearLight").length).toBe(2)
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
    /** Squares on the ground, spawned in the order given: 2 m, or 18 m (432 texels, one a page) at `scale` 9. */
    const room = (s: ReturnType<typeof scene>, xs: readonly number[], scale = 1) => {
        const ground = s.mesh(SQUARE)
        return xs.map((x) => s.spawn(ground, { static: true, position: [x, 0, 0], scale }))
    }
    const recordOf = (bytes: Uint8Array) => parseSaved(readText(bytes)) as SavedLight
    /** A fresh scene, as the next Run is. */
    const again = () => {
        dispose()
        calls = []
        return scene()
    }

    /** Bakes the room here and returns the file the host was handed. */
    async function bakeAndSave(xs: readonly number[], scale = 1, options?: BakeOptions): Promise<Uint8Array> {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        room(s, xs, scale)
        const light = s.bake(NAME, options)
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

    // preload made a light file a texture, which scene.bake never reads, and the bake fetched it again (review P5).
    it("reads a light file preload fetched, rather than fetching it again", async () => {
        served.set(NAME, await bakeAndSave([0, 3]))
        const s = again()
        room(s, [0, 3])
        fetched = []
        await preload([NAME])
        expect(fetched).toHaveLength(1)
        await s.bake(NAME).done
        expect(fetched).toHaveLength(1)
        expect(of("LoadLight")).toHaveLength(1)
        expect(of("LoadImage")).toEqual([])
        // Let go, it is fetched again.
        await unload([NAME])
        await s.bake(NAME).done
        expect(fetched).toHaveLength(2)
    })

    it("loads the file when it was baked for this scene, and bakes nothing", async () => {
        served.set(NAME, await bakeAndSave([0, 3]))
        const s = again()
        const [a, b] = room(s, [0, 3])
        const light = s.bake(NAME)
        await light.done
        expect(light.progress).toBe(1)
        expect(of("BeginBake")).toEqual([])
        const [, file, actors, copies, grid, width, height, pages] = of("LoadLight")[0]! as [string, string, Float32Array, Float32Array, Float32Array, number, number, number]
        expect(Buffer.from(file, "base64")).toEqual(Buffer.from(served.get(NAME)!))
        expect(Array.from(actors).filter((_, i) => i % 5 === 0)).toEqual([a!.id, b!.id])
        expect(copies.length).toBe(0)
        expect(grid.length).toBe(9)
        expect(width).toBe(recordOf(served.get(NAME)!).layout.atlas[0])
        expect(height).toBe(recordOf(served.get(NAME)!).layout.atlas[1])
        expect(pages).toBe(1)
        expect(baked).toEqual([])
    })

    it("saves the pages a bake used in its record, and loads its file onto as many", async () => {
        served.set(NAME, await bakeAndSave([0, 20, 40], 9, { detail: 24 }))
        const saved = recordOf(served.get(NAME)!)
        expect(saved.layout.pages).toBe(4)
        expect(saved.layout.atlas[2]).toBe(24)
        const s = again()
        room(s, [0, 20, 40], 9)
        await s.bake(NAME, { detail: 24 }).done
        expect(of("BeginBake")).toEqual([])
        const [, , actors, , , width, height, pages] = of("LoadLight")[0]! as [string, string, Float32Array, Float32Array, Float32Array, number, number, number]
        expect([width, height, pages]).toEqual([saved.layout.atlas[0], saved.layout.atlas[1], 4])
        // Three 18 m squares, two to a row of the sheet: the third's offset is on the second column, past the split.
        const x = Array.from(actors).filter((_, i) => i % 5 === 3).sort()
        expect(x.slice(0, 2)).toEqual([0, 0])
        expect(x[2]!).toBeGreaterThan((width - 1) / width)
    })

    it("bakes with the options given, records them, and loads the file only for the same options", async () => {
        served.set(NAME, await bakeAndSave([0, 3], 1, { bounces: 3, samples: 64, occlusion: 0.5, detail: 12 }))
        const [, , , , , , , detail, samples, bounces, occlusion] = of("BeginBake")[0]!
        expect([detail, samples, bounces, occlusion]).toEqual([12, 64, 3, 0.5])
        const saved = recordOf(served.get(NAME)!)
        expect(saved).toMatchObject({ v: 2, bounces: 3, samples: 64, occlusion: 0.5, detail: 12 })
        expect(saved.layout.atlas[2]).toBe(12)

        let s = again()
        room(s, [0, 3])
        await s.bake(NAME, { detail: 12, occlusion: 0.5, samples: 64, bounces: 3 }).done
        expect(of("LoadLight").length).toBe(1)
        expect(of("BeginBake")).toEqual([])

        s = again()
        room(s, [0, 3])
        const light = s.bake(NAME, { bounces: 3, samples: 64, occlusion: 0.5 })
        await started()
        frame()
        await light.done
        expect(of("LoadLight")).toEqual([])
        expect(baked[0]!.line).toBe(`[oj] ${NAME} was baked for a different scene (its detail changed from 12 to the scene's size): baked here instead.`)
    })

    it("lays out at the detail asked, and says on its line when the pages could not hold it", async () => {
        served.set(NAME, await bakeAndSave([0, 3], 1, { detail: 12 }))
        const half = of("BeginBake")[0]![1] as Float32Array
        let s = again()
        room(s, [0, 3])
        await s.bake(NAME, { detail: 12 }).done
        s = again()
        room(s, [0, 3])
        const full = s.bake(NAME, { detail: 24 })
        await started()
        frame()
        await full.done
        // Twice the texels a metre, so each square's rectangle twice as wide in texels.
        const atlas = (n: number) => (of("BeginBake")[n]![4] as number)
        const texels = (list: Float32Array, a: number) => list[1]! * a
        expect(texels(of("BeginBake")[0]![1] as Float32Array, atlas(0)) / texels(half, recordOf(served.get(NAME)!).layout.atlas[0])).toBeCloseTo(2, 0)
        expect(baked[0]!.line).toMatch(/: baked here instead\.$/)

        // Three 18 m squares at 64 texels a metre are 1152 a side, more than a page.
        baked = []
        s = again()
        room(s, [0, 20, 40], 9)
        const big = s.bake(NAME, { detail: 64 })
        await started()
        frame()
        await big.done
        const packed = of("BeginBake")[0]![7] as number
        expect(packed).toBeLessThan(64)
        expect(baked[0]!.line).toMatch(new RegExp(`, at ${packed} texels a metre, as 64 does not fit 4 pages\\.$`))
    })

    it("says the detail it lowered to on the console when the bake has no name", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {})
        const s = scene()
        room(s, [0, 20, 40], 9)
        s.bake({ detail: 64 })
        await started()
        const packed = of("BeginBake")[0]![7] as number
        expect(log.mock.calls.map((c) => c[0])).toEqual([`[oj] scene.bake: baked at ${packed} texels a metre, as 64 does not fit 4 pages.`])
        log.mockClear()
        const t = again()
        room(t, [0])
        t.bake({ samples: 64 })
        await started()
        expect(of("BeginBake")[0]![8]).toBe(64)
        expect(fetched).toEqual([])
        expect(log).not.toHaveBeenCalled()
    })

    it("refuses an option it does not have, or one out of its range, at the call", () => {
        const s = scene()
        room(s, [0])
        for (const [options, message] of [
            [{ quality: 64 }, /has no option quality: its options are bounces, samples, occlusion, detail/],
            [{ bounces: 9 }, /bounces is a whole number from 0 to 8, not 9/],
            [{ bounces: 1.5 }, /bounces is a whole number from 0 to 8, not 1\.5/],
            [{ samples: 0 }, /samples is a whole number from 1 to 4096, not 0/],
            [{ occlusion: 2 }, /occlusion is a number from 0 to 1, not 2/],
            [{ detail: 0.5 }, /detail is a number 1 or more, not 0\.5/],
            [{ detail: "24" }, /detail is a number 1 or more, not "24"/],
            [[], /options are an object/],
        ] as const) {
            expect(() => s.bake(NAME, options as never), JSON.stringify(options)).toThrow(message)
        }
        expect(() => s.bake({ bounces: 9 })).toThrow(/bounces/)
        expect(() => s.bake({} as never, {} as never)).toThrow(/options come once/)
        expect(() => s.bake("")).toThrow(/name the light file/)
        expect(of("BeginBake")).toEqual([])
    })

    it("bakes here a file an older oj saved, saying so, rather than calling it unreadable", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const old = { v: 1, baker: 1, fingerprint: "0", actors: [], sun: null, ambient: [0, 0, 0, 0, 0, 0], detail: 24, quality: 256, layout: { atlas: [64, 64, 24], grid: [0, 0, 0, 1, 2, 2, 2], rects: "0" } }
        served.set(NAME, writeText(new Uint8Array(Buffer.from(PIXEL, "base64")), JSON.stringify(old)))
        const s = scene()
        room(s, [0])
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(of("LoadLight")).toEqual([])
        expect(baked[0]!.line).toBe(`[oj] ${NAME} was saved by an older oj: baked here instead.`)
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

    // The bake bounces a textured ground's picture, so a light baked under one tiling or picture is stale under another.
    it("hashes a textured scene.mesh model's texture and tiling, so the same mesh tiled again is stale", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const uvs = [0, 0, 1, 0, 1, 1, 0, 1]
        const grass = {}
        const first = scene()
        first.spawn(first.mesh({ ...SQUARE, uvs, texture: grass, tiling: 8 }), { static: true })
        const light = first.bake(NAME)
        await started()
        frame()
        await light.done
        served.set(NAME, baked[0]!.bytes)
        baked = []
        const s = again()
        s.spawn(s.mesh({ ...SQUARE, uvs, texture: grass, tiling: 4 }), { static: true })
        const relit = s.bake(NAME)
        await started()
        frame()
        await relit.done
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

    it("bakes a current file again when the host asks, and hands the host the new file", async () => {
        served.set(NAME, await bakeAndSave([0, 3]))
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = again()
        room(s, [0, 3])
        await s.bake(NAME).done
        expect(of("LoadLight").length).toBe(1)
        expect(of("BeginBake")).toEqual([])
        fetched = []
        expect(bakeAgain(NAME)).toBe(true)
        await started()
        frame()
        await vi.waitFor(() => { if (baked.length === 0) throw new Error("not yet") })
        expect(fetched).toEqual([])
        expect(of("BeginBake").length).toBe(1)
        expect(baked.map((l) => [l.name, l.line])).toEqual([[NAME, `[oj] ${NAME} baked again here.`]])
        expect(recordOf(baked[0]!.bytes).actors.map((r) => r[2])).toEqual([0, 3])
        expect(warn.mock.calls.map((c) => c[0])).toEqual([baked[0]!.line])
        expect(containerBakeAgain).toBe(bakeAgain)
    })

    it("bakes again only a name the scene running now baked, and nothing once it goes", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(bakeAgain(NAME)).toBe(false)
        const s = scene()
        room(s, [0])
        const light = s.bake(NAME)
        await started()
        frame()
        await light.done
        expect(bakeAgain("other.light.png")).toBe(false)
        const next = again()
        room(next, [0])
        expect(bakeAgain(NAME)).toBe(false)
        expect(of("BeginBake")).toEqual([])
    })

    it("refuses an empty name", () => {
        expect(() => scene().bake("")).toThrow(/name the light file/)
    })

    it("refuses at the call a name that is not a light file's, so Save can never write over a texture", () => {
        const s = scene()
        expect(() => s.bake("floor.png")).toThrow(/scene\.bake\("floor\.png"\): a light file's name ends in \.light\.png/)
        expect(() => s.bake(".light.png")).toThrow(/ends in \.light\.png/)
        expect(() => s.bake("./room.light.png")).toThrow(/name it from the cart's root as it is, "room\.light\.png"/)
        expect(() => s.bake("assets/room.light.png")).toThrow(/as it is, "room\.light\.png"/)
        for (const bad of ["/room.light.png", "C:/room.light.png", "levels\\room.light.png", "https://x.test/room.light.png"]) {
            expect(() => s.bake(bad)).toThrow(/a path in the cart/)
        }
        for (const bad of ["../room.light.png", "levels//room.light.png", "levels/./room.light.png"]) {
            expect(() => s.bake(bad)).toThrow(/no empty, \. or \.\. part/)
        }
        expect(of("BeginBake")).toEqual([])
        expect(s.bake("levels/room.light.png").done).toBeInstanceOf(Promise)
        expect(s.bake("room.light.png", { bounces: 1 }).done).toBeInstanceOf(Promise)
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
        expect(told).toEqual([`begun ${NAME}`, `ended ${NAME} loaded`])
        told = []
        light = t.bake()
        await vi.waitFor(() => expect(of("BeginBake").length).toBe(2))
        frame()
        await light.done
        expect(told).toEqual([])
    })

    it("tells a bake's progress at most every 250 ms of frames, and at each new page", async () => {
        const progress: string[] = []
        setLightHost({ baked: () => {}, progress: (name, f) => progress.push(`${name} ${f}`) })
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        steps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.97, 0.98, 0.99, 0.991, 0.992, 0.993, 0.994, 0.995, 0.996, 0.997]
        const light = s.bake(NAME)
        await started()
        // 18 frames of 1/60 s, the first with no interval before it: one call, at the 16th, 250 ms in.
        for (let i = 0; i < 18; i++) frame()
        expect(progress).toEqual([`${NAME} 0.993`])
        page = 1
        frame()
        expect(progress).toEqual([`${NAME} 0.993`, `${NAME} 0.996`])
        s.bake()
        await light.done
        // Nothing for a bake with no name.
        for (let i = 0; i < 40; i++) frame()
        expect(progress.length).toBe(2)
    })

    it("tells the host when the scene that offered Bake again goes, and not when the cart clears its light", async () => {
        const withdrawn: string[] = []
        setLightHost({ baked: () => {}, withdrawn: (name) => withdrawn.push(name) })
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        s.bake(NAME)
        s.clearLight()
        expect(withdrawn).toEqual([])
        expect(bakeAgain(NAME)).toBe(true)
        dispose()
        expect(withdrawn).toEqual([NAME])
        expect(bakeAgain(NAME)).toBe(false)
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

    it("waits the frames a finished bake's light file takes to read back, then saves it", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        lightFileWaits = 3
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        const light = s.bake(NAME)
        await started()
        for (let i = 0; i < 3; i++) frame()
        expect(baked).toEqual([])
        expect(told).toEqual([`begun ${NAME}`])
        frame()
        await light.done
        expect(of("LightFile").length).toBe(4)
        expect(baked.length).toBe(1)
        expect(told).toEqual([`begun ${NAME}`, `baked ${NAME}`, `ended ${NAME} baked`])
    })

    it("fails a finished bake whose light cannot be read back, saying the light is showing", async () => {
        lightFileAnswer = ""
        const s = scene()
        s.spawn(s.mesh(SQUARE), { static: true })
        const light = s.bake(NAME)
        await started()
        for (let i = 1; i < FILE_READ_FRAMES; i++) frame()
        expect(told).toEqual([`begun ${NAME}`])
        frame()
        await light.done
        expect(of("LightFile").length).toBe(FILE_READ_FRAMES)
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
