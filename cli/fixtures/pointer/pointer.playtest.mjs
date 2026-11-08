// A press lands where it was sent: in a pointer event's x and y, and in
// `input` whenever it saw the press, on a 1x desktop and on a 3x phone, by
// mouse and by touch.
//
// Unity's WebGL input counts device pixel rows from 0 at the bottom and UI
// Toolkit flipped them as if they started at 1, so up to runtime 1.0.66 every
// pointer event read one device pixel low (400 as 401 at 1x, 422 as 422.33 at
// 3x) and the bottom row reached nothing. `input` reads the browser's events
// and was right throughout. PlayRuntime/Assets/Scripts/PointerRows.cs.
//
// Unity's player also takes the mouse's position from mousemove alone, so up
// to runtime 1.3.2 a press with no move before it reached the pointer event
// at the last move, (0, 539) on a fresh page (Tachi's finding 23, 7 Nov).
// The adapter moves Unity's mouse to such a press (src/adapter.ts). `click`
// moves first, as a real mouse does, so the bare presses below are what
// checks that a mouse resting since the page loaded still presses where it is.
const DESK = [[640, 400], [195, 422], [0, 0], [959, 539]]
const PHONE = [[195, 422], [100, 300], [389, 843]]
const BARE = [[300, 200], [500, 300]]
/** The last runtime that pressed a bare mousePressed at the last move. */
const BARE_FIXED_AFTER = [1, 3, 2]

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

/** A press and release with no move before it, as a mouse that has not moved since the page loaded sends. */
async function barePress(cart, x, y) {
    await cart.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 })
    await cart.wait(70)
    await cart.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 })
}

function newer(version, than) {
    const v = String(version).split(".").map(Number)
    for (let i = 0; i < 3; i++) if (v[i] !== than[i]) return v[i] > than[i]
    return false
}

export default async function (cart) {
    const desk = await cart.stage()
    if (desk.width !== 960 || desk.height !== 540) throw new Error(`the stage is ${desk.width} by ${desk.height}; this script expects the 960 by 540 default`)
    // First, before anything has moved the mouse.
    const runtime = await cart.eval("__ojPlay.runtime.oj.version")
    if (newer(runtime, BARE_FIXED_AFTER)) {
        for (const [x, y] of BARE) await check(cart, "press with no move", x, y, () => barePress(cart, x, y))
    } else {
        console.log(`[pointer] runtime ${runtime} presses a bare mousePressed at the last move; the bare presses run after ${BARE_FIXED_AFTER.join(".")}`)
    }
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
