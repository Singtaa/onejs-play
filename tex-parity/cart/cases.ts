/**
 * Magerie's kernel-parity cases as tex graphs. Each case is the input and
 * the call magerie-one's `js/tests/kernel-parity.test.tsx` makes, with the
 * golden that call recorded on a Mac (`../goldens`, from the commit in
 * `../goldens/SOURCE.md`). The fixture builders are that file's, ported.
 */
import { tex, type TexImage } from "oj"

type RGBA = [number, number, number, number]

function uniform(r: number, g: number, b: number, a: number, w: number, h: number): Uint8Array {
    const bytes = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) bytes.set([r, g, b, a], i * 4)
    return bytes
}

/** Columns alternating every `stripe` pixels, `c0` first. */
function stripes(w: number, h: number, stripe: number, c0: RGBA, c1: RGBA): Uint8Array {
    const bytes = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) bytes.set((Math.floor(x / stripe) & 1) === 1 ? c1 : c0, (y * w + x) * 4)
    }
    return bytes
}

/** Premultiplied red with alpha ramping 0 to 255 across x. */
function alphaRamp(w: number, h: number): Uint8Array {
    const bytes = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const a = w === 1 ? 128 : Math.round((x / (w - 1)) * 255)
            bytes.set([a, 0, 0, a], (y * w + x) * 4)
        }
    }
    return bytes
}

const GRAYS = [
    13, 15, 25, 26, 30, 31, 37, 50, 52, 55, 57, 60, 61, 62, 74, 79,
    99, 100, 104, 105, 109, 110, 114, 115, 117, 119, 120, 122, 124, 125, 127, 148,
    151, 158, 161, 163, 193, 198, 200, 205, 208, 210, 218, 220, 225, 228, 230, 234,
    235, 238, 240, 244, 245, 248, 250, 253, 254, 0, 1, 2, 64, 128, 192, 255,
]

function grays(a = 255): Uint8Array {
    const bytes = new Uint8Array(8 * 8 * 4)
    GRAYS.forEach((g, i) => {
        const p = Math.round((g * a) / 255)
        bytes.set([p, p, p, a], i * 4)
    })
    return bytes
}

/** A red column at x = 3 on black, 8 x 8: the warp cases' source. */
function redColumn(): Uint8Array {
    const bytes = uniform(0, 0, 0, 255, 8, 8)
    for (let y = 0; y < 8; y++) bytes[(y * 8 + 3) * 4] = 255
    return bytes
}

function px(w: number, h: number, bytes: Uint8Array): TexImage {
    return tex.pixels(w, h, bytes)
}

export interface Case {
    /** The golden's path under goldens/, without .bin. */
    readonly name: string
    make(): TexImage
    /** Compared as stored floats, for a 32-bit picture. */
    readonly float?: boolean
}

const noise16 = tex.canvas(16)

/** createNoiseTexture's positional call, which skips the host's scale lock: scaleY as given. */
const gpuNoise = (type: "perlin" | "simplex" | "voronoi" | "white", scale: number, octaves: number, opts: Record<string, unknown> = {}) =>
    noise16.noise(type, 42, { scale, scaleY: scale, scaleLock: false, octaves, persistence: 0.5, ...opts })

export const CASES: readonly Case[] = [
    { name: "blur/opaque-uniform-r2", make: () => px(8, 8, uniform(128, 128, 128, 255, 8, 8)).blur(2) },
    { name: "blur/opaque-stripes-r2", make: () => px(16, 8, stripes(16, 8, 2, [0, 0, 0, 255], [255, 255, 255, 255])).blur(2) },
    { name: "blur/semi-transparent-alpha-r2", make: () => px(16, 8, alphaRamp(16, 8)).blur(2) },

    { name: "invert/opaque-color-all", make: () => px(8, 8, uniform(200, 100, 50, 255, 8, 8)).invert() },
    { name: "invert/semi-transparent-red", make: () => px(8, 8, uniform(128, 0, 0, 128, 8, 8)).invert() },
    { name: "invert/fully-transparent", make: () => px(4, 4, uniform(0, 0, 0, 0, 4, 4)).invert() },

    { name: "levels/opaque-identity", make: () => px(8, 8, uniform(128, 128, 128, 255, 8, 8)).levels() },
    {
        name: "levels/opaque-stretch",
        make: () => px(16, 8, stripes(16, 8, 2, [64, 64, 64, 255], [192, 192, 192, 255])).levels({ inputBlack: 0.2, inputWhite: 0.8 }),
    },
    { name: "levels/semi-transparent-identity", make: () => px(8, 8, uniform(128, 128, 128, 128, 8, 8)).levels() },

    { name: "gradient-map/opaque-mid", make: () => px(8, 8, uniform(128, 128, 128, 255, 8, 8)).gradientMap(["#ff0000", "#0000ff"]) },
    { name: "gradient-map/semi-transparent-endpoint", make: () => px(8, 8, uniform(128, 128, 128, 128, 8, 8)).gradientMap(["#ff0000", "#0000ff"]) },

    { name: "warp/uniform-map-no-warp", make: () => px(8, 8, redColumn()).warp(px(8, 8, uniform(200, 128, 0, 255, 8, 8)), 5) },
    {
        name: "warp/gradient-map-stripe",
        make: () => {
            const map = new Uint8Array(8 * 8 * 4)
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) map.set([(x * 255 / 7) | 0, 128, 0, 255], (y * 8 + x) * 4)
            return px(8, 8, redColumn()).warp(px(8, 8, map), 3)
        },
    },

    { name: "blend-nonseparable/luminosity-clear-top", make: () => px(8, 8, grays()).blend(px(8, 8, new Uint8Array(256)), "luminosity", 1) },
    { name: "blend-nonseparable/luminosity-black-top-half", make: () => px(8, 8, grays()).blend(px(8, 8, uniform(0, 0, 0, 255, 8, 8)), "luminosity", 0.5) },
    {
        name: "blend-nonseparable/color-gray-top-over-half-black-half",
        make: () => px(8, 8, uniform(0, 0, 0, 128, 8, 8)).blend(px(8, 8, grays()), "color", 0.5),
    },

    { name: "tile/2x2-no-mirror", make: () => { const b = uniform(0, 0, 0, 255, 4, 4); b[0] = 255; return px(4, 4, b).tile(2) } },
    { name: "tile/2x2-mirror", make: () => { const b = uniform(0, 0, 0, 255, 4, 4); b[0] = 255; return px(4, 4, b).tile(2, { mirror: true }) } },

    { name: "noise/perlin-seed42", make: () => gpuNoise("perlin", 4, 1) },
    { name: "noise/simplex-fbm4", make: () => gpuNoise("simplex", 4, 4) },
    { name: "noise/simplex-ridged-fbm4", make: () => gpuNoise("simplex", 4, 4, { fractal: "ridged" }) },
    { name: "noise/simplex-billow-fbm4", make: () => gpuNoise("simplex", 4, 4, { fractal: "billow" }) },
    { name: "noise/simplex-lacunarity3", make: () => gpuNoise("simplex", 4, 4, { lacunarity: 3 }) },
    { name: "noise/simplex-warp", make: () => gpuNoise("simplex", 4, 4, { warp: 0.6 }) },
    { name: "noise/perlin-tile-warp", make: () => gpuNoise("perlin", 6.3, 4, { lacunarity: 2.3, warp: 0.5, tile: true }) },
    { name: "noise/voronoi-tile-cracks", make: () => gpuNoise("voronoi", 6.3, 2, { voronoiMode: "f2-f1", tile: true }) },
    { name: "noise/white-tile", make: () => gpuNoise("white", 6.3, 1, { tile: true }) },
    { name: "noise/voronoi-cell", make: () => gpuNoise("voronoi", 4, 1, { voronoiMode: "cell" }) },
    // Through the node's own parameters, as runNoiseGPU resolves them: the host's lock, on a square.
    { name: "noise/turbulence-oj3", make: () => noise16.noise("turbulence", 42, { scale: 4, octaves: 3, persistence: 0.5 }) },
    { name: "noise/ridged-oj3", make: () => noise16.noise("ridged", 42, { scale: 4, octaves: 3, persistence: 0.5 }) },
]
