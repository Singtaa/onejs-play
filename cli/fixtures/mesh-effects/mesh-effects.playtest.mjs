// A scene with no light at all, a quad filling the view from above, and its
// middle pixel read for each look. Lit, a white quad must be black, or the
// scene is lit and nothing here measures unlit. Unlit it must be white, and
// unlit with a red picture made from bytes (tex.pixels) it must be red. Over a
// grey unlit floor, a dark grey quad made with blend "add" must brighten the
// floor by about its own colour. Then all of it under a blue fog that is
// whole well before the quad: the floor turns blue, and the added quad must
// fade out, leaving the floor as it is, rather than add the fog's colour
// again. Reads the page's own screenshot, decoded by the page. Throws, so the
// run exits non-zero, when the scene is lit, the fog is not on, or any check
// is off.
const DARK = 20      // levels under which the lit quad counts as black
const BRIGHT = 200   // levels an unlit white quad must reach
const ADDED = 40     // levels an added #404040 must brighten the floor by (64 in sRGB)
const SAME = 20      // levels a faded-out added quad may leave on the fogged floor

async function middle(game) {
    const { data } = await game.browser.send("Page.captureScreenshot", { format: "png" })
    return JSON.parse(await game.eval(`(async () => {
        const img = new Image()
        img.src = "data:image/png;base64,${data}"
        await img.decode()
        const c = document.createElement("canvas")
        c.width = img.width; c.height = img.height
        const g = c.getContext("2d")
        g.drawImage(img, 0, 0)
        return JSON.stringify(Array.from(g.getImageData(img.width >> 1, img.height >> 1, 1, 1).data.slice(0, 3)))
    })()`))
}

const mean = (p) => (p[0] + p[1] + p[2]) / 3
const px = (p) => p.join(", ")

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.meshEffects")) === "object", { what: "the effects cart", timeoutMs: 30000 })
    const seen = {}
    const look = async (name, shown) => {
        await game.eval(`globalThis.meshEffects.show(${JSON.stringify(shown)})`)
        await game.wait(500)
        seen[name] = await middle(game)
    }
    await look("lit", {})
    await look("unlit", { look: { unlit: true } })
    await look("pixels", { look: { unlit: true }, pixels: true })
    await look("floor", { floor: "#808080", bare: true })
    await look("added", { floor: "#808080", look: { unlit: true, blend: "add", color: "#404040" } })
    await look("floor in fog", { floor: "#808080", bare: true, fog: "#0000c0" })
    await look("added in fog", { floor: "#808080", look: { unlit: true, blend: "add", color: "#404040" }, fog: "#0000c0" })
    console.log("PIXELS " + JSON.stringify(seen))

    if (!(mean(seen.lit) <= DARK)) throw new Error(`a lit white quad is ${px(seen.lit)} in a scene with no light: the scene is lit, so nothing here measures unlit`)
    const [fr, fg, fb] = seen["floor in fog"]
    if (!(fb > 100 && fr < DARK && fg < DARK)) throw new Error(`the grey floor under a blue fog is ${fr}, ${fg}, ${fb}: the fog is not on, so nothing here measures how it falls on an added mesh`)
    const wrong = []
    if (!(Math.min(...seen.unlit) >= BRIGHT)) wrong.push(`unlit, a white quad is ${px(seen.unlit)} with no light: still lit`)
    const [r, g, b] = seen.pixels
    if (!(r >= BRIGHT && g <= DARK && b <= DARK)) wrong.push(`unlit under a red picture made from bytes it is ${r}, ${g}, ${b}: the picture did not draw`)
    if (!(mean(seen.added) - mean(seen.floor) >= ADDED)) wrong.push(`added over the floor it is ${px(seen.added)} where the floor is ${px(seen.floor)}: not added`)
    const left = Math.max(...seen["added in fog"].map((v, i) => Math.abs(v - seen["floor in fog"][i])))
    if (left > SAME) wrong.push(`added in a whole fog it is ${px(seen["added in fog"])} where the fogged floor is ${px(seen["floor in fog"])}: the fog did not fade it out`)
    if (wrong.length > 0) throw new Error(`mesh effects: ${wrong.join("; ")}`)
}
