import { mount, loadModel, setLoadBudget } from "oj"

// setLoadBudget as a loading screen uses it: 4 ms a frame while two models load, then 0. Reads
// OneJS's ModelBridge.LoadBudget by its C# name at each step, so load-budget.playtest.mjs can say
// whether the budget reached the engine and not only whether the call returned. A runtime without
// it throws at the first call, which the playtest reports as such.
const seen: Record<string, unknown> = { done: false }
;(globalThis as any).budget = seen
const bridge = () => (globalThis as any).CS.OneJS.Models.ModelBridge

async function run() {
    try {
        setLoadBudget(4)
    } catch (e) {
        seen.threw = String((e as Error).message)
        seen.done = true
        return
    }
    seen.during = bridge().LoadBudget
    try {
        setLoadBudget(-1)
        seen.negative = "accepted"
    } catch {
        seen.negative = "refused"
    }
    const models = await Promise.all([loadModel("crate.glb"), loadModel("car.glb")])
    seen.loaded = models.filter((m) => m.height > 0).length
    setLoadBudget(0)
    seen.after = bridge().LoadBudget
    seen.done = true
}

function Budget() {
    return null
}

mount(<Budget />)
run()
