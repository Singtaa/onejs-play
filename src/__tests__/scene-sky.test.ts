/**
 * `scene.sky`, as the calls it makes on OneJS's ModelBridge (SetSky, drawn
 * and read back in OneJS's SkyEditModeTests), and the fog that takes the
 * sky's horizon when it has no colour of its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createScene, SCENE_DEFAULTS } from "../models"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown

function bridge(without: string[] = []): any {
    return new Proxy({}, {
        get(_t, name: string) {
            if (without.includes(name)) return undefined
            return (...args: unknown[]) => { calls.push([name, ...args]) }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name)
const last = (name: string) => of(name).at(-1)!.slice(1)

const disposals: (() => void)[] = []
function scene(options?: Parameters<typeof createScene>[0]) {
    const made = createScene(options)
    disposals.push(made.dispose)
    return made.scene
}

beforeEach(() => {
    calls = []
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: bridge() } } }
})

afterEach(() => {
    for (const d of disposals.splice(0)) d()
    ;(globalThis as any).CS = savedCS
    vi.restoreAllMocks()
})

const RED = [1, 0, 0]
const BLUE = [0, 0, 1]
const WHITE = [1, 1, 1]

describe("scene.sky", () => {
    it("sends nothing for a scene that never has one", () => {
        const s = scene()
        s.sky(false)
        expect(of("SetSky")).toHaveLength(0)
    })

    it("is a clear day when called with nothing, its bottom the horizon's colour", () => {
        const s = scene()
        s.sky()
        const [on, ...rest] = last("SetSky")
        expect(on).toBe(true)
        const horizon = rest.slice(3, 6)
        expect(rest.slice(6, 9)).toEqual(horizon)
        expect(rest.slice(9)).toEqual([SCENE_DEFAULTS.sky.sun.size, SCENE_DEFAULTS.sky.sun.glow, 0])
    })

    it("changes only what it names", () => {
        const s = scene()
        s.sky({ top: "#ff0000", horizon: "#0000ff", bottom: "#ffffff", stars: 0.5, sun: { size: 3 } })
        expect(last("SetSky")).toEqual([true, ...RED, ...BLUE, ...WHITE, 3, SCENE_DEFAULTS.sky.sun.glow, 0.5])
        s.sky({ top: "#0000ff" })
        expect(last("SetSky")).toEqual([true, ...BLUE, ...BLUE, ...WHITE, 3, SCENE_DEFAULTS.sky.sun.glow, 0.5])
        s.sky({ sun: false })
        expect(last("SetSky").slice(10)).toEqual([0, 0, 0.5])
        s.sky({ sun: { glow: 5 } })
        expect(last("SetSky").slice(10)).toEqual([SCENE_DEFAULTS.sky.sun.size, 5, 0.5])
    })

    it("goes with false, back to the background colour", () => {
        const s = scene()
        s.sky()
        s.sky(false)
        expect(last("SetSky")[0]).toBe(false)
        s.sky({ stars: 1 })
        expect(last("SetSky")[0]).toBe(true)
        expect(last("SetSky")[12]).toBe(1)
        expect(last("SetSky")[10]).toBe(SCENE_DEFAULTS.sky.sun.size)
    })

    it("can be a scene option", () => {
        scene({ sky: { top: "#ff0000" } })
        expect(last("SetSky").slice(0, 4)).toEqual([true, ...RED])
    })

    it("throws for a colour it cannot read before anything changes", () => {
        const s = scene()
        s.sky({ top: "#ff0000" })
        const sent = of("SetSky").length
        expect(() => s.sky({ horizon: "not a colour" })).toThrow(/sky horizon/)
        expect(of("SetSky")).toHaveLength(sent)
        s.sky({ stars: 1 })
        expect(last("SetSky").slice(0, 4)).toEqual([true, ...RED])
    })

    it("lends its horizon to fog with no colour of its own, and not to fog with one", () => {
        const s = scene({ background: "#000000", fog: { near: 5, far: 20 } })
        expect(last("SetFog").slice(1, 4)).toEqual([0, 0, 0])
        s.sky({ horizon: "#0000ff" })
        expect(last("SetFog").slice(1, 4)).toEqual(BLUE)
        s.sky(false)
        expect(last("SetFog").slice(1, 4)).toEqual([0, 0, 0])
        s.fog({ color: "#ff0000" })
        s.sky({ horizon: "#0000ff" })
        expect(last("SetFog").slice(1, 4)).toEqual(RED)
    })

    it("says once that an older OneJS has no sky, and sends nothing", () => {
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: bridge(["SetSky"]) } } }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene()
        s.sky()
        s.sky({ stars: 1 })
        expect(warn.mock.calls.filter((c) => String(c[0]).includes("scene.sky needs a newer OneJS"))).toHaveLength(1)
    })

    it("sends no reflection for a scene never asked to reflect, so its calls are a 1.7 scene's", () => {
        const s = scene({ sky: { top: "#ff0000" } })
        s.sky({ stars: 1 })
        s.sky(false)
        expect(s.reflections).toBe(false)
        expect(of("SetSkyReflect")).toHaveLength(0)
    })

    it("reflects the sky once asked, after the sky it reflects, and keeps reflecting through its changes", () => {
        const s = scene({ sky: {}, reflections: "sky" })
        const names = calls.map((c) => c[0])
        expect(names.indexOf("SetSkyReflect")).toBeGreaterThan(names.lastIndexOf("SetSky"))
        expect(last("SetSkyReflect")).toEqual([true])
        expect(s.reflections).toBe("sky")
        s.sky({ stars: 1 })
        expect(last("SetSkyReflect")).toEqual([true])
        s.reflections = false
        expect(last("SetSkyReflect")).toEqual([false])
        const sent = of("SetSkyReflect").length
        s.sky({ stars: 0 })
        expect(of("SetSkyReflect")).toHaveLength(sent)
    })

    it("keeps asking through a sky taken away and given back, and sends nothing while there is none", () => {
        const s = scene({ reflections: "sky" })
        expect(of("SetSkyReflect")).toHaveLength(0)
        s.sky()
        expect(last("SetSkyReflect")).toEqual([true])
        s.sky(false)
        const sent = of("SetSkyReflect").length
        s.reflections = false
        s.reflections = "sky"
        expect(of("SetSkyReflect")).toHaveLength(sent)
        s.sky()
        expect(last("SetSkyReflect")).toEqual([true])
    })

    it("refuses \"world\", which is not built yet, and anything else, before anything changes", () => {
        expect(() => scene({ sky: {}, reflections: "world" as any })).toThrow(/"world" is not available yet/)
        const s = scene({ sky: {}, reflections: "sky" })
        const sent = of("SetSkyReflect").length
        expect(() => { s.reflections = "world" as any }).toThrow(/"world" is not available yet/)
        expect(() => { s.reflections = true as any }).toThrow(/takes "sky" or false/)
        expect(s.reflections).toBe("sky")
        expect(of("SetSkyReflect")).toHaveLength(sent)
    })

    it("says once that an older OneJS has no reflections, and still draws the sky", () => {
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: bridge(["SetSkyReflect"]) } } }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const s = scene({ sky: {}, reflections: "sky" })
        s.sky({ stars: 1 })
        expect(of("SetSky")).toHaveLength(2)
        expect(warn.mock.calls.filter((c) => String(c[0]).includes("scene.reflections needs a newer OneJS"))).toHaveLength(1)
    })
})
