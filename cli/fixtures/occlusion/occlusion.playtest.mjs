// A plastered wall lit by the ambient light alone, timbers 0.15 m proud of it,
// seen straight on (index.tsx). Reads the wall in a strip just beside a timber
// and in the middle of the panel between two, and compares their brightness,
// for the occlusion as the host draws it, off, darker, and as the host draws it
// again. As the host draws it the strip must be darker than the panel, or
// nothing here measures the switch; off it must be as bright as the panel;
// darker it must be darker than as the host draws it; and set back it must be
// as it was. Also prints the grain, the spread of the strip's brightness, for
// comparing the noise between settings. Then holds still: two screenshots of
// the unchanged scene, as the host draws it, must be the same bytes, since
// occlusion whose noise moves each frame makes every still 3D scene shimmer
// (runtime 1.10.0's blue noise did). Throws, so the run exits non-zero, when
// any check is off.
const SHADED = 0.95  // the strip over the panel, at most, with the host's occlusion
const CLEAR = 0.97   // the strip over the panel, at least, with none
const DARKER = 0.03  // how much further the strip must fall at intensity 2
const SAME = 0.02    // how far set back may sit from the first reading
const APART = 300    // ms between the two screenshots of the still scene, many frames

// The screen is 960 by 540: 167.9 pixels a metre on the wall, centre 480, 270.
const PX = 540 / (2 * 6 * Math.tan(Math.PI / 12))
// Wall x in metres: a strip just right of the timber at 0.5 (its edge, seen 0.15 m nearer, is at
// 0.615), and the middle of the panel between it and the next.
const STRIP = [0.63, 0.73]
const PANEL = [0.9, 1.1]
const ROWS = [200, 340]

async function regions(game, rects) {
    const { data } = await game.browser.send("Page.captureScreenshot", { format: "png" })
    return JSON.parse(await game.eval(`(async () => {
        const img = new Image()
        img.src = "data:image/png;base64,${data}"
        await img.decode()
        const c = document.createElement("canvas")
        c.width = img.width; c.height = img.height
        const g = c.getContext("2d")
        g.drawImage(img, 0, 0)
        return JSON.stringify(${JSON.stringify(rects)}.map(([x0, y0, x1, y1]) => {
            const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data
            const v = []
            for (let i = 0; i < d.length; i += 4) v.push((d[i] + d[i + 1] + d[i + 2]) / 3)
            const mean = v.reduce((a, b) => a + b, 0) / v.length
            const spread = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)
            return { mean, spread }
        }))
    })()`))
}

const rect = ([a, b]) => [Math.round(480 + a * PX), ROWS[0], Math.round(480 + b * PX), ROWS[1]]

async function screenshot(game) {
    const { data } = await game.browser.send("Page.captureScreenshot", { format: "png" })
    return data
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.occlusion")) === "object", { what: "the occlusion cart", timeoutMs: 30000 })
    const seen = {}
    const look = async (name, code) => {
        if (code !== null) await game.eval(code)
        await game.wait(500)
        const [strip, panel] = await regions(game, [rect(STRIP), rect(PANEL)])
        seen[name] = { ratio: strip.mean / panel.mean, strip: strip.mean, panel: panel.mean, grain: strip.spread }
    }
    await look("host", null)
    await look("off", "globalThis.occlusion.set(false)")
    await look("darker", "globalThis.occlusion.set({ intensity: 2 })")
    await look("host again", "globalThis.occlusion.set(true)")
    console.log("OCCLUSION " + JSON.stringify(seen))
    // Chrome encodes the same pixels the same way, so equal bytes are equal pixels.
    const first = await screenshot(game)
    await game.wait(APART)
    const still = first === await screenshot(game)
    console.log("STILL " + still)

    if (!(seen.host.panel > 40)) throw new Error(`the panel reads ${seen.host.panel}: the wall was not lit, so nothing here measures occlusion`)
    if (!(seen.host.ratio <= SHADED)) throw new Error(`with the host's occlusion the wall beside a timber is ${seen.host.ratio.toFixed(3)} of the panel: no occlusion drawn, so nothing here measures the switch`)
    const wrong = []
    if (!(seen.off.ratio >= CLEAR)) wrong.push(`off, the wall beside a timber is still ${seen.off.ratio.toFixed(3)} of the panel`)
    if (!(seen.darker.ratio <= seen.host.ratio - DARKER)) wrong.push(`at intensity 2 it is ${seen.darker.ratio.toFixed(3)} of the panel where the host's is ${seen.host.ratio.toFixed(3)}: the intensity did nothing`)
    if (!(Math.abs(seen["host again"].ratio - seen.host.ratio) <= SAME)) wrong.push(`set back to true it is ${seen["host again"].ratio.toFixed(3)} where it began at ${seen.host.ratio.toFixed(3)}`)
    if (!still) wrong.push(`two screenshots ${APART} ms apart of the unchanged scene differ: the occlusion moves from frame to frame, so a still scene shimmers`)
    if (wrong.length > 0) throw new Error(`occlusion: ${wrong.join("; ")}`)
}
