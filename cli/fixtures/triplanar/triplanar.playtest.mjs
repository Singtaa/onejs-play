// A splat layer given `triplanar: 4` must repeat every 4 m of a steep face,
// where the same picture read at uvs laid flat stretches. Counts the band
// edges up the middle of each face in the page's screenshot: a face 48 m tall
// with bands every 4 m has 12 repeats, 24 edges. A count of whole edges is off
// by at most one at the face's ends, half a repeat in twelve, 4.2%, so 5% is
// the tolerance; and a count needs no scale, so the face's perspective (its
// top is 17 m further off than its foot) cannot bend it.
// Throws, so the run exits non-zero, when either face is missing from the
// column, when the triplanar face is off its 4 m, or when the uv face is not
// stretched (a check that saw no difference measured nothing).
const HEIGHT = 48
const METRES = 4
const TOLERANCE = 0.05
const STRETCHED = 8   // the uv face repeats every 4 m of run, 11 m of height at 70 degrees

async function columns(game) {
    const { data } = await game.browser.send("Page.captureScreenshot", { format: "png" })
    return JSON.parse(await game.eval(`(async () => {
        const img = new Image()
        img.src = "data:image/png;base64,${data}"
        await img.decode()
        const c = document.createElement("canvas")
        c.width = img.width; c.height = img.height
        const g = c.getContext("2d")
        g.drawImage(img, 0, 0)
        const column = (x) => Array.from(g.getImageData(x, 0, 1, img.height).data)
        return JSON.stringify({ left: column(img.width >> 2), right: column((img.width * 3) >> 2) })
    })()`))
}

/**
 * The face's band edges up one column of RGBA, and how many of its pixels are
 * the face's. A pixel is a red band's or a green band's when that channel
 * leads the other two by 40; the sky, above and below the horizon, and the
 * blend at an edge are neither, and are passed over.
 */
export function edgesOf(rgba) {
    let edges = 0, pixels = 0, last = null
    for (let i = 0; i < rgba.length; i += 4) {
        const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]]
        const band = r > g + 40 && r > b + 40 ? "red" : g > r + 40 && g > b + 40 ? "green" : null
        if (band === null) continue
        pixels++
        if (last !== null && band !== last) edges++
        last = band
    }
    return { edges, pixels }
}

/** Metres of height a repeat takes on a face 48 m tall with this many band edges. */
export const metresPerRepeat = (edges) => edges === 0 ? Infinity : HEIGHT / (edges / 2)

export function verdict(left, right) {
    const uv = edgesOf(left), tri = edgesOf(right)
    console.log(`BANDS uv ${uv.edges} edges over ${uv.pixels} px, ${metresPerRepeat(uv.edges).toFixed(2)} m a repeat; triplanar ${tri.edges} edges over ${tri.pixels} px, ${metresPerRepeat(tri.edges).toFixed(2)} m a repeat`)
    if (uv.pixels < 40 || tri.pixels < 40) throw new Error(`a face is missing from its column (uv ${uv.pixels} px, triplanar ${tri.pixels} px): nothing was measured`)
    const m = metresPerRepeat(tri.edges)
    const wrong = []
    if (!(Math.abs(m - METRES) <= METRES * TOLERANCE)) wrong.push(`the triplanar layer repeats every ${m.toFixed(2)} m of height, not ${METRES} within ${TOLERANCE * 100}%`)
    if (!(metresPerRepeat(uv.edges) >= STRETCHED)) wrong.push(`the uv layer repeats every ${metresPerRepeat(uv.edges).toFixed(2)} m, not stretched past ${STRETCHED}: the two faces drew alike`)
    if (wrong.length > 0) throw new Error(wrong.join("; "))
}

export default async function (game) {
    await game.until(async () => (await game.eval("globalThis.triplanarReady === true")) === true, { what: "the faces", timeoutMs: 30000 })
    await game.wait(1000)
    const { left, right } = await columns(game)
    verdict(left, right)
}
