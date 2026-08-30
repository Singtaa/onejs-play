import { describe, it, expect } from "vitest"
import * as oj from "../index"
import { Vector2 } from "../vec"

/**
 * Names onejs-react exports that the container must not expose, because their
 * public API needs CS.*. Each would be a runtime landmine: it type-checks, it
 * imports, and it throws the first time a game actually calls it.
 */
const MUST_NOT_EXPORT = [
    "useVectorContent",
    "registerElement",
    "createComponent",
    "toArray",
    "useEventSync",
    "useFrameSync",
    "useFrameSyncWith",
    "useThrottledSync",
    "toWire",
    "unmountAll",
    "getDebugInfo",
]

/**
 * Container machinery that must live behind onejs-play/container, not on the
 * surface a game imports. Same split react and react-dom draw.
 */
const CONTAINER_ONLY = [
    "evaluateBundle",
    "snapshotGlobals",
    "removeAddedGlobals",
    "SHADOWED_GLOBALS",
    "INJECTED_GLOBALS",
    "createContainerInput",
]

describe("container surface", () => {
    it("keeps host-only machinery off the game surface", () => {
        const leaked = CONTAINER_ONLY.filter((name) => name in oj)
        expect(leaked).toEqual([])
    })

    it("exposes that machinery on the container entry point instead", async () => {
        const container = await import("../container")
        for (const name of CONTAINER_ONLY) {
            expect(container).toHaveProperty(name)
        }
    })

    it("does not re-export anything that requires CS.*", () => {
        const leaked = MUST_NOT_EXPORT.filter((name) => name in oj)
        expect(leaked).toEqual([])
    })

    it("shadows Vector2 with a constructible class, not a CS type alias", () => {
        expect(typeof oj.Vector2).toBe("function")
        const v = new oj.Vector2(3, 4)
        expect(v.magnitude).toBe(5)
    })

    it("shadows Color with a constructible class", () => {
        expect(typeof oj.Color).toBe("function")
        expect(oj.Color.FromHex("#ff8800").r).toBe(1)
    })

    it("exposes Mathf and random as values", () => {
        expect(typeof oj.Mathf.Lerp).toBe("function")
        expect(typeof oj.random).toBe("function")
    })

    // Transform2D is exported, but it must be oj's JS one. onejs-react's
    // returns new CS.UnityEngine.Vector2 from point() and would throw here.
    it("exports oj's Transform2D, not the CS-backed one", () => {
        const p = new oj.Transform2D().translate(10, 20).point(1, 2)
        expect(p).toBeInstanceOf(Vector2)
        expect(p.x).toBe(11)
        expect(p.y).toBe(22)
    })

    // Games call onejs-unity's input, not a second API, so the same code reads
    // identically here and after eject.
    it("re-exports onejs-unity's input rather than a parallel API", () => {
        expect(oj.input).toBeDefined()
        expect(typeof oj.input.keyboard.isKeyDown).toBe("function")
        expect(typeof oj.input.mouse).toBe("object")
        expect("createInput" in oj).toBe(false)
    })

    it("exposes the batched painter rather than the raw one", () => {
        expect(typeof oj.batchedVisualContent).toBe("function")
        expect(typeof oj.Painter).toBe("function")
        expect("useVectorContent" in oj).toBe(false)
    })

    it("exposes the stage helpers", () => {
        expect(oj.DEFAULT_STAGE_WIDTH).toBe(960)
        expect(oj.DEFAULT_STAGE_HEIGHT).toBe(540)
        expect(typeof oj.computeStageLayout).toBe("function")
    })

    it("exposes the components a game renders with", () => {
        for (const name of ["View", "Text", "Label", "Button", "TextField", "Toggle", "Slider", "ScrollView", "Image"]) {
            expect(oj).toHaveProperty(name)
        }
    })

    it("exposes render as the entry point", () => {
        expect(typeof oj.render).toBe("function")
    })
})

describe("the shader language is reachable from oj", () => {
    it("exposes sl, encode and ShaderProgram", () => {
        // Every phase of this could be finished and a Play author still unable
        // to reach any of it. That gap is invisible from inside the packages
        // that built it, which is why it is a test rather than a note.
        expect(typeof (oj as any).sl).toBe("object")
        expect(typeof (oj as any).sl.program).toBe("function")
        expect(typeof (oj as any).encode).toBe("function")
        expect((oj as any).ShaderProgram).toBeDefined()
    })

    it("records and encodes a program end to end", () => {
        const sl = (oj as any).sl
        const p = sl.program(({ uv, time }: any) => {
            const q = uv.mul(8).add(time.mul(0.4))
            const v = sl.sin(q.x).add(sl.sin(q.y))
            return sl.ramp(v.mul(0.25).add(0.5), ["#000018", "#0080ff", "#ffffff"])
        })
        const e = (oj as any).encode(p)
        expect(e.hash).toMatch(/^[0-9a-f]{8}$/)
        expect(e.instructions).toBeGreaterThan(0)
        expect(e.registersUsed).toBeLessThanOrEqual(8)
    })

    it("can build the manifest an ejected project compiles from", () => {
        const sl = (oj as any).sl
        const p = sl.program(({ uv }: any) => sl.vec4(uv, 0, 1))
        const m = (oj as any).manifest([p])
        expect(m.programs[0].hash).toBe(p.hash)
        expect(m.programs[0].hlsl).toContain("Shader ")
    })
})
