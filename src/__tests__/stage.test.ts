import { describe, it, expect } from "vitest"
import { stageOf, screenToStage, screenDeltaToStage } from "../stage"

describe("stageOf", () => {
    it("is the measured viewport", () => {
        expect(stageOf(1280, 720)).toEqual({ width: 1280, height: 720 })
    })

    /** UI Toolkit measures nothing on its first frames; a game dividing by the stage must never see zero. */
    it("falls back to a usable size until something is measured", () => {
        const bad: Array<[number, number]> = [
            [0, 0], [0, 540], [960, 0], [-100, 540], [NaN, 540], [960, NaN], [Infinity, 540],
        ]
        for (const [w, h] of bad) {
            const s = stageOf(w, h)
            expect(s.width).toBeGreaterThan(0)
            expect(s.height).toBeGreaterThan(0)
            expect(Number.isFinite(s.width) && Number.isFinite(s.height)).toBe(true)
        }
    })

    it("hands out a fresh object, so a caller mutating one cannot change the fallback", () => {
        const a = stageOf(0, 0)
        a.width = 1
        expect(stageOf(0, 0).width).not.toBe(1)
    })
})

/**
 * Unity's input and UI Toolkit disagree about where the origin is, which way y
 * goes, and whether a pixel is physical or logical. These are the tests that
 * make the eject path's pointer conversion something other than a guess.
 */
describe("screenToStage", () => {
    const stage = stageOf(800, 600)

    it("puts the bottom of the screen at the bottom of the stage", () => {
        // Unity y = 0 is the BOTTOM. On the stage the bottom is y = height.
        expect(screenToStage(stage, 0, 0, 1).y).toBe(600)
    })

    it("puts the top of the screen at the top of the stage", () => {
        expect(screenToStage(stage, 0, 600, 1).y).toBe(0)
    })

    it("leaves x alone apart from the pixel ratio", () => {
        expect(screenToStage(stage, 123, 0, 1).x).toBe(123)
    })

    it("divides physical pixels down to logical ones", () => {
        // The same physical point on a 2x display is the same stage point.
        const at1x = screenToStage(stage, 400, 300, 1)
        const at2x = screenToStage(stage, 800, 600, 2)
        expect(at2x).toEqual(at1x)
    })

    it("survives a pixel ratio of zero rather than dividing by it", () => {
        expect(Number.isFinite(screenToStage(stage, 100, 100, 0).x)).toBe(true)
    })
})

describe("screenDeltaToStage", () => {
    it("flips the vertical direction and leaves the horizontal alone", () => {
        const moved = screenDeltaToStage(10, 10, 1)
        expect(moved.x).toBe(10)
        // Moving up in Unity is moving toward smaller y on the stage.
        expect(moved.y).toBe(-10)
    })

    it("divides physical pixels down to logical ones", () => {
        expect(screenDeltaToStage(20, 20, 2)).toEqual({ x: 10, y: -10 })
    })

    /**
     * The mistake this function exists to prevent: a delta run through
     * screenToStage picks up the stage height and reads as a huge jump.
     */
    it("does not pick up the stage height the way a position does", () => {
        expect(Math.abs(screenDeltaToStage(0, 0, 1).y)).toBe(0)
        expect(screenToStage(stageOf(800, 600), 0, 0, 1).y).toBe(600)
    })
})
