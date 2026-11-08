// Reads the cart's numbers, then runs the same cases on the browser's own timers
// in the page as the control. Exits non-zero through a throw when nothing was read.
const CONTROL = `(async () => {
    const n = globalThis.__onejsNativeTimers
    if (!n) return JSON.stringify({ error: "no native stash" })
    const st = n.setTimeout
    const busy = (ms) => { const end = performance.now() + ms; while (performance.now() < end) {} }
    const one = (deep) => new Promise((done) => {
        st(async () => {
            const t0 = performance.now()
            if (deep) await (async () => { await (async () => { await null })() })()
            else await Promise.resolve()
            done(performance.now() - t0)
        }, 20)
        st(() => busy(8), 20)
    })
    const a = [], b = []
    for (let i = 0; i < 5; i++) a.push(await one(false))
    for (let i = 0; i < 5; i++) b.push(await one(true))
    return JSON.stringify({ awaitBeside: a, chainBeside: b })
})()`

export default async function (game) {
    await game.until(async () => (await game.read()).join("\n").includes("awaitBeside"), { what: "the cart numbers", timeoutMs: 30000 })
    const text = (await game.read()).join("\n")
    const cart = JSON.parse(text.slice(text.indexOf("{")))
    const native = JSON.parse(await game.eval(CONTROL))
    console.log("CART " + JSON.stringify(cart))
    console.log("NATIVE " + JSON.stringify(native))
    if (native.error) throw new Error(native.error)
    // The browser's order: an await resumes before the next due callback runs.
    const worst = Math.max(...cart.awaitBeside, ...cart.chainBeside)
    if (worst > 1) throw new Error(`an await beside an 8 ms callback took ${worst.toFixed(1)} ms; the browser's own timers give ${Math.max(...native.awaitBeside, ...native.chainBeside).toFixed(2)} ms`)
    // The container's 4 ms budget a frame for timers: ten 2 ms jobs due at
    // once spread over frames, two or three a frame, not ten in one.
    if (cart.sliced.jobsInOneFrame > 3) throw new Error(`${cart.sliced.jobsInOneFrame} of ten 2 ms timers ran in one frame; the budget allows two or three`)
}
