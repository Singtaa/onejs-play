/**
 * `tex`: Magerie's texture nodes as code.
 *
 *     import { tex } from "oj"
 *
 *     const { noise } = tex.canvas(512, { tile: true })
 *     const height = noise("perlin", 23, { scale: 56, octaves: 2 }).warp(noise("perlin", 11), 18).blur(1)
 *     const grass = height.gradientMap(["#1a3d24", "#62a832 70%", "#c9e267"]).alpha(height)
 *     scene.mesh({ ...ground, splat: { layers: [grass.texture(), rock], weights } })
 *
 * A chain is a description. `.texture()` plans it into as few passes as it
 * can, draws them on the GPU, and hands back one texture; asking again for
 * the same graph hands back the same texture.
 */
import type { Texture } from "onejs-react"
import { makeNode, type Node } from "./graph"
import { draw, plan } from "./engine"
import { uploadRGBA } from "./upload"
import { KERNELS, SPECS, resolve, type Canvas, type SpecName } from "./nodes"
import type { BlendMode, CurvatureMode, CurvesChannel, Fractal, InvertChannels, NoiseType, SlopeBlurMode, VoronoiMode } from "./kernels"

declare const CS: any

export type { BlendMode, CurvatureMode, CurvesChannel, Fractal, InvertChannels, NoiseType, SlopeBlurMode, VoronoiMode }
export type Edges = "auto" | "wrap" | "clamp"

export interface SizeOptions {
    /** Pixels across. Default: the canvas's. */
    width?: number
    /** Pixels down. Default: the canvas's. */
    height?: number
}

export interface NoiseOptions extends SizeOptions {
    type?: NoiseType
    scale?: number
    scaleY?: number
    scaleLock?: boolean
    voronoiMode?: VoronoiMode
    fractal?: Fractal
    warp?: number
    /** Repeats seamlessly. Default: the canvas's `tile`. */
    tile?: boolean
    seed?: number
    offsetX?: number
    offsetY?: number
    octaves?: number
    persistence?: number
    lacunarity?: number
    aspect?: "square" | "stretch"
}

export interface EdgesOptions {
    /** How a neighbour past the edge is read. `"auto"` wraps an input that tiles. */
    edges?: Edges
}

export interface LevelsOptions {
    gamma?: number
    inputBlack?: number
    inputWhite?: number
    outputBlack?: number
    outputWhite?: number
}

/** A stop: `"#2f6e26"`, `"#2f6e26 35%"`, or Magerie's `{ position, color }`. */
export type GradientStop = string | { position: number, color: string }

export interface GradientMapOptions {
    colors?: readonly GradientStop[]
    alphaFromInput?: "off"
}

/** Magerie's Curves presets; `"custom"` takes `points`. */
export type CurvesPreset = "linear" | "increase-contrast" | "decrease-contrast" | "brighten" | "darken" | "s-curve" | "inverse" | "custom"

/** A tone curve's control points, `[input, output]`, each 0 to 1. */
export type CurvePoints = readonly (readonly [number, number])[]

export interface CurvesOptions {
    preset?: CurvesPreset
    points?: CurvePoints
    /** Which channels the curve reshapes. Default `"rgb"`. */
    channel?: CurvesChannel
}

export interface TileOptions {
    repeatX?: number
    repeatY?: number
    offsetX?: number
    offsetY?: number
    mirror?: boolean
}

export interface NormalMapOptions extends EdgesOptions {
    strength?: number
    /** DirectX convention, green down. */
    flipY?: boolean
    /** Pixels of Gaussian smoothing on the height first, 0 to 10; under 1 is none. Default 4. */
    smoothRadius?: number
}

export interface SlopeBlurOptions extends EdgesOptions {
    intensity?: number
    /** Steps along the walk, 1 to 64. */
    samples?: number
    mode?: SlopeBlurMode
}

export interface InvertOptions {
    channels?: InvertChannels
}

export interface BlendOptions {
    mode?: BlendMode
    opacity?: number
}

export interface HistogramScanOptions {
    position?: number
    contrast?: number
}

export interface CurvatureOptions extends EdgesOptions {
    intensity?: number
    mode?: CurvatureMode
}

export interface AmbientOcclusionOptions extends EdgesOptions {
    radius?: number
    intensity?: number
    /** Directions searched, 1 to 64. */
    samples?: number
}

/** Every node that takes images, written with its images first. */
interface ImageNodes {
    invert(img: TexImage, channels?: InvertChannels | InvertOptions, opts?: InvertOptions): TexImage
    levels(img: TexImage, gamma?: number | LevelsOptions, opts?: LevelsOptions): TexImage
    gradientMap(img: TexImage, colors?: readonly GradientStop[] | GradientMapOptions, opts?: GradientMapOptions): TexImage
    /** Reshapes the tones through a monotone curve through `points`, as Photoshop's Curves: `curves([[0, 0.15], [0.5, 0.5], [1, 0.88]])`, or a preset, `curves("s-curve")`. */
    curves(img: TexImage, ...rest: [preset?: CurvesPreset | CurvesOptions, opts?: CurvesOptions] | [points?: CurvePoints | CurvesOptions, opts?: CurvesOptions]): TexImage
    blend(base: TexImage, top: TexImage, ...rest: [mode?: BlendMode | BlendOptions, opacity?: number | BlendOptions, opts?: BlendOptions] | [opacity?: number | BlendOptions, opts?: BlendOptions]): TexImage
    blur(img: TexImage, radius?: number | (EdgesOptions & { radius?: number }), opts?: EdgesOptions): TexImage
    warp(src: TexImage, displacement: TexImage, strength?: number | (EdgesOptions & { strength?: number }), opts?: EdgesOptions): TexImage
    tile(img: TexImage, repeatX?: number | TileOptions, opts?: TileOptions): TexImage
    /** A tangent-space normal map from this picture's height (its Rec. 601 luma): OpenGL green up unless `flipY`. */
    normalMap(height: TexImage, strength?: number | NormalMapOptions, opts?: NormalMapOptions): TexImage
    /** Smears `src` uphill along `slope`'s red gradient, `intensity` pixels long. */
    slopeBlur(src: TexImage, slope: TexImage, ...rest: [mode?: SlopeBlurMode | SlopeBlurOptions, intensity?: number | SlopeBlurOptions, opts?: SlopeBlurOptions] | [intensity?: number | SlopeBlurOptions, opts?: SlopeBlurOptions]): TexImage
    /** A grey band picked out of the height: white above `position`, black below, `contrast` 1 a hard step. */
    histogramScan(height: TexImage, position?: number | HistogramScanOptions, contrast?: number | HistogramScanOptions, opts?: HistogramScanOptions): TexImage
    /** Ridges and valleys of the height: grey 0.5 flat, lighter convex, darker concave (mode "both"). */
    curvature(height: TexImage, ...rest: [mode?: CurvatureMode | CurvatureOptions, intensity?: number | CurvatureOptions, opts?: CurvatureOptions] | [intensity?: number | CurvatureOptions, opts?: CurvatureOptions]): TexImage
    /** Horizon-based ambient occlusion of the height, `radius` pixels out. */
    ambientOcclusion(height: TexImage, radius?: number | AmbientOcclusionOptions, opts?: AmbientOcclusionOptions): TexImage
    /** This picture's colour with `height`'s grey as alpha, straight: what a splat layer reads. */
    alpha(color: TexImage, height: TexImage): TexImage
}

type Tail<F> = F extends (first: TexImage, ...rest: infer R) => TexImage ? (...rest: R) => TexImage : never
type ImageMethods = { [K in keyof ImageNodes]: Tail<ImageNodes[K]> }

/** The generators, which a canvas sizes. */
interface Generators {
    noise(...args: [type?: NoiseType | NoiseOptions, seed?: number | NoiseOptions, opts?: NoiseOptions] | [seed?: number | NoiseOptions, opts?: NoiseOptions]): TexImage
}

export type TexFunctions = ImageNodes & Generators

export interface PixelsOptions {
    /**
     * `false` draws every node into a texture of its own instead of running
     * pointwise nodes together in one pass. The bytes are the same, only
     * slower: it is how a test shows fusion changes nothing.
     */
    fuse?: boolean
}

interface Baked { texture: unknown, ready: Promise<Texture> }

const baked = new Map<string, Baked>()

/** A picture described by nodes. Every method returns a new one; nothing is drawn until `texture()`. */
// The methods are installed on the prototype from the node table below, and
// this merge is how their types reach the class: one table, two spellings.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface TexImage extends ImageMethods {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class TexImage {
    /** @internal */
    readonly node: Node
    /** @internal */
    constructor(node: Node) { this.node = node }

    get width(): number { return this.node.width }
    get height(): number { return this.node.height }
    /** Whether it repeats seamlessly. */
    get tiles(): boolean { return this.node.tiles }

    /**
     * The picture as a texture, for `scene.mesh`, `<Image>` or particles. It
     * is handed back at once and filled when the GPU has drawn it, a frame or
     * a few later; a mesh given it before then shows it when it is. The same
     * graph asked again is the same texture.
     */
    texture(): Texture {
        return bake(this.node).texture as Texture
    }

    /** The texture, once it holds the picture: for a loading screen, or a test. */
    ready(): Promise<Texture> {
        return bake(this.node).ready
    }

    /**
     * The picture's bytes as Magerie stores them: RGBA, premultiplied, gamma
     * encoded, row 0 at the top, `width * height * 4`. For a height read on
     * the CPU (a terrain's vertices), or a test against Magerie's own.
     */
    pixels(options: PixelsOptions = {}): Promise<Uint8Array> {
        return draw(plan(this.node, KERNELS, { delivered: false, fuse: options.fuse !== false }), readBytes)
    }
}

function isImage(v: unknown): v is TexImage {
    return v instanceof TexImage
}

function call(name: SpecName, canvas: Canvas, args: readonly unknown[]): TexImage {
    const { images, params } = resolve(name, args, isImage)
    return new TexImage(SPECS[name].make(params, images, canvas))
}

const IMAGE_NODES = (Object.keys(SPECS) as SpecName[]).filter((n) => SPECS[n].images > 0)
const GENERATORS = (Object.keys(SPECS) as SpecName[]).filter((n) => SPECS[n].images === 0)

for (const name of IMAGE_NODES) {
    // An image's size and tiling come from the image, so a method needs no canvas.
    Object.defineProperty(TexImage.prototype, name, {
        value(this: TexImage, ...args: unknown[]) { return call(name, DEFAULT_CANVAS, [this, ...args]) },
        writable: true, configurable: true,
    })
}

function functions(canvas: Canvas): TexFunctions {
    const out: Record<string, unknown> = {}
    for (const name of [...IMAGE_NODES, ...GENERATORS]) out[name] = (...args: unknown[]) => call(name, canvas, args)
    return out as unknown as TexFunctions
}

/** Magerie's document default (nativePipelineHelpers.ts:22). */
const DEFAULT_CANVAS: Canvas = { width: 1024, height: 1024, tile: false }

export interface CanvasOptions {
    /** Every generator from this canvas that can tile does, so every `edges: "auto"` filter wraps. */
    tile?: boolean
    /** Pixels down, when not square. */
    height?: number
}

function canvas(width: number, options: CanvasOptions = {}): TexFunctions {
    const c: Canvas = { width, height: options.height ?? width, tile: options.tile === true }
    // Checked here, once, rather than at the first generator.
    if (![c.width, c.height].every((v) => Number.isInteger(v) && v >= 1 && v <= 8192)) {
        throw new Error(`[oj] tex.canvas is ${c.width} by ${c.height}, whole numbers of pixels from 1 to 8192`)
    }
    return functions(c)
}

/**
 * A picture from bytes: `width * height * 4`, RGBA, premultiplied, as
 * Magerie stores them. For tests, and for data a cart computes.
 */
function pixels(width: number, height: number, rgba: Uint8Array | readonly number[], options: { tile?: boolean } = {}): TexImage {
    if (rgba.length !== width * height * 4) throw new Error(`[oj] tex.pixels: ${width} by ${height} is ${width * height * 4} bytes, and these are ${rgba.length}`)
    const texture = uploadRGBA(width, height, rgba, options.tile === true)
    return new TexImage(makeNode("pixels", "source", [], {}, width, height, options.tile === true, texture))
}

/** A half-float render texture's texels as 8-bit stored values, row 0 at the top. */
async function readBytes(output: unknown): Promise<Uint8Array> {
    const read = CS.OneJS.Lighting.TextureRead.Start(output)
    for (let frames = 0; !read.Done; frames++) {
        if (frames > 600) throw new Error("[oj] tex pixels: the GPU did not hand the texels back in 600 frames")
        await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()))
    }
    if (read.Error) throw new Error(`[oj] tex pixels: ${read.Error}`)
    // Rounded and flipped in C#, and handed over in one crossing.
    const binary: string = (globalThis as any).atob(CS.OneJS.ShaderFX.KeptTexture.StoredBytes(read))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}

function bake(node: Node): Baked {
    const known = baked.get(node.id)
    if (known !== undefined) return known
    const kept = CS.OneJS?.ShaderFX?.KeptTexture
    if (kept === undefined || kept === null) throw new Error("[oj] tex needs a newer OneJS: this host has no OneJS.ShaderFX.KeptTexture (it came with runtime 1.7).")
    const into = kept.Create(node.width, node.height, node.tiles, `tex ${node.op} ${node.id}`)
    const ready = draw(plan(node, KERNELS), (output) => kept.Fill(output, into)).then(() => {
        // A mesh handed the texture before it was drawn copied it empty.
        CS.OneJS?.Models?.ModelBridge?.RefreshGroundCopy?.(into)
        return into as Texture
    })
    const entry: Baked = { texture: into, ready }
    baked.set(node.id, entry)
    // A failed bake is said, and forgotten, so asking again tries again.
    ready.catch((e) => {
        baked.delete(node.id)
        console.error(e instanceof Error ? e.message : String(e))
    })
    return entry
}

const defaults = functions(DEFAULT_CANVAS)

/** Magerie's nodes as code. Each node is a function here and a method on every image. */
export const tex = {
    ...defaults,
    /** Generators sized `width` (by `height`), tiling if asked, with every other node beside them. */
    canvas,
    pixels,
}
