// A grey quad under the sun, its mirror image in the middle pixel: made rough
// (today's mesh), glossy, and metallic, then the rough one made glossy and red
// after it was made. A glossy quad must outshine the rough one, a metal one be
// darker than it (a metal scatters no light of its own), a roughness set after
// creation must draw as one given at creation, and a colour set after creation
// must draw. Reads the middle pixel of the page's own screenshot, decoded by the
// page. Throws, so the run exits non-zero, when the rough quad is too dark to
// measure or any of the four is off.
const LIT = 30       // levels the rough quad must reach, or nothing here was lit
const GLINT = 40     // levels a glossy quad must outshine the rough one by
const DARKER = 20    // levels a metal quad must fall below the rough one by
const SAME = 4       // levels a surface set after may differ from one made with it, for rounding

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

const sum = (p) => p[0] + p[1] + p[2]

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.meshMaterial")) === "object", { what: "the material cart", timeoutMs: 30000 })
    const seen = {}
    const look = async (name, code) => {
        await game.eval(code)
        await game.wait(500)
        seen[name] = await middle(game)
    }
    await look("rough", `globalThis.meshMaterial.show({})`)
    await look("glossy", `globalThis.meshMaterial.show({ roughness: 0.15 })`)
    await look("metal", `globalThis.meshMaterial.show({ metallic: 1 })`)
    await look("rough", `globalThis.meshMaterial.show({})`)
    await look("made glossy after", `globalThis.meshMaterial.change({ roughness: 0.15 })`)
    await look("made red after", `globalThis.meshMaterial.change({ roughness: 1, color: "#c00000" })`)
    console.log("PIXELS " + JSON.stringify(seen))

    const rough = seen.rough
    if (!(sum(rough) / 3 >= LIT)) throw new Error(`the rough quad is ${rough.join(", ")}, under the ${LIT} levels this check needs: nothing was lit`)
    const wrong = []
    if (!(sum(seen.glossy) / 3 - sum(rough) / 3 >= GLINT)) wrong.push(`glossy is ${seen.glossy.join(", ")} where rough is ${rough.join(", ")}: no highlight`)
    if (!(sum(rough) / 3 - sum(seen.metal) / 3 >= DARKER)) wrong.push(`metal is ${seen.metal.join(", ")} where rough is ${rough.join(", ")}: still scattering light`)
    const after = Math.max(...seen["made glossy after"].map((v, i) => Math.abs(v - seen.glossy[i])))
    if (after > SAME) wrong.push(`made glossy after it was made it is ${seen["made glossy after"].join(", ")} where made glossy is ${seen.glossy.join(", ")}`)
    const [r, g, b] = seen["made red after"]
    if (!(r > 2 * g + 10 && r > 2 * b + 10)) wrong.push(`made red after it was made it is ${r}, ${g}, ${b}`)
    if (wrong.length > 0) throw new Error(`mesh material: ${wrong.join("; ")}`)
}
