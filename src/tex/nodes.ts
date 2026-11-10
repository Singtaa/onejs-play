/**
 * The node table: each Magerie node once, with its name, call shape,
 * defaults and kernel. Both spellings come from here, `blur(img, 6)` and
 * `img.blur(6)`, so they cannot drift.
 *
 * Call shape is Magerie's script API (magerie-one `docs/script-api.md`):
 * leading images, then the positional parameters in order, then an options
 * object. Unknown option keys throw, as Magerie's do, so a misspelt key is
 * an error and not a silent default.
 */
import { isFloat, makeNode, type Edges, type Node, type NodeKind } from "./graph"
import type { Kernel } from "./engine"
import * as k from "./kernels"
import type { BlendMode, Fractal, InvertChannels, NoiseType, Stop, VoronoiMode } from "./kernels"

/** Where generators take their size and tiling from when a call does not say. */
export interface Canvas {
    readonly width: number
    readonly height: number
    readonly tile: boolean
    /** What a generator that takes `bitDepth` draws at when its call does not say. */
    readonly bitDepth: "8" | "32"
}

export interface Spec {
    /** Leading image arguments. */
    readonly images: number
    /** Up to this many more images may follow them, as Composite's layers do. */
    readonly optionalImages?: number
    /**
     * The parameter a leading string after the images names, as Magerie's
     * script API takes a kind: `noise("voronoi", 5)`, `slopeBlur(a, s, "min")`.
     * Optional, so `noise(5)` is a seed.
     */
    readonly kind?: string
    /** The parameters a call may give in order after the images (and the kind). */
    readonly positional: readonly string[]
    /** Every option and its default. A key missing here is refused. */
    readonly defaults: Readonly<Record<string, unknown>>
    /** Takes a `material(...)` before anything else, as Material Light does. */
    readonly material?: true
    /**
     * The node a call makes, from its resolved parameters; or, for a node
     * with several outputs, one per output, named as Magerie's script API
     * names its ports without "out-" (Tile Grid's image, random and uv).
     */
    make(p: Record<string, unknown>, images: readonly Node[], canvas: Canvas, material?: Material): Node | Readonly<Record<string, Node>>
}

/**
 * Magerie's Material (spec 8.1): a bundle of maps, no pixels of its own. A
 * channel is a picture, or a number standing in for the slider, as in
 * Magerie's `material({ albedo, normal, roughness, ... })`.
 */
export interface Material {
    readonly kind: "material"
    readonly albedo: Node
    readonly normal: Node | null
    readonly roughness: Node | number
    readonly metallic: Node | number
    readonly ao: Node | number
    readonly emissive: Node | null
    readonly opacity: Node | number
}

const MATERIAL_DEFAULTS = { albedo: undefined, normal: null, roughness: 0.5, metallic: 0, height: null, ao: 1, emissive: null, opacity: 1 }

export function isMaterial(v: unknown): v is Material {
    return v !== null && typeof v === "object" && (v as { kind?: unknown }).kind === "material"
}

/** A Material from its options, each map a picture's node or, for the scalar channels, a number 0 to 1. */
export function makeMaterial(options: unknown, nodeOf: (v: unknown) => Node | undefined): Material {
    if (options === null || typeof options !== "object" || Array.isArray(options)) throw new Error("[oj] tex material: takes { albedo, normal, roughness, metallic, height, ao, emissive, opacity }")
    const o = options as Record<string, unknown>
    for (const key of Object.keys(o)) {
        if (!(key in MATERIAL_DEFAULTS)) throw new Error(`[oj] tex material: no map "${key}"; it has ${Object.keys(MATERIAL_DEFAULTS).join(", ")}`)
    }
    const image = (key: string, required = false): Node | null => {
        const v = o[key]
        if (v === undefined || v === null) {
            if (required) throw new Error(`[oj] tex material: ${key} is required, a picture from tex`)
            return null
        }
        const n = nodeOf(v)
        if (n === undefined) throw new Error(`[oj] tex material: ${key} is ${typeof v}, a picture from tex`)
        return n
    }
    const scalar = (key: "roughness" | "metallic" | "ao" | "opacity"): Node | number => {
        const v = o[key]
        if (v === undefined) return MATERIAL_DEFAULTS[key]
        return typeof v === "number" ? num(v, `material ${key}`, 0, 1) : image(key)!
    }
    // Height is part of Magerie's bundle, and Material Light does not read it.
    if (o.height !== undefined && o.height !== null) image("height")
    return Object.freeze({
        kind: "material" as const, albedo: image("albedo", true)!, normal: image("normal"),
        roughness: scalar("roughness"), metallic: scalar("metallic"), ao: scalar("ao"),
        emissive: image("emissive"), opacity: scalar("opacity"),
    })
}

const SIZE = { width: null, height: null }

function sizeOf(p: Record<string, unknown>, canvas: Canvas): [number, number] {
    const w = p.width ?? canvas.width, h = p.height ?? canvas.height
    for (const [what, v] of [["width", w], ["height", h]] as const) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 8192) throw new Error(`[oj] tex: ${what} is ${String(v)}, a whole number of pixels from 1 to 8192`)
    }
    return [w as number, h as number]
}

/**
 * Magerie's Bit Depth (nodes/_bitDepth.ts), on every generator that has it:
 * "32" holds the output in 32-bit floats, and everything reading it, as
 * Magerie's float wins downstream; "8" or absent is 8 bits. A call that does
 * not say takes the canvas's.
 */
function bitDepthOf(p: Record<string, unknown>, canvas: Canvas, what: string): boolean {
    return oneOf(p.bitDepth ?? canvas.bitDepth, ["8", "32"], `${what} bitDepth`) === "32"
}

function wraps(edges: unknown, input: Node, what: string): boolean {
    if (edges === "wrap") return true
    if (edges === "clamp") return false
    if (edges === "auto") return input.tiles
    throw new Error(`[oj] tex ${what}: edges is ${JSON.stringify(edges)}, and is "auto", "wrap" or "clamp"`)
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
    if (typeof value === "string" && (options as readonly string[]).includes(value)) return value as T
    throw new Error(`[oj] tex: ${what} is ${JSON.stringify(value)}, one of ${options.map((o) => `"${o}"`).join(", ")}`)
}

function num(value: unknown, what: string, min = -Infinity, max = Infinity): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`[oj] tex: ${what} is ${String(value)}, a number`)
    return Math.min(Math.max(value, min), max)
}

/** A pointwise node at its first input's size, tiling when all of its inputs do. */
function pointwise(op: string, p: Record<string, unknown>, inputs: readonly Node[]): Node {
    const a = inputs[0]!
    return makeNode(op, "pointwise", inputs, p, a.width, a.height, inputs.every((i) => i.tiles))
}

/** An area node at its first input's size, tiling when it reads its first input wrapped and that tiles. */
function area(op: string, p: Record<string, unknown>, inputs: readonly Node[], tiles: boolean): Node {
    const a = inputs[0]!
    return makeNode(op, "area" as NodeKind, inputs, p, a.width, a.height, tiles)
}

/** A separable Gaussian, x then y, the intermediate stored as the input is (spec 4.1). */
function gaussian(a: Node, g: { sigma: number, taps: number }, wrap: boolean): Node {
    const v = { sigma: g.sigma, taps: g.taps, wrap }
    return area("blurY", v, [area("blurX", v, [a], wrap && a.tiles)], wrap && a.tiles)
}

const wrapOf = (n: Node): boolean => n.params.wrap as boolean

function gaussianAxis(s: Parameters<Kernel>[0], n: Node, i: Parameters<Kernel>[2], axis: "x" | "y") {
    return k.blurAxis(s, i.texture(0, wrapOf(n)), n.params.sigma as number, n.params.taps as number, axis, wrapOf(n))
}

const SLOPE_MODES: readonly k.SlopeBlurMode[] = ["blur", "max", "min"]
const CURVATURE_MODES: readonly k.CurvatureMode[] = ["both", "convex", "concave"]
const NOISE_TYPES: readonly NoiseType[] = ["perlin", "simplex", "voronoi", "white", "turbulence", "ridged"]
const VORONOI_MODES: readonly VoronoiMode[] = ["f1", "f2", "f2-f1", "cell"]
const FRACTALS: readonly Fractal[] = ["standard", "ridged", "billow"]
export const BLEND_MODES: readonly BlendMode[] = [
    "normal", "multiply", "screen", "overlay", "softLight", "hardLight", "add", "darken", "lighten",
    "colorDodge", "colorBurn", "linearBurn", "vividLight", "linearLight", "pinLight", "difference",
    "exclusion", "subtract", "hue", "saturation", "color", "luminosity",
]
const CHANNELS: readonly InvertChannels[] = ["rgb", "r", "g", "b"]
const GRADIENT_TYPES: readonly k.GradientType[] = ["linear", "radial", "angular"]
const CHANNEL_MATH_OPS: readonly k.ChannelMathOp[] = ["add", "subtract", "multiply", "screen", "overlay", "difference", "divide"]
const CHANNEL_MATH_CHANNELS: readonly k.ChannelMathChannels[] = ["rgb", "rgba", "r", "g", "b", "a"]
const ALPHA_CHANNELS: readonly k.AlphaChannel[] = ["luma", "red", "alpha"]
const SHAPES: readonly k.ShapeType[] = ["circle", "ellipse", "vesica"]
const CHANNEL_SOURCES: readonly k.ChannelSource[] = ["r", "g", "b", "a", "0", "1"]
const TILE_GRID_OUTPUTS = { image: "height", random: "random", uv: "uv" } as const satisfies Record<string, k.TileGridOutput>
/** Every parameter of Magerie's Shape, so a board's call is taken whole; tex draws three of its shapes so far. */
const SHAPE_DEFAULTS = {
    shape: "circle", size: 1.5, edgeBand: 0, rotation: 0, offsetX: 0, offsetY: 0, shapeWidth: 0.5, shapeHeight: 0.5,
    capsuleLength: 0.6, capsuleThickness: 0.3, cornerRadius: 0.05, angle: 270, thickness: 0.05,
    eggHeight: 0.45, eggBottomRadius: 0.3, eggTopRadius: 0.1, eggBulge: 0.75,
    moonDistance: 0.2, moonOuterRadius: 0.45, moonInnerRadius: 0.32, vesicaWidth: 0.5, vesicaHeight: 0.8,
    fillColor: "#ffffff", edgeColor: "#ff6b6b", backgroundColor: "#000000", transparentBackground: false,
}

/**
 * Two pictures mixed pixel by pixel at Magerie's mix size (spec 1.3): the
 * first that is not 1 by 1 decides, the other is stretched to it; it tiles
 * when every input larger than 1 by 1 does.
 */
function mixed(op: string, p: Record<string, unknown>, inputs: readonly Node[]): Node {
    const size = inputs.find((i) => i.width > 1 || i.height > 1) ?? inputs[0]!
    const big = inputs.filter((i) => i.width > 1 || i.height > 1)
    return makeNode(op, "pointwise", inputs, p, size.width, size.height, big.length > 0 && big.every((i) => i.tiles))
}

const AUTO_LEVELS_MODES: readonly k.AutoLevelsMode[] = ["luminance", "perChannel"]

/** Auto Levels' reduction: 4 by 4 blocks to one texel, keyed on the first step. */
function rangeOf(a: Node, key: k.RangeKey): Node {
    let n = a
    let first = true
    do {
        n = makeNode("rangeStep", "area", [n], { key: first ? key : null }, Math.ceil(n.width / 4), Math.ceil(n.height / 4), false)
        first = false
    } while (n.width > 1 || n.height > 1)
    return n
}
const CURVES_CHANNELS: readonly k.CurvesChannel[] = ["rgb", "red", "green", "blue"]

/** Magerie's Curves presets (curves/definition.ts), whose points win over a custom curve's. */
const CURVES_PRESETS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
    "linear": [[0, 0], [1, 1]],
    "increase-contrast": [[0, 0], [0.25, 0.15], [0.5, 0.5], [0.75, 0.85], [1, 1]],
    "decrease-contrast": [[0, 0], [0.25, 0.35], [0.5, 0.5], [0.75, 0.65], [1, 1]],
    "brighten": [[0, 0], [0.25, 0.35], [0.5, 0.6], [0.75, 0.8], [1, 1]],
    "darken": [[0, 0], [0.25, 0.15], [0.5, 0.4], [0.75, 0.65], [1, 1]],
    "s-curve": [[0, 0], [0.25, 0.1], [0.5, 0.5], [0.75, 0.9], [1, 1]],
    "inverse": [[0, 1], [1, 0]],
}

/** A curve's points: `[x, y]` pairs, each 0 to 1. Magerie reads anything else as the identity; tex refuses it. */
function tonePoints(points: unknown): (readonly [number, number])[] {
    const ok = Array.isArray(points) && points.length >= 2
        && points.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1))
    if (!ok) throw new Error(`[oj] tex curves: points are ${JSON.stringify(points)}; write two or more [x, y] pairs from 0 to 1, such as [[0, 0.15], [0.5, 0.5], [1, 0.88]]`)
    return points as [number, number][]
}

/** A table a node computes on the CPU, as a source the graph uploads when it draws. Equal tables are one node. */
function table(rgba: readonly number[], width: number, height: number): Node {
    return makeNode("table", "source", [], { rgba }, width, height, false)
}

/**
 * A hex colour as Magerie's parseHex reads one: 3, 4, 6 or 8 digits, the `#`
 * optional. Its alpha, when it has one, is returned beside the colour for the
 * nodes that use it; a Gradient Map does not (Magerie's flattenGradientStops
 * keeps only r, g and b). Magerie reads a malformed colour as black, and tex
 * refuses it instead.
 */
export function hexRGBA(text: string, what: string): [number, number, number, number] {
    const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text.trim())
    if (m === null) throw new Error(`[oj] tex ${what}: ${JSON.stringify(text)} is not a colour; write it as #rrggbb or #rrggbbaa`)
    const short = m[1]!.length <= 4
    const h = short ? m[1]!.replace(/./g, (c) => c + c) : m[1]!
    return [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255) / 255) as [number, number, number, number]
}

/**
 * Gradient stops: CSS strings, `"#2f6e26 35%"`, where a stop without a
 * position takes one spaced evenly between its neighbours as CSS does; or
 * Magerie's `{ position, color }`.
 */
export function parseStops(stops: unknown, what = "gradientMap", most = 32): Stop[] {
    if (!Array.isArray(stops) || stops.length < 1 || stops.length > most) {
        throw new Error(`[oj] tex ${what}: colors are 1 to ${most} stops, "#rrggbb" or "#rrggbb 40%"`)
    }
    const parsed = stops.map((s, i): { at: number | null, color: [number, number, number, number] } => {
        if (typeof s === "string") {
            const [c, pos, extra] = s.trim().split(/\s+/)
            if (extra !== undefined || c === undefined) throw new Error(`[oj] tex ${what}: stop ${i} is ${JSON.stringify(s)}; a stop is a colour and an optional position, "#2f6e26 35%"`)
            if (pos === undefined) return { at: null, color: hexRGBA(c, what) }
            const m = /^(-?[0-9.]+)%$/.exec(pos)
            if (m === null) throw new Error(`[oj] tex ${what}: stop ${i}'s position is ${JSON.stringify(pos)}, a percentage such as 35%`)
            return { at: Number(m[1]) / 100, color: hexRGBA(c, what) }
        }
        if (s !== null && typeof s === "object" && typeof s.color === "string") {
            return { at: num(s.position, `${what} stop ${i} position`, 0, 1), color: hexRGBA(s.color, what) }
        }
        throw new Error(`[oj] tex ${what}: stop ${i} is ${JSON.stringify(s)}, a string such as "#2f6e26 35%"`)
    })
    // CSS: the first and last default to 0% and 100%, and a run without
    // positions spreads evenly between the stops either side.
    if (parsed[0]!.at === null) parsed[0]!.at = 0
    if (parsed[parsed.length - 1]!.at === null) parsed[parsed.length - 1]!.at = 1
    for (let i = 1; i < parsed.length; i++) {
        if (parsed[i]!.at !== null) continue
        let j = i
        while (parsed[j]!.at === null) j++
        const from = parsed[i - 1]!.at!, to = parsed[j]!.at!
        for (let n = i; n < j; n++) parsed[n]!.at = from + ((to - from) * (n - i + 1)) / (j - i + 1)
    }
    // Sorted as Magerie's flattenGradientStops sorts, which keeps equal positions in order.
    return parsed
        .map((s, i) => ({ s, i }))
        .sort((a, b) => a.s.at! - b.s.at! || a.i - b.i)
        .map(({ s }) => ({ at: s.at!, color: [s.color[0], s.color[1], s.color[2]] as [number, number, number], alpha: s.color[3] }))
}

export const SPECS = {
    noise: {
        images: 0,
        kind: "type",
        positional: ["seed"],
        defaults: {
            type: "simplex", scale: 8, scaleY: null, scaleLock: true, voronoiMode: "f1", fractal: "standard",
            warp: 0, tile: null, seed: 0, offsetX: 0, offsetY: 0, octaves: 4, persistence: 0.5, lacunarity: 2,
            aspect: "square", bitDepth: null, ...SIZE,
        },
        make(p, _images, canvas) {
            const [w, h] = sizeOf(p, canvas)
            const float = bitDepthOf(p, canvas, "noise")
            const type = oneOf(p.type, NOISE_TYPES, "noise type")
            const tile = (p.tile ?? canvas.tile) === true
            const scale = num(p.scale, "noise scale", 0.1)
            // ExecutorRegistry.cpp:413-437: a lock keeps Y at X, squared to the picture.
            let scaleY = p.scaleY === null ? scale : num(p.scaleY, "noise scaleY", 0.1)
            if (p.scaleLock === true) scaleY = oneOf(p.aspect, ["square", "stretch"], "noise aspect") === "square" ? scale * (h / w) : scale
            const octaves = Math.trunc(num(p.octaves, "noise octaves", 1, 8))
            const lacunarity = num(p.lacunarity, "noise lacunarity")
            const warp = num(p.warp, "noise warp")
            const params = {
                shape: {
                    type, tile, warp: warp > 0,
                    voronoiMode: oneOf(p.voronoiMode, VORONOI_MODES, "noise voronoiMode"),
                    fractal: oneOf(p.fractal, FRACTALS, "noise fractal"),
                    single: octaves <= 1 || type === "white",
                },
                values: {
                    scale: [scale, scaleY], offset: [num(p.offsetX, "noise offsetX"), num(p.offsetY, "noise offsetY")],
                    seed: Math.trunc(num(p.seed, "noise seed")), octaves,
                    persistence: num(p.persistence, "noise persistence"),
                    lacunarity: lacunarity > 1 ? lacunarity : 2, warp: warp > 0 ? warp : 0,
                },
            }
            // Noise is never dithered (#574), so 32 bits only changes how it is held.
            return makeNode("noise", "generator", [], float ? { ...params, float } : params, w, h, tile)
        },
    },
    invert: {
        images: 1,
        kind: "channels",
        positional: [],
        defaults: { channels: "rgb" },
        make(p, [a]) { return pointwise("invert", { channels: oneOf(p.channels, CHANNELS, "invert channels") }, [a!]) },
    },
    levels: {
        images: 1,
        positional: ["gamma"],
        defaults: { gamma: 1, inputBlack: 0, inputWhite: 1, outputBlack: 0, outputWhite: 1 },
        make(p, [a]) {
            return pointwise("levels", {
                gamma: num(p.gamma, "levels gamma", 0.1, 10),
                inputBlack: num(p.inputBlack, "levels inputBlack", 0, 1), inputWhite: num(p.inputWhite, "levels inputWhite", 0, 1),
                outputBlack: num(p.outputBlack, "levels outputBlack", 0, 1), outputWhite: num(p.outputWhite, "levels outputWhite", 0, 1),
            }, [a!])
        },
    },
    gradientMap: {
        images: 1,
        positional: ["colors"],
        defaults: { colors: ["#000000", "#ffffff"], alphaFromInput: "off" },
        make(p, [a]) {
            if (p.alphaFromInput !== "off") throw new Error("[oj] tex gradientMap: alphaFromInput is not in this runtime yet; only \"off\"")
            return pointwise("gradientMap", { stops: parseStops(p.colors) }, [a!])
        },
    },
    curves: {
        images: 1,
        kind: "preset",
        positional: ["points"],
        defaults: { preset: null, points: null, channel: "rgb" },
        make(p, [a]) {
            // Points alone are a custom curve. A named preset uses its own
            // points whatever else is given, as Magerie's exports carry both.
            const preset = p.preset === null ? (p.points === null ? "linear" : "custom") : oneOf(p.preset as string, [...Object.keys(CURVES_PRESETS), "custom"], "curves preset")
            const points = preset === "custom" ? tonePoints(p.points) : CURVES_PRESETS[preset]!
            const rgba = Array.from(k.toneTable(points), (v) => [v, v, v, 255]).flat()
            const lut = table(rgba, 256, 1)
            return makeNode("curves", "pointwise", [a!, lut], { channel: oneOf(p.channel, CURVES_CHANNELS, "curves channel") }, a!.width, a!.height, a!.tiles)
        },
    },
    gradient: {
        images: 0,
        kind: "type",
        positional: ["colors"],
        defaults: { type: "linear", colors: ["#000000", "#ffffff"], angle: 0, centerX: 0.5, centerY: 0.5, bitDepth: null, ...SIZE },
        make(p, _images, canvas) {
            const [w, h] = sizeOf(p, canvas)
            const float = bitDepthOf(p, canvas, "gradient")
            // Never tiles, as Magerie's never says it does. At 32 bits it is not
            // dithered: the dither is for an 8-bit store (MetalRenderer+Gradient.mm:272).
            return makeNode("gradient", "generator", [], {
                type: oneOf(p.type, GRADIENT_TYPES, "gradient type"), stops: parseStops(p.colors, "gradient", 16),
                angle: num(p.angle, "gradient angle"), center: [num(p.centerX, "gradient centerX"), num(p.centerY, "gradient centerY")],
                ...(float ? { float } : {}),
            }, w, h, false)
        },
    },
    solidColor: {
        images: 0,
        kind: "color",
        positional: [],
        defaults: { color: "#808080", ...SIZE },
        make(p, _images, canvas) {
            const [w, h] = sizeOf(p, canvas)
            const [r, g, b, a] = hexRGBA(String(p.color), "solidColor")
            // Two equal stops: flat, so never dithered, and it tiles.
            return makeNode("gradient", "generator", [], {
                type: "linear", stops: [0, 1].map((at) => ({ at, color: [r, g, b], alpha: a })), angle: 0, center: [0.5, 0.5],
            }, w, h, true)
        },
    },
    hslAdjust: {
        images: 1,
        positional: ["hue", "saturation", "lightness"],
        defaults: { hue: 0, saturation: 0, lightness: 0, targetHue: 0, targetRange: 180, targetFalloff: 0.5 },
        make(p, [a]) {
            return pointwise("hslAdjust", {
                hue: num(p.hue, "hslAdjust hue", -180, 180), saturation: num(p.saturation, "hslAdjust saturation", -1, 1),
                lightness: num(p.lightness, "hslAdjust lightness", -1, 1), targetHue: num(p.targetHue, "hslAdjust targetHue", 0, 360),
                targetRange: num(p.targetRange, "hslAdjust targetRange", 0, 180), targetFalloff: num(p.targetFalloff, "hslAdjust targetFalloff", 0, 1),
            }, [a!])
        },
    },
    mask: {
        images: 2,
        positional: [],
        defaults: { invert: false },
        make(p, [a, m]) { return mixed("mask", { invert: p.invert === true }, [a!, m!]) },
    },
    channelMath: {
        images: 2,
        kind: "operation",
        positional: [],
        defaults: { operation: "add", channels: "rgb" },
        make(p, [a, b]) {
            return mixed("channelMath", { operation: oneOf(p.operation, CHANNEL_MATH_OPS, "channelMath operation"), channels: oneOf(p.channels, CHANNEL_MATH_CHANNELS, "channelMath channels") }, [a!, b!])
        },
    },
    alphaMerge: {
        images: 2,
        kind: "alphaChannel",
        positional: [],
        defaults: { alphaChannel: "luma" },
        make(p, [rgb, alpha]) {
            // Always the RGB's size, and stored at 16 bits: Magerie writes RGBA16F here.
            const tiles = [rgb!, alpha!].filter((i) => i.width > 1 || i.height > 1).every((i) => i.tiles)
            return makeNode("alphaMerge", "pointwise", [rgb!, alpha!], { alphaChannel: oneOf(p.alphaChannel, ALPHA_CHANNELS, "alphaMerge alphaChannel"), half: true }, rgb!.width, rgb!.height, tiles)
        },
    },
    autoLevels: {
        images: 1,
        kind: "mode",
        positional: [],
        defaults: { mode: "luminance" },
        make(p, [a]) {
            const mode = oneOf(p.mode, AUTO_LEVELS_MODES, "autoLevels mode")
            const ranges = mode === "luminance" ? [rangeOf(a!, "luma")] : [rangeOf(a!, "low"), rangeOf(a!, "high")]
            return makeNode("autoLevels", "pointwise", [a!, ...ranges], { mode }, a!.width, a!.height, a!.tiles)
        },
    },
    directionalWarp: {
        images: 2,
        positional: ["angle", "intensity"],
        defaults: { angle: 0, intensity: 20, bothWays: false, edges: "auto" },
        make(p, [src, map]) {
            const wrap = wraps(p.edges, src!, "directionalWarp")
            return area("directionalWarp", {
                angle: num(p.angle, "directionalWarp angle"), intensity: num(p.intensity, "directionalWarp intensity"),
                bothWays: p.bothWays === true, wrap,
            }, [src!, map!], wrap && src!.tiles)
        },
    },
    materialLight: {
        images: 0,
        material: true,
        positional: ["lightAngle"],
        defaults: { lightAngle: 135, lightElevation: 45, lightStrength: 1, ambient: 0.15 },
        make(p, _images, _canvas, m) {
            const inputs: Node[] = [m!.albedo]
            const slot = (c: Node | number | null): number | null => {
                if (c === null || typeof c === "number") return null
                inputs.push(c)
                return inputs.length - 1
            }
            const slots = { normal: slot(m!.normal), roughness: slot(m!.roughness), metallic: slot(m!.metallic), ao: slot(m!.ao), emissive: slot(m!.emissive), opacity: slot(m!.opacity) }
            const scalars = { roughness: m!.roughness, metallic: m!.metallic, ao: m!.ao, opacity: m!.opacity }
            const light = {
                angle: num(p.lightAngle, "materialLight lightAngle"), elevation: num(p.lightElevation, "materialLight lightElevation", 0, 90),
                strength: num(p.lightStrength, "materialLight lightStrength", 0), ambient: num(p.ambient, "materialLight ambient", 0, 1),
            }
            const numbers = Object.fromEntries(Object.entries(scalars).filter(([, v]) => typeof v === "number"))
            // A material tiles when every map in it does (materialTiles), and its reads wrap then.
            return area("materialLight", { slots, numbers, light }, inputs, inputs.every((i) => i.tiles))
        },
    },
    blend: {
        images: 2,
        kind: "mode",
        positional: ["opacity"],
        defaults: { mode: "normal", opacity: 1 },
        make(p, [a, b]) {
            return pointwise("blend", { mode: oneOf(p.mode, BLEND_MODES, "blend mode"), opacity: num(p.opacity, "blend opacity", 0, 1) }, [a!, b!])
        },
    },
    blur: {
        images: 1,
        positional: ["radius"],
        defaults: { radius: 5, quality: "medium", edges: "auto" },
        make(p, [a]) {
            const wrap = wraps(p.edges, a!, "blur")
            return gaussian(a!, k.blurGaussian(num(p.radius, "blur radius", 0, 1000)), wrap)
        },
    },
    normalMap: {
        images: 1,
        positional: ["strength"],
        defaults: { strength: 1, flipY: false, smoothRadius: 4, edges: "auto" },
        make(p, [a]) {
            const wrap = wraps(p.edges, a!, "normalMap")
            const radius = num(p.smoothRadius, "normalMap smoothRadius", 0, 10)
            // Its own Gaussian, not Blur's (spec 4.2), and none under a radius of 1.
            const height = radius < 1 ? a! : gaussian(a!, k.smoothGaussian(radius), wrap)
            return area("normalMap", { strength: num(p.strength, "normalMap strength", 0.1), flipY: p.flipY === true, wrap }, [height], wrap && a!.tiles)
        },
    },
    slopeBlur: {
        images: 2,
        kind: "mode",
        positional: ["intensity"],
        defaults: { intensity: 20, samples: 16, mode: "blur", edges: "auto" },
        make(p, [src, slope]) {
            const wrap = wraps(p.edges, src!, "slopeBlur")
            return area("slopeBlur", {
                intensity: num(p.intensity, "slopeBlur intensity", 0), samples: Math.min(Math.max(Math.round(num(p.samples, "slopeBlur samples")), 1), 64),
                mode: oneOf(p.mode, SLOPE_MODES, "slopeBlur mode"), wrap,
            }, [src!, slope!], wrap && src!.tiles)
        },
    },
    histogramScan: {
        images: 1,
        positional: ["position", "contrast"],
        defaults: { position: 0.5, contrast: 1 },
        make(p, [a]) {
            return pointwise("histogramScan", { position: num(p.position, "histogramScan position", 0, 1), contrast: num(p.contrast, "histogramScan contrast", 0, 1) }, [a!])
        },
    },
    curvature: {
        images: 1,
        kind: "mode",
        positional: ["intensity"],
        defaults: { intensity: 1, mode: "both", edges: "auto" },
        make(p, [a]) {
            const wrap = wraps(p.edges, a!, "curvature")
            return area("curvature", { intensity: num(p.intensity, "curvature intensity"), mode: oneOf(p.mode, CURVATURE_MODES, "curvature mode"), wrap }, [a!], wrap && a!.tiles)
        },
    },
    ambientOcclusion: {
        images: 1,
        positional: ["radius"],
        defaults: { radius: 16, intensity: 1, samples: 16, edges: "auto" },
        make(p, [a]) {
            const wrap = wraps(p.edges, a!, "ambientOcclusion")
            return area("ambientOcclusion", {
                radius: num(p.radius, "ambientOcclusion radius", 1, 64), intensity: num(p.intensity, "ambientOcclusion intensity"),
                samples: Math.min(Math.max(Math.trunc(num(p.samples, "ambientOcclusion samples")), 1), 64), wrap,
            }, [a!], wrap && a!.tiles)
        },
    },
    warp: {
        images: 2,
        positional: ["strength"],
        defaults: { strength: 10, edges: "auto" },
        make(p, [src, displacement]) {
            const wrap = wraps(p.edges, src!, "warp")
            return area("warp", { strength: num(p.strength, "warp strength", 0), wrap }, [src!, displacement!], wrap && src!.tiles && displacement!.tiles)
        },
    },
    tile: {
        images: 1,
        positional: ["repeatX"],
        defaults: { repeatX: 2, repeatY: 2, offsetX: 0, offsetY: 0, mirror: false },
        make(p, [a]) {
            const v = {
                repeatX: Math.trunc(num(p.repeatX, "tile repeatX", 1, 16)), repeatY: Math.trunc(num(p.repeatY, "tile repeatY", 1, 16)),
                offsetX: num(p.offsetX, "tile offsetX", -1, 1), offsetY: num(p.offsetY, "tile offsetY", -1, 1), mirror: p.mirror === true,
            }
            // Tiles unless a mirror with an odd count meets an input that does not (spec 7.1).
            const tiles = !(v.mirror && (v.repeatX % 2 === 1 || v.repeatY % 2 === 1) && !a!.tiles)
            return area("tile", v, [a!], tiles)
        },
    },
    alpha: {
        images: 2,
        positional: [],
        defaults: {},
        make(_p, [color, height]) { return pointwise("alpha", {}, [color!, height!]) },
    },
    sdfShape: {
        images: 0,
        kind: "shape",
        positional: ["size"],
        defaults: { ...SHAPE_DEFAULTS, bitDepth: null, ...SIZE },
        make(p, _images, canvas) {
            const [w, h] = sizeOf(p, canvas)
            const float = bitDepthOf(p, canvas, "sdfShape")
            const shape = p.shape as k.ShapeType
            if (!SHAPES.includes(shape)) throw new Error(`[oj] tex sdfShape: shape is ${JSON.stringify(p.shape)}; tex draws ${SHAPES.join(", ")} so far`)
            const size = num(p.size, "sdfShape size", 0.01, 2)
            const rotation = num(p.rotation, "sdfShape rotation") * Math.PI / 180
            const background = hexRGBA(String(p.backgroundColor), "sdfShape backgroundColor")
            if (p.transparentBackground === true) background[3] = 0
            // packShapeParams: every dimension scaled by size.
            const [a, b] = shape === "circle" ? [size / 2, 0]
                : shape === "ellipse" ? [num(p.shapeWidth, "sdfShape shapeWidth", 0.1, 1) * size / 2, num(p.shapeHeight, "sdfShape shapeHeight", 0.1, 1) * size / 2]
                : [num(p.vesicaWidth, "sdfShape vesicaWidth", 0.1, 2) * size, num(p.vesicaHeight, "sdfShape vesicaHeight", 0.1, 2) * size]
            const v: k.ShapeValues = {
                shape, a, b, cos: Math.cos(rotation), sin: Math.sin(rotation),
                offset: [num(p.offsetX, "sdfShape offsetX", -1, 1), num(p.offsetY, "sdfShape offsetY", -1, 1)],
                edgeBand: num(p.edgeBand, "sdfShape edgeBand", 0, 0.1),
                fill: hexRGBA(String(p.fillColor), "sdfShape fillColor"), edge: hexRGBA(String(p.edgeColor), "sdfShape edgeColor"), background,
            }
            return makeNode("sdfShape", "generator", [], (float ? { ...v, float } : v) as unknown as Record<string, unknown>, w, h, false)
        },
    },
    tileGrid: {
        images: 0,
        positional: ["columns"],
        defaults: {
            columns: 4, rows: 8, rowOffset: 0.5, offsetJitter: 0, lengthJitter: 0, sizeJitter: 0,
            jointWidth: 0.06, bevel: 0.08, round: 0, heightJitter: 0, seed: 0, bitDepth: null, ...SIZE,
        },
        make(p, _images, canvas) {
            const [w, h] = sizeOf(p, canvas)
            const float = bitDepthOf(p, canvas, "tileGrid")
            // Magerie's resolveTileGridParams: counts whole, the shares clamped.
            const share = (key: string, most = 1) => num(p[key], `tileGrid ${key}`, 0, most)
            const values: k.TileGridValues = {
                columns: Math.max(1, Math.round(num(p.columns, "tileGrid columns"))),
                rows: Math.max(1, Math.round(num(p.rows, "tileGrid rows"))),
                rowOffset: share("rowOffset"), offsetJitter: share("offsetJitter"), lengthJitter: share("lengthJitter"),
                sizeJitter: share("sizeJitter"), jointWidth: share("jointWidth", 0.5), bevel: share("bevel", 0.5),
                round: share("round"), heightJitter: share("heightJitter"),
                seed: Math.max(0, Math.round(num(p.seed, "tileGrid seed"))),
            }
            // Every output tiles, whatever the canvas says: the grid repeats by construction.
            return Object.fromEntries(Object.entries(TILE_GRID_OUTPUTS).map(([port, output]) =>
                [port, makeNode("tileGrid", "generator", [], float ? { values, output, float } : { values, output }, w, h, true)]))
        },
    },
    pixelate: {
        images: 1,
        positional: ["blockSize"],
        defaults: { blockSize: 8 },
        // Magerie's output does not say it tiles: a block can straddle the wrap.
        make(p, [a]) { return area("pixelate", { blockSize: num(p.blockSize, "pixelate blockSize", 1, 4096) }, [a!], false) },
    },
    channelShuffle: {
        images: 1,
        kind: "swizzle",
        positional: [],
        defaults: { swizzle: null, outR: "r", outG: "g", outB: "b", outA: "a" },
        make(p, [a]) {
            let out = [p.outR, p.outG, p.outB, p.outA]
            if (p.swizzle !== null) {
                // "aaa1": each output channel's source, in order.
                if (typeof p.swizzle !== "string" || !/^[rgba01]{4}$/.test(p.swizzle)) throw new Error(`[oj] tex channelShuffle: ${JSON.stringify(p.swizzle)} is four of r, g, b, a, 0 and 1, as "aaa1"`)
                out = [...p.swizzle]
            }
            for (const c of out) if (!CHANNEL_SOURCES.includes(c as k.ChannelSource)) throw new Error(`[oj] tex channelShuffle: ${JSON.stringify(c)} is r, g, b, a, "0" or "1"`)
            return pointwise("channelShuffle", { out }, [a!])
        },
    },
    threshold: {
        images: 1,
        positional: ["threshold"],
        defaults: { threshold: 0.5, smooth: false, smoothness: 0.02 },
        make(p, [a]) {
            // Magerie keeps a half-float input half (MageriePreserveFloatFormat).
            return pointwise("threshold", {
                threshold: num(p.threshold, "threshold", 0, 1),
                smoothness: p.smooth === true ? num(p.smoothness, "threshold smoothness", 0, 0.5) : 0,
                half: a!.params.half === true,
            }, [a!])
        },
    },
    distance: {
        images: 1,
        kind: "mode",
        positional: ["maxDistance"],
        defaults: { mode: "inside", maxDistance: 30, threshold: 0.5, edges: "auto" },
        make(p, [a]) {
            const wrap = wraps(p.edges, a!, "distance")
            if (p.mode !== "inside" && p.mode !== "outside") throw new Error(`[oj] tex distance: mode is ${JSON.stringify(p.mode)}, and is "inside" or "outside"`)
            if (Math.max(a!.width, a!.height) > 2048) throw new Error(`[oj] tex distance: ${a!.width} by ${a!.height} is past 2048, the most a seed's whole pixels hold exactly`)
            // A jump flood (_jfaDistance.ts): seeds, steps from half the size down to 1, one more 1, then the distance.
            let n = area("distanceSeed", { threshold: num(p.threshold, "distance threshold", 0, 1), inside: p.mode === "inside", wrap, half: true }, [a!], wrap)
            let top = 1
            while (top < Math.max(a!.width, a!.height)) top *= 2
            const steps: number[] = []
            for (let s = Math.max(1, top / 2); s >= 1; s = s >> 1) steps.push(s)
            for (const step of [...steps, 1]) n = area("distanceStep", { step, wrap, half: true }, [n], wrap)
            // Magerie writes it in half floats, so a lit chain does not band.
            return area("distanceRemap", { maxDistance: Math.max(1, num(p.maxDistance, "distance maxDistance", 1, 256)), wrap, half: true }, [n], wrap)
        },
    },
    composite: {
        images: 1,
        optionalImages: 3,
        positional: [],
        defaults: {},
        make(_p, layers) {
            // One layer is a copy; more go over it in order, at the first size that is not 1 by 1 (fitInputs).
            const sized = layers.find((l) => l.width * l.height > 1) ?? layers[0]!
            const half = layers[0]!.params.half === true
            let out = layers[0]!
            for (const layer of layers.slice(1)) {
                out = makeNode("over", "pointwise", [out, layer], { half }, sized.width, sized.height, out.tiles && layer.tiles)
            }
            return out
        },
    },
} satisfies Record<string, Spec>

/** What each op draws. Blur is two ops, one an axis. */
export const KERNELS: Record<string, Kernel> = {
    noise: (s, n) => k.noise(s, n.params.shape as k.NoiseShape, n.params.values as k.NoiseValues),
    invert: (_s, n, i) => k.invert(i.value(0), n.params.channels as InvertChannels),
    levels: (s, n, i) => k.levels(s, i.value(0), n.params as unknown as k.LevelsValues),
    gradientMap: (s, n, i) => k.gradientMap(s, i.value(0), n.params.stops as Stop[]),
    curves: (_s, n, i) => k.curves(i.value(0), i.texture(1, false), n.params.channel as k.CurvesChannel),
    gradient: (s, n) => k.gradient(s, n.params.type as k.GradientType, n.params.stops as Stop[], n.params.angle as number, n.params.center as [number, number], isFloat(n)),
    hslAdjust: (s, n, i) => k.hslAdjust(s, i.value(0), n.params as unknown as k.HslValues),
    mask: (_s, n, i) => k.mask(i.value(0), i.value(1), n.params.invert as boolean),
    channelMath: (_s, n, i) => k.channelMath(i.value(0), i.value(1), n.params.operation as k.ChannelMathOp, n.params.channels as k.ChannelMathChannels),
    alphaMerge: (_s, n, i) => k.alphaMerge(i.value(0), i.value(1), n.params.alphaChannel as k.AlphaChannel),
    autoLevels: (_s, n, i) => k.autoLevels(i.value(0), i.texture(1, false), n.params.mode === "perChannel" ? i.texture(2, false) : null, n.params.mode as k.AutoLevelsMode),
    rangeStep: (s, n, i) => k.rangeStep(s, i.texture(0, false), n.params.key as k.RangeKey | null),
    directionalWarp: (s, n, i) => k.directionalWarp(s, i.texture(0, wrapOf(n)), i.texture(1, wrapOf(n)), n.params.angle as number, n.params.intensity as number, n.params.bothWays as boolean),
    materialLight: (s, n, i) => {
        const slots = n.params.slots as Record<string, number | null>
        const numbers = n.params.numbers as Record<string, number>
        const read = (key: string): k.Channel => (slots[key] === null ? numbers[key]! : i.texture(slots[key]!, n.tiles))
        const map = (key: string) => (slots[key] === null ? null : i.texture(slots[key]!, n.tiles))
        return k.materialLight(s, i.texture(0, n.tiles), map("normal"),
            { roughness: read("roughness"), metallic: read("metallic"), ao: read("ao"), emissive: map("emissive"), opacity: read("opacity") },
            n.params.light as k.LightValues)
    },
    blend: (s, n, i) => k.blend(s, i.value(0), i.value(1), n.params.mode as BlendMode, n.params.opacity as number),
    blurX: (s, n, i) => gaussianAxis(s, n, i, "x"),
    blurY: (s, n, i) => gaussianAxis(s, n, i, "y"),
    normalMap: (s, n, i) => k.normalMap(s, i.texture(0, wrapOf(n)), n.params.strength as number, n.params.flipY as boolean, wrapOf(n)),
    slopeBlur: (s, n, i) => k.slopeBlur(s, i.texture(0, wrapOf(n)), i.texture(1, wrapOf(n)), n.params.intensity as number, n.params.samples as number, n.params.mode as k.SlopeBlurMode),
    histogramScan: (s, n, i) => k.histogramScan(s, i.value(0), n.params.position as number, n.params.contrast as number),
    curvature: (s, n, i) => k.curvature(s, i.texture(0, wrapOf(n)), n.params.intensity as number, n.params.mode as k.CurvatureMode, wrapOf(n)),
    ambientOcclusion: (s, n, i) => k.ambientOcclusion(s, i.texture(0, wrapOf(n)), n.params.radius as number, n.params.intensity as number, n.params.samples as number),
    warp: (s, n, i) => k.warp(s, i.texture(0, n.params.wrap as boolean), i.texture(1, n.params.wrap as boolean), n.params.strength as number),
    tile: (s, n, i) => k.tile(s, i.texture(0, false), n.params as unknown as k.TileValues),
    alpha: (_s, _n, i) => k.alphaPack(i.value(0), i.value(1)),
    sdfShape: (s, n) => k.sdfShape(s, n.params as unknown as k.ShapeValues),
    pixelate: (s, n, i) => k.pixelate(s, i.texture(0, false), n.params.blockSize as number),
    tileGrid: (s, n) => k.tileGrid(s, n.params.values as k.TileGridValues, n.params.output as k.TileGridOutput),
    channelShuffle: (_s, n, i) => k.channelShuffle(i.value(0), n.params.out as k.ChannelSource[]),
    threshold: (s, n, i) => k.threshold(s, i.value(0), n.params.threshold as number, n.params.smoothness as number),
    over: (_s, _n, i) => k.over(i.value(0), i.value(1)),
    distanceSeed: (s, n, i) => k.distanceSeed(s, i.texture(0, wrapOf(n)), n.params.threshold as number, n.params.inside as boolean, wrapOf(n)),
    distanceStep: (s, n, i) => k.distanceStep(s, i.texture(0, wrapOf(n)), n.params.step as number, wrapOf(n)),
    distanceRemap: (s, n, i) => k.distanceRemap(s, i.texture(0, wrapOf(n)), n.params.maxDistance as number, wrapOf(n)),
}

export type SpecName = keyof typeof SPECS

/** Splits a call's arguments into its images and its resolved parameters. */
export function resolve(name: SpecName, args: readonly unknown[], isImage: (v: unknown) => v is { node: Node }): { images: Node[], params: Record<string, unknown>, material?: Material } {
    const spec: Spec = SPECS[name]
    const images: Node[] = []
    for (let i = 0; i < spec.images; i++) {
        const a = args[i]
        if (!isImage(a)) throw new Error(`[oj] tex ${name}: argument ${i + 1} is ${a === undefined ? "missing" : typeof a}, and is an image from tex`)
        images.push(a.node)
    }
    let taken = spec.images
    while (taken < spec.images + (spec.optionalImages ?? 0) && isImage(args[taken])) images.push((args[taken++] as { node: Node }).node)
    const params: Record<string, unknown> = { ...spec.defaults }
    let rest = args.slice(taken)
    let material: Material | undefined
    if (spec.material === true) {
        if (!isMaterial(rest[0])) throw new Error(`[oj] tex ${name}: argument 1 is ${rest[0] === undefined ? "missing" : typeof rest[0]}, and is a material from tex.material({ albedo, ... })`)
        material = rest[0]
        rest = rest.slice(1)
    }
    if (spec.kind !== undefined && typeof rest[0] === "string") {
        params[spec.kind] = rest[0]
        rest = rest.slice(1)
    }
    let options: Record<string, unknown> | undefined
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i]
        const isOptions = a !== null && typeof a === "object" && !Array.isArray(a) && !isImage(a)
        if (isOptions) {
            if (i !== rest.length - 1) throw new Error(`[oj] tex ${name}: the options object comes last`)
            options = a as Record<string, unknown>
            break
        }
        const key = spec.positional[i]
        if (key === undefined) {
            const takes = [...(spec.kind === undefined ? [] : [`a ${spec.kind} string`]), ...spec.positional]
            throw new Error(`[oj] tex ${name}: takes ${takes.length === 0 ? "nothing" : takes.join(", then ")} after its ${spec.optionalImages ? `${spec.images} to ${spec.images + spec.optionalImages} images` : `image${spec.images === 1 ? "" : "s"}`}, then options; argument ${args.length - rest.length + i + 1} is ${typeof a === "string" ? `the string ${JSON.stringify(a)}` : "extra"}`)
        }
        if (a !== undefined) params[key] = a
    }
    for (const [key, value] of Object.entries(options ?? {})) {
        if (!(key in spec.defaults)) throw new Error(`[oj] tex ${name}: no option "${key}"; it has ${Object.keys(spec.defaults).join(", ") || "none"}`)
        if (value !== undefined) params[key] = value
    }
    return { images, params, material }
}

export type { Edges }
