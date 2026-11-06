import { describe, it, expect, vi, afterEach } from "vitest"
import { setInputBackend } from "onejs-unity/input"
import { createRuntime, getCurrentRuntime } from "../runtime"
import * as api from "../index"

/** A container, which is the only kind of host that passes the api. */
const make = (over = {}) =>
    createRuntime({ api, root: { fake: "root" }, version: "1.4.2", ...over })

afterEach(() => { setInputBackend(null); vi.restoreAllMocks() })

describe("the oj object", () => {
    it("carries the whole game-facing API, so imports from \"oj\" resolve", () => {
        const { oj } = make()
        for (const name of ["View", "Text", "Button", "mount", "Vector2", "Color", "Mathf", "random", "input", "Painter"]) {
            expect(oj).toHaveProperty(name)
        }
    })

    /**
     * The other half of the contract. mount() in an ordinary project imports
     * oj directly, so a host that does not evaluate a bundle has no reason to
     * carry the package, and carrying it made the whole surface reachable from
     * a file that draws a box.
     */
    it("carries none of it when the host did not ask for it", () => {
        const { oj } = createRuntime({
            root: { fake: "root" }, version: "1.4.2",
        })
        for (const name of ["View", "Text", "mount", "Mathf", "input", "Painter"]) {
            expect(oj).not.toHaveProperty(name)
        }
        // What every host provides is still there.
        expect(oj.version).toBe("1.4.2")
        expect(oj.stage).toEqual({ width: 960, height: 540 })
        expect(typeof oj.onFrame).toBe("function")
    })

    it("carries what only the host knows", () => {
        const { oj } = make({ viewport: { width: 1920, height: 540 } })
        expect(oj.version).toBe("1.4.2")
        expect(oj.root).toEqual({ fake: "root" })
        expect(oj.stage).toEqual({ width: 1920, height: 540 })
        expect(oj.time.frame).toBe(0)
    })

    it("registers itself as the current runtime for useFrame", () => {
        const r = make()
        expect(getCurrentRuntime()).toBe(r.oj)
        r.dispose()
        expect(getCurrentRuntime()).toBeNull()
    })
})

describe("the frame clock", () => {
    it("advances now, dt and frame", () => {
        const r = make()
        r.beginFrame(0.016)
        expect(r.oj.time.frame).toBe(1)
        expect(r.oj.time.dt).toBeCloseTo(0.016, 6)
        r.beginFrame(0.016)
        expect(r.oj.time.now).toBeCloseTo(0.032, 6)
    })

    it("reuses one time object rather than allocating per frame", () => {
        const r = make()
        const first = r.oj.time
        r.beginFrame(0.016)
        expect(r.oj.time).toBe(first)
    })

    it("drives input edges, so pressed lasts exactly one frame", () => {
        const r = make()
        r.input.sink.keyDown("Space")
        // Events queue and become visible at the frame boundary, so the frame
        // that runs sees them rather than the one that just ended.
        r.beginFrame(0.016)
        expect(r.oj.input.keyboard.wasKeyPressed("Space")).toBe(true)
        r.beginFrame(0.016)
        expect(r.oj.input.keyboard.wasKeyPressed("Space")).toBe(false)
    })

    it("calls frame callbacks with dt and unsubscribes cleanly", () => {
        const r = make()
        const seen: number[] = []
        const off = r.oj.onFrame((dt) => seen.push(dt))
        r.beginFrame(0.02)
        r.beginFrame(0.03)
        off()
        r.beginFrame(0.04)
        expect(seen).toEqual([0.02, 0.03])
    })

    // One bad line used to remove the callback for good, which stopped a
    // cart's whole loop on its first frame (learn Mac). Saying it every frame
    // would flood the console, so each distinct error is said once.
    it("keeps a callback that throws, and says each distinct error once", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        const r = make()
        const throws = ["boom", "boom", "bang", null]
        const ran: number[] = []
        r.oj.onFrame(() => {
            const next = throws.shift()
            if (next) throw new Error(next)
            ran.push(r.oj.time.frame)
        })
        const ok: number[] = []
        r.oj.onFrame(() => ok.push(1))
        for (let i = 0; i < 4; i++) r.beginFrame(0.016)
        expect(error).toHaveBeenCalledTimes(2)
        expect(String(error.mock.calls[1][1])).toContain("bang")
        expect(ran).toEqual([4])
        expect(ok).toHaveLength(4)
        error.mockRestore()
    })

    it("survives a callback unsubscribing during the frame", () => {
        const r = make()
        const off = r.oj.onFrame(() => off())
        expect(() => r.beginFrame(0.016)).not.toThrow()
    })
})

// The frame, then the step, then late (runtime-1.3.md section 8). The order
// used to be registration: a world registers when its engine loads, so a
// camera mounted before that read last frame's pose and one mounted after
// read this frame's, from the same code.
describe("frame phases", () => {
    it("run frame, step, late whatever order they were added in", () => {
        const r = make()
        const ran: string[] = []
        r.oj.onLateFrame(() => ran.push("late"))
        r.oj.onStep(() => ran.push("step"))
        r.oj.onFrame(() => ran.push("frame"))
        r.oj.onStep(() => ran.push("step 2"))
        r.oj.onFrame(() => ran.push("frame 2"))
        r.beginFrame(0.016)
        expect(ran).toEqual(["frame", "frame 2", "step", "step 2", "late"])
    })

    it("let a frame callback's input move this frame's step, and late read what the step wrote", () => {
        const r = make()
        const body = { velocity: 0, position: 0 }
        const read: number[] = []
        // Late added first, the world last: the order a cart whose world loads after mount gets.
        r.oj.onLateFrame(() => read.push(body.position))
        r.oj.onFrame(() => { body.velocity = 10 })
        r.oj.onStep((dt) => { body.position += body.velocity * dt })
        r.beginFrame(0.1)
        r.beginFrame(0.1)
        expect(read).toEqual([1, 2])
    })

    it("pass each phase the frame's dt", () => {
        const r = make()
        const seen: number[] = []
        r.oj.onStep((dt) => seen.push(dt))
        r.oj.onLateFrame((dt) => seen.push(dt))
        r.beginFrame(0.02)
        expect(seen).toEqual([0.02, 0.02])
    })

    it("keep a world that throws from costing another world or late, and say it once", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        const r = make()
        const ran: string[] = []
        r.oj.onStep(() => { throw new Error("touch handler") })
        r.oj.onStep(() => ran.push("step"))
        r.oj.onLateFrame(() => ran.push("late"))
        r.beginFrame(0.016)
        r.beginFrame(0.016)
        expect(ran).toEqual(["step", "late", "step", "late"])
        expect(error).toHaveBeenCalledTimes(1)
        expect(String(error.mock.calls[0][0])).toContain("a world's step")
        error.mockRestore()
    })

    it("unsubscribe, and drop every phase on dispose", () => {
        const r = make()
        const ran: string[] = []
        const offStep = r.oj.onStep(() => ran.push("step"))
        r.oj.onLateFrame(() => ran.push("late"))
        r.beginFrame(0.016)
        offStep()
        r.beginFrame(0.016)
        r.oj.onStep(() => ran.push("step"))
        r.dispose()
        r.beginFrame(0.016)
        expect(ran).toEqual(["step", "late", "late"])
    })
})

describe("viewport changes", () => {
    it("make the stage the new viewport", () => {
        const r = make({ viewport: { width: 960, height: 540 } })
        r.setViewport(1920, 1080)
        expect(r.oj.stage).toEqual({ width: 1920, height: 1080 })
    })

    // useStage compares identity to decide whether to re-render.
    it("replace the stage object rather than mutating it", () => {
        const r = make({ viewport: { width: 960, height: 540 } })
        const before = r.oj.stage
        r.setViewport(1920, 1080)
        expect(r.oj.stage).not.toBe(before)
        expect(before).toEqual({ width: 960, height: 540 })
    })

    it("leave pointer coordinates alone: they were never scaled", () => {
        const r = make({ viewport: { width: 960, height: 540 } })
        r.input.sink.pointerMove(480, 270)
        r.beginFrame(0.016)
        r.setViewport(1920, 1080)
        expect(r.oj.input.mouse.position.x).toBe(480)
    })

    it("keep a usable stage when the viewport is not measured yet", () => {
        const r = make({ viewport: { width: 1280, height: 720 } })
        r.setViewport(0, 0)
        expect(r.oj.stage.width).toBeGreaterThan(0)
        expect(r.oj.stage.height).toBeGreaterThan(0)
    })
})

describe("dispose", () => {
    it("stops frame callbacks and detaches the input backend", () => {
        const r = make()
        const seen: number[] = []
        r.oj.onFrame(() => seen.push(1))
        r.dispose()
        r.beginFrame(0.016)
        expect(seen).toHaveLength(0)
    })
})

/**
 * useFrame is onejs-react's, so a cart and a OneJS app share one hook. The
 * runtime installs itself as that hook's clock, which keeps the two things a
 * game relies on: frames stop when the container stops calling beginFrame, and
 * a frame callback sees this frame's input edges, not last frame's.
 */
describe("useFrame's clock", () => {
    it("is the runtime's beginFrame while the runtime lives", async () => {
        const { subscribeFrame } = await import("onejs-react/src/frame")
        const r = make()
        const seen: number[] = []
        const stop = subscribeFrame((dt) => seen.push(dt))
        r.beginFrame(0.02)
        r.beginFrame(0.03)
        expect(seen).toEqual([0.02, 0.03])
        stop()
        r.beginFrame(0.04)
        expect(seen).toEqual([0.02, 0.03])
        r.dispose()
    })

    // The clamp keeps a stall from throwing everything through a wall; the real
    // seconds are for what must not run slow after one, such as a wall clock.
    it("passes the unclamped seconds second, to useFrame, every phase and oj.time", async () => {
        const { subscribeFrame } = await import("onejs-react/src/frame")
        const r = make()
        const seen: Array<[string, number, number]> = []
        const stop = subscribeFrame((dt, realDt) => seen.push(["useFrame", dt, realDt]))
        r.oj.onStep((dt, realDt) => seen.push(["step", dt, realDt]))
        r.oj.onLateFrame((dt, realDt) => seen.push(["late", dt, realDt]))
        r.beginFrame(0.1, 0.35)
        expect(seen).toEqual([["useFrame", 0.1, 0.35], ["step", 0.1, 0.35], ["late", 0.1, 0.35]])
        expect(r.oj.time.dt).toBe(0.1)
        expect(r.oj.time.realDt).toBe(0.35)
        expect(r.oj.time.now).toBe(0.1)
        seen.length = 0
        r.beginFrame(0.02)
        expect(seen[0]).toEqual(["useFrame", 0.02, 0.02])
        expect(r.oj.time.realDt).toBe(0.02)
        stop()
        r.dispose()
    })

    it("goes back to onejs-react's own once the runtime is disposed", async () => {
        const { subscribeFrame } = await import("onejs-react/src/frame")
        vi.stubGlobal("requestAnimationFrame", () => 1)
        vi.stubGlobal("cancelAnimationFrame", () => {})
        const r = make()
        r.dispose()
        const seen: number[] = []
        const stop = subscribeFrame((dt) => seen.push(dt))
        r.beginFrame(0.02)
        expect(seen).toEqual([])
        stop()
        vi.unstubAllGlobals()
    })
})
