// A plain mesh, a textured one and a splat (read at its uvs, and with its layer
// triplanar), each the same grey, must look the
// same near and move toward the fog colour by the same amount far off. Reads
// the middle pixel of the page's own screenshot, decoded by the page. Throws,
// so the run exits non-zero, when fog moved the plain quad too little to
// measure, or when the textured or splat quad differs from it.
const KINDS = ["plain", "texture", "splat", "triplanar"]
const SAME = 4      // levels of 255 the three may differ by, for rounding
const MOVED = 40    // levels the plain quad must move toward the red fog, or fog was not measured

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

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.groundFog")) === "object", { what: "the fog cart", timeoutMs: 30000 })
    const seen = {}
    for (const kind of KINDS) {
        for (const far of [false, true]) {
            await game.eval(`globalThis.groundFog.show(${JSON.stringify(kind)}, ${far}).then(() => globalThis.__fogShown = "${kind}${far}")`)
            await game.until(async () => (await game.eval("globalThis.__fogShown")) === `${kind}${far}`, { what: `${kind} ${far ? "far" : "near"}`, timeoutMs: 30000 })
            await game.wait(500)
            seen[`${kind} ${far ? "far" : "near"}`] = await middle(game)
        }
    }
    console.log("PIXELS " + JSON.stringify(seen))
    const plainNear = seen["plain near"], plainFar = seen["plain far"]
    const moved = (plainFar[0] - plainNear[0]) + (plainNear[1] - plainFar[1])
    if (!(moved >= MOVED)) throw new Error(`fog moved the plain quad ${moved} levels toward red, under the ${MOVED} this check needs: nothing was measured`)
    const wrong = []
    for (const kind of KINDS.slice(1)) {
        for (const at of ["near", "far"]) {
            const a = seen[`${kind} ${at}`], b = seen[`plain ${at}`]
            const off = Math.max(...a.map((v, i) => Math.abs(v - b[i])))
            if (off > SAME) wrong.push(`${kind} ${at} is ${a.join(", ")} where plain is ${b.join(", ")}`)
        }
    }
    if (wrong.length > 0) throw new Error(`under fog, ${wrong.join("; ")}`)
}
