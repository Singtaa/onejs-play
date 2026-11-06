// A font a cart ships, in a real container (loadFont, useFont, fontFamily):
// loaded first through oj.json's preload, it reaches the Text under the View
// that names it and no other, on a desktop and on a 3x phone. The same words
// in the default face are the control: a font that never applied would leave
// the two lines the same width, which is what every cart got before 1.2.0.

/** Each line's font asset by name, and its width in layout pixels. */
async function lines(cart) {
    return JSON.parse(await cart.eval(`JSON.stringify(Object.fromEntries(Object.entries(globalThis.__lines).map(([id, ref]) => {
        const el = ref.current
        const font = el.resolvedStyle.unityFontDefinition.fontAsset
        return [id, { font: font ? font.name : null, width: Math.round(el.layout.width) }]
    })))`))
}

function check(where, got) {
    if (got.pixel.font !== "Pixelify") throw new Error(`${where}: the line under fontFamily draws in ${JSON.stringify(got.pixel.font)}, want "Pixelify"`)
    if (got.plain.font === "Pixelify") throw new Error(`${where}: the line outside it draws in Pixelify too`)
    const ratio = got.pixel.width / got.plain.width
    if (Math.abs(ratio - 1) < 0.03) throw new Error(`${where}: both lines are ${got.plain.width} wide, so the face did not change what was drawn`)
    console.log(`${where}: Pixelify ${got.pixel.width} wide against the default face's ${got.plain.width}`)
}

export default async function (cart) {
    // Preloaded, so the font is there on the cart's first render, which waits
    // behind the loading bar until preload has finished.
    const first = await cart.until(async () => JSON.parse(await cart.eval("JSON.stringify({ had: globalThis.__fontOnFirstRender ?? null })")).had !== null
        ? cart.eval("String(globalThis.__fontOnFirstRender)") : null, { timeoutMs: 10000, what: "the cart's first render" })
    if (first !== "true") throw new Error("the font was not there on the cart's first render, so preload did not cover it")
    // A style resolves and lays out on the frames after a render.
    await cart.frameAfter(await cart.frame() + 3)
    check("desktop", await lines(cart))
    await cart.shot(".oj/font-desktop.png")

    await cart.browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
    await cart.until(async () => (await cart.stage()).width === 390, { timeoutMs: 10000, what: "the stage to take the phone's 390 by 844" })
    // windows-latest draws a 3x phone in software at 0.7 fps, and the frames
    // just after the resize slower still: three of them once took past
    // frameAfter's 15 s there (6 Nov 2026). The timings print so a run says
    // how near this is.
    let since = Date.now()
    await cart.frameAfter(await cart.frame() + 3, 60000)
    const frames = (Date.now() - since) / 1000
    check("phone", await lines(cart))
    since = Date.now()
    await cart.shot(".oj/font-phone.png")
    console.log(`phone at 3x: three frames in ${frames.toFixed(1)} s, the screenshot in ${((Date.now() - since) / 1000).toFixed(1)} s`)
}
