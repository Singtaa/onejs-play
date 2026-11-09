// Reads an 8-bit, non-interlaced RGB or RGBA PNG into RGBA bytes, row 0 at
// the top: what Magerie and grain-textures.mjs write. Anything else throws.
import zlib from "node:zlib"

export function readPNG(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG")
    let at = 8, width = 0, height = 0, type = 0
    const idat = []
    while (at < buf.length) {
        const len = buf.readUInt32BE(at), kind = buf.toString("latin1", at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len)
        if (kind === "IHDR") {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9]
            if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) throw new Error(`a PNG this reader does not take: depth ${data[8]}, colour type ${type}, interlace ${data[12]}`)
        }
        if (kind === "IDAT") idat.push(data)
        at += 12 + len
    }
    const channels = type === 6 ? 4 : 3, stride = width * channels
    const raw = zlib.inflateSync(Buffer.concat(idat))
    const rows = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? rows[y * stride + x - channels] : 0
            const b = y > 0 ? rows[(y - 1) * stride + x] : 0
            const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
            const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]
            if (pred === undefined) throw new Error(`PNG filter ${filter}`)
            rows[y * stride + x] = (line[x] + pred) & 255
        }
    }
    if (channels === 4) return { width, height, rgba: new Uint8Array(rows) }
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) { rgba.set(rows.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255 }
    return { width, height, rgba }
}
