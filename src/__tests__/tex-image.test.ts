import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { tex } from "../tex"
import { plan } from "../tex/engine"
import { KERNELS } from "../tex/nodes"
import { cacheKey } from "../tex/cache"

/** A loaded texture as the bridge hands one over: its size and whether its data is sRGB. */
const texture = (width: number, height: number, isDataSRGB = true) => ({ width, height, isDataSRGB }) as never

/** Unity's colour space, as `tex.image` asks it. */
function unity(space: "linear" | "gamma") {
    return { UnityEngine: { QualitySettings: { activeColorSpace: space === "linear" ? 1 : 0 }, ColorSpace: { Gamma: 0, Linear: 1 } } }
}

describe("tex.image", () => {
    let was: unknown
    beforeEach(() => {
        was = (globalThis as any).CS
        ;(globalThis as any).CS = unity("linear")
    })
    afterEach(() => { (globalThis as any).CS = was })

    it("makes a picture the texture's size, read in one pass from the texture itself", () => {
        const t = texture(256, 128)
        const img = tex.image(t)
        expect([img.width, img.height, img.tiles]).toEqual([256, 128, false])
        const passes = plan(img.node, KERNELS)
        expect(passes.map((p) => p.node.op)).toEqual(["fromTexture"])
        const reads = Object.values(passes[0]!.reads)
        expect(reads.map((n) => [n.op, n.kind])).toEqual([["texture", "source"]])
        expect(reads[0]!.texture).toBe(t)
        expect(tex.image(t, { tile: true }).tiles).toBe(true)
    })

    it("encodes an sRGB texture back from linear light in a linear project, and nothing else", () => {
        expect(tex.image(texture(4, 4, true)).node.params).toEqual({ decoded: true })
        expect(tex.image(texture(4, 4, false)).node.params).toEqual({ decoded: false })
        ;(globalThis as any).CS = unity("gamma")
        expect(tex.image(texture(4, 4, true)).node.params).toEqual({ decoded: false })
    })

    it("is one picture for one texture however often it is handed in, so composed looks share their bake", () => {
        const body = texture(256, 256), helm = texture(256, 256)
        expect(tex.image(body).node.id).toBe(tex.image(body).node.id)
        expect(tex.image(body).node.id).not.toBe(tex.image(helm).node.id)
        expect(tex.image(body).node.id).not.toBe(tex.image(body, { tile: true }).node.id)
        const look = () => tex.composite(tex.image(body), tex.image(helm))
        expect(look().node.id).toBe(look().node.id)
        expect(tex.composite(tex.image(helm), tex.image(body)).node.id).not.toBe(look().node.id)
    })

    it("is a base and a layer of composite, and goes through any node", () => {
        const body = tex.image(texture(256, 256)), helm = tex.image(texture(256, 256)), cloak = tex.image(texture(256, 256))
        const look = tex.composite(body, helm, cloak)
        const passes = plan(look.node, KERNELS)
        // The three reads fuse into the composite's one pass.
        expect(passes).toHaveLength(1)
        expect(Object.values(passes[0]!.reads).map((n) => n.op)).toEqual(["texture", "texture", "texture"])
        expect(passes[0]!.program.glsl.length).toBeGreaterThan(0)
        expect(passes[0]!.program.wgsl.length).toBeGreaterThan(0)
        expect(plan(body.hslAdjust(30).blur(2).node, KERNELS).length).toBeGreaterThan(1)
    })

    it("is never kept across loads, since a texture's pixels are not in its recipe", () => {
        const img = tex.image(texture(8, 8))
        expect(cacheKey(img.node)).toBeUndefined()
        expect(cacheKey(tex.composite(tex.canvas(8).solidColor("#ff0000"), img).node)).toBeUndefined()
    })

    it("refuses what is not a texture, and one past a picture's sizes", () => {
        expect(() => tex.image(null as never)).toThrow(/takes a texture/)
        expect(() => tex.image({} as never)).toThrow(/whole numbers of pixels from 1 to 8192/)
        expect(() => tex.image(texture(0, 4))).toThrow(/0 by 4/)
        expect(() => tex.image(texture(9000, 4))).toThrow(/9000 by 4/)
    })
})
