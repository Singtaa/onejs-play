// A chrome ball side on under a blue sky with an orange horizon. First not asked to reflect: the
// whole screenshot's SHA-256 is printed as UNASKED, so two runtimes can be compared byte for byte
// (a scene that does not ask must draw as it did before reflections). Then asked: its middle
// reflects the level ray back to the orange horizon and a point higher up the blue sky, so the
// middle's red must lead its blue and the upper point's blue its red. Then not asked again: the same
// bytes as the first. Throws, so the run exits non-zero, on any of them or on a black screen.
import { createHash } from "node:crypto"

const LIT = 30   // levels the brightest channel must reach somewhere, or nothing here was lit
const LEADS = 40 // levels the reflected colour's own channel must lead the other by

async function shot(game) {
    const { data } = await game.browser.send("Page.captureScreenshot", { format: "png" })
    return data
}

// The pixels at the middle and three tenths of the way up from it to the top, from a screenshot.
async function pixels(game, data) {
    return JSON.parse(await game.eval(`(async () => {
        const img = new Image()
        img.src = "data:image/png;base64,${data}"
        await img.decode()
        const c = document.createElement("canvas")
        c.width = img.width; c.height = img.height
        const g = c.getContext("2d")
        g.drawImage(img, 0, 0)
        const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3))
        const h = img.height >> 1
        return JSON.stringify({ middle: at(img.width >> 1, h), upper: at(img.width >> 1, Math.round(h * 0.7)) })
    })()`))
}

// The screenshot's PNG bytes: Chrome encodes the same pixels the same way, so equal hashes are
// equal pixels.
const hash = (data) => createHash("sha256").update(Buffer.from(data, "base64")).digest("hex")

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.skyReflect")) === "object", { what: "the reflect cart", timeoutMs: 30000 })
    const look = async (reflect) => {
        await game.eval(`globalThis.skyReflect.show(${reflect})`)
        await game.wait(700)
        return shot(game)
    }
    // Which API drew it, so a run says whether it compared WebGPU or WebGL 2.
    console.log("BACKEND " + await game.eval(`(() => {
        const c = [...document.querySelectorAll("canvas")].find((e) => e.width > 0 && e.id !== "")
        if (!c) return "unknown"
        return c.getContext("webgpu") ? "webgpu" : c.getContext("webgl2") ? "webgl2" : "unknown"
    })()`))
    const before = await look(false)
    console.log("UNASKED " + hash(before))
    const asked = await look(true)
    const again = await look(false)
    const seen = { unasked: await pixels(game, before), asked: await pixels(game, asked) }
    console.log("PIXELS " + JSON.stringify(seen))

    const brightest = Math.max(...seen.unasked.middle, ...seen.unasked.upper, ...seen.asked.middle, ...seen.asked.upper)
    if (!(brightest >= LIT)) throw new Error(`the ball reads ${JSON.stringify(seen)}, under the ${LIT} levels this check needs: nothing was lit`)
    const wrong = []
    const [mr, , mb] = seen.asked.middle
    if (!(mr - mb >= LEADS)) wrong.push(`asked, the middle is ${seen.asked.middle.join(", ")}: not the orange horizon`)
    const [ur, , ub] = seen.asked.upper
    // The sky 40 degrees up is still part horizon, a lavender, so blue leads rather than rules.
    if (!(ub - ur >= LEADS)) wrong.push(`asked, the upper part is ${seen.asked.upper.join(", ")}: not the blue sky`)
    if (hash(again) !== hash(before)) wrong.push("not asked again, it does not draw the bytes it drew before it was asked")
    if (wrong.length > 0) throw new Error(`sky reflect: ${wrong.join("; ")}`)
}
