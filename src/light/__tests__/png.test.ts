import { deflateSync } from "node:zlib"
import { checksumsHold, readText, writeText } from "../png"

/** A real 2 by 2 RGBA PNG, built here so the test needs no file. */
function png(): Uint8Array {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
    const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
    const chunk = (type: string, data: Uint8Array) => {
        const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer)
        v.setUint32(0, data.length); out.set([...type].map((c) => c.charCodeAt(0)), 4); out.set(data, 8)
        v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
        return out
    }
    const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer)
    v.setUint32(0, 2); v.setUint32(4, 2); ihdr[8] = 8; ihdr[9] = 6
    const raw = new Uint8Array([0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 255, 255, 255, 255, 255, 64])
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}

describe("the light file's text chunk", () => {
    it("is written before the end chunk with a right CRC, read back, and replaced rather than repeated", () => {
        const plain = png()
        expect(readText(plain)).toBe(null)
        const once = writeText(plain, JSON.stringify({ fingerprint: "abc", name: "kraków.glb" }))
        expect(checksumsHold(once)).toBe(true)
        expect(JSON.parse(readText(once)!)).toEqual({ fingerprint: "abc", name: "kraków.glb" })
        const twice = writeText(once, "{\"fingerprint\":\"def\"}")
        expect(JSON.parse(readText(twice)!)).toEqual({ fingerprint: "def" })
        expect(twice.length).toBe(plain.length + 12 + "oj-light\0{\"fingerprint\":\"def\"}".length)
        // The pixels are untouched: the chunks before IEND are the same bytes.
        expect(twice.subarray(0, plain.length - 12)).toEqual(plain.subarray(0, plain.length - 12))
    })

    it("leaves another keyword's text alone, and refuses what is not a PNG", () => {
        const other = writeText(png(), "hello", "Comment")
        const both = writeText(other, "{}")
        expect(readText(both, "Comment")).toBe("hello")
        expect(readText(both)).toBe("{}")
        expect(() => readText(new Uint8Array([1, 2, 3]))).toThrow(/not a PNG/)
        const cut = png().subarray(0, 40)
        expect(() => readText(cut)).toThrow(/runs past the end|no end chunk/)
    })

    it("notices a byte changed in a chunk", () => {
        const bytes = writeText(png(), "{}")
        bytes[bytes.length - 20] ^= 1
        expect(checksumsHold(bytes)).toBe(false)
    })
})
