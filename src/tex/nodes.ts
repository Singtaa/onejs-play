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
import { makeNode, type Edges, type Node, type NodeKind } from "./graph"
import type { Kernel } from "./engine"
import * as k from "./kernels"
import type { BlendMode, Fractal, InvertChannels, NoiseType, Stop, VoronoiMode } from "./kernels"

/** Where generators take their size and tiling from when a call does not say. */
export interface Canvas {
    readonly width: number
    readonly height: number
    readonly tile: boolean
}

export interface Spec {
    /** Leading image arguments. */
    readonly images: number
    /** The parameters a call may give in order after the images. */
    readonly positional: readonly string[]
    /** Every option and its default. A key missing here is refused. */
    readonly defaults: Readonly<Record<string, unknown>>
    /** The node (or nodes) a call makes, from its resolved parameters. */
    make(p: Record<string, unknown>, images: readonly Node[], canvas: Canvas): Node
}

const SIZE = { width: null, height: null }

function sizeOf(p: Record<string, unknown>, canvas: Canvas): [number, number] {
    const w = p.width ?? canvas.width, h = p.height ?? canvas.height
    for (const [what, v] of [["width", w], ["height", h]] as const) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 8192) throw new Error(`[oj] tex: ${what} is ${String(v)}, a whole number of pixels from 1 to 8192`)
    }
    return [w as number, h as number]
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

/** A colour as `#rgb` or `#rrggbb`, to gamma 0..1. */
function hex(text: string, what: string): [number, number, number] {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
    if (m === null) throw new Error(`[oj] tex ${what}: ${JSON.stringify(text)} is not a colour; write it as #rrggbb`)
    const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}

/**
 * Gradient stops: CSS strings, `"#2f6e26 35%"`, where a stop without a
 * position takes one spaced evenly between its neighbours as CSS does; or
 * Magerie's `{ position, color }`.
 */
export function parseStops(stops: unknown, what = "gradientMap"): Stop[] {
    if (!Array.isArray(stops) || stops.length < 1 || stops.length > 32) {
        throw new Error(`[oj] tex ${what}: colors are 1 to 32 stops, "#rrggbb" or "#rrggbb 40%"`)
    }
    const parsed = stops.map((s, i): { at: number | null, color: [number, number, number] } => {
        if (typeof s === "string") {
            const [c, pos, extra] = s.trim().split(/\s+/)
            if (extra !== undefined || c === undefined) throw new Error(`[oj] tex ${what}: stop ${i} is ${JSON.stringify(s)}; a stop is a colour and an optional position, "#2f6e26 35%"`)
            if (pos === undefined) return { at: null, color: hex(c, what) }
            const m = /^(-?[0-9.]+)%$/.exec(pos)
            if (m === null) throw new Error(`[oj] tex ${what}: stop ${i}'s position is ${JSON.stringify(pos)}, a percentage such as 35%`)
            return { at: Number(m[1]) / 100, color: hex(c, what) }
        }
        if (s !== null && typeof s === "object" && typeof s.color === "string") {
            return { at: num(s.position, `${what} stop ${i} position`, 0, 1), color: hex(s.color, what) }
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
        .map(({ s }) => ({ at: s.at!, color: s.color }))
}

export const SPECS = {
    noise: {
        images: 0,
        positional: ["type", "seed"],
        defaults: {
            type: "simplex", scale: 8, scaleY: null, scaleLock: true, voronoiMode: "f1", fractal: "standard",
            warp: 0, tile: null, seed: 0, offsetX: 0, offsetY: 0, octaves: 4, persistence: 0.5, lacunarity: 2,
            aspect: "square", ...SIZE,
        },
        make(p, _images, canvas) {
            const [w, h] = sizeOf(p, canvas)
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
            return makeNode("noise", "generator", [], params, w, h, tile)
        },
    },
    invert: {
        images: 1,
        positional: ["channels"],
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
    blend: {
        images: 2,
        positional: ["mode", "opacity"],
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
        positional: ["mode", "intensity"],
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
} satisfies Record<string, Spec>

/** What each op draws. Blur is two ops, one an axis. */
export const KERNELS: Record<string, Kernel> = {
    noise: (s, n) => k.noise(s, n.params.shape as k.NoiseShape, n.params.values as k.NoiseValues),
    invert: (_s, n, i) => k.invert(i.value(0), n.params.channels as InvertChannels),
    levels: (s, n, i) => k.levels(s, i.value(0), n.params as unknown as k.LevelsValues),
    gradientMap: (s, n, i) => k.gradientMap(s, i.value(0), n.params.stops as Stop[]),
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
}

export type SpecName = keyof typeof SPECS

/** Splits a call's arguments into its images and its resolved parameters. */
export function resolve(name: SpecName, args: readonly unknown[], isImage: (v: unknown) => v is { node: Node }): { images: Node[], params: Record<string, unknown> } {
    const spec: Spec = SPECS[name]
    const images: Node[] = []
    for (let i = 0; i < spec.images; i++) {
        const a = args[i]
        if (!isImage(a)) throw new Error(`[oj] tex ${name}: argument ${i + 1} is ${a === undefined ? "missing" : typeof a}, and is an image from tex`)
        images.push(a.node)
    }
    const params: Record<string, unknown> = { ...spec.defaults }
    const rest = args.slice(spec.images)
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
        if (key === undefined) throw new Error(`[oj] tex ${name}: takes ${spec.positional.length === 0 ? "no" : spec.positional.join(", then ")} after its image${spec.images === 1 ? "" : "s"}, then options; argument ${spec.images + i + 1} is extra`)
        if (a !== undefined) params[key] = a
    }
    for (const [key, value] of Object.entries(options ?? {})) {
        if (!(key in spec.defaults)) throw new Error(`[oj] tex ${name}: no option "${key}"; it has ${Object.keys(spec.defaults).join(", ") || "none"}`)
        if (value !== undefined) params[key] = value
    }
    return { images, params }
}

export type { Edges }
