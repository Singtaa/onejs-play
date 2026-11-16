// Two grey squares with an "add" shine (index.tsx): the left faces the camera, the right faces up
// and toward it, and the scene's picture is bright only where a surface faces up as the camera
// sees it. Read with no picture, with it, and with the right square's actor.shine at 0: with the
// picture the right square must gain at least GAIN levels and the left stay within STILL of its
// plain reading, and at 0 the right must be back within STILL of its own. Throws, so the run
// exits non-zero, when any check is off or when a reading measured nothing.
const GAIN = 40       // levels the facing-up square gains with the picture, at least
const STILL = 6       // levels a square that should not shine may move, at most
const LIT = 30        // levels a plain square reads, at least, or nothing here is lit

// Boxes on a 540 row screen, its middle at 270, scaled to the real one: each square's middle is
// 1.2 m off the axis at 5 m, about 178 rows of a 20 degree half height.
const LEFT = [-198, -158], RIGHT = [158, 198], ROWS = [255, 285]

async function squares(game) {
    const { data } = await game.browser.send("Page.captureScreenshot", { format: "png" })
    return JSON.parse(await game.eval(`(async () => {
        const img = new Image()
        img.src = "data:image/png;base64,${data}"
        await img.decode()
        const c = document.createElement("canvas")
        c.width = img.width; c.height = img.height
        const g = c.getContext("2d", { willReadFrequently: true })
        g.drawImage(img, 0, 0)
        const s = img.height / 540, mid = img.width / 2
        const mean = ([c0, c1]) => {
            const x0 = Math.round(mid + c0 * s), x1 = Math.round(mid + c1 * s)
            const y0 = Math.round(${ROWS[0]} * s), y1 = Math.round(${ROWS[1]} * s)
            const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data
            let sum = 0
            for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3
            return sum / (d.length / 4)
        }
        return JSON.stringify({ left: mean(${JSON.stringify(LEFT)}), right: mean(${JSON.stringify(RIGHT)}) })
    })()`))
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.shine")) === "object", { what: "the shine cart", timeoutMs: 30000 })
    // Which API drew it, so a run says whether it read WebGPU or WebGL 2.
    console.log("BACKEND " + await game.eval(`(() => {
        const c = [...document.querySelectorAll("canvas")].find((e) => e.width > 0 && e.id !== "")
        if (!c) return "unknown"
        return c.getContext("webgpu") ? "webgpu" : c.getContext("webgl2") ? "webgl2" : "unknown"
    })()`))
    const seen = {}
    for (const state of ["plain", "shone", "zero"]) {
        await game.eval(`globalThis.shine.show(${JSON.stringify(state)})`)
        await game.wait(500)
        seen[state] = await squares(game)
    }
    console.log("SHINE " + JSON.stringify(seen))

    const { plain, shone, zero } = seen
    if (!(plain.left > LIT && plain.right > LIT)) throw new Error(`the squares read ${plain.left.toFixed(1)} and ${plain.right.toFixed(1)} with no picture: they were not drawn lit, so nothing here measures a shine`)
    const wrong = []
    if (!(shone.right - plain.right >= GAIN)) wrong.push(`the square facing up gained ${(shone.right - plain.right).toFixed(1)} levels with the picture (no shine drawn)`)
    if (!(Math.abs(shone.left - plain.left) <= STILL)) wrong.push(`the square facing the camera moved ${(shone.left - plain.left).toFixed(1)} levels, where the picture is black (the lookup ignores which way it faces)`)
    if (!(Math.abs(zero.right - plain.right) <= STILL)) wrong.push(`at actor.shine 0 the square facing up is ${(zero.right - plain.right).toFixed(1)} levels off its plain reading (the actor's share is not read)`)
    if (wrong.length > 0) throw new Error(`shine: ${wrong.join("; ")}`)
}
