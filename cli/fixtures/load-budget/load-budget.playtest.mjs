// index.tsx's run of setLoadBudget(4), two loads, setLoadBudget(0), as it read ModelBridge.LoadBudget.
// Throws, so the run exits non-zero, when the budget did not reach the engine, a negative budget was
// taken, the models did not load under it, or 0 did not put it back.

/** What is wrong with a finished run, empty when it passed. */
export function wrongs(seen) {
    if (seen.threw !== undefined) return [`setLoadBudget(4) threw: ${seen.threw}`]
    const out = []
    if (seen.during !== 4) out.push(`ModelBridge.LoadBudget read ${seen.during} after setLoadBudget(4)`)
    if (seen.negative !== "refused") out.push("setLoadBudget(-1) was taken")
    if (seen.loaded !== 2) out.push(`${seen.loaded} of 2 models loaded under the budget`)
    if (seen.after !== 0) out.push(`ModelBridge.LoadBudget read ${seen.after} after setLoadBudget(0)`)
    return out
}

export default async function (game) {
    await game.until(async () => (await game.eval("globalThis.budget?.done === true")) === true, { what: "the load-budget run", timeoutMs: 60000 })
    const seen = JSON.parse(await game.eval("JSON.stringify(globalThis.budget)"))
    console.log("BUDGET " + JSON.stringify(seen))
    const wrong = wrongs(seen)
    if (wrong.length > 0) throw new Error(`load budget: ${wrong.join("; ")}`)
}
