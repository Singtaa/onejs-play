import { describe, it, expect, vi, afterEach } from "vitest"
import { setInputBackend } from "onejs-unity/input"
import { createRuntime, getCurrentRuntime } from "../runtime"
import { normalizeStage } from "../stage"
import * as api from "../index"

/** A container, which is the only kind of host that passes the api. */
const make = (over = {}) =>
    createRuntime({ api, root: { fake: "root" }, version: "1.4.2", stage: normalizeStage({ size: [960, 540] }), ...over })

afterEach(() => { setInputBackend(null); vi.restoreAllMocks() })

describe("the oj object", () => {
    it("carries the whole game-facing API, so imports from \"oj\" resolve", () => {
        const { oj } = make()
        for (const name of ["View", "Text", "Button", "render", "Vector2", "Color", "Mathf", "random", "input", "Painter"]) {
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
            root: { fake: "root" }, version: "1.4.2", stage: normalizeStage({ size: [960, 540] }),
        })
        for (const name of ["View", "Text", "render", "Mathf", "input", "Painter"]) {
            expect(oj).not.toHaveProperty(name)
        }
        // What every host provides is still there.
        expect(oj.version).toBe("1.4.2")
        expect(oj.stage.width).toBe(960)
        expect(typeof oj.onFrame).toBe("function")
    })

    it("carries what only the host knows", () => {
        const { oj } = make({ viewport: { width: 1920, height: 540 } })
        expect(oj.version).toBe("1.4.2")
        expect(oj.root).toEqual({ fake: "root" })
        expect(oj.stage.width).toBe(960)
        expect(oj.stage.scale).toBe(1)
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

    // Otherwise one bad callback throws sixty times a second forever.
    it("removes a callback that throws, and reports it once", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        const r = make()
        r.oj.onFrame(() => { throw new Error("boom") })
        const ok: number[] = []
        r.oj.onFrame(() => ok.push(1))
        r.beginFrame(0.016)
        r.beginFrame(0.016)
        expect(error).toHaveBeenCalledTimes(1)
        expect(ok).toHaveLength(2)
    })

    it("survives a callback unsubscribing during the frame", () => {
        const r = make()
        const off = r.oj.onFrame(() => off())
        expect(() => r.beginFrame(0.016)).not.toThrow()
    })
})

describe("viewport changes", () => {
    it("recomputes the stage", () => {
        const r = make({ viewport: { width: 960, height: 540 } })
        expect(r.oj.stage.scale).toBe(1)
        r.setViewport(1920, 1080)
        expect(r.oj.stage.scale).toBe(2)
    })

    it("keeps pointer coordinates in logical units across the change", () => {
        const r = make({ viewport: { width: 960, height: 540 } })
        r.input.sink.pointerMove(480, 270)
        r.beginFrame(0.016)
        expect(r.oj.input.mouse.position.x).toBeCloseTo(480, 6)
        r.setViewport(1920, 1080)
        expect(r.oj.input.mouse.position.x).toBeCloseTo(240, 6)
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
