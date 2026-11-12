// A glow quad standing through a grey floor, seen from 45 degrees above (index.tsx), in each
// blend a spell's effect uses, drawn unlit. Each blend is read twice: with no soften, where the
// quad must end on the floor in a hard line, or nothing here can see a cut; and with `soften: 1`,
// where the quad just above that line must read within a quarter of its body's step over the
// floor, and its body must keep most of its strength. Throws, so the run exits non-zero, when any
// check is off.
const BLENDS = ["alpha", "add", "premultiplied", "premultipliedTexture"]
const SOFTEN = 1      // metres
const CUT = 0.6       // the seam over the body, at least, with no soften
const SOFT = 0.25     // the seam over the body, at most, with soften
const KEPT = 0.8      // the softened body over the hard one, at least
const BODY = 25       // levels the quad must add over the floor, at least

// Rows and columns on a 540 row screen, its middle at 270, scaled to the real one. The line where
// quad and floor meet crosses the middle. A point h metres up the quad sits h / (8 - h) / tan 20
// of the half height above it: 0.02 to 0.09 m in SEAM, the floor in front in FLOOR, 0.94 to
// 1.06 m in BODY, where the floor behind is 1.4 m off and any soften under that leaves it whole.
const SEAM = [262, 268], FLOOR = [272, 278], BODY_ROWS = [158, 170], COLUMNS = [-60, 60]

async function bands(game) {
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
        const mean = ([r0, r1]) => {
            const x0 = Math.round(mid + ${COLUMNS[0]} * s), x1 = Math.round(mid + ${COLUMNS[1]} * s)
            const d = g.getImageData(x0, Math.round(r0 * s), x1 - x0, Math.round((r1 - r0) * s)).data
            let sum = 0
            for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3
            return sum / (d.length / 4)
        }
        return JSON.stringify({ seam: mean(${JSON.stringify(SEAM)}), floor: mean(${JSON.stringify(FLOOR)}), body: mean(${JSON.stringify(BODY_ROWS)}) })
    })()`))
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.softGlow")) === "object", { what: "the soft glow cart", timeoutMs: 30000 })
    // Which API drew it, so a run says whether it read WebGPU or WebGL 2.
    console.log("BACKEND " + await game.eval(`(() => {
        const c = [...document.querySelectorAll("canvas")].find((e) => e.width > 0 && e.id !== "")
        if (!c) return "unknown"
        return c.getContext("webgpu") ? "webgpu" : c.getContext("webgl2") ? "webgl2" : "unknown"
    })()`))
    const seen = {}
    for (const blend of BLENDS) {
        for (const soften of [0, SOFTEN]) {
            await game.eval(`globalThis.softGlow.show(${JSON.stringify({ blend, soften })})`)
            await game.wait(500)
            const b = await bands(game)
            const body = b.body - b.floor
            seen[`${blend} ${soften === 0 ? "cut" : "soft"}`] = { ...b, step: body, seam: b.seam - b.floor, share: (b.seam - b.floor) / body }
        }
    }
    console.log("SOFTGLOW " + JSON.stringify(seen))

    const wrong = []
    for (const blend of BLENDS) {
        const cut = seen[`${blend} cut`], soft = seen[`${blend} soft`]
        if (!(cut.floor > 30)) throw new Error(`the floor reads ${cut.floor.toFixed(1)}: it was not lit, so nothing here measures a seam`)
        if (!(cut.step > BODY)) throw new Error(`${blend}: the quad adds ${cut.step.toFixed(1)} levels over the floor: no glow drawn, so nothing here measures a seam`)
        if (!(cut.share >= CUT)) throw new Error(`${blend}: with no soften the quad just above the floor is ${cut.share.toFixed(2)} of its body: no hard cut to see, so nothing here measures one`)
        if (!(soft.share <= SOFT)) wrong.push(`${blend}: softened, the quad just above the floor is still ${soft.share.toFixed(2)} of its body (a hard cut at the floor)`)
        if (!(soft.step >= KEPT * cut.step)) wrong.push(`${blend}: softened, its body adds ${soft.step.toFixed(1)} levels where unsoftened it adds ${cut.step.toFixed(1)} (the soften faded the whole quad)`)
    }
    if (wrong.length > 0) throw new Error(`soft glow: ${wrong.join("; ")}`)
}
