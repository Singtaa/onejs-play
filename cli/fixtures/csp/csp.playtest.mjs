// The local page refuses what the game origin refuses (host/csp.mjs): a cart
// that passes here cannot be refused by the site's policy, and one the site
// would refuse fails here. Without the header, data: and another origin load.
export default async function (cart) {
    const answers = await cart.until(async () => JSON.parse(await cart.eval("JSON.stringify(globalThis.__csp ?? null)")), { timeoutMs: 30000, what: "the three fetches" })
    const want = { blob: "ok", data: "refused", elsewhere: "refused" }
    for (const [k, v] of Object.entries(want)) {
        if (answers[k] !== v) throw new Error(`${k}: wanted ${v}, got ${answers[k]} (${JSON.stringify(answers)})`)
    }
    // The two refusals are this script's own probes and are logged as errors,
    // which fail a run; only lines naming the addresses it asked for go.
    const own = (line) => line.includes("data:,elsewhere") || line.includes("https://example.com/")
    const kept = cart.errors.filter((line) => !own(line))
    const suppressed = cart.errors.length - kept.length
    cart.errors.splice(0, cart.errors.length, ...kept)
    console.log(`csp: ${JSON.stringify(answers)}; ${suppressed} console line(s) from the refused probes set aside`)
}
