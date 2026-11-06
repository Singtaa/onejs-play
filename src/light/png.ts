/**
 * The record a light file carries, in a PNG text chunk.
 *
 * The light is saved as a PNG because the site stores PNGs and every host's
 * loaders already read them (docs/lightmapping.md §2, "Where the file lives").
 * The pixels are the baker's; the record (the fingerprint and the layout) rides
 * in one `tEXt` chunk under the keyword `oj-light`, which image loaders skip.
 * Reading and writing a text chunk needs no inflate, only the chunk framing and
 * its CRC, so this works wherever the bytes are, QuickJS included.
 */

export const LIGHT_KEYWORD = "oj-light"

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

let crcTable: Uint32Array | null = null

function crc32(bytes: Uint8Array, start: number, end: number): number {
    if (crcTable === null) {
        crcTable = new Uint32Array(256)
        for (let n = 0; n < 256; n++) {
            let c = n
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            crcTable[n] = c >>> 0
        }
    }
    let c = 0xffffffff
    for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

interface Chunk { type: string, start: number, end: number, dataStart: number, dataEnd: number }

function chunks(png: Uint8Array): Chunk[] {
    if (png.length < 8 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error("[oj] not a PNG file")
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const out: Chunk[] = []
    let at = 8
    while (at + 12 <= png.length) {
        const length = view.getUint32(at)
        const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!)
        const end = at + 12 + length
        if (end > png.length) throw new Error(`[oj] a PNG chunk (${type}) runs past the end of the file`)
        out.push({ type, start: at, end, dataStart: at + 8, dataEnd: at + 8 + length })
        at = end
        if (type === "IEND") return out
    }
    throw new Error("[oj] a PNG file with no end chunk")
}

/** The text under `keyword`, or null when the file has none. */
export function readText(png: Uint8Array, keyword = LIGHT_KEYWORD): string | null {
    for (const c of chunks(png)) {
        if (c.type !== "tEXt") continue
        const data = png.subarray(c.dataStart, c.dataEnd)
        const zero = data.indexOf(0)
        if (zero < 0) continue
        if (latin1(data.subarray(0, zero)) === keyword) return latin1(data.subarray(zero + 1))
    }
    return null
}

/** A copy of the file with `text` under `keyword`, replacing any text already there, before the end chunk. */
export function writeText(png: Uint8Array, text: string, keyword = LIGHT_KEYWORD): Uint8Array {
    const all = chunks(png)
    const keep = all.filter((c) => !(c.type === "tEXt" && readKeyword(png, c) === keyword))
    const body = toLatin1(`${keyword}\0${asciiSafe(text)}`)
    const chunk = new Uint8Array(12 + body.length)
    const view = new DataView(chunk.buffer)
    view.setUint32(0, body.length)
    chunk.set([116, 69, 88, 116], 4)
    chunk.set(body, 8)
    view.setUint32(8 + body.length, crc32(chunk, 4, 8 + body.length))
    const parts: Uint8Array[] = [png.subarray(0, 8)]
    for (const c of keep) {
        if (c.type === "IEND") parts.push(chunk)
        parts.push(png.subarray(c.start, c.end))
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}

/** Whether every chunk's CRC is right: what a file carried through a store and back should still be. */
export function checksumsHold(png: Uint8Array): boolean {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    return chunks(png).every((c) => crc32(png, c.start + 4, c.dataEnd) === view.getUint32(c.dataEnd))
}

function readKeyword(png: Uint8Array, c: Chunk): string {
    const data = png.subarray(c.dataStart, c.dataEnd)
    const zero = data.indexOf(0)
    return zero < 0 ? "" : latin1(data.subarray(0, zero))
}

function latin1(bytes: Uint8Array): string {
    let s = ""
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
    return s
}

function toLatin1(s: string): Uint8Array {
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
}

/** tEXt holds Latin-1: anything past ASCII goes as a JSON escape, which JSON.parse reads back. */
function asciiSafe(text: string): string {
    return text.replace(/[^\x20-\x7e]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"))
}
