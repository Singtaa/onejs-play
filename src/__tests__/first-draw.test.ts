/**
 * The first-draw clock (runtime-1.3.md section 11): where the page compiles
 * programs off the frame, the clock holds behind the cart's first screen
 * until its programs have drawn once, or FIRST_DRAW_CAP seconds, so a count
 * kept in useFrame is 0 at a program's first draw, not 10, 3 and 3.
 */
import { describe, it, expect, afterEach } from "vitest"
import { createRuntime, FIRST_DRAW_CAP } from "../runtime"
import { setInputBackend } from "onejs-unity/input"

afterEach(() => { setInputBackend(null) })

function counted(pendingCompiles?: () => number) {
    const runtime = createRuntime({ root: {}, version: "1.0.0", pendingCompiles })
    const seen: Array<[number, number]> = []
    runtime.oj.onFrame((dt, realDt) => seen.push([dt, realDt]))
    return { runtime, seen }
}

describe("the first-draw clock", () => {
    it("holds every phase and oj.time while the first screen's programs compile, then starts with a normal frame", () => {
        let compiling = 2
        const { runtime, seen } = counted(() => compiling)
        const late: number[] = []
        runtime.oj.onLateFrame((dt) => late.push(dt))
        runtime.oj.armFirstDraw()
        expect(runtime.oj.holding).toBe(true)
        runtime.beginFrame(0.1, 0.4)
        compiling = 1
        runtime.beginFrame(0.1, 0.3)
        expect(seen).toEqual([])
        expect(late).toEqual([])
        expect(runtime.oj.time.frame).toBe(0)
        expect(runtime.oj.time.now).toBe(0)
        compiling = 0
        runtime.beginFrame(0.1, 0.7)
        expect(seen).toEqual([[1 / 60, 1 / 60]])
        expect(runtime.oj.time.frame).toBe(1)
        expect(runtime.oj.holding).toBe(false)
        runtime.beginFrame(0.02, 0.02)
        expect(seen.at(-1)).toEqual([0.02, 0.02])
        runtime.dispose()
    })

    it("starts after FIRST_DRAW_CAP seconds held, however long a compile takes", () => {
        const { runtime, seen } = counted(() => 1)
        runtime.oj.armFirstDraw()
        const frames = Math.round(FIRST_DRAW_CAP / 0.5)
        for (let i = 1; i < frames; i++) runtime.beginFrame(0.1, 0.5)
        expect(seen).toHaveLength(0)
        runtime.beginFrame(0.1, 0.5)
        expect(seen).toEqual([[1 / 60, 1 / 60]])
        runtime.dispose()
    })

    it("asks the count once a frame only while it holds, and never again", () => {
        let asked = 0
        const { runtime } = counted(() => { asked++; return 0 })
        runtime.beginFrame(0.016)
        expect(asked).toBe(0)
        runtime.oj.armFirstDraw()
        runtime.beginFrame(0.016)
        runtime.beginFrame(0.016)
        expect(asked).toBe(1)
        runtime.dispose()
    })

    it("holds nothing before the cart's first screen, nor for programs mounted after the hold", () => {
        let compiling = 1
        const { runtime, seen } = counted(() => compiling)
        runtime.beginFrame(0.016)
        expect(seen).toHaveLength(1)
        runtime.oj.armFirstDraw()
        compiling = 0
        runtime.beginFrame(0.016)
        compiling = 3
        runtime.oj.armFirstDraw()
        runtime.beginFrame(0.016)
        expect(seen).toHaveLength(3)
        runtime.dispose()
    })

    it("holds nothing where the host compiles as programs are made, or its count cannot be read", () => {
        for (const pendingCompiles of [undefined, () => NaN, () => { throw new Error("no such member") }]) {
            const { runtime, seen } = counted(pendingCompiles)
            runtime.oj.armFirstDraw()
            runtime.beginFrame(0.016)
            expect(seen, String(pendingCompiles)).toHaveLength(1)
            runtime.dispose()
        }
    })

    it("says when the hold ends, once, so the loading bar can go", () => {
        let compiling = 1
        const { runtime } = counted(() => compiling)
        runtime.oj.armFirstDraw()
        let ended = 0
        runtime.oj.onHoldChange(() => ended++)
        runtime.beginFrame(0.016)
        expect(ended).toBe(0)
        compiling = 0
        runtime.beginFrame(0.016)
        runtime.beginFrame(0.016)
        expect(ended).toBe(1)
        runtime.dispose()
    })
})
