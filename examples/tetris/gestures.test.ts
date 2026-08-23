import { describe, it, expect } from "vitest"
import {
    beginGesture, advanceGesture, releaseGesture, isSoftDropping,
    SWIPE_STEP, TAP_SLOP,
} from "./gestures"

describe("dragging sideways", () => {
    it("shifts a column once the finger has travelled far enough", () => {
        const g = beginGesture(100, 100)
        expect(advanceGesture(g, 100 + SWIPE_STEP - 1, 100, 0.016)).toBe(0)
        expect(advanceGesture(g, 100 + SWIPE_STEP, 100, 0.016)).toBe(1)
    })

    it("walks several columns in one frame when the finger jumps", () => {
        // A frame can be long, and a fast drag arrives as one big step. Moving
        // one column for it would make the piece lag behind the finger.
        const g = beginGesture(0, 0)
        expect(advanceGesture(g, SWIPE_STEP * 3, 0, 0.05)).toBe(3)
    })

    it("keeps the remainder, so a slow drag does not lose ground", () => {
        const g = beginGesture(0, 0)
        advanceGesture(g, SWIPE_STEP - 2, 0, 0.016)
        expect(advanceGesture(g, SWIPE_STEP + 2, 0, 0.016)).toBe(1)
    })

    it("goes left for a leftward drag", () => {
        const g = beginGesture(200, 0)
        expect(advanceGesture(g, 200 - SWIPE_STEP * 2, 0, 0.03)).toBe(-2)
    })
})

describe("letting go", () => {
    it("reads a quick still touch as a rotate", () => {
        const g = beginGesture(50, 50)
        advanceGesture(g, 52, 51, 0.05)
        expect(releaseGesture(g)).toBe("rotate")
    })

    it("still reads a rotate when the finger drifted a little", () => {
        // A finger on glass is never perfectly still, and requiring that would
        // make rotate feel broken.
        const g = beginGesture(0, 0)
        advanceGesture(g, TAP_SLOP - 2, 0, 0.1)
        expect(releaseGesture(g)).toBe("rotate")
    })

    it("does not read a long hold as a rotate", () => {
        const g = beginGesture(0, 0)
        advanceGesture(g, 1, 1, 0.6)
        expect(releaseGesture(g)).toBe("none")
    })

    it("reads a fast downward flick as a drop", () => {
        const g = beginGesture(0, 0)
        advanceGesture(g, 0, 200, 0.1)     // 2000 units a second
        expect(releaseGesture(g)).toBe("drop")
    })

    it("does not drop for a slow drag down", () => {
        // Dragging down is a soft drop while it happens; it must not also fire
        // a hard drop the moment the finger lifts.
        const g = beginGesture(0, 0)
        advanceGesture(g, 0, 200, 1.5)     // about 130 a second
        expect(releaseGesture(g)).toBe("none")
    })

    it("does not drop for a fast sideways flick", () => {
        const g = beginGesture(0, 0)
        advanceGesture(g, 400, 0, 0.1)
        expect(releaseGesture(g)).toBe("none")
    })
})

describe("soft drop", () => {
    it("starts once the drag has gone a column down, not before", () => {
        const g = beginGesture(0, 0)
        advanceGesture(g, 0, SWIPE_STEP - 1, 0.2)
        expect(isSoftDropping(g)).toBe(false)
        advanceGesture(g, 0, SWIPE_STEP + 4, 0.2)
        expect(isSoftDropping(g)).toBe(true)
    })

    it("is not triggered by dragging sideways", () => {
        const g = beginGesture(0, 0)
        advanceGesture(g, 300, 0, 0.2)
        expect(isSoftDropping(g)).toBe(false)
    })
})
