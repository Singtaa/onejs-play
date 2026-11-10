// The first frames that draw a faded, scattered see-through sheet, read in the page as each is drawn
// (not by screenshot, which shows whichever frame the compositor has). The playtest wraps
// requestAnimationFrame, makes the sheet in the same task as arming the capture, and copies the
// canvas into a 2D canvas right after each of the next FRAMES frames is drawn, reading a pixel over
// the deep floor and one over the shallow. Every frame must read what the last one does (within
// SAME levels), and the shallow half must be darker than the deep by FADES levels, or nothing was
// faded. In the Unity editor on Direct3D 12 the first render after a fresh compile drew the sheet
// over white; this asks whether the Play container's first frame does. Throws, so the run exits
// non-zero, on a frame that differs, on no fade, on frames never read, and on a black screen.

export const FRAMES = 6
export const SAME = 3
export const FADES = 20
const LIT = 30

/** What is wrong with the frames read, `[{ deep: [r,g,b], shallow: [r,g,b] }]`, or [] when nothing is. */
export function firstFrameProblems(frames) {
    if (!Array.isArray(frames) || frames.length < 2) return [`read ${frames?.length ?? 0} frames, not ${FRAMES}: nothing was compared`]
    const last = frames.at(-1)
    const wrong = []
    if (Math.max(...last.deep, ...last.shallow) < LIT) wrong.push(`the last frame reads ${JSON.stringify(last)}, under ${LIT} levels: nothing was drawn`)
    const sum = (c) => c[0] + c[1] + c[2]
    if (!(sum(last.deep) - sum(last.shallow) >= FADES * 3)) wrong.push(`the shallow half (${last.shallow}) is not darker than the deep (${last.deep}): nothing was faded`)
    frames.forEach((f, i) => {
        const off = Math.max(...[...f.deep, ...f.shallow].map((v, k) => Math.abs(v - [...last.deep, ...last.shallow][k])))
        if (off > SAME) wrong.push(`frame ${i + 1} reads ${JSON.stringify(f)}, ${off} levels from the last frame's ${JSON.stringify(last)}`)
    })
    return wrong
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.firstFrame")) === "object", { what: "the first-frame cart", timeoutMs: 30000 })
    console.log("BACKEND " + await game.eval(`(() => {
        const c = [...document.querySelectorAll("canvas")].find((e) => e.width > 0 && e.id !== "")
        if (!c) return "unknown"
        return c.getContext("webgpu") ? "webgpu" : c.getContext("webgl2") ? "webgl2" : "unknown"
    })()`))
    await game.eval(`(() => {
        const canvas = [...document.querySelectorAll("canvas")].find((e) => e.width > 0 && e.id !== "")
        const copy = document.createElement("canvas")
        copy.width = canvas.width; copy.height = canvas.height
        const g = copy.getContext("2d", { willReadFrequently: true })
        const at = (x, y) => Array.from(g.getImageData(Math.round(x * copy.width), Math.round(y * copy.height), 1, 1).data.slice(0, 3))
        const raf = globalThis.requestAnimationFrame
        const read = globalThis.__firstFrames = []
        globalThis.requestAnimationFrame = (f) => raf((t) => {
            f(t)
            if (read.length >= ${FRAMES}) return
            g.drawImage(canvas, 0, 0)
            read.push({ a: at(0.25, 0.5), b: at(0.75, 0.5) })
        })
        globalThis.firstFrame.show()
    })()`)
    await game.until(async () => (await game.eval("globalThis.__firstFrames.length")) >= FRAMES, { what: `${FRAMES} frames read`, timeoutMs: 10000 })
    const raw = await game.eval("JSON.stringify(globalThis.__firstFrames)")
    // Which side is over the deep floor depends on how the camera faces; the deep one is brighter.
    const frames = JSON.parse(raw)
    const sum = (c) => c[0] + c[1] + c[2]
    const deepIsA = sum(frames.at(-1).a) >= sum(frames.at(-1).b)
    const named = frames.map((f) => ({ deep: deepIsA ? f.a : f.b, shallow: deepIsA ? f.b : f.a }))
    console.log("FRAMES " + JSON.stringify(named))
    const wrong = firstFrameProblems(named)
    if (wrong.length > 0) throw new Error(`first frame: ${wrong.join("; ")}`)
}
