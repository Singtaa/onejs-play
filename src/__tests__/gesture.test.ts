import { describe, it, expect } from "vitest"
import { newSwipeTracker, moveTo, readSwipe, SWIPE_THRESHOLD, type SwipeSource, type SwipeTracker } from "../gesture"

const T = SWIPE_THRESHOLD

/** A frame with no touch and an idle mouse. */
function idle(): SwipeSource {
    return {
        touches: [],
        mouse: { position: { x: 0, y: 0 } as any, leftButton: false, wasLeftPressed: false, wasLeftReleased: false },
    }
}

function touch(state: SwipeTracker, phase: "began" | "moved" | "stationary" | "ended" | "canceled", x: number, y: number, fingerId = 0) {
    const frame = idle()
    frame.touches = [{ fingerId, position: { x, y } as any, phase }]
    return readSwipe(state, frame, T)
}

function mouse(state: SwipeTracker, x: number, y: number, flags: Partial<SwipeSource["mouse"]>) {
    const frame = idle()
    frame.mouse = { ...frame.mouse, position: { x, y } as any, ...flags }
    return readSwipe(state, frame, T)
}

describe("moveTo, the state machine", () => {
    const start = () => {
        const s = newSwipeTracker()
        s.from = { x: 100, y: 100 }
        return s
    }

    it("says nothing until the pointer has gone far enough", () => {
        const s = start()
        expect(moveTo(s, 100 + T - 1, 100, T)).toBeNull()
        expect(moveTo(s, 100 + T, 100, T)).toBe("right")
    })

    it("reads all four directions", () => {
        const far = T + 10
        const swipe = (dx: number, dy: number) => moveTo(start(), 100 + dx, 100 + dy, T)
        expect(swipe(far, 0)).toBe("right")
        expect(swipe(-far, 0)).toBe("left")
        expect(swipe(0, far)).toBe("down")
        expect(swipe(0, -far)).toBe("up")
    })

    it("picks the axis the pointer actually travelled furthest on", () => {
        expect(moveTo(start(), 160, 120, T)).toBe("right")
    })

    it("fires once per gesture however far the pointer keeps going", () => {
        const s = start()
        expect(moveTo(s, 200, 100, T)).toBe("right")
        expect(moveTo(s, 300, 100, T)).toBeNull()
        expect(moveTo(s, 300, 300, T)).toBeNull()
    })

    it("measures a diagonal by its longer side, not its length", () => {
        const s = newSwipeTracker()
        s.from = { x: 0, y: 0 }
        const just = T - 2
        expect(moveTo(s, just, just, T)).toBeNull()
    })

    it("ignores movement when nothing is down", () => {
        expect(moveTo(newSwipeTracker(), 500, 500, T)).toBeNull()
    })
})

describe("readSwipe, by touch", () => {
    it("follows a finger from began to a swipe", () => {
        const s = newSwipeTracker()
        expect(touch(s, "began", 100, 100)).toBeNull()
        expect(touch(s, "moved", 110, 100)).toBeNull()
        expect(touch(s, "moved", 100 + T, 100)).toBe("right")
    })

    it("arms again for the next finger", () => {
        const s = newSwipeTracker()
        touch(s, "began", 100, 100)
        expect(touch(s, "moved", 200, 100)).toBe("right")
        touch(s, "ended", 200, 100)
        touch(s, "began", 100, 100)
        expect(touch(s, "moved", 100, 200)).toBe("down")
    })

    it("lets one finger drive and ignores a second", () => {
        const s = newSwipeTracker()
        touch(s, "began", 100, 100, 0)
        const frame = idle()
        frame.touches = [
            { fingerId: 0, position: { x: 100, y: 100 } as any, phase: "stationary" },
            { fingerId: 1, position: { x: 500, y: 500 } as any, phase: "began" },
        ]
        expect(readSwipe(s, frame, T)).toBeNull()
        frame.touches = [
            { fingerId: 0, position: { x: 100, y: 100 } as any, phase: "stationary" },
            { fingerId: 1, position: { x: 500, y: 500 + T } as any, phase: "moved" },
        ]
        expect(readSwipe(s, frame, T)).toBeNull()
        expect(touch(s, "moved", 100 - T, 100, 0)).toBe("left")
    })

    it("treats a cancel like a lift", () => {
        const s = newSwipeTracker()
        touch(s, "began", 100, 100)
        touch(s, "canceled", 100, 100)
        expect(s.finger).toBeNull()
        expect(touch(s, "moved", 300, 100)).toBeNull()
    })

    it("does not also listen to the mouse while a finger is down", () => {
        // The container reports a touch as the mouse as well, so a swipe that
        // read both would fire twice.
        const s = newSwipeTracker()
        touch(s, "began", 100, 100)
        expect(mouse(s, 100, 100, { wasLeftPressed: true, leftButton: true })).toBeNull()
        expect(mouse(s, 300, 100, { leftButton: true })).toBeNull()
        expect(s.source).toBe("touch")
    })
})

describe("readSwipe, by mouse", () => {
    it("follows a drag from press to a swipe", () => {
        const s = newSwipeTracker()
        expect(mouse(s, 100, 100, { wasLeftPressed: true, leftButton: true })).toBeNull()
        expect(mouse(s, 100, 100 - T, { leftButton: true })).toBe("up")
    })

    it("fires once per drag and arms again on release", () => {
        const s = newSwipeTracker()
        mouse(s, 100, 100, { wasLeftPressed: true, leftButton: true })
        expect(mouse(s, 300, 100, { leftButton: true })).toBe("right")
        expect(mouse(s, 400, 100, { leftButton: true })).toBeNull()
        mouse(s, 400, 100, { wasLeftReleased: true })
        expect(s.source).toBeNull()
        mouse(s, 100, 100, { wasLeftPressed: true, leftButton: true })
        expect(mouse(s, 100, 300, { leftButton: true })).toBe("down")
    })

    it("does nothing while the button is up", () => {
        const s = newSwipeTracker()
        expect(mouse(s, 300, 300, {})).toBeNull()
        expect(s.source).toBeNull()
    })
})
