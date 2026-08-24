import { describe, it, expect } from "vitest"
import { newSwipe, begin, end, moveTo, THRESHOLD } from "./swipe"

describe("swipe", () => {
    it("says nothing until the finger has gone far enough", () => {
        const s = newSwipe()
        begin(s, 100, 100)
        expect(moveTo(s, 100 + THRESHOLD - 1, 100)).toBeNull()
        expect(moveTo(s, 100 + THRESHOLD, 100)).toBe("right")
    })

    it("reads all four directions", () => {
        const far = THRESHOLD + 10
        const swipe = (dx: number, dy: number) => {
            const s = newSwipe()
            begin(s, 100, 100)
            return moveTo(s, 100 + dx, 100 + dy)
        }
        expect(swipe(far, 0)).toBe("right")
        expect(swipe(-far, 0)).toBe("left")
        expect(swipe(0, far)).toBe("down")
        expect(swipe(0, -far)).toBe("up")
    })

    it("picks the axis the finger actually travelled furthest on", () => {
        const s = newSwipe()
        begin(s, 100, 100)
        expect(moveTo(s, 160, 120)).toBe("right")
    })

    it("fires once per gesture however far the finger keeps going", () => {
        const s = newSwipe()
        begin(s, 100, 100)
        expect(moveTo(s, 200, 100)).toBe("right")
        expect(moveTo(s, 300, 100)).toBeNull()
        expect(moveTo(s, 300, 300)).toBeNull()
    })

    it("arms again for the next gesture", () => {
        const s = newSwipe()
        begin(s, 100, 100)
        expect(moveTo(s, 200, 100)).toBe("right")
        end(s)
        begin(s, 100, 100)
        expect(moveTo(s, 100, 200)).toBe("down")
    })

    it("ignores movement when no finger is down", () => {
        const s = newSwipe()
        expect(moveTo(s, 500, 500)).toBeNull()
        end(s)
        expect(moveTo(s, 500, 500)).toBeNull()
    })

    it("treats a new touch as a new gesture even without an end", () => {
        const s = newSwipe()
        begin(s, 100, 100)
        expect(moveTo(s, 200, 100)).toBe("right")
        begin(s, 400, 400)
        expect(moveTo(s, 400, 500)).toBe("down")
    })

    it("measures a diagonal by its longer side, not its length", () => {
        const s = newSwipe()
        begin(s, 0, 0)
        const just = THRESHOLD - 2
        expect(moveTo(s, just, just)).toBeNull()
    })
})
