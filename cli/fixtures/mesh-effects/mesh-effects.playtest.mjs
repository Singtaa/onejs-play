// A scene with no light at all, a quad filling the view from above, and its
// middle pixel read for each look. Lit, a white quad must be black, or the
// scene is lit and nothing here measures unlit. Lit with a grey flash, it
// must be that grey, the light it has not got added. Unlit it must be white, and
// unlit with a red picture made from bytes (tex.pixels) it must be red. Playing
// a red and a blue picture as a flipbook over two seconds, three reads 0.35 s
// apart must each be the two cross-faded in linear light, and must not all be
// the same. Over a
// grey unlit floor, a grey quad made with blend "add" must draw the floor and
// itself summed as light is, in linear values: 128 and 128 make 174, not 255. Then all of it under a blue fog that is
// whole well before the quad: the floor turns blue, and the added quad must
// fade out, leaving the floor as it is, rather than add the fog's colour
// again. Reads the page's own screenshot, decoded by the page. Throws, so the
// run exits non-zero, when the scene is lit, the fog is not on, or any check
// is off.
const DARK = 20      // levels under which the lit quad counts as black
const BRIGHT = 200   // levels an unlit white quad must reach
const ADD = 128      // the added quad's grey, as the floor's
const FLASH = 128    // the flash's grey, which the black lit quad must show
const NEAR = 10      // levels the added quad may differ from the floor and itself summed in linear light
const SAME = 20      // levels a faded-out added quad may leave on the fogged floor
const FADED = 0.08   // how far a flipbook's red and blue, in linear light, may sum from 1
const PLAYS = 20     // levels the flipbook's red must change by across three reads

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
const linear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const srgb = (l) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)
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
    await look("flashed", { flash: "#808080" })
    await look("unlit", { look: { unlit: true } })
    await look("pixels", { look: { unlit: true }, pixels: true })
    await look("flipbook", { look: { unlit: true }, flipbook: true })
    for (const later of ["flipbook later", "flipbook last"]) {
        await game.wait(350)
        seen[later] = await middle(game)
    }
    await look("floor", { floor: "#808080", bare: true })
    await look("added", { floor: "#808080", look: { unlit: true, blend: "add", color: "#808080" } })
    await look("floor in fog", { floor: "#808080", bare: true, fog: "#0000c0" })
    await look("added in fog", { floor: "#808080", look: { unlit: true, blend: "add", color: "#808080" }, fog: "#0000c0" })
    console.log("PIXELS " + JSON.stringify(seen))

    if (!(mean(seen.lit) <= DARK)) throw new Error(`a lit white quad is ${px(seen.lit)} in a scene with no light: the scene is lit, so nothing here measures unlit`)
    const [fr, fg, fb] = seen["floor in fog"]
    if (!(fb > 100 && fr < DARK && fg < DARK)) throw new Error(`the grey floor under a blue fog is ${fr}, ${fg}, ${fb}: the fog is not on, so nothing here measures how it falls on an added mesh`)
    const wrong = []
    if (!(Math.min(...seen.unlit) >= BRIGHT)) wrong.push(`unlit, a white quad is ${px(seen.unlit)} with no light: still lit`)
    if (!(Math.max(...seen.flashed.map((v) => Math.abs(v - FLASH))) <= NEAR)) wrong.push(`lit in the dark with a ${FLASH} grey flash it is ${px(seen.flashed)}: the flash was not added`)
    const [r, g, b] = seen.pixels
    if (!(r >= BRIGHT && g <= DARK && b <= DARK)) wrong.push(`unlit under a red picture made from bytes it is ${r}, ${g}, ${b}: the picture did not draw`)
    const flips = [seen.flipbook, seen["flipbook later"], seen["flipbook last"]]
    for (const [fr, fg, fb] of flips) {
        if (!(fg <= DARK && Math.abs(linear(fr) + linear(fb) - 1) <= FADED)) wrong.push(`playing a red and a blue frame it is ${fr}, ${fg}, ${fb}: not the two cross-faded`)
    }
    const reds = flips.map((p) => p[0])
    if (!(Math.max(...reds) - Math.min(...reds) >= PLAYS)) wrong.push(`playing a red and a blue frame over 2 s, three reads 0.35 s apart are ${flips.map(px).join(" and ")}: the flipbook did not play`)
    const summed = srgb(Math.min(1, linear(mean(seen.floor)) + linear(ADD)))
    if (!(Math.abs(mean(seen.added) - summed) <= NEAR)) wrong.push(`added over the floor it is ${px(seen.added)} where the floor is ${px(seen.floor)} and the two summed in linear light are ${Math.round(summed)}: not added`)
    const left = Math.max(...seen["added in fog"].map((v, i) => Math.abs(v - seen["floor in fog"][i])))
    if (left > SAME) wrong.push(`added in a whole fog it is ${px(seen["added in fog"])} where the fogged floor is ${px(seen["floor in fog"])}: the fog did not fade it out`)
    if (wrong.length > 0) throw new Error(`mesh effects: ${wrong.join("; ")}`)
}
