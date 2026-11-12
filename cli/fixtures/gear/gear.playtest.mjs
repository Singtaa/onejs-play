// What tex makes of a loaded picture and of a model's own, on a real container (index.tsx's
// checks()). The body's picture (model.texture through tex.image) must read back as the bytes
// body.glb carries; paint.png through tex.image as its bytes premultiplied, its half see-through
// band included; and the paint composed over the body as the paint over the body, texel by texel.
// One texture handed in twice must be one picture, and the joints and parts the gear hangs by
// must be listed. Throws, so the run exits non-zero, when any check is off, or when the samples
// cannot tell (a body picture of one colour, a paint without its three bands).
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

/** The texels index.tsx's checks() reads back, as [x, y]: across the picture and down through the paint's three bands. */
export const SAMPLES = [[0, 0], [37, 10], [128, 63], [200, 64], [5, 100], [64, 128], [255, 140], [128, 159], [90, 160], [255, 255]]
/** Levels a stored byte may differ from the file's: 8-bit rounding either side of the GPU's. */
export const SLACK = 2

/** An 8-bit RGBA PNG whose rows are all filter 0 (what scripts/make-person.mjs and make-gear.mjs write), as bytes, row 0 at the top. */
export function decodePng(bytes) {
    if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG")
    let at = 8, width = 0, height = 0
    const data = []
    while (at < bytes.length) {
        const n = bytes.readUInt32BE(at), type = bytes.toString("latin1", at + 4, at + 8)
        const body = bytes.subarray(at + 8, at + 8 + n)
        if (type === "IHDR") {
            width = body.readUInt32BE(0)
            height = body.readUInt32BE(4)
            if (body[8] !== 8 || body[9] !== 6) throw new Error("only 8-bit RGBA is read here")
        }
        if (type === "IDAT") data.push(body)
        at += 12 + n
    }
    const raw = zlib.inflateSync(Buffer.concat(data))
    const out = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
        const row = y * (width * 4 + 1)
        if (raw[row] !== 0) throw new Error(`row ${y} uses PNG filter ${raw[row]}; only 0 is read here`)
        out.set(raw.subarray(row + 1, row + 1 + width * 4), y * width * 4)
    }
    return { width, height, rgba: out }
}

/** The first picture a .glb carries, decoded. */
export function glbPicture(file) {
    const b = fs.readFileSync(file)
    const n = b.readUInt32LE(12)
    const json = JSON.parse(b.subarray(20, 20 + n).toString())
    const bin = b.subarray(20 + n + 8)
    const view = json.bufferViews[json.images[0].bufferView]
    return decodePng(Buffer.from(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)))
}

const at = (p, [x, y]) => Array.from(p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4))
const premultiply = ([r, g, b, a]) => [Math.round(r * a / 255), Math.round(g * a / 255), Math.round(b * a / 255), a]
const over = (top, base) => top.map((t, i) => Math.round(t + base[i] * (1 - top[3] / 255)))

/** What checks() must read, from the files. */
export function expected(body, paint) {
    return {
        body: SAMPLES.map((s) => premultiply(at(body, s))),
        paint: SAMPLES.map((s) => premultiply(at(paint, s))),
        composed: SAMPLES.map((s) => over(premultiply(at(paint, s)), premultiply(at(body, s)))),
    }
}

/** Every way `got` (checks()'s answer) is off against `want` (expected()), and every way the run could not tell. */
export function verdict(got, want) {
    const wrong = []
    if (got.own === null) return ["model.texture was null: body.glb carries a picture"]
    if (got.own.width !== 256 || got.own.height !== 256) wrong.push(`model.texture is ${got.own.width} by ${got.own.height}, and body.glb's picture is 256 by 256`)
    // Whether these samples could tell: a body of several colours, and a paint with all three bands.
    if (new Set(want.body.map((t) => t.join())).size < 3) wrong.push("the body's samples are nearly one colour, so a wrong picture could read right")
    const alphas = new Set(want.paint.map((t) => t[3]))
    if (!alphas.has(0) || !alphas.has(255) || ![...alphas].some((a) => a > 0 && a < 255)) wrong.push("the paint's samples miss a band (clear, half, solid), so premultiplying is not tested")
    for (const what of ["body", "paint", "composed"]) {
        const rows = got[what]
        if (!Array.isArray(rows) || rows.length !== SAMPLES.length) { wrong.push(`${what}: read ${rows?.length ?? "no"} samples of ${SAMPLES.length}`); continue }
        SAMPLES.forEach((s, i) => {
            const g = rows[i], w = want[what][i]
            if (!Array.isArray(g) || g.length !== 4 || g.some((v, k) => !(Math.abs(v - w[k]) <= SLACK))) wrong.push(`${what} at (${s.join(", ")}): read ${JSON.stringify(g)}, the files say ${JSON.stringify(w)}`)
        })
    }
    if (got.samePicture !== true) wrong.push("one texture handed to tex.image twice made two pictures")
    for (const joint of ["head", "chest", "shoulder.L", "shoulder.R", "hand.L", "hand.R"]) if (!got.joints?.includes(joint)) wrong.push(`body.glb lists no joint ${joint}`)
    for (const part of ["helm", "shoulder.L", "shoulder.R", "cloak", "sword", "shield"]) if (!got.parts?.includes(part)) wrong.push(`body.dressed.glb lists no part ${part}`)
    if (got.dressedTexture !== true) wrong.push("body.dressed.glb's model.texture was null")
    return wrong
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.gear")) === "object", { what: "the gear cart", timeoutMs: 60000 })
    console.log("BACKEND " + await game.eval(`(() => {
        const c = [...document.querySelectorAll("canvas")].find((e) => e.width > 0 && e.id !== "")
        if (!c) return "unknown"
        return c.getContext("webgpu") ? "webgpu" : c.getContext("webgl2") ? "webgl2" : "unknown"
    })()`))
    const got = JSON.parse(await game.eval(`globalThis.gear.checks(${JSON.stringify(SAMPLES)}).then((r) => JSON.stringify(r))`))
    const dir = import.meta.dirname
    const want = expected(glbPicture(path.join(dir, "body.glb")), decodePng(fs.readFileSync(path.join(dir, "paint.png"))))
    console.log("GEAR " + JSON.stringify({ got, want }))
    const wrong = verdict(got, want)
    if (wrong.length > 0) throw new Error(`gear: ${wrong.length} off:\n  ${wrong.join("\n  ")}`)
    console.log(`GEAR passed: ${SAMPLES.length * 3} texels within ${SLACK} levels of the files`)
}
