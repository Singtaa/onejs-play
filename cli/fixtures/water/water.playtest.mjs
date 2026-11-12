// A pool in a dark room with no sun, seen across 14 m of water to a wall
// standing in it (index.tsx). Sets the pool's water and reads three patches of
// it: near (5.5 m out, seen 29 degrees down), far (9.5 m out, 17 degrees) and
// the band where it meets the wall.
//
// - plain, then reflecting a red sky: the far patch must gain red, and gain
//   more than the near one, since water reflects more the lower it is seen;
//   without that nothing here measures the reflection.
// - with foam: the band at the wall must brighten, and the far patch stay as
//   it was.
// - still, two shots half a second apart must match; with a swell they must
//   differ, or the swell moved nothing.
// - plain again must read as plain did.
// Throws, so the run exits non-zero, when any check is off.
const GAIN = 25        // the far patch's red, at least, over plain, reflecting red
const STEEPER = 2      // the far patch's red gain over the near one's, at least
const FOAMED = 40      // the band's brightness, at least, over the same water without foam
const SAME = 4         // how far a patch may drift where nothing should change it
const STILL = 1        // mean change a pixel, at most, between two shots of still water
const MOVED = 2        // mean change a pixel, at least, between two shots of a swell

// index.tsx's CAMERA, on the harness's 960 by 540 screen.
const CAMERA = { position: [0, 3, -8], lookAt: [0, 0, 2], fov: 40 }
const W = 960, H = 540

const sub = (a, b) => a.map((v, i) => v - b[i])
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l) }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Where a world point lands on screen, in pixels: Unity's left-handed camera. */
export function project(point) {
    const f = norm(sub(CAMERA.lookAt, CAMERA.position))
    const r = norm(cross([0, 1, 0], f))
    const u = cross(f, r)
    const d = sub(point, CAMERA.position)
    const t = Math.tan((CAMERA.fov * Math.PI) / 360)
    const z = dot(d, f)
    return [W / 2 + (dot(d, r) / (z * t * (W / H))) * (W / 2), H / 2 - (dot(d, u) / (z * t)) * (H / 2)]
}

/** The screen rectangle a patch of water at height 0 covers, x0..x1 by z0..z1 in metres. */
function patch(x0, x1, z0, z1) {
    const corners = [[x0, 0, z0], [x1, 0, z0], [x0, 0, z1], [x1, 0, z1]].map(project)
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1])
    return [Math.ceil(Math.max(...xs.filter((_, i) => i % 2 === 0))), Math.ceil(Math.min(...ys)), Math.floor(Math.min(...xs.filter((_, i) => i % 2 === 1))), Math.floor(Math.max(...ys))]
}

const NEAR = patch(-1, 1, -3, -2)
const FAR = patch(-1, 1, 1, 2)
const BAND = patch(-1, 1, 3.6, 3.85)

/** Each rectangle's mean red and mean brightness, and its pixels' brightness every fourth pixel. */
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
            let red = 0, grey = 0, n = 0
            const samples = []
            for (let i = 0; i < d.length; i += 4) {
                red += d[i]; grey += (d[i] + d[i + 1] + d[i + 2]) / 3; n++
                if ((i / 4) % 4 === 0) samples.push((d[i] + d[i + 1] + d[i + 2]) / 3)
            }
            return { red: red / n, grey: grey / n, samples }
        }))
    })()`))
}

const change = (a, b) => a.samples.reduce((s, v, i) => s + Math.abs(v - b.samples[i]), 0) / a.samples.length

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.water")) === "object", { what: "the water cart", timeoutMs: 30000 })
    for (const [name, r] of Object.entries({ NEAR, FAR, BAND })) {
        if (!(r[2] - r[0] >= 8 && r[3] - r[1] >= 2)) throw new Error(`the ${name} patch is ${JSON.stringify(r)} on screen, too small to read: the camera here and index.tsx's differ`)
    }
    const seen = {}
    const look = async (name, water) => {
        if (water !== undefined) await game.eval(`globalThis.water.set(${JSON.stringify(water)})`)
        await game.wait(500)
        const [near, far, band] = await regions(game, [NEAR, FAR, BAND])
        seen[name] = { near, far, band }
    }
    const RED = "#ff2020"
    await look("plain", undefined)
    await look("red", { sky: RED })
    await look("foam", { sky: RED, foam: { color: "#ffffff", metres: 1 } })
    await look("still", { sky: RED })
    await look("still later", undefined)
    await look("swell", { sky: RED, swell: 0.3 })
    await look("swell later", undefined)
    await look("plain again", false)
    const brief = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([p, r]) => [p, { red: +r.red.toFixed(1), grey: +r.grey.toFixed(1) }]))]))
    console.log("WATER " + JSON.stringify(brief))

    const nearGain = seen.red.near.red - seen.plain.near.red, farGain = seen.red.far.red - seen.plain.far.red
    if (!(farGain >= GAIN)) throw new Error(`reflecting a red sky, the far water gained ${farGain.toFixed(1)} red: no reflection drawn, so nothing here measures the water`)
    const wrong = []
    if (!(farGain >= STEEPER * Math.max(nearGain, 1))) wrong.push(`the far water gained ${farGain.toFixed(1)} red and the near ${nearGain.toFixed(1)}: it does not reflect more the lower it is seen`)
    if (!(seen.foam.band.grey - seen.red.band.grey >= FOAMED)) wrong.push(`with foam the band at the wall reads ${seen.foam.band.grey.toFixed(1)} where it read ${seen.red.band.grey.toFixed(1)} without: no foam`)
    if (!(Math.abs(seen.foam.far.grey - seen.red.far.grey) <= SAME)) wrong.push(`with foam the far water reads ${seen.foam.far.grey.toFixed(1)} where it read ${seen.red.far.grey.toFixed(1)}: the foam spread past the shore`)
    const still = change(seen.still.far, seen["still later"].far), swell = change(seen.swell.far, seen["swell later"].far)
    if (!(still <= STILL)) wrong.push(`still water changed ${still.toFixed(2)} a pixel in half a second`)
    if (!(swell >= MOVED)) wrong.push(`a swell of 0.3 m changed ${swell.toFixed(2)} a pixel in half a second: it did not move`)
    if (!(Math.abs(seen["plain again"].far.grey - seen.plain.far.grey) <= SAME && Math.abs(seen["plain again"].far.red - seen.plain.far.red) <= SAME)) wrong.push("plain again, the far water does not read as plain did")
    if (wrong.length > 0) throw new Error(`water: ${wrong.join("; ")}`)
}
