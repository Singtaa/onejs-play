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
import { uploadRGBA, uploadRGBAFloat } from "./upload"
import { TexCache, cacheKey, hostBackend } from "./cache"
import { DEFAULT_CANVAS, KERNELS, SPECS, makeMaterial, resolve, type Canvas, type Material, type Spec, type SpecName } from "./nodes"
import type { AutoLevelsMode, BlendMode, CurvatureMode, CurvesChannel, Fractal, InvertChannels, NoiseType, SlopeBlurMode, VoronoiMode } from "./kernels"

declare const CS: any

export type { AutoLevelsMode, BlendMode, CurvatureMode, CurvesChannel, Material, Fractal, InvertChannels, NoiseType, SlopeBlurMode, VoronoiMode }
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
    /** Blobs top to bottom, drawn as given; without it Y follows `scale`, squared to the picture. */
    scaleY?: number
    /** True keeps Y at X whatever `scaleY` says; false draws `scaleY`. Unset, a `scaleY` given unlocks it, as in Magerie's script API. */
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
    /** "32" holds it in 32-bit floats, and everything reading it, so a gentle height keeps its slope. Default: the canvas's. */
    bitDepth?: "8" | "32"
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

export type { GradientType, ChannelMathOp, ChannelMathChannels, AlphaChannel, ShapeType, ChannelSource } from "./kernels"
import type { GradientType, ChannelMathOp, ChannelMathChannels, AlphaChannel, ShapeType, ChannelSource } from "./kernels"

export interface GradientOptions extends SizeOptions {
    type?: GradientType
    /** Up to 16 stops; a stop's alpha is used. */
    colors?: readonly GradientStop[]
    /** Degrees: linear 0 runs left to right, 90 top to bottom; angular turns its seam. */
    angle?: number
    /** Radial and angular centre, 0 to 1 with y down. */
    centerX?: number
    centerY?: number
    /** "32" holds it in 32-bit floats, undithered, and everything reading it. Default: the canvas's. */
    bitDepth?: "8" | "32"
}

export interface SolidColorOptions extends SizeOptions {
    /** `#rrggbb` or `#rrggbbaa`. */
    color?: string
}

export interface HslAdjustOptions {
    /** Degrees, -180 to 180. */
    hue?: number
    /** Added, -1 to 1. */
    saturation?: number
    /** Added, -1 to 1. */
    lightness?: number
    /** The hue band the change is limited to, degrees: its centre, half width (180 is every hue) and soft edge. */
    targetHue?: number
    targetRange?: number
    targetFalloff?: number
}

export interface MaskOptions {
    invert?: boolean
}

export interface SdfShapeOptions extends SizeOptions {
    shape?: ShapeType
    /** The shape's size: 2 spans the picture. */
    size?: number
    /** Degrees. */
    rotation?: number
    /** From the centre, -1 to 1, y down: 0.5 is a quarter of the picture. */
    offsetX?: number
    offsetY?: number
    /** An ellipse's width and height, 0.1 to 1, times size. */
    shapeWidth?: number
    shapeHeight?: number
    /** A vesica's width and height, 0.1 to 2, times size. */
    vesicaWidth?: number
    vesicaHeight?: number
    /** A band of `edgeColor` this far either side of the edge, 0 to 0.1. */
    edgeBand?: number
    fillColor?: string
    edgeColor?: string
    backgroundColor?: string
    /** The background's alpha 0, whatever its colour says. */
    transparentBackground?: boolean
    /** "32" holds it in 32-bit floats, and everything reading it. Default: the canvas's. */
    bitDepth?: "8" | "32"
    // Magerie's parameters for the shapes tex does not draw yet, taken so a
    // board's call compiles whole; the three shapes above ignore them.
    capsuleLength?: number
    capsuleThickness?: number
    cornerRadius?: number
    angle?: number
    thickness?: number
    eggHeight?: number
    eggBottomRadius?: number
    eggTopRadius?: number
    eggBulge?: number
    moonDistance?: number
    moonOuterRadius?: number
    moonInnerRadius?: number
}

export interface TileGridOptions extends SizeOptions {
    /** Pieces across, 1 or more. Default 4. */
    columns?: number
    /** Rows down. Default 8. */
    rows?: number
    /** How far each row slides along from the one below, as a share of a piece: 0.5 is running bond. */
    rowOffset?: number
    /** The gap between pieces, as a share of a piece's short side, 0 to 0.5. Default 0.06. */
    jointWidth?: number
    /** How wide the edge slopes up to the face, as a share of a piece's short side, 0 to 0.5. Default 0.08. */
    bevel?: number
    /** Rounds the corners, 0 square to 1 fully round. */
    round?: number
    seed?: number
    /** Slides each row by a random extra, up to half a piece either way at 1. */
    offsetJitter?: number
    /** Makes pieces in a row longer and shorter than each other. */
    lengthJitter?: number
    /** Shrinks some pieces inside their place, by up to half. */
    sizeJitter?: number
    /** Sinks some faces by up to this much. */
    heightJitter?: number
    /** "32" keeps the height in floats, so a bevel stays smooth when lit or stretched. Default: the canvas's. */
    bitDepth?: "8" | "32"
}

export interface TransformOptions {
    /** Pixels right. Default 0. */
    translateX?: number
    /** Pixels down. Default 0. */
    translateY?: number
    /** About the centre: Magerie's slider runs 0.1 to 4. Default 1. */
    scale?: number
    /** Degrees about the centre, any angle (Magerie's slider runs -180 to 180). Default 0. */
    rotation?: number
    flipX?: boolean
    flipY?: boolean
}

export interface ScatterOptions extends SizeOptions {
    /**
     * Where copies may land: a copy is kept when the mask's luma under its
     * centre beats the copy's own random draw, so white keeps all, black none,
     * grey some. A dropped copy is gone from image, id and random alike, and
     * no other copy moves. Default none.
     */
    mask?: TexImage | null
    /** "random" places `count` copies anywhere; "grid" one a cell of `gridX` by `gridY`. Default "random". */
    layout?: "random" | "grid"
    /** Copies, for "random", 1 to 4096. Default 20. */
    count?: number
    gridX?: number
    gridY?: number
    /** How far a grid copy strays from its cell's centre, 0 to 1 of half a cell. Default 0.5. */
    positionJitter?: number
    seed?: number
    /** Each copy's size, a random share of the stamp's, 0.1 to 2. Defaults 0.5 and 1. */
    scaleMin?: number
    scaleMax?: number
    /** Each copy turns by a random angle from 0 to this, in degrees. Default 360. */
    rotationRange?: number
    /** Defaults 0.5 and 1. */
    opacityMin?: number
    opacityMax?: number
    /** Magerie blurs a copy by its stamp's mip chain, which tex does not build: anything above 0 is refused. */
    softnessMin?: number
    softnessMax?: number
    /** "wrap" carries a copy across each edge to the other side, so the picture tiles. "auto" wraps when `mask` tiles, and clamps otherwise. */
    edges?: Edges
    /** Behind every copy. Default "#00000000". */
    bgColor?: string
}

/** Scatter's three pictures. */
export interface Scatter {
    /** The copies, straight over `bgColor`, the last on top. */
    readonly image: TexImage
    /** One colour a copy wherever its stamp is at least half covered: Flood Fill's IDs. */
    readonly id: TexImage
    /** One grey a copy on the same cover: the ID's red. */
    readonly random: TexImage
}

export interface ChannelShuffleOptions {
    /** Each output channel's source: a stored channel, or "0" or "1". */
    outR?: ChannelSource
    outG?: ChannelSource
    outB?: ChannelSource
    outA?: ChannelSource
}

export interface ThresholdOptions {
    threshold?: number
    /** A smoothstep `smoothness` either side, instead of a hard step. */
    smooth?: boolean
    smoothness?: number
}

export interface DistanceOptions extends EdgesOptions {
    /** `"inside"` ramps up into the light part; `"outside"` away from it. */
    mode?: "inside" | "outside"
    /** Pixels at which the ramp reaches 1, 1 to 256. */
    maxDistance?: number
    /** The luma that splits light from dark. */
    threshold?: number
}

export interface ChannelMathOptions {
    operation?: ChannelMathOp
    /** Which channels take the result; the rest keep the first picture's. */
    channels?: ChannelMathChannels
}

export interface AlphaMergeOptions {
    alphaChannel?: AlphaChannel
}

export interface AutoLevelsOptions {
    /** `"luminance"` stretches every channel by the luma's range; `"perChannel"` each by its own. */
    mode?: AutoLevelsMode
}

export interface DirectionalWarpOptions extends EdgesOptions {
    /** Degrees, 0 right, 90 down. */
    angle?: number
    /** Pixels the source moves where the map is white. */
    intensity?: number
    /** The map's mid grey stays put: darker moves back, lighter forward. */
    bothWays?: boolean
}

/** A Material's maps. A scalar channel takes a picture's red, or a number 0 to 1 for the whole surface. */
export interface MaterialMaps {
    albedo: TexImage
    normal?: TexImage
    roughness?: TexImage | number
    metallic?: TexImage | number
    /** In Magerie's bundle; Material Light does not read it. */
    height?: TexImage
    ao?: TexImage | number
    emissive?: TexImage
    opacity?: TexImage | number
}

export interface MaterialLightOptions {
    /** Degrees, 0 right, 90 up. */
    lightAngle?: number
    /** Degrees above the surface, 90 overhead. */
    lightElevation?: number
    lightStrength?: number
    ambient?: number
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
    /** Turns the hue, and adds to saturation and lightness: `hslAdjust(0, 0.25)`. */
    hslAdjust(img: TexImage, hue?: number | HslAdjustOptions, saturation?: number | HslAdjustOptions, lightness?: number | HslAdjustOptions, opts?: HslAdjustOptions): TexImage
    /** This picture where `mask` is light: scaled by the mask's luma times its alpha. */
    mask(img: TexImage, mask: TexImage, opts?: MaskOptions): TexImage
    /** Adds, subtracts, multiplies (and more) two pictures channel by channel, clamped. */
    channelMath(a: TexImage, b: TexImage, ...rest: [operation?: ChannelMathOp | ChannelMathOptions, opts?: ChannelMathOptions] | [opts?: ChannelMathOptions]): TexImage
    /** This picture's colour with a new alpha: `alpha`'s luma, red or alpha. */
    alphaMerge(rgb: TexImage, alpha: TexImage, ...rest: [alphaChannel?: AlphaChannel | AlphaMergeOptions, opts?: AlphaMergeOptions] | [opts?: AlphaMergeOptions]): TexImage
    /** Stretches the tones to fill 0 to 1, from the darkest and lightest pixels it holds. */
    autoLevels(img: TexImage, mode?: AutoLevelsMode | AutoLevelsOptions, opts?: AutoLevelsOptions): TexImage
    /** Pushes `src` along `angle` by `map`'s red times `intensity` pixels. */
    directionalWarp(src: TexImage, map: TexImage, angle?: number | DirectionalWarpOptions, intensity?: number | DirectionalWarpOptions, opts?: DirectionalWarpOptions): TexImage
    /** This picture's colour with `height`'s grey as alpha, straight: what a splat layer reads. */
    alpha(color: TexImage, height: TexImage): TexImage
    /** Big square pixels, each block the input read once at its centre: `pixelate(img, 8)`. */
    pixelate(img: TexImage, blockSize?: number | { blockSize?: number }): TexImage
    /**
     * Moves, turns, scales or flips a picture within its own frame, as Magerie's
     * Transform: `transform(leaf, { translateX: -40, rotation: 92 })`. Same size,
     * transparent where nothing lands, and it never tiles.
     */
    transform(img: TexImage, opts?: TransformOptions): TexImage
    /** Rearranges the stored channels: `channelShuffle(leaf, "aaa1")` is its alpha as an opaque grey. */
    channelShuffle(img: TexImage, swizzle?: string | ChannelShuffleOptions, opts?: ChannelShuffleOptions): TexImage
    /** White where the luma reaches `threshold`, black below, the alpha kept. */
    threshold(img: TexImage, threshold?: number | ThresholdOptions, opts?: ThresholdOptions): TexImage
    /** Each pixel's distance to the other side of `threshold`, over `maxDistance` pixels, as grey. */
    distance(img: TexImage, ...rest: [mode?: "inside" | "outside" | DistanceOptions, maxDistance?: number | DistanceOptions, opts?: DistanceOptions] | [maxDistance?: number | DistanceOptions, opts?: DistanceOptions]): TexImage
    /** Up to three layers over this picture, in order, by their alpha. */
    composite(base: TexImage, ...layers: [] | [TexImage] | [TexImage, TexImage] | [TexImage, TexImage, TexImage]): TexImage
}

type Tail<F> = F extends (first: TexImage, ...rest: infer R) => TexImage ? (...rest: R) => TexImage : never
type ImageMethods = { [K in keyof ImageNodes]: Tail<ImageNodes[K]> }

/** The generators, which a canvas sizes. */
interface Generators {
    /** A linear, radial or angular ramp through `colors`, dithered as Magerie's. */
    gradient(...args: [type?: GradientType | GradientOptions, colors?: readonly GradientStop[] | GradientOptions, opts?: GradientOptions] | [colors?: readonly GradientStop[] | GradientOptions, opts?: GradientOptions]): TexImage
    /** One colour everywhere. */
    solidColor(...args: [color?: string | SolidColorOptions, opts?: SolidColorOptions] | [opts?: SolidColorOptions]): TexImage
    /** A bundle of maps for `materialLight`, as Magerie's Material node. */
    material(maps: MaterialMaps): Material
    /** Lights a material from `lightAngle` and renders it to a picture the albedo's size. */
    materialLight(material: Material, lightAngle?: number | MaterialLightOptions, opts?: MaterialLightOptions): TexImage
    noise(...args: [type?: NoiseType | NoiseOptions, seed?: number | NoiseOptions, opts?: NoiseOptions] | [seed?: number | NoiseOptions, opts?: NoiseOptions]): TexImage
    /** A circle, ellipse or vesica, antialiased, filled over a background: `sdfShape("ellipse", 0.8, { shapeHeight: 0.74 })`. */
    sdfShape(...args: [shape?: ShapeType | SdfShapeOptions, size?: number | SdfShapeOptions, opts?: SdfShapeOptions] | [size?: number | SdfShapeOptions, opts?: SdfShapeOptions]): TexImage
    /**
     * Bricks, tiles, slabs or planks, always seamless: `const { image, random, uv } = tileGrid(4, { rows: 8 })`.
     * `image` is the height (0 in the joint, 1 on the face), `random` one grey
     * per piece, `uv` each face's own 0 to 1 coordinates in red and green.
     */
    tileGrid(columns?: number | TileGridOptions, opts?: TileGridOptions): TileGrid
    /**
     * Copies of `stamp` across the canvas, each its own size, turn and opacity,
     * as Magerie's Scatter node: `const { image, id } = scatter(knot, { count: 12, edges: "wrap" })`.
     * A picture of pictures; `scene.scatter` is the other one, instanced meshes in a scene.
     */
    scatter(stamp: TexImage, ...args: [layout?: "random" | "grid" | number | ScatterOptions, count?: number | ScatterOptions, opts?: ScatterOptions]): Scatter
}

/** Tile Grid's three pictures. */
export interface TileGrid {
    readonly image: TexImage
    readonly random: TexImage
    readonly uv: TexImage
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

export interface TextureOptions {
    /**
     * `false` draws it on every load. By default a picture is kept across
     * loads, keyed by its recipe, and the next load reads it back instead of
     * drawing: worth skipping for a picture made from a new seed each run.
     */
    cache?: boolean
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
     * graph asked again is the same texture. A later load of the cart reads
     * the picture back from storage rather than drawing it (`cache: false`
     * skips that).
     */
    texture(options?: TextureOptions): Texture {
        return bake(this.node, options).texture as Texture
    }

    /** The texture, once it holds the picture: for a loading screen, or a test. */
    ready(options?: TextureOptions): Promise<Texture> {
        return bake(this.node, options).ready
    }

    /**
     * The picture's bytes as Magerie stores them: RGBA, premultiplied, gamma
     * encoded, row 0 at the top, `width * height * 4`. For a height read on
     * the CPU (a terrain's vertices), or a test against Magerie's own.
     */
    pixels(options?: PixelsOptions & { float?: false }): Promise<Uint8Array>
    /** The values as stored, unrounded, as floats: for a 32-bit picture, or a test against Magerie's float readback. */
    pixels(options: PixelsOptions & { float: true }): Promise<Float32Array>
    pixels(options: PixelsOptions & { float?: boolean } = {}): Promise<Uint8Array | Float32Array> {
        const plans = plan(this.node, KERNELS, { delivered: false, fuse: options.fuse !== false })
        return options.float === true ? draw(plans, readFloats) : draw(plans, readBytes)
    }
}

function isImage(v: unknown): v is TexImage {
    return v instanceof TexImage
}

function call(name: SpecName, canvas: Canvas, args: readonly unknown[]): TexImage | Readonly<Record<string, TexImage>> {
    const { images, params, material } = resolve(name, args, isImage)
    const made = (SPECS[name] as Spec).make(params, images, canvas, material)
    if ("op" in made) return new TexImage(made as Node)
    return Object.freeze(Object.fromEntries(Object.entries(made).map(([port, n]) => [port, new TexImage(n)])))
}

function material(maps: MaterialMaps): Material {
    return makeMaterial(maps, (v) => (isImage(v) ? v.node : undefined))
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
    out.material = material
    return out as unknown as TexFunctions
}


export interface CanvasOptions {
    /** Every generator from this canvas that can tile does, so every `edges: "auto"` filter wraps. */
    tile?: boolean
    /** Pixels down, when not square. */
    height?: number
    /**
     * "32" draws every generator from this canvas that takes a bit depth in
     * floats, and everything reading one, as Magerie's float wins. Default "8".
     */
    bitDepth?: "8" | "32"
}

function canvas(width: number, options: CanvasOptions = {}): TexFunctions {
    const c: Canvas = { width, height: options.height ?? width, tile: options.tile === true, bitDepth: options.bitDepth ?? "8" }
    if (c.bitDepth !== "8" && c.bitDepth !== "32") throw new Error(`[oj] tex.canvas: bitDepth is ${JSON.stringify(c.bitDepth)}, "8" or "32"`)
    // Checked here, once, rather than at the first generator.
    if (![c.width, c.height].every((v) => Number.isInteger(v) && v >= 1 && v <= 8192)) {
        throw new Error(`[oj] tex.canvas is ${c.width} by ${c.height}, whole numbers of pixels from 1 to 8192`)
    }
    return functions(c)
}

/**
 * A picture from bytes: `width * height * 4`, RGBA, premultiplied, as
 * Magerie stores them. For tests, and for data a cart computes. A
 * Float32Array makes a 32-bit picture, unrounded, as a `bitDepth: "32"`
 * generator's, and everything reading it is 32-bit too.
 */
function pixels(width: number, height: number, rgba: Uint8Array | Float32Array | readonly number[], options: { tile?: boolean } = {}): TexImage {
    if (rgba.length !== width * height * 4) throw new Error(`[oj] tex.pixels: ${width} by ${height} is ${width * height * 4} values, and these are ${rgba.length}`)
    const tile = options.tile === true
    if (rgba instanceof Float32Array) {
        return new TexImage(makeNode("pixels", "source", [], { float: true }, width, height, tile, uploadRGBAFloat(width, height, rgba, tile)))
    }
    return new TexImage(makeNode("pixels", "source", [], {}, width, height, tile, uploadRGBA(width, height, rgba, tile)))
}

/** A pass's texels, read back from the GPU, as the bytes C#'s `encode` hands over in one crossing, row 0 at the top. */
async function readBack(output: unknown, encode: "StoredBytes" | "StoredFloats"): Promise<Uint8Array> {
    const read = CS.OneJS.Lighting.TextureRead.Start(output)
    for (let frames = 0; !read.Done; frames++) {
        if (frames > 600) throw new Error("[oj] tex pixels: the GPU did not hand the texels back in 600 frames")
        await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()))
    }
    if (read.Error) throw new Error(`[oj] tex pixels: ${read.Error}`)
    const kept = CS.OneJS.ShaderFX.KeptTexture
    if (typeof kept[encode] !== "function") throw new Error("[oj] tex pixels({ float: true }) needs a newer OneJS: this one hands back 8 bits only")
    const binary: string = (globalThis as any).atob(kept[encode](read))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}

/** The texels as 8-bit stored values, rounded in C#. */
const readBytes = (output: unknown): Promise<Uint8Array> => readBack(output, "StoredBytes")

/** The texels as stored, float32. */
const readFloats = async (output: unknown): Promise<Float32Array> => {
    const bytes = await readBack(output, "StoredFloats")
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

let store: TexCache | null | undefined

/** The cache across loads, or null on a host that cannot keep one (a OneJS before `KeptTexture.Upload`, or no storage). */
function texCache(): TexCache | null {
    if (store === undefined) {
        const upload = typeof CS === "undefined" ? undefined : CS.OneJS?.ShaderFX?.KeptTexture?.Upload
        const backend = typeof upload === "function" ? hostBackend() : undefined
        store = backend === undefined ? null : new TexCache(backend)
    }
    return store
}

/** Reads a kept texture's bytes back and keeps them under `key`. Never throws: a picture not kept is drawn again next load. */
async function keep(key: string, into: unknown): Promise<void> {
    try {
        const bytes = await keptBytes(into)
        await texCache()?.put(key, bytes)
    } catch (e) {
        console.warn(`[oj] tex: a picture was not cached (${e instanceof Error ? e.message : String(e)})`)
    }
}

/** A kept texture's 8-bit bytes, row 0 at the top, in base64, as KeptTexture.Upload takes them. */
async function keptBytes(into: unknown): Promise<string> {
    const read = CS.OneJS.Lighting.TextureRead.Start(into)
    for (let frames = 0; !read.Done; frames++) {
        if (frames > 600) throw new Error("the GPU did not hand the texels back in 600 frames")
        await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()))
    }
    if (read.Error) throw new Error(read.Error)
    return CS.OneJS.ShaderFX.KeptTexture.StoredBytes(read)
}

/** Whether a kept picture went into `into`: false for one the wrong size, or an upload that failed, which a draw then fills. */
function uploaded(kept: any, bytes: string, into: unknown): boolean {
    try {
        return kept.Upload(bytes, into) === true
    } catch {
        return false
    }
}

function bake(node: Node, options: TextureOptions = {}): Baked {
    const known = baked.get(node.id)
    if (known !== undefined) return known
    const kept = CS.OneJS?.ShaderFX?.KeptTexture
    if (kept === undefined || kept === null) throw new Error("[oj] tex needs a newer OneJS: this host has no OneJS.ShaderFX.KeptTexture (it came with runtime 1.7).")
    const into = kept.Create(node.width, node.height, node.tiles, `tex ${node.op} ${node.id}`)
    const cache = options.cache === false ? null : texCache()
    const key = cache === null ? undefined : cacheKey(node)
    const ready = (async () => {
        const hit = key === undefined ? undefined : await cache!.get(key)
        if (hit === undefined || !uploaded(kept, hit, into)) {
            await draw(plan(node, KERNELS), (output) => kept.Fill(output, into))
            // Kept after the picture is handed over: storing it costs the cart nothing it waits for.
            if (key !== undefined) void keep(key, into)
        }
        // A mesh handed the texture before it was drawn copied it empty.
        CS.OneJS?.Models?.ModelBridge?.RefreshGroundCopy?.(into)
        return into as Texture
    })()
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
    /** The pictures kept across loads (64 MB, least recently used dropped first). */
    cache: {
        /** Drops every kept picture, for a settings screen's "clear cached textures". The next load draws each again. */
        clear(): Promise<void> {
            return texCache()?.clear() ?? Promise.resolve()
        },
    },
}
