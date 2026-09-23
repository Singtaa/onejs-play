import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { startStandalone } from "../standalone"
import { getCurrentRuntime } from "../runtime"

/**
 * A stand-in for the OneJS host: a root element, a Screen, a panel whose scale
 * we can read back, and a frame pump we drive by hand.
 */
function fakeHost({ width = 1280, height = 800, dpr = 1 } = {}) {
    const frames: Array<(t: number) => void> = []
    const panelSettings = { scale: 1 }
    const g = globalThis as any
    g.__root = {
        panel: { panelSettings },
        resolvedStyle: { width, height },
    }
    g.CS = { UnityEngine: { Screen: { width: width * dpr, height: height * dpr } } }
    g.devicePixelRatio = dpr
    g.requestAnimationFrame = (fn: (t: number) => void) => { frames.push(fn); return frames.length }
    const teardowns: Array<() => void> = []
    g.__onTeardown = (fn: () => void) => teardowns.push(fn)
    return {
        panelSettings,
        teardowns,
        /** Runs exactly one queued frame. */
        step(t: number) {
            const next = frames.shift()
            next?.(t)
        },
        resize(w: number, h: number, ratio = dpr) {
            g.CS.UnityEngine.Screen = { width: w * ratio, height: h * ratio }
            g.__root.resolvedStyle = { width: w, height: h }
            g.devicePixelRatio = ratio
        },
    }
}

let host: ReturnType<typeof fakeHost>

beforeEach(() => { host = fakeHost() })
afterEach(() => {
    getCurrentRuntime()  // keep the import honest
    const g = globalThis as any
    for (const fn of host.teardowns) fn()
    delete g.__root; delete g.CS; delete g.devicePixelRatio
    delete g.requestAnimationFrame; delete g.__onTeardown
})

describe("startStandalone", () => {
    it("installs a runtime, so a game written for the container runs unchanged", () => {
        expect(getCurrentRuntime()).toBeNull()
        const runtime = startStandalone()
        expect(getCurrentRuntime()).toBe(runtime.oj)
        expect(runtime.oj.stage).toEqual({ width: 1280, height: 800 })
    })

    it("scales the panel by the pixel ratio, so one logical pixel is one CSS pixel", () => {
        startStandalone()
        expect(host.panelSettings.scale).toBe(1)
    })

    it("accounts for device pixel ratio, so a retina window is not half size", () => {
        host = fakeHost({ width: 1280, height: 800, dpr: 2 })
        const runtime = startStandalone()
        expect(host.panelSettings.scale).toBe(2)
        expect(runtime.oj.stage).toEqual({ width: 1280, height: 800 })
    })

    it("advances the frame clock", () => {
        const runtime = startStandalone()
        expect(runtime.oj.time.frame).toBe(0)
        host.step(0)
        host.step(16)
        expect(runtime.oj.time.frame).toBe(2)
        expect(runtime.oj.time.dt).toBeCloseTo(0.016, 3)
    })

    it("follows the window when it changes, without being told", () => {
        const runtime = startStandalone()
        host.step(0)
        host.resize(2000, 1400)
        host.step(16)
        expect(runtime.oj.stage).toEqual({ width: 2000, height: 1400 })
    })

    it("rescales the panel when the window moves to a display of a different density", () => {
        const runtime = startStandalone()
        host.step(0)
        host.resize(1280, 800, 2)
        host.step(16)
        expect(host.panelSettings.scale).toBe(2)
        expect(runtime.oj.stage).toEqual({ width: 1280, height: 800 })
    })

    it("never hands the panel a scale it treats as blank", () => {
        // ResolveScale returns 0 for a non-positive scale, which blanks the panel.
        host = fakeHost({ width: 0, height: 0, dpr: 0 })
        startStandalone()
        expect(host.panelSettings.scale).toBeGreaterThan(0)
    })

    it("joins the existing run rather than starting a second one", () => {
        const first = startStandalone()
        expect(startStandalone()).toBe(first)
    })

    it("disposes on teardown, so a hot reload does not leave the old clock running", () => {
        startStandalone()
        expect(getCurrentRuntime()).not.toBeNull()
        for (const fn of host.teardowns) fn()
        expect(getCurrentRuntime()).toBeNull()
    })

    it("says what is wrong when there is no host at all", () => {
        delete (globalThis as any).__root
        expect(() => startStandalone()).toThrow(/__root/)
    })
})
