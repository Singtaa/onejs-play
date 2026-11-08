import { describe, it, expect } from "vitest"
import { tex, TexImage } from "../tex"
import { plan, materialised } from "../tex/engine"
import { KERNELS, parseStops } from "../tex/nodes"

const passes = (img: TexImage) => plan(img.node, KERNELS)

describe("tex graph", () => {
    it("spells a node the same way as a function and as a method", () => {
        const { noise, blur } = tex.canvas(64)
        const a = noise("perlin", 7)
        expect(blur(a, 3).node.id).toBe(a.blur(3).node.id)
        expect(a.blur(3).node.id).not.toBe(a.blur(4).node.id)
    })

    it("takes positional parameters, then options, and refuses a key Magerie has not", () => {
        const { noise } = tex.canvas(64)
        expect(noise("voronoi", 5, { scale: 7 }).node.params).toMatchObject({ shape: { type: "voronoi" }, values: { seed: 5, scale: [7, 7] } })
        expect(noise({ type: "white" }).node.params).toMatchObject({ shape: { type: "white", single: true } })
        expect(() => noise("perlin", 1, { sclae: 3 } as never)).toThrow(/no option "sclae"/)
        // The kind string is optional, as in Magerie's script API, and any parameter can be an option.
        expect(noise(5).node.id).toBe(noise("simplex", 5).node.id)
        expect(noise({ seed: 5 }).node.id).toBe(noise(5).node.id)
        const h = noise("perlin", 2), s = noise("simplex", 3)
        expect(h.slopeBlur(s, "min", 8).node.id).toBe(h.slopeBlur(s, 8, { mode: "min" }).node.id)
        expect(h.curvature("convex").node.id).toBe(h.curvature({ mode: "convex" }).node.id)
        expect(h.blend(s, 0.5).node.id).toBe(h.blend(s, "normal", 0.5).node.id)
        expect(() => h.blur("6" as never)).toThrow(/blur radius is 6, a number/)
        expect(() => (h.blur as (...a: unknown[]) => unknown)(6, "wrap")).toThrow(/takes radius after its image, then options; argument 3 is the string "wrap"/)
        expect(() => noise("perlin").blend(noise("white"), "overlya" as never)).toThrow(/blend mode is "overlya"/)
    })

    it("sizes generators by their canvas and tiles them when it does", () => {
        const { noise } = tex.canvas(256, { tile: true, height: 128 })
        const n = noise("perlin")
        expect([n.width, n.height, n.tiles]).toEqual([256, 128, true])
        expect(n.blur(2).tiles).toBe(true)
        expect(n.blur(2, { edges: "clamp" }).tiles).toBe(false)
        expect(tex.noise().width).toBe(1024)
    })

    it("reads gradient stops as CSS does", () => {
        expect(parseStops(["#000", "#ff0000 40%", "#fff"]).map((s) => s.at)).toEqual([0, 0.4, 1])
        expect(parseStops(["#000", "#111", "#222", "#fff"]).map((s) => s.at)).toEqual([0, 1 / 3, 2 / 3, 1])
        expect(parseStops([{ position: 0.5, color: "#808080" }])[0]).toEqual({ at: 0.5, color: [128 / 255, 128 / 255, 128 / 255] })
        expect(() => parseStops(["green"])).toThrow(/not a colour/)
    })
})

describe("tex planning", () => {
    it("fuses generators and pointwise nodes into one pass", () => {
        const { noise } = tex.canvas(64)
        const img = noise("perlin", 3).invert().levels(0.8).gradientMap(["#1a3d24", "#c9e267"]).blend(noise("voronoi", 2), "overlay", 0.5)
        expect(passes(img)).toHaveLength(1)
    })

    it("draws an area node's input first, and a blur as two axes", () => {
        const { noise } = tex.canvas(64)
        const p = passes(noise("perlin").blur(2))
        expect(p.map((x) => x.node.op)).toEqual(["noise", "blurX", "blurY"])
        expect(Object.keys(p[2]!.reads)).toEqual(["t0"])
    })

    it("draws a node read twice once", () => {
        const { noise } = tex.canvas(64)
        const a = noise("perlin", 9)
        const img = a.blend(a.invert(), "difference")
        expect(materialised(img.node).has(a.node.id)).toBe(true)
        expect(passes(img).map((x) => x.node.op)).toEqual(["noise", "blend"])
    })

    it("splits a pass that would read more textures than a program may", () => {
        const { noise } = tex.canvas(64)
        // Twelve shared noises, each read twice, all reaching one blend chain.
        const shared = Array.from({ length: 12 }, (_, i) => noise("perlin", i))
        let img = shared[0]!
        for (const s of shared.slice(1)) img = img.blend(s, "multiply").blend(s, "screen", 0.5)
        const p = passes(img)
        for (const x of p) expect(Object.keys(x.reads).length).toBeLessThanOrEqual(8)
        expect(p.length).toBeGreaterThan(13)
    })

    it("emits every kernel for both web backends", () => {
        const { noise } = tex.canvas(64, { tile: true })
        const d = noise("perlin", 11, { scale: 3, octaves: 3 })
        const img = noise("simplex", 23, { warp: 0.5 })
            .warp(d, 18)
            .blend(noise("voronoi", 5, { voronoiMode: "cell", octaves: 1 }), "softLight", 0.45)
            .blend(noise("ridged", 3), "hue")
            .tile(2, { mirror: true })
            .blur(1)
            .invert("g")
            .levels(0.8, { inputBlack: 0.1 })
            .gradientMap(["#1a3d24", "#2f6e26 35%", "#c9e267"])
            .alpha(d)
        for (const x of passes(img)) {
            expect(x.program.glsl.length).toBeGreaterThan(0)
            expect(x.program.wgsl.length).toBeGreaterThan(0)
        }
    })

    it("emits the height filters for both web backends, and smooths a normal map with its own Gaussian", () => {
        const { noise } = tex.canvas(64, { tile: true })
        const h = noise("perlin", 4)
        const imgs = [
            h.normalMap(4), h.normalMap(2, { smoothRadius: 0, flipY: true, edges: "clamp" }),
            h.slopeBlur(noise("simplex", 2), 12, { mode: "min" }), h.histogramScan(0.3, 0.2),
            h.curvature("convex", 2), h.ambientOcclusion(6, { samples: 8 }),
        ]
        for (const img of imgs) {
            for (const x of passes(img)) {
                expect(x.program.glsl.length).toBeGreaterThan(0)
                expect(x.program.wgsl.length).toBeGreaterThan(0)
            }
        }
        expect(passes(h.normalMap(4)).map((x) => x.node.op)).toEqual(["noise", "blurX", "blurY", "normalMap"])
        expect(passes(h.normalMap(4)).find((x) => x.node.op === "blurX")!.node.params).toMatchObject({ sigma: 2, taps: 4 })
        expect(passes(h.blur(4)).find((x) => x.node.op === "blurX")!.node.params).toMatchObject({ sigma: 4 / 3, taps: 4 })
        expect(passes(h.normalMap(4, { smoothRadius: 0.5 })).map((x) => x.node.op)).toEqual(["noise", "normalMap"])
        expect(imgs.map((i) => i.tiles)).toEqual([true, false, true, true, true, true])
    })

    it("keeps a parameter out of the program, so a new seed compiles nothing", () => {
        const { noise } = tex.canvas(64)
        const a = passes(noise("perlin", 1).levels(0.5))[0]!
        const b = passes(noise("perlin", 2).levels(0.7))[0]!
        expect(a.program.hash).toBe(b.program.hash)
        expect(a.uniforms).not.toEqual(b.uniforms)
    })
})
