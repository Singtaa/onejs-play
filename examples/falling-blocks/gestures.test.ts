import { describe, it, expect } from "vitest"
import {
    beginGesture, advanceGesture, releaseGesture, isSoftDropping, spendDrop,
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

describe("one drag, one piece", () => {
    it("stops dropping once the piece it was aimed at has landed", () => {
        // The piece locks and the next one spawns under a finger that is still
        // down and still dragging. Without this it drops too, and the player
        // never gets the moment they needed to lift.
        const g = beginGesture(0, 0)
        advanceGesture(g, 0, SWIPE_STEP * 3, 0.3)
        expect(isSoftDropping(g)).toBe(true)
        spendDrop(g)
        expect(isSoftDropping(g)).toBe(false)
    })

    it("stays spent even as the finger keeps moving down", () => {
        const g = beginGesture(0, 0)
        advanceGesture(g, 0, SWIPE_STEP * 2, 0.2)
        spendDrop(g)
        advanceGesture(g, 0, SWIPE_STEP * 6, 0.2)
        expect(isSoftDropping(g)).toBe(false)
    })

    it("does not hard drop the next piece when the finger finally lifts", () => {
        // A flick that landed a piece must not also throw the one after it.
        const g = beginGesture(0, 0)
        advanceGesture(g, 0, 300, 0.1)
        spendDrop(g)
        expect(releaseGesture(g)).toBe("none")
    })

    it("still steers sideways, which is what a finger already down is for", () => {
        const g = beginGesture(0, 0)
        spendDrop(g)
        expect(advanceGesture(g, SWIPE_STEP * 2, 0, 0.05)).toBe(2)
    })

    it("comes back fresh on the next touch", () => {
        const spent = beginGesture(0, 0)
        spendDrop(spent)
        const fresh = beginGesture(0, 0)
        advanceGesture(fresh, 0, SWIPE_STEP * 2, 0.2)
        expect(isSoftDropping(fresh)).toBe(true)
    })
})
