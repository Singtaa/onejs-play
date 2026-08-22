import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
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
        const runtime = startStandalone({ size: [600, 760] })
        expect(getCurrentRuntime()).toBe(runtime.oj)
        expect(runtime.oj.stage.width).toBe(600)
        expect(runtime.oj.stage.height).toBe(760)
    })

    it("scales the panel so the declared stage fills the window", () => {
        startStandalone({ size: [600, 760] })
        // 600x760 letterboxed into 1280x800: scale is 800/760.
        expect(host.panelSettings.scale).toBeCloseTo(800 / 760, 6)
    })

    it("accounts for device pixel ratio, so a retina window is not half size", () => {
        host = fakeHost({ width: 1280, height: 800, dpr: 2 })
        startStandalone({ size: [600, 760] })
        expect(host.panelSettings.scale).toBeCloseTo((800 / 760) * 2, 6)
    })

    it("advances the frame clock", () => {
        const runtime = startStandalone()
        expect(runtime.oj.time.frame).toBe(0)
        host.step(0)
        host.step(16)
        expect(runtime.oj.time.frame).toBe(2)
        expect(runtime.oj.time.dt).toBeCloseTo(0.016, 3)
    })

    it("re-fits when the window changes, without being told", () => {
        const runtime = startStandalone({ size: [600, 760] })
        host.step(0)
        const before = runtime.oj.stage.scale
        host.resize(2000, 1400)
        host.step(16)
        expect(runtime.oj.stage.scale).not.toBeCloseTo(before, 6)
        expect(runtime.oj.stage.scale).toBeCloseTo(1400 / 760, 6)
    })

    it("re-fits when the window moves to a display of a different density", () => {
        startStandalone({ size: [600, 760] })
        host.step(0)
        const before = host.panelSettings.scale
        host.resize(1280, 800, 2)
        host.step(16)
        expect(host.panelSettings.scale).toBeCloseTo(before * 2, 6)
    })

    it("never hands the panel a scale it treats as blank", () => {
        // ResolveScale returns 0 for a non-positive scale, which blanks the panel.
        host = fakeHost({ width: 0, height: 0 })
        startStandalone({ size: [600, 760] })
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
