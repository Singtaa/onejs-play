// A press lands where it was sent: in a pointer event's x and y, and in
// `input` whenever it saw the press, on a 1x desktop and on a 3x phone, by
// mouse and by touch.
//
// Unity's WebGL input counts device pixel rows from 0 at the bottom and UI
// Toolkit flipped them as if they started at 1, so up to runtime 1.0.66 every
// pointer event read one device pixel low (400 as 401 at 1x, 422 as 422.33 at
// 3x) and the bottom row reached nothing. `input` reads the browser's events
// and was right throughout. PlayRuntime/Assets/Scripts/PointerRows.cs.
const DESK = [[640, 400], [195, 422], [0, 0], [959, 539]]
const PHONE = [[195, 422], [100, 300], [389, 843]]

async function presses(cart) {
    return JSON.parse(await cart.eval("JSON.stringify(globalThis.__presses.splice(0))"))
}

async function check(cart, how, x, y, send) {
    await presses(cart)
    const before = await cart.frame()
    await send()
    await cart.frameAfter(before + 2)
    const got = await cart.until(async () => {
        const all = await presses(cart)
        return all.some((p) => p.from === "event") ? all : null
    }, { timeoutMs: 3000, what: `a pointer event for the ${how} at ${x}, ${y}` })
    for (const p of got) {
        if (Math.abs(p.x - x) > 0.01 || Math.abs(p.y - y) > 0.01) {
            throw new Error(`a ${how} sent at ${x}, ${y} reached ${p.from === "event" ? "the pointer event" : "input"} at ${p.x}, ${p.y}`)
        }
    }
}

export default async function (cart) {
    const desk = await cart.stage()
    if (desk.width !== 960 || desk.height !== 540) throw new Error(`the stage is ${desk.width} by ${desk.height}; this script expects the 960 by 540 default`)
    for (const [x, y] of DESK) await check(cart, "click", x, y, () => cart.click(x, y))

    await cart.browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
    await cart.browser.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
    await cart.until(async () => (await cart.stage()).width === 390, { timeoutMs: 10000, what: "the stage to take the phone's 390 by 844" })
    for (const [x, y] of PHONE) {
        await check(cart, "tap", x, y, async () => {
            await cart.browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
            await cart.wait(80)
            await cart.browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
        })
    }
}
