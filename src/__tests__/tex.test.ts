import { describe, it, expect } from "vitest"
import { tex, TexImage } from "../tex"
import { plan, materialised } from "../tex/engine"
import { KERNELS, SPECS, parseStops } from "../tex/nodes"
import { toneTable } from "../tex/kernels"
import toneFixture from "./fixtures/tone-tables.json"

/**
 * The parameter each Magerie op takes as its leading kind string, from its
 * script API (`OpSpec.kindParam` in magerie-one js/src/nodes/scriptapi,
 * branch feat/copy-ojplay-code-mac004 at aa4eafae4). Magerie's exporter
 * writes `op(images, kind, { options })`, so a node here with another kind,
 * or none, would put that string in a number's place.
 */
const MAGERIE_KINDS: Record<string, string> = {
    noise: "type", blend: "mode", gradient: "type", solidColor: "color", sdfShape: "shape", pattern: "type",
    scatter: "layout", invert: "channels", colorSpaceDecompose: "colorSpace", channelMath: "operation",
    curvature: "mode", autoLevels: "mode", curves: "preset", slopeBlur: "mode", alphaMerge: "alphaChannel",
}

/** Nodes Magerie's script API has no op for, whose kind tex chose: the exporter writes them as tex spells them. */
const TEX_KINDS: Record<string, string> = { channelShuffle: "swizzle", distance: "mode" }

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
        expect(parseStops([{ position: 0.5, color: "#808080" }])[0]).toEqual({ at: 0.5, color: [128 / 255, 128 / 255, 128 / 255], alpha: 1 })
        expect(() => parseStops(["green"])).toThrow(/not a colour/)
        // Magerie's own spellings (parseHex): 3, 4, 6 or 8 digits. A Gradient Map uses the colour and drops the alpha.
        expect(parseStops([{ position: 0, color: "#c8704cff" }])[0]!.color).toEqual([200 / 255, 112 / 255, 76 / 255])
        expect(parseStops([{ position: 0, color: "#c8704c00" }])[0]).toEqual({ at: 0, color: [200 / 255, 112 / 255, 76 / 255], alpha: 0 })
        expect(parseStops(["#f80", "#f80c 50%", "c8704c"]).map((s) => s.color)).toEqual([
            [1, 136 / 255, 0], [1, 136 / 255, 0], [200 / 255, 112 / 255, 76 / 255],
        ])
        expect(() => parseStops(["#c8704cf"])).toThrow(/not a colour/)
    })
})

describe("tex against Magerie's exporter", () => {
    it("takes a leading kind string on exactly the nodes Magerie writes one for", () => {
        for (const [name, spec] of Object.entries(SPECS) as [string, { kind?: string }][]) {
            expect([name, spec.kind]).toEqual([name, MAGERIE_KINDS[name] ?? TEX_KINDS[name]])
        }
    })
})

describe("tex curves", () => {
    it("builds Magerie's tone table to the byte", () => {
        for (const [name, points] of Object.entries(toneFixture.points)) {
            expect([name, Array.from(toneTable(points as [number, number][]))]).toEqual([name, toneFixture.tables[name as keyof typeof toneFixture.tables]])
        }
    })

    it("takes points as a custom curve, a preset by name, and refuses a malformed curve", () => {
        const { noise } = tex.canvas(64)
        const a = noise("perlin", 3)
        const sand = a.curves([[0, 0.15], [0.2, 0.44], [0.5, 0.5], [0.8, 0.56], [1, 0.88]])
        expect(sand.node.inputs[1]!.params.rgba).toEqual(toneFixture.tables.sand.flatMap((v) => [v, v, v, 255]))
        // Magerie's export spelling, a preset with its own points beside it, is the same node.
        expect(a.curves("s-curve").node.id).toBe(a.curves("s-curve", { points: [[0, 0], [1, 1]] }).node.id)
        expect(a.curves("custom", { points: toneFixture.points.s as [number, number][] }).node.id).toBe(a.curves("s-curve").node.id)
        expect(a.curves({ channel: "red" }).node.params).toEqual({ channel: "red" })
        expect(() => a.curves([[0, 0]])).toThrow(/two or more \[x, y\] pairs/)
        expect(() => a.curves("sharpen" as never)).toThrow(/curves preset is "sharpen"/)
    })

    it("uploads one table for equal curves, and fuses the lookup with its input", () => {
        const { noise, blend } = tex.canvas(64)
        const a = noise("perlin", 3), b = noise("voronoi", 4)
        const both = blend(a.curves("darken"), b.curves("darken"), "multiply")
        expect(new Set([both.node.inputs[0]!.inputs[1]!.id, both.node.inputs[1]!.inputs[1]!.id]).size).toBe(1)
        expect(passes(both)).toHaveLength(1)
    })
})

describe("tex material and auto levels", () => {
    it("reduces a picture to one texel in quarter steps, one chain for luminance and two per channel", () => {
        const { noise } = tex.canvas(300, { tile: true })
        const a = noise("perlin", 3)
        const lum = a.autoLevels()
        expect(lum.node.inputs.map((i) => [i.width, i.height])).toEqual([[300, 300], [1, 1]])
        expect(lum.tiles).toBe(true)
        const sizes: number[] = []
        for (let n = lum.node.inputs[1]!; n.op === "rangeStep"; n = n.inputs[0]!) sizes.push(n.width)
        expect(sizes).toEqual([1, 2, 5, 19, 75])
        expect(a.autoLevels("perChannel").node.inputs).toHaveLength(3)
        expect(passes(lum).length).toBeGreaterThan(5)
    })

    it("takes Magerie's material({ albedo, ... }) and lights it, a number standing in for a map", () => {
        const { noise, material, materialLight } = tex.canvas(64, { tile: true })
        const albedo = noise("perlin", 1), height = noise("perlin", 2)
        const m = material({ albedo, normal: height.normalMap(), roughness: 0.5, ao: height })
        const lit = materialLight(m, 135, { lightElevation: 60 })
        expect(lit.node.inputs).toHaveLength(3)
        expect(lit.node.params).toMatchObject({ numbers: { roughness: 0.5, metallic: 0, opacity: 1 }, light: { angle: 135, elevation: 60 } })
        expect(lit.tiles).toBe(true)
        expect(passes(lit).length).toBeGreaterThan(0)
        expect(() => material({ normal: height } as never)).toThrow(/albedo is required/)
        expect(() => material({ albedo, shine: 1 } as never)).toThrow(/no map "shine"/)
        expect(() => materialLight(albedo as never)).toThrow(/a material from tex.material/)
    })

    it("warps along an angle, wrapping when the source tiles", () => {
        const { noise } = tex.canvas(64, { tile: true })
        const a = noise("perlin", 1)
        const w = a.directionalWarp(a, 30, 20)
        expect(w.node.params).toMatchObject({ angle: 30, intensity: 20, wrap: true })
        expect(passes(w).length).toBeGreaterThan(0)
    })
})

describe("tex generators and mixes", () => {
    it("makes Magerie's Gradient and Solid Color at the canvas size, a solid colour tiling", () => {
        const { gradient, solidColor, noise } = tex.canvas(48)
        expect(gradient("radial", ["#ffffff", "#000000"]).node.params).toMatchObject({ type: "radial", center: [0.5, 0.5] })
        expect(gradient({ angle: 90, width: 32 }).width).toBe(32)
        expect(gradient().tiles).toBe(false)
        expect(solidColor("#c8c8c8ff").tiles).toBe(true)
        expect(solidColor("#1c200c80").node.params.stops).toEqual([0, 1].map((at) => ({ at, color: [28 / 255, 32 / 255, 12 / 255], alpha: 128 / 255 })))
        expect(() => gradient(Array.from({ length: 17 }, () => "#000"))).toThrow(/1 to 16 stops/)
        // Mixes take the first picture's size, and the other is stretched to it.
        const small = noise("perlin", 1, { width: 16, height: 16 })
        expect(noise("perlin", 2).mask(small).width).toBe(48)
        expect(noise("perlin", 2).channelMath(small, "subtract").node.params).toEqual({ operation: "subtract", channels: "rgb" })
    })

    it("stores Alpha Merge at 16 bits, as Magerie does, and everything else at 8", () => {
        const { noise } = tex.canvas(32)
        expect(noise("perlin", 1).alphaMerge(noise("perlin", 2)).node.params).toEqual({ alphaChannel: "luma", half: true })
        expect(passes(noise("perlin", 1).alphaMerge(noise("perlin", 2), "red")).length).toBe(1)
    })
})

describe("tex pixelate", () => {
    it("reads the input once a block, never says it tiles, and takes its block size first", () => {
        const img = tex.canvas(32, { tile: true }).noise(3).pixelate(4)
        expect(img.node.params).toEqual({ blockSize: 4 })
        expect(img.tiles).toBe(false)
        expect(passes(img)).toHaveLength(2)
    })
})

describe("tex tile grid", () => {
    it("returns Magerie's three pictures, which always tile, from one call", () => {
        const { tileGrid } = tex.canvas(64)
        const { image, random, uv } = tileGrid(4, { rows: 8, seed: 3, lengthJitter: 0.4 })
        for (const out of [image, random, uv]) {
            expect([out.width, out.height, out.tiles]).toEqual([64, 64, true])
        }
        expect(image.node.params.output).toBe("height")
        expect(image.node.params.values).toEqual(random.node.params.values)
        expect(image.node).not.toBe(random.node)
        expect((image.node.params.values as { columns: number }).columns).toBe(4)
        // Magerie's clamps: counts whole and at least 1, shares within their sliders.
        expect(tileGrid({ columns: 2.6, rows: 0, jointWidth: 0.9 }).image.node.params.values).toMatchObject({ columns: 3, rows: 1, jointWidth: 0.5 })
        expect(() => tileGrid({ bitDepth: "16" as "8" })).toThrow(/bitDepth is "16"/)
    })

    it("draws 32 bits from bitDepth or the canvas, and everything reading it is 32 bits too", () => {
        const { image } = tex.canvas(64).tileGrid({ bitDepth: "32" })
        const lit = image.blur(2).normalMap(4)
        const plans = passes(lit)
        expect(plans.every((p) => p.bits === 32)).toBe(true)
        expect(lit.node.params.float).toBe(true)
        // An 8-bit graph keeps 16-bit targets holding 8-bit values, and says nothing of floats.
        const plain = tex.canvas(64).tileGrid().image.blur(2)
        expect(passes(plain).map((p) => p.bits)).toEqual([16, 16, 16])
        expect("float" in plain.node.params).toBe(false)
        expect(tex.canvas(64, { bitDepth: "32" }).tileGrid().random.node.params.float).toBe(true)
        expect(() => tex.canvas(64, { bitDepth: "16" as "8" })).toThrow(/"8" or "32"/)
    })

    it("reads a float picture by fetches only, unfiltered, since a float texture may not filter", () => {
        const { image } = tex.canvas(64).tileGrid({ bitDepth: "32" })
        const blurred = passes(image.blur(2))
        const reader = blurred[1]!.program
        expect(reader.wgsl).toMatch(/textureLoad/)
        expect(reader.wgsl).not.toMatch(/textureSample/)
    })

    it("hashes each cell with unsigned integer maths on both web dialects", () => {
        const { image } = tex.canvas(32).tileGrid()
        const [p] = passes(image.gradientMap(["#000000", "#ffffff"]))
        expect(p!.program.glsl).toMatch(/uint/)
        expect(p!.program.wgsl).toMatch(/u32/)
    })
})

describe("tex shapes and masks", () => {
    it("takes Magerie's Shape call whole, and draws its circle, ellipse and vesica", () => {
        const { sdfShape } = tex.canvas(32)
        const leaf = sdfShape("ellipse", 0.8, { shapeWidth: 1, shapeHeight: 0.74, rotation: 90, capsuleLength: 0.6, transparentBackground: true })
        expect(leaf.node.params).toMatchObject({ shape: "ellipse", a: 0.4, b: 0.8 * 0.74 / 2, background: [0, 0, 0, 0] })
        expect(leaf.node.params.cos).toBeCloseTo(0)
        expect(leaf.tiles).toBe(false)
        expect(sdfShape("vesica", { vesicaWidth: 0.92, width: 96, height: 64 }).width).toBe(96)
        // @ts-expect-error: a shape tex does not draw yet is refused by type and at run time.
        expect(() => sdfShape("heart")).toThrow(/circle, ellipse, vesica so far/)
    })

    it("shuffles channels by name or by a four-letter swizzle", () => {
        const { noise } = tex.canvas(16)
        expect(noise(1).channelShuffle("aaa1").node.params).toEqual({ out: ["a", "a", "a", "1"] })
        expect(noise(1).channelShuffle({ outR: "g" }).node.params).toEqual({ out: ["g", "g", "b", "a"] })
        expect(() => noise(1).channelShuffle("rgbx")).toThrow(/four of r, g, b, a, 0 and 1/)
    })

    it("composites up to three layers over a base, one pass, at the first size past 1 by 1", () => {
        const { noise, solidColor } = tex.canvas(32)
        const base = noise(1)
        expect(base.composite().node).toBe(base.node)
        const stack = solidColor({ width: 1, height: 1 }).composite(noise(2), noise(3), noise(4))
        expect([stack.width, stack.height]).toEqual([32, 32])
        // The 1 by 1 base is another size, so it is drawn first; the layers go over it in one pass.
        expect(passes(stack)).toHaveLength(2)
        expect(passes(base.composite(noise(2), noise(3)))).toHaveLength(1)
        // @ts-expect-error: three layers at most.
        expect(() => base.composite(noise(2), noise(3), noise(4), noise(5))).toThrow(/takes nothing after its 1 to 4 images/)
    })

    it("floods distance in log2 steps plus one, held in half floats", () => {
        const { noise } = tex.canvas(128)
        const d = noise(1).distance("outside", 140)
        // A seed pass, 64 down to 1 and one more 1, then the distance.
        expect(passes(d).map((p) => p.node.op).slice(1)).toEqual(["distanceSeed", ...Array(8).fill("distanceStep"), "distanceRemap"])
        expect(d.node.params).toEqual({ maxDistance: 140, wrap: false, half: true })
        expect(noise(1).distance({ edges: "wrap" }).tiles).toBe(true)
        // @ts-expect-error: not a mode.
        expect(() => noise(1).distance("both")).toThrow(/"inside" or "outside"/)
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
