/**
 * `scene.bake` as the calls it makes on OneJS's ModelBridge: LightMesh,
 * SetLightUnwrap, BeginBake and StepBake (tested in OneJS's
 * ModelLightPlayModeTests). The unwrap is xatlas's own, so what reaches the
 * bridge is what a cart's would be.
 */
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

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
// Models whose LightMesh answers "": what the bridge cannot bake into.
let refused: Set<number>
let beginAnswer: string
// What StepBake answers, in turn; the last repeats.
let steps: number[]

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
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: recorder() } } }
    runtime = createRuntime({ root: {}, version: "1.0.0" })
})

afterEach(() => {
    dispose?.()
    runtime.dispose()
    ;(globalThis as any).CS = savedCS
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

describe("decodeLightMesh", () => {
    it("reads LightMesh's counts, positions and indices, and refuses a length its counts do not give", () => {
        const t = decodeLightMesh(squareMesh())!
        expect(Array.from(t.vertices)).toEqual(SQUARE.positions)
        expect(Array.from(t.indices)).toEqual(SQUARE.indices)
        expect(decodeLightMesh("")).toBeNull()
        expect(() => decodeLightMesh(Buffer.from(Buffer.from(squareMesh(), "base64").subarray(0, 20)).toString("base64"))).toThrow(/bytes/)
    })
})
