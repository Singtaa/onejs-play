// A press on a HUD button is not a game input (engine-findings.md): a click
// or a tap on the button is over UI and the button still gets it, a thumb on
// it never starts the left stick, and a press on the game behind it, inside
// a stage-sized View that answers nothing, is the game's.
const BUTTON = [50, 25]
const GAME = [150, 300]

async function presses(cart) {
    return JSON.parse(await cart.eval("JSON.stringify({ presses: globalThis.__presses.splice(0), clicks: globalThis.__clicks })"))
}

async function after(cart, send) {
    await presses(cart)
    const before = await cart.frame()
    await send()
    await cart.frameAfter(before + 3)
    return cart.until(async () => {
        const got = await presses(cart)
        return got.presses.length > 0 ? got : null
    }, { timeoutMs: 3000, what: "the press to reach the cart" })
}

function expect(what, got, want) {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

export default async function (cart) {
    const onButton = await after(cart, () => cart.click(...BUTTON))
    expect("a click on the button", onButton.presses.map((p) => [p.by, p.overUI]), [["mouse", true]])
    expect("the button's clicks", onButton.clicks, 1)
    const onGame = await after(cart, () => cart.click(...GAME))
    expect("a click on the game", onGame.presses.map((p) => [p.by, p.overUI]), [["mouse", false]])

    await cart.browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
    await cart.browser.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
    await cart.until(async () => (await cart.stage()).width === 390, { timeoutMs: 10000, what: "the stage to take the phone's 390 by 844" })
    const tap = (x, y) => async () => {
        await cart.browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
        await cart.wait(120)
        await cart.browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    }
    const thumbOnButton = await after(cart, tap(...BUTTON))
    const touched = thumbOnButton.presses.filter((p) => p.by === "touch")
    expect("a thumb on the button: over UI, and the stick", touched.map((p) => [p.overUI, p.stick]), [[true, false]])
    expect("the button's clicks after the tap", thumbOnButton.clicks, 2)

    // A thumb on the game's left half: the game's, and the stick takes it.
    const onGameByThumb = await after(cart, tap(...GAME))
    expect("a thumb on the game: over UI, and the stick", onGameByThumb.presses.filter((p) => p.by === "touch").map((p) => [p.overUI, p.stick]), [[false, true]])
}
