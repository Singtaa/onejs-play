import { createHash } from "node:crypto"
import { afterEach, vi } from "vitest"
import { sha256, sha256Hex } from "../sha256"

const node = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")

describe("sha256Hex", () => {
    it("is the standard digest of the empty message and of abc", () => {
        expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    })

    it("matches Node's at every length round a block's padding, and on a megabyte", () => {
        for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
            const b = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff)
            expect(sha256Hex(b)).toBe(node(b))
        }
        const big = new Uint8Array(1 << 20).map((_, i) => (i * 2654435761) >>> 24)
        expect(sha256Hex(big)).toBe(node(big))
    })
})

describe("sha256", () => {
    const abc = new TextEncoder().encode("abc")
    const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    afterEach(() => vi.unstubAllGlobals())

    it("takes the browser's digest first, of only the view's own bytes", async () => {
        const bridge = { Sha256: vi.fn(() => "bridge") }
        const view = new Uint8Array([0, 97, 98, 99, 0]).subarray(1, 4)
        expect(await sha256(view, bridge)).toBe(ABC)
        expect(bridge.Sha256).not.toHaveBeenCalled()
    })

    it("takes OneJS's where there is no crypto.subtle, as under QuickJS, and plain arithmetic where neither is", async () => {
        vi.stubGlobal("crypto", undefined)
        const bridge = { Sha256: vi.fn((b: Uint8Array) => b.length === 3 ? ABC : "wrong") }
        expect(await sha256(abc, bridge)).toBe(ABC)
        expect(bridge.Sha256).toHaveBeenCalledOnce()
        expect(await sha256(abc, {})).toBe(ABC)
        expect(await sha256(abc)).toBe(ABC)
    })
})
