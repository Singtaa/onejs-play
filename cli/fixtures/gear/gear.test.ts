import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, vi } from "vitest"
import check, { SAMPLES, decodePng, expected, glbPicture } from "./gear.playtest.mjs"

const body = glbPicture(path.join(import.meta.dirname, "body.glb"))
const paint = decodePng(fs.readFileSync(path.join(import.meta.dirname, "paint.png")))
const WANT = expected(body, paint)

/** checks()'s answer from a container that does everything right. */
const RIGHT = {
    own: { width: 256, height: 256 },
    body: WANT.body, paint: WANT.paint, composed: WANT.composed,
    samePicture: true,
    joints: ["hips", "chest", "head", "shoulder.L", "shoulder.R", "hand.L", "hand.R"],
    parts: ["person", "helm", "shoulder.L", "shoulder.R", "cloak", "sword", "shield"],
    dressedTexture: true,
}

/** A game whose checks() answers `got`. */
function fake(got: object) {
    return {
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.gear")) return "object"
            if (code.includes("getContext(\"webgpu\")")) return "webgpu"
            if (code.includes("gear.checks(")) return JSON.stringify(got)
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

const linear = (c: number) => Math.round(255 * ((c / 255) <= 0.04045 ? (c / 255) / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4))

describe("the gear playtest", () => {
    vi.spyOn(console, "log").mockImplementation(() => {})

    it("reads samples that can tell: a body of several colours, and the paint's three bands", () => {
        expect(new Set(WANT.body.map((t) => t.join())).size).toBeGreaterThan(2)
        expect(new Set(WANT.paint.map((t) => t[3]))).toEqual(new Set([0, 128, 255]))
        expect(SAMPLES).toHaveLength(10)
    })

    it("passes a container that hands back the files' bytes", async () => {
        await expect(check(fake(RIGHT) as any)).resolves.toBeUndefined()
    })

    it("fails a body picture left in linear light, as a texture read without encoding it back would be", async () => {
        const got = { ...RIGHT, body: WANT.body.map(([r, g, b, a]) => [linear(r), linear(g), linear(b), a]) }
        await expect(check(fake(got) as any)).rejects.toThrow(/body at/)
    })

    it("fails paint left straight, not premultiplied", async () => {
        const straight = SAMPLES.map(([x, y]) => Array.from(paint.rgba.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4)))
        await expect(check(fake({ ...RIGHT, paint: straight }) as any)).rejects.toThrow(/paint at \(255, 140\)/)
    })

    it("fails a composite that dropped the body under the paint's half see-through band", async () => {
        await expect(check(fake({ ...RIGHT, composed: WANT.paint }) as any)).rejects.toThrow(/composed at/)
    })

    it("fails a model with no picture, two pictures for one texture, and a missing part", async () => {
        await expect(check(fake({ own: null }) as any)).rejects.toThrow(/model.texture was null/)
        await expect(check(fake({ ...RIGHT, samePicture: false }) as any)).rejects.toThrow(/made two pictures/)
        await expect(check(fake({ ...RIGHT, parts: ["person"] }) as any)).rejects.toThrow(/no part helm/)
    })

    it("fails a run that read fewer samples than it asked for", async () => {
        await expect(check(fake({ ...RIGHT, body: WANT.body.slice(1) }) as any)).rejects.toThrow(/read 9 samples of 10/)
    })
})
