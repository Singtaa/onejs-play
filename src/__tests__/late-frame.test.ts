/**
 * useLateFrame: a cart's callback in the late phase, after every frame
 * callback and every world's step, whenever it subscribed. subscribeLate is
 * its effect, driven here directly as watchSound is for useSound.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { createRuntime } from "../runtime"
import { subscribeLate } from "../mount"
import { setInputBackend } from "onejs-unity/input"

afterEach(() => { setInputBackend(null); vi.restoreAllMocks() })

describe("useLateFrame", () => {
    it("runs after the frame and the step, though it subscribed first, with dt and realDt", () => {
        const runtime = createRuntime({ root: {}, version: "1.0.0" })
        const ran: string[] = []
        const stop = subscribeLate((dt, realDt) => ran.push(`late ${dt} ${realDt}`))
        runtime.oj.onStep(() => ran.push("step"))
        runtime.oj.onFrame(() => ran.push("frame"))
        runtime.beginFrame(0.1, 0.25)
        expect(ran).toEqual(["frame", "step", "late 0.1 0.25"])
        stop!()
        runtime.beginFrame(0.1)
        expect(ran.filter((r) => r.startsWith("late"))).toHaveLength(1)
        runtime.dispose()
    })

    it("says once that nothing runs it where no runtime keeps a frame clock", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(subscribeLate(() => {})).toBeUndefined()
        subscribeLate(() => {})
        expect(warn.mock.calls.filter((c) => String(c[0]).includes("useLateFrame"))).toHaveLength(1)
    })
})
