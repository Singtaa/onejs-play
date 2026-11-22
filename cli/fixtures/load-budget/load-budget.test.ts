import { describe, it, expect } from "vitest"
import check, { wrongs } from "./load-budget.playtest.mjs"

const GOOD = { done: true, during: 4, negative: "refused", loaded: 2, after: 0 }

/** A game whose run ended with `seen`. */
function fake(seen: Record<string, unknown>) {
    return {
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => code.includes("done === true") ? seen.done === true : JSON.stringify(seen),
    }
}

describe("the load-budget playtest", () => {
    it("passes a budget that reached the engine and went back to 0", async () => {
        await expect(check(fake(GOOD) as any)).resolves.toBeUndefined()
    })

    it("fails a runtime without setLoadBudget", async () => {
        await expect(check(fake({ done: true, threw: "setLoadBudget is not a function" }) as any)).rejects.toThrow("setLoadBudget(4) threw: setLoadBudget is not a function")
    })

    it("fails a budget the engine never saw", () => {
        expect(wrongs({ ...GOOD, during: 0 })).toEqual(["ModelBridge.LoadBudget read 0 after setLoadBudget(4)"])
    })

    it("fails a negative budget taken", () => {
        expect(wrongs({ ...GOOD, negative: "accepted" })).toEqual(["setLoadBudget(-1) was taken"])
    })

    it("fails models that did not load", () => {
        expect(wrongs({ ...GOOD, loaded: 1 })).toEqual(["1 of 2 models loaded under the budget"])
    })

    it("fails a budget left on", () => {
        expect(wrongs({ ...GOOD, after: 4 })).toEqual(["ModelBridge.LoadBudget read 4 after setLoadBudget(0)"])
    })
})
