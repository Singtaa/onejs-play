/**
 * setLoadBudget: the milliseconds a frame loading models may take, handed to
 * ModelBridge.LoadBudget as the number it is.
 */
import { describe, it, expect, afterEach } from "vitest"
import { setLoadBudget } from "../models"

afterEach(() => {
    delete (globalThis as any).CS
})

// ActorCount is what models.ts reads to know the host has a ModelBridge at all.
function host(bridge: any) {
    bridge.ActorCount = 0
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: bridge } } }
    return bridge
}

describe("setLoadBudget", () => {
    it("sets the bridge's budget in milliseconds, and 0 back to the engine's own pace", () => {
        const b = host({ LoadBudget: 0 })
        setLoadBudget(4)
        expect(b.LoadBudget).toBe(4)
        setLoadBudget(0)
        expect(b.LoadBudget).toBe(0)
    })

    it("refuses what is not 0 or more milliseconds, and sets nothing", () => {
        const b = host({ LoadBudget: 2 })
        for (const bad of [-1, NaN, Infinity]) expect(() => setLoadBudget(bad)).toThrow(/0 or more milliseconds/)
        expect(b.LoadBudget).toBe(2)
    })

    it("says a host without a load budget needs a newer OneJS", () => {
        host({})
        expect(() => setLoadBudget(4)).toThrow(/needs a newer OneJS/)
    })
})
