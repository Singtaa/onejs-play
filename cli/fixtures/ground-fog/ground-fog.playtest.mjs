// A plain mesh, a textured one and a splat (read at its uvs, and with its layer
// triplanar), each the same grey, must look the
// same near and move toward the fog colour by the same amount far off. Then each
// law of fog (linear, exp, exp2, and exp and exp2 thinning with height) on a
// plain ground (ModelLit) and a splat one (GroundLit), straight down and on a
// slant, must take the share of fog the law gives a point at that distance and
// height: the pixel unfogged, moved toward the red fog by that share in linear
// light. The share integrates the density along the ray numerically, so it checks
// the shader's closed form rather than repeating it. Reads the middle pixel of
// the page's own screenshot, decoded by the page. Throws, so the run exits
// non-zero, when fog moved the plain quad too little to measure, when the
// textured or splat quad differs from it, or when a law's pixel is off its share.
const KINDS = ["plain", "texture", "splat", "triplanar"]
const SAME = 4      // levels of 255 the three may differ by, for rounding
const MOVED = 40    // levels the plain quad must move toward the red fog, or fog was not measured
const OFF = 3       // levels of 255 a law's pixel may be off its share, for 8-bit rounding twice

// The camera and the point its middle pixel sees, as the cart's VIEWS place them.
export const VIEWS = {
    down: { from: [0, 40, 0.001], to: [0, 0, 0] },
    slant: { from: [0, 40, 0], to: [0, 0, 120] },
}
export const LAWS = {
    linear: { color: "#ff0000", near: 20, far: 60, mode: "linear", height: false },
    exp: { mode: "exp", density: 0.02, height: false },
    exp2: { mode: "exp2", density: 0.015, height: false },
    "exp height": { mode: "exp", density: 0.05, height: { base: 0, thickness: 15 } },
    "exp2 height": { mode: "exp2", density: 0.03, height: { base: 0, thickness: 15 } },
}

/** The share of fog the middle pixel of `view` takes under `law` (merged over linear's near and far, as scene.fog merges). */
export function share(lawName, viewName) {
    const law = { ...LAWS.linear, ...LAWS[lawName] }
    const { from, to } = VIEWS[viewName]
    const ray = to.map((v, i) => v - from[i])
    const d = Math.hypot(...ray)
    // The middle pixel's ray is the camera's view, so its eye depth is its distance. The
    // camera's near plane, a fraction of a metre, moves linear's share by under 1/100.
    if (law.mode === "linear") return Math.min(Math.max((d - law.near) / (law.far - law.near), 0), 1)
    const rise = ray[1] / d
    const density = (t) => law.height ? law.density * Math.exp(-(from[1] + rise * t - law.height.base) / law.height.thickness) : law.density
    const steps = 4000, h = (d - law.near) / steps
    let tau = 0
    for (let k = 0; k <= steps; k++) tau += density(law.near + k * h) * (k === 0 || k === steps ? 1 : k % 2 ? 4 : 2)
    tau *= h / 3
    if (law.mode === "exp2") tau *= tau
    return 1 - Math.exp(-tau)
}

const linear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const srgb = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/** The pixel `clear` takes under a red fog's `share`. */
export function fogged(clear, s) {
    return clear.map((v, i) => srgb(linear(v) * (1 - s) + (i === 0 ? 1 : 0) * s))
}

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

    const laws = {}
    const off = []
    for (const kind of ["plain", "splat"]) {
        await game.eval(`globalThis.groundFog.show(${JSON.stringify(kind)}, "ground").then(() => globalThis.__fogShown = "${kind}ground")`)
        await game.until(async () => (await game.eval("globalThis.__fogShown")) === `${kind}ground`, { what: `${kind} ground`, timeoutMs: 30000 })
        for (const view of Object.keys(VIEWS)) {
            await game.eval(`globalThis.groundFog.view(${JSON.stringify(view)})`)
            await game.eval("globalThis.groundFog.fog(false)")
            await game.wait(500)
            const clear = await middle(game)
            laws[`${kind} ${view} clear`] = clear
            for (const law of Object.keys(LAWS)) {
                await game.eval(`globalThis.groundFog.fog(${JSON.stringify({ ...LAWS.linear, ...LAWS[law] })})`)
                await game.wait(500)
                const got = await middle(game)
                const s = share(law, view)
                const want = fogged(clear, s).map(Math.round)
                laws[`${kind} ${view} ${law}`] = got
                const by = Math.max(...got.map((v, i) => Math.abs(v - want[i])))
                if (by > OFF) off.push(`${kind} ${view} ${law} is ${got.join(", ")} where a share of ${s.toFixed(3)} is ${want.join(", ")}`)
            }
        }
    }
    console.log("LAWS " + JSON.stringify(laws))
    if (off.length > 0) throw new Error(`fog off its law: ${off.join("; ")}`)
}
