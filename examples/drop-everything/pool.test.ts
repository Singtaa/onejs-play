import { describe, it, expect } from "vitest"
import { Pool } from "./pool"

describe("Pool", () => {
    it("hands out each body once before repeating", () => {
        const pool = new Pool(4)
        const taken = [pool.take(), pool.take(), pool.take(), pool.take()]
        expect(taken.every((t) => t.recycled === null)).toBe(true)
        expect(new Set(taken.map((t) => t.body)).size).toBe(4)
    })

    it("counts what is in use", () => {
        const pool = new Pool(3)
        expect(pool.inUse).toBe(0)
        pool.take()
        pool.take()
        expect(pool.inUse).toBe(2)
    })

    it("never exceeds its size", () => {
        const pool = new Pool(3)
        for (let i = 0; i < 20; i++) pool.take()
        expect(pool.inUse).toBe(3)
    })

    it("recycles the oldest once nothing is free", () => {
        const pool = new Pool(3)
        const first = pool.take().body
        pool.take()
        pool.take()
        const fourth = pool.take()
        expect(fourth.recycled).toBe(first)
        expect(fourth.body).toBe(first)
    })

    it("recycles in order, oldest first, round after round", () => {
        const pool = new Pool(3)
        const order = [pool.take().body, pool.take().body, pool.take().body]
        expect(pool.take().recycled).toBe(order[0])
        expect(pool.take().recycled).toBe(order[1])
        expect(pool.take().recycled).toBe(order[2])
        // And round again, in the same order.
        expect(pool.take().recycled).toBe(order[0])
    })

    it("says nothing was recycled while bodies remain free", () => {
        const pool = new Pool(2)
        expect(pool.take().recycled).toBeNull()
        expect(pool.take().recycled).toBeNull()
        expect(pool.take().recycled).not.toBeNull()
    })

    it("gives everything back when cleared, and reports what was live", () => {
        const pool = new Pool(4)
        const a = pool.take().body
        const b = pool.take().body
        expect(new Set(pool.clear())).toEqual(new Set([a, b]))
        expect(pool.inUse).toBe(0)
    })

    it("starts over cleanly after a clear", () => {
        const pool = new Pool(3)
        pool.take()
        pool.take()
        pool.clear()
        const fresh = [pool.take(), pool.take(), pool.take()]
        expect(fresh.every((t) => t.recycled === null)).toBe(true)
    })

    it("lists what is live, oldest first", () => {
        const pool = new Pool(4)
        const a = pool.take().body
        const b = pool.take().body
        expect(pool.snapshot()).toEqual([a, b])
    })

    it("keeps the live list in age order after recycling", () => {
        const pool = new Pool(2)
        const a = pool.take().body
        const b = pool.take().body
        pool.take()
        // a was recycled and is now the newest, so b is the oldest.
        expect(pool.snapshot()).toEqual([b, a])
    })

    it("refuses to hand anything out when it holds nothing", () => {
        expect(() => new Pool(0).take()).toThrow(/no bodies/)
    })
})
