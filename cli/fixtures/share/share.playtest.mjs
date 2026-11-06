// copy() in a real container (share.ts): a Button's onClick and a key read in
// a frame callback both count as the press's frame, by mouse at 1x and by touch
// at a 3x phone, and a call from a timer with no press is refused without
// asking the browser. The clipboard is read back after each copy.
//
// Chrome is given the clipboard permission first, so a refusal here is
// share.ts's own rule and not Chrome's. What Chrome alone would say is in
// `active`: whether navigator.userActivation.isActive was true at the call.
const BUTTON = [70, 30]

async function copies(cart) {
    return JSON.parse(await cart.eval("JSON.stringify(globalThis.__copies.splice(0))"))
}

async function after(cart, send) {
    await copies(cart)
    const before = await cart.frame()
    await send()
    await cart.frameAfter(before + 3)
    return cart.until(async () => {
        const got = await copies(cart)
        return got.length > 0 ? got : null
    }, { timeoutMs: 4000, what: "the copy to answer" })
}

const clipboard = (cart) => cart.eval("navigator.clipboard.readText()")

function expect(what, got, want) {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

export default async function (cart) {
    await cart.browser.send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] })
    await cart.browser.send("Emulation.setFocusEmulationEnabled", { enabled: true })

    const click = await after(cart, () => cart.click(...BUTTON))
    expect("a click on the button", click.map((c) => [c.from, c.answer]), [["click", "copied"]])
    expect("the clipboard after the click", await clipboard(cart), "from-click")
    console.log(`click: copied, userActivation.isActive ${click[0].active}`)

    const key = await after(cart, () => cart.press("KeyC"))
    expect("the C key", key.map((c) => [c.from, c.answer]), [["key", "copied"]])
    expect("the clipboard after the key", await clipboard(cart), "from-key")

    const late = await after(cart, () => cart.eval("globalThis.__late()"))
    expect("a copy from a timer", late.map((c) => [c.from, c.answer]), [["timer", "refused"]])
    expect("the clipboard after the timer", await clipboard(cart), "from-key")
    console.log(`timer: refused, userActivation.isActive ${late[0].active}`)

    await cart.browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
    await cart.browser.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
    await cart.until(async () => (await cart.stage()).width === 390, { timeoutMs: 10000, what: "the stage to take the phone's 390 by 844" })
    const tap = await after(cart, async () => {
        await cart.browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: BUTTON[0], y: BUTTON[1] }] })
        await cart.wait(120)
        await cart.browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    })
    expect("a tap on the button", tap.map((c) => [c.from, c.answer]), [["click", "copied"]])
    expect("the clipboard after the tap", await clipboard(cart), "from-click")
    console.log(`tap: copied, userActivation.isActive ${tap[0].active}`)
}
