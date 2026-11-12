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
// again. Over the floor, a green quad blended "premultiplied" must cover it at
// alpha 1, add to it at alpha 0 (its green whole, not dimmed by the alpha), and
// leave half the floor's light at alpha 0.5; at alpha 0 in the fog it must fade
// out as the added quad does. Under a red picture at half alpha, which a tex
// picture delivers as full red at 0.5, it must multiply the red by the alpha
// before adding half the floor, and blended "premultipliedTexture" it must
// take the red whole. (A tex picture cannot carry colour at alpha 0: it is
// delivered straight, colour over alpha, so its clear texels are black.) Lit,
// in the dark, by an actor light of grey shining straight down on it, the
// white quad must be that grey; shining straight up from under it, a
// seventeenth of that grey in linear light, the far side of the light's soft wrap;
// and by an actor light's red ambient alone, that red. Unlit under a red waterline a metre above, the white quad must be
// red; with the line a metre below, white; at half strength, its green halfway
// in linear light. Then that line moved a metre below by `{ y }` alone, the
// quad must be white again. Reads the page's own screenshot, decoded by the page. Throws, so the
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
const HALF = Math.round(255 * (1.055 * 0.5 ** (1 / 2.4) - 0.055)) // the green a white quad keeps halfway to red, in linear light

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
    const over = (color, more = {}) => look(more.name ?? color, { floor: "#808080", look: { unlit: true, blend: "premultiplied", color }, ...more.shown })
    await over("#00ff00", { name: "covering" })
    await over("#00ff0000", { name: "adding" })
    await over("#00ff0080", { name: "halfway" })
    await over("#00ff0000", { name: "adding in fog", shown: { fog: "#0000c0" } })
    await look("straight half", { floor: "#808080", look: { unlit: true, blend: "premultiplied" }, halfPixels: true })
    await look("multiplied half", { floor: "#808080", look: { unlit: true, blend: "premultipliedTexture" }, halfPixels: true })
    await look("own light", { light: { ambient: "#000000", color: "#808080", direction: [0, -1, 0] } })
    await look("own light below", { light: { ambient: "#000000", color: "#808080", direction: [0, 1, 0] } })
    await look("own ambient", { light: { ambient: "#800000", color: "#000000", direction: [0, -1, 0] } })
    await look("under", { look: { unlit: true }, waterline: { y: 1, strength: 1 } })
    await look("over", { look: { unlit: true }, waterline: { y: -1, strength: 1 } })
    await look("half under", { look: { unlit: true }, waterline: { y: 1, strength: 0.5 } })
    await game.eval(`globalThis.meshEffects.lower()`)
    await game.wait(500)
    seen["moved over"] = await middle(game)
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
    const near = (p, q) => Math.max(...p.map((v, i) => Math.abs(v - q[i]))) <= NEAR
    const fl = mean(seen.floor)
    if (!near(seen.covering, [0, 255, 0])) wrong.push(`premultiplied at alpha 1 over the floor it is ${px(seen.covering)}: not laid over it in green`)
    if (!near(seen.adding, [fl, 255, fl])) wrong.push(`premultiplied at alpha 0 over the floor it is ${px(seen.adding)} where the floor is ${px(seen.floor)}: not its whole green added`)
    const kept = srgb(linear(fl) * (1 - 128 / 255))
    if (!near(seen.halfway, [kept, 255, kept])) wrong.push(`premultiplied at alpha 0.5 over the floor it is ${px(seen.halfway)}: not half the floor's light kept (${Math.round(kept)}) under its green`)
    if (!near(seen["adding in fog"], seen["floor in fog"])) wrong.push(`premultiplied at alpha 0 in a whole fog it is ${px(seen["adding in fog"])} where the fogged floor is ${px(seen["floor in fog"])}: the fog did not fade it out`)
    const halfRed = srgb(128 / 255 + linear(fl) * (1 - 128 / 255))
    if (!near(seen["straight half"], [halfRed, kept, kept])) wrong.push(`premultiplied under a red picture at half alpha it is ${px(seen["straight half"])}: not its red times its alpha (${Math.round(halfRed)}) over half the floor (${Math.round(kept)})`)
    if (!near(seen["multiplied half"], [255, kept, kept])) wrong.push(`premultipliedTexture under a red picture at half alpha it is ${px(seen["multiplied half"])}: not its red whole over half the floor (${Math.round(kept)})`)
    if (!near(seen["own light"], [128, 128, 128])) wrong.push(`lit in the dark by its own grey light shining down on it, it is ${px(seen["own light"])}: not that grey`)
    const farSide = srgb(linear(128) / 17)
    if (!near(seen["own light below"], [farSide, farSide, farSide])) wrong.push(`lit by its own grey light from below, it is ${px(seen["own light below"])}: not a seventeenth of the grey (${Math.round(farSide)})`)
    if (!near(seen["own ambient"], [128, 0, 0])) wrong.push(`lit by its own red ambient alone, it is ${px(seen["own ambient"])}: not that red`)
    const [ur, ug, ub] = seen.under
    if (!(ur >= BRIGHT && ug <= DARK && ub <= DARK)) wrong.push(`unlit under a red waterline a metre above it is ${ur}, ${ug}, ${ub}: not red`)
    if (!(Math.min(...seen.over) >= BRIGHT)) wrong.push(`unlit with a red waterline a metre below it is ${px(seen.over)}: not white`)
    const [hr, hg] = seen["half under"]
    if (!(hr >= BRIGHT && Math.abs(hg - HALF) <= NEAR)) wrong.push(`under a red waterline at half strength it is ${px(seen["half under"])}: its green is not ${HALF}, halfway in linear light`)
    const [mr, mg] = seen["moved over"]
    if (!(mr >= BRIGHT && mg >= BRIGHT)) wrong.push(`with the half strength waterline moved below by { y } alone it is ${px(seen["moved over"])}: not white`)
    if (wrong.length > 0) throw new Error(`mesh effects: ${wrong.join("; ")}`)
}
