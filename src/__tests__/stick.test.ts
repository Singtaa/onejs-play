import { describe, expect, it } from "vitest"
import { newStick, readPad, readStick, type PadState, type TouchPoint } from "../stick"

const touch = (fingerId: number, x: number, y: number, phase: TouchPoint["phase"] = "moved"): TouchPoint =>
    ({ fingerId, position: { x, y }, phase } as TouchPoint)
const left = (x: number) => x < 400

describe("a stick", () => {
    it("takes a thumb that comes down on its half and follows it", () => {
        const s = newStick(50)
        readStick(s, [touch(1, 100, 300, "began")], left)
        expect(s.active).toBe(true)
        expect([s.originX, s.originY]).toEqual([100, 300])
        readStick(s, [touch(1, 125, 300)], left)
        expect(s.x).toBeCloseTo(0.5)
        expect(s.y).toBeCloseTo(0)
    })

    it("ignores a thumb on the other half, and one already down", () => {
        const s = newStick(50)
        readStick(s, [touch(1, 600, 300, "began")], left)
        expect(s.active).toBe(false)
        readStick(s, [touch(2, 100, 300)], left)
        expect(s.active).toBe(false)
    })

    it("keeps its thumb wherever it wanders, and drags its centre past the edge", () => {
        const s = newStick(50)
        readStick(s, [touch(1, 100, 300, "began")], left)
        readStick(s, [touch(1, 700, 300)], left)
        expect(s.active).toBe(true)
        expect(s.x).toBeCloseTo(1)
        expect(s.originX).toBeCloseTo(650)
        // Pulling back answers at once rather than after crossing the whole way.
        readStick(s, [touch(1, 640, 300)], left)
        expect(s.x).toBeLessThan(0)
    })

    it("lets go when the thumb lifts", () => {
        const s = newStick(50)
        readStick(s, [touch(1, 100, 300, "began")], left)
        readStick(s, [touch(1, 140, 300)], left)
        readStick(s, [touch(1, 140, 300, "ended")], left)
        expect(s.active).toBe(false)
        expect(s.x).toBe(0)
        readStick(s, [], left)
        expect(s.active).toBe(false)
    })
})

describe("a pad", () => {
    const pad = (): PadState => ({ down: false, pressed: false, released: false, x: 700, y: 300, radius: 30, finger: -1 })

    it("is down while a finger that landed on it stays, pressed and released once each", () => {
        const p = pad()
        readPad(p, [touch(3, 710, 305, "began")])
        expect([p.down, p.pressed]).toEqual([true, true])
        readPad(p, [touch(3, 760, 360)])
        expect([p.down, p.pressed]).toEqual([true, false])
        readPad(p, [])
        expect([p.down, p.released]).toEqual([false, true])
        readPad(p, [])
        expect(p.released).toBe(false)
    })

    it("ignores a finger that lands beside it", () => {
        const p = pad()
        readPad(p, [touch(3, 650, 300, "began")])
        expect(p.down).toBe(false)
    })
})
