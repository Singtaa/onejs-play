// scene.depth on a real container: check.sl paints green where the depth is the distance along
// each pixel's ray to a wall 10 m off (left half) or the far distance (the sky, right half), red
// where it is not. Read alone, then beside scene.texture: each half must be at least 99% green.
// Then with the wall it expects moved a metre: the left half must be at least 99% red, which
// shows the check can fail on this build. Throws, so the run exits non-zero, on any of them or on
// a screen that is neither colour.
const ENOUGH = 0.99

async function shot(game) {
    const { data } = await game.browser.send("Page.captureScreenshot", { format: "png" })
    return data
}

// The share of green and of red pixels in the left and right halves, past the black middle band.
async function shares(game, data) {
    return JSON.parse(await game.eval(`(async () => {
        const img = new Image()
        img.src = "data:image/png;base64,${data}"
        await img.decode()
        const c = document.createElement("canvas")
        c.width = img.width; c.height = img.height
        const g = c.getContext("2d")
        g.drawImage(img, 0, 0)
        const px = g.getImageData(0, 0, img.width, img.height).data
        const count = (x0, x1) => {
            let green = 0, red = 0, all = 0
            for (let y = 0; y < img.height; y++) for (let x = x0; x < x1; x++) {
                const i = (y * img.width + x) * 4
                all++
                if (px[i + 1] > 200 && px[i] < 60) green++
                else if (px[i] > 200 && px[i + 1] < 60) red++
            }
            return { green: green / all, red: red / all }
        }
        const w = img.width
        return JSON.stringify({ left: count(0, Math.floor(w * 0.46)), right: count(Math.ceil(w * 0.54), w) })
    })()`))
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.sceneDepth")) === "object", { what: "the scene-depth cart", timeoutMs: 30000 })
    console.log("BACKEND " + await game.eval(`(() => {
        const c = [...document.querySelectorAll("canvas")].find((e) => e.width > 0 && e.id !== "")
        if (!c) return "unknown"
        return c.getContext("webgpu") ? "webgpu" : c.getContext("webgl2") ? "webgl2" : "unknown"
    })()`))
    const look = async (mode) => {
        await game.eval(`globalThis.sceneDepth.mode(${JSON.stringify(mode)})`)
        await game.wait(1000)
        const seen = await shares(game, await shot(game))
        console.log(`SHARES ${JSON.stringify(mode)} ${JSON.stringify(seen)}`)
        return seen
    }
    const wrong = []
    for (const withScene of [false, true]) {
        const seen = await look({ withScene, off: 0 })
        const name = withScene ? "beside scene.texture" : "alone"
        if (!(seen.left.green >= ENOUGH)) wrong.push(`${name}, the wall is ${(seen.left.green * 100).toFixed(1)}% green, ${(seen.left.red * 100).toFixed(1)}% red: not the distance along each ray`)
        if (!(seen.right.green >= ENOUGH)) wrong.push(`${name}, the sky is ${(seen.right.green * 100).toFixed(1)}% green, ${(seen.right.red * 100).toFixed(1)}% red: not the far distance`)
    }
    const off = await look({ withScene: false, off: 1 })
    if (!(off.left.red >= ENOUGH)) wrong.push(`with the wall expected a metre further, the wall is only ${(off.left.red * 100).toFixed(1)}% red: the check cannot tell a wrong depth`)
    if (wrong.length > 0) throw new Error(`scene depth: ${wrong.join("; ")}`)
}
