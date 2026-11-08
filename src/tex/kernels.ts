/**
 * Magerie's node maths, recorded in the shader language.
 *
 * Each kernel follows magerie-one's `docs/design/texture-node-spec.md` and the
 * Metal kernel it cites, line for line where the spec says "copy bit for bit":
 * the hash constants, the seed offsets, the order of a loop's comparisons,
 * where a value is clamped. The values are the stored ones, gamma encoded and
 * premultiplied (spec 1.1), and every coordinate is Magerie's (scope.ts).
 *
 * A kernel runs at record time, once per pass, not per pixel: it returns the
 * expression a texel's colour is. A choice that changes the program's shape
 * (a blend mode, a noise type) is a JavaScript `switch`; a number is a
 * uniform, so a new seed or strength recompiles nothing.
 */
import { sl, type Float, type Vec2, type Vec3, type Vec4 } from "onejs-unity/sl"
import type { Scope, TexRead } from "./scope"

// The shader language's values, loosely: a kernel mixes floats and vectors
// the way HLSL does, and the record-time types would only restate the maths.
type S = any

const TAU = 6.28318530718

const val = (v: S): S => (typeof v === "number" ? sl.float(v) : v)
const max = (a: S, b: S): S => val(a).max(b)
const min = (a: S, b: S): S => val(a).min(b)

// storage

/** Magerie's 8-bit store: the GPU's float to unorm, half up (spec 1.1, "Rounding"). */
export function quantise8(c: Vec4): Vec4 {
    return c.saturate().mul(255).add(0.5).floor().div(255)
}

/** Straight colour from a premultiplied one: black below alpha 0.001. */
function unpremultiply(c: Vec4): Vec3 {
    return sl.select(c.w.gt(0.001), c.xyz.div(max(c.w, 0.001)), sl.vec3(0, 0, 0)) as Vec3
}

/** The Rec. 601 luma Magerie takes of gamma values. */
function luma601(c: Vec3): Float {
    return c.dot(sl.vec3(0.299, 0.587, 0.114))
}

// noise (spec 3, "Noise"; MetalRenderer.mm:1109-1404)

function hash(p: Vec2, seed: Float): Float {
    let p3: S = sl.vec3(p.x, p.y, seed).mul(sl.vec3(443.897, 441.423, 437.195)).fract()
    p3 = p3.add(p3.dot(p3.swz("yzx").add(19.19)))
    return p3.x.add(p3.y).mul(p3.z).fract()
}

/** Integer modulo with negatives folded up, as wrapCell: a float division under fast maths gives 6 / 6 as 0.99999994. */
function wrapAxis(c: Float, period: Float): Float {
    const ci: S = sl.int(c)
    const pi: S = sl.int(max(period, 1))
    const m0: S = ci.sub(pi.mul(ci.div(pi)))
    const m: S = sl.select(m0.lt(0), m0.add(pi), m0)
    return sl.select(period.le(0), c, sl.float(m)) as Float
}

function wrapCell(c: Vec2, period: Vec2): Vec2 {
    return sl.vec2(wrapAxis(c.x, period.x), wrapAxis(c.y, period.y))
}

function grad(cell: Vec2, seed: Float): Vec2 {
    const a = hash(cell, seed).mul(TAU)
    return sl.vec2(sl.cos(a), sl.sin(a))
}

function perlin(p: Vec2, seed: Float, period: Vec2): Float {
    const c: S = p.floor()
    const f: S = p.fract()
    const u: S = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10))
    const corner = (dx: number, dy: number) =>
        grad(wrapCell(c.add(sl.vec2(dx, dy)), period), seed).dot(f.sub(sl.vec2(dx, dy)))
    const n00 = corner(0, 0), n10 = corner(1, 0), n01 = corner(0, 1), n11 = corner(1, 1)
    return sl.mix(sl.mix(n00, n10, u.x), sl.mix(n01, n11, u.x), u.y) as Float
}

function simplex(p: Vec2, seed: Float): Float {
    const K1 = 0.366025404, K2 = 0.211324865
    const i: S = p.add(p.x.add(p.y).mul(K1)).floor()
    const a: S = p.sub(i).add(i.x.add(i.y).mul(K2))
    const o: S = sl.select(a.x.gt(a.y), sl.vec2(1, 0), sl.vec2(0, 1))
    const b: S = a.sub(o).add(K2)
    const c: S = a.sub(1 - 2 * K2)
    const h: S = max(sl.vec3(0.5, 0.5, 0.5).sub(sl.vec3(a.dot(a), b.dot(b), c.dot(c))), 0)
    const n: S = h.mul(h).mul(h).mul(h).mul(sl.vec3(
        a.dot(grad(i, seed)),
        b.dot(grad(i.add(o), seed)),
        c.dot(grad(i.add(1), seed))))
    return n.dot(sl.vec3(70, 70, 70))
}

export type NoiseType = "perlin" | "simplex" | "voronoi" | "white" | "turbulence" | "ridged"
export type VoronoiMode = "f1" | "f2" | "f2-f1" | "cell"
export type Fractal = "standard" | "ridged" | "billow"

function voronoi(p: Vec2, seed: Float, period: Vec2, mode: VoronoiMode): Float {
    const i: S = p.floor()
    const f: S = p.fract()
    let d1: S = sl.float(1), d2: S = sl.float(1), nearest: S = i
    // y outer, x inner, strict <: the first of two equal distances wins.
    for (let y = -1; y <= 1; y++) {
        for (let x = -1; x <= 1; x++) {
            const neighbour = sl.vec2(x, y)
            const cell = wrapCell(i.add(neighbour), period)
            const point = neighbour.add(sl.vec2(hash(cell, seed), hash(cell, seed.add(1000))))
            const dist: S = f.sub(point).length()
            const nearer = dist.lt(d1)
            const second = dist.lt(d2)
            d2 = sl.select(nearer, d1, sl.select(second, dist, d2))
            nearest = sl.select(nearer, cell, nearest)
            d1 = sl.select(nearer, dist, d1)
        }
    }
    switch (mode) {
        case "f2": return d2
        case "f2-f1": return d2.sub(d1)
        case "cell": return hash(nearest, seed.add(7777))
        default: return d1
    }
}

function tilePeriod(base: Vec2, frequency: Float | number): Vec2 {
    // MSL round is half away from zero; for a positive value that is floor(x + 0.5).
    return max(base.mul(frequency).add(0.5).floor(), sl.vec2(1, 1)) as Vec2
}

export interface NoiseShape {
    type: NoiseType
    voronoiMode: VoronoiMode
    fractal: Fractal
    tile: boolean
    warp: boolean
    /** One octave: white noise, or `octaves` 1. */
    single: boolean
}

export interface NoiseValues {
    scale: [number, number]
    offset: [number, number]
    seed: number
    octaves: number
    persistence: number
    lacunarity: number
    warp: number
}

/** Magerie's Noise node: a grey value at this texel's corner, alpha 1. */
export function noise(s: Scope, shape: NoiseShape, v: NoiseValues): Vec4 {
    // The host side's folds (ExecutorRegistry.cpp:378-407).
    const kind = shape.type === "turbulence" || shape.type === "ridged" ? "simplex" : shape.type
    const fractal: Fractal = shape.type === "turbulence" ? "billow" : shape.type === "ridged" ? "ridged" : shape.fractal

    const base: S = sl.vec2(s.f(v.scale[0]), s.f(v.scale[1]))
    const seed: S = s.f(v.seed)
    const uv: S = s.pixel.div(s.size).add(sl.vec2(s.f(v.offset[0]), s.f(v.offset[1])))
    let p: S = uv.mul(base)

    if (shape.warp) {
        const amount = s.f(v.warp)
        let wx: S, wy: S
        if (shape.tile) {
            const period = tilePeriod(base, 0.5)
            const q = p.mul(period.div(base))
            wx = perlin(q.add(sl.vec2(11.3, 5.1)), seed.add(31337), period)
            wy = perlin(q.add(sl.vec2(-7.7, 19.4)), seed.add(92717), period)
        } else {
            const q = p.mul(0.5)
            wx = simplex(q.add(sl.vec2(11.3, 5.1)), seed.add(31337))
            wy = simplex(q.add(sl.vec2(-7.7, 19.4)), seed.add(92717))
        }
        p = p.add(sl.vec2(wx, wy).mul(amount))
    }

    const octave = (q: Vec2, octaveSeed: Float, period: Vec2): Float => {
        switch (kind) {
            case "perlin": return perlin(q, octaveSeed, period).mul(0.5).add(0.5)
            // A tiled Simplex evaluates Perlin (MetalRenderer.mm:1267-1269).
            case "simplex": return shape.tile
                ? perlin(q, octaveSeed, period).mul(0.5).add(0.5)
                : simplex(q, octaveSeed).mul(0.5).add(0.5)
            case "voronoi": return voronoi(q, octaveSeed, period, shape.voronoiMode)
            default: return hash(wrapCell(q.floor(), period), octaveSeed)
        }
    }
    const fold = (n: Float): Float => {
        if (fractal === "ridged") {
            const r = sl.float(1).sub(n.mul(2).sub(1).abs())
            return r.mul(r)
        }
        if (fractal === "billow") return n.mul(2).sub(1).abs()
        return n
    }

    let value: S
    if (shape.single) {
        const period = shape.tile ? tilePeriod(base, 1) : sl.vec2(0, 0)
        const q = shape.tile ? p.mul(period.div(base)) : p
        value = fold(octave(q, seed, period))
    } else {
        // value, amplitude, frequency, total, octave
        const [sum, , , total] = sl.loop(
            [0, 1, 1, 0, 0],
            (r: S[]) => r[4].lt(s.f(v.octaves)),
            (r: S[]) => {
                const [val, amp, freq, tot, i] = r
                const period = shape.tile ? tilePeriod(base, freq) : sl.vec2(0, 0)
                const q = shape.tile ? p.mul(period.div(base)) : p.mul(freq)
                const n = fold(octave(q, seed.add(i.mul(1000)), period))
                return [val.add(n.mul(amp)), amp.mul(s.f(v.persistence)), freq.mul(s.f(v.lacunarity)), tot.add(amp), i.add(1)]
            },
            8,
        ) as S[]
        value = sum.div(total)
    }
    const g = value.saturate()
    return sl.vec4(g, g, g, 1)
}

// pointwise colour (spec 5)

export type BlendMode =
    | "normal" | "multiply" | "screen" | "overlay" | "add" | "subtract" | "softLight" | "hardLight"
    | "colorDodge" | "colorBurn" | "darken" | "lighten" | "difference" | "exclusion"
    | "hue" | "saturation" | "color" | "luminosity" | "vividLight" | "linearLight" | "pinLight" | "linearBurn"

const lum = (c: S): S => c.dot(sl.vec3(0.299, 0.587, 0.114))

function clipColor(c: S): S {
    const l = lum(c)
    const n = min(min(c.x, c.y), c.z)
    const x = max(max(c.x, c.y), c.z)
    // Guarded so a grey, whose spread is 0, stays itself instead of 0 / 0 (#802).
    const low = sl.select(n.lt(0).and(l.sub(n).gt(0)), sl.vec3(l, l, l).add(c.sub(l).mul(l).div(max(l.sub(n), 1e-6))), c)
    // The high end is judged by the max before the low end moved, as Magerie's clipColor.
    return sl.select(x.gt(1).and(x.sub(l).gt(0)), sl.vec3(l, l, l).add(low.sub(l).mul(sl.float(1).sub(l)).div(max(x.sub(l), 1e-6))), low)
}

const setLum = (c: S, l: S): S => clipColor(c.add(l.sub(lum(c))))
const sat = (c: S): S => max(max(c.x, c.y), c.z).sub(min(min(c.x, c.y), c.z))

function setSat(c: S, s: S): S {
    const lo = min(min(c.x, c.y), c.z)
    const hi = max(max(c.x, c.y), c.z)
    return sl.select(hi.gt(lo), c.sub(lo).mul(s).div(max(hi.sub(lo), 1e-6)), sl.vec3(0, 0, 0))
}

function dodge(b: S, t: S): S {
    return sl.select(b.le(0), 0, sl.select(t.ge(1), 1, min(sl.float(1), b.div(max(sl.float(1).sub(t), 1e-6)))))
}

function burn(b: S, t: S): S {
    return sl.select(b.ge(1), 1, sl.select(t.le(0), 0, sl.float(1).sub(min(sl.float(1), sl.float(1).sub(b).div(max(t, 1e-6))))))
}

/** One channel of a separable mode: `b` the base, `t` the top, both gamma 0..1. */
function separable(mode: BlendMode, b: S, t: S): S {
    switch (mode) {
        case "multiply": return b.mul(t)
        case "screen": return sl.float(1).sub(sl.float(1).sub(b).mul(sl.float(1).sub(t)))
        case "overlay": return sl.select(b.lt(0.5), b.mul(t).mul(2), sl.float(1).sub(sl.float(1).sub(b).mul(sl.float(1).sub(t)).mul(2)))
        case "add": return b.add(t).clamp(0, 1)
        case "subtract": return b.sub(t).clamp(0, 1)
        case "softLight": {
            const d = sl.select(b.le(0.25), b.mul(16).sub(12).mul(b).add(4).mul(b), sl.sqrt(b))
            return sl.select(t.le(0.5),
                b.sub(sl.float(1).sub(t.mul(2)).mul(b).mul(sl.float(1).sub(b))),
                b.add(t.mul(2).sub(1).mul(d.sub(b))))
        }
        case "hardLight": return sl.select(t.lt(0.5), b.mul(t).mul(2), sl.float(1).sub(sl.float(1).sub(b).mul(sl.float(1).sub(t)).mul(2)))
        case "colorDodge": return dodge(b, t)
        case "colorBurn": return burn(b, t)
        case "darken": return min(b, t)
        case "lighten": return max(b, t)
        case "difference": return b.sub(t).abs()
        case "exclusion": return b.add(t).sub(b.mul(t).mul(2))
        case "vividLight": return sl.select(t.le(0.5), burn(b, t.mul(2)), dodge(b, t.sub(0.5).mul(2)))
        case "linearLight": return b.add(t.mul(2)).sub(1).clamp(0, 1)
        case "pinLight": return sl.select(t.le(0.5), min(b, t.mul(2)), max(b, t.mul(2).sub(1)))
        case "linearBurn": return b.add(t).sub(1).clamp(0, 1)
        default: return t
    }
}

function blendMix(mode: BlendMode, b: S, t: S): S {
    switch (mode) {
        case "hue": return setLum(setSat(t, sat(b)), lum(b))
        case "saturation": return setLum(setSat(b, sat(t)), lum(b))
        case "color": return setLum(t, lum(b))
        case "luminosity": return setLum(b, lum(t))
        default: return sl.vec3(separable(mode, b.x, t.x), separable(mode, b.y, t.y), separable(mode, b.z, t.z))
    }
}

/** Magerie's Blend: `base` below, `top` above, both premultiplied (spec 5.4). */
export function blend(s: Scope, base: Vec4, top: Vec4, mode: BlendMode, opacity: number): Vec4 {
    const t: S = top.mul(s.f(opacity).clamp(0, 1))
    const a: S = base
    const outA = t.w.add(a.w.mul(sl.float(1).sub(t.w)))
    if (mode === "normal") return sl.vec4(t.xyz.add(a.xyz.mul(sl.float(1).sub(t.w))), outA)
    const bs = unpremultiply(a)
    const ts = unpremultiply(t)
    const m = blendMix(mode, bs, ts)
    // W3C: where the base is clear, the top shows unblended.
    const mixed: S = ts.mul(sl.float(1).sub(a.w)).add(m.mul(a.w))
    return sl.vec4(mixed.mul(t.w).add(a.xyz.mul(sl.float(1).sub(t.w))), outA)
}

export interface LevelsValues { inputBlack: number, inputWhite: number, gamma: number, outputBlack: number, outputWhite: number }

/** Magerie's Levels (spec 5.2). */
export function levels(s: Scope, c: Vec4, v: LevelsValues): Vec4 {
    const ib = s.f(v.inputBlack), iw = s.f(v.inputWhite), g = s.f(v.gamma)
    const ob = s.f(v.outputBlack), ow = s.f(v.outputWhite)
    let x: S = unpremultiply(c)
    x = x.sub(ib).div(max(iw.sub(ib), 0.001)).clamp(0, 1)
    x = x.pow(sl.float(1).div(g))
    x = x.mul(ow.sub(ob)).add(ob).clamp(0, 1)
    return sl.vec4(x.mul(c.w), c.w)
}

export type InvertChannels = "rgb" | "r" | "g" | "b"

/** Magerie's Invert (MetalRenderer.mm applyInvert). */
export function invert(c: Vec4, channels: InvertChannels): Vec4 {
    const x: S = unpremultiply(c)
    const one = (k: S) => sl.float(1).sub(k)
    const y = channels === "rgb" ? one(x)
        : sl.vec3(channels === "r" ? one(x.x) : x.x, channels === "g" ? one(x.y) : x.y, channels === "b" ? one(x.z) : x.z)
    return sl.vec4(y.mul(c.w), c.w)
}

/** Stops for a gradient map, sorted, as gamma colours 0..1. */
export interface Stop { at: number, color: [number, number, number] }

/** Magerie's Gradient Map (spec 5.1): by Rec. 601 luma, interpolated in gamma RGB. */
export function gradientMap(s: Scope, c: Vec4, stops: readonly Stop[]): Vec4 {
    const l: S = luma601(unpremultiply(c))
    const at = stops.map((stop) => s.f(stop.at))
    const col = stops.map((stop) => s.f4([...stop.color, 1]).xyz)
    const last = stops.length - 1
    let out: S = col[last]
    let found: S = l.ge(at[last])
    // The first stop pair holding l, in order: later pairs only where no
    // earlier one did, as the kernel's forward search.
    out = sl.select(l.le(at[0]!), col[0], out)
    found = found.or(l.le(at[0]!))
    for (let i = 0; i < last; i++) {
        const span = at[i + 1]!.sub(at[i]!)
        const t = l.sub(at[i]!).div(max(span, 1e-6))
        const here = found.not().and(l.ge(at[i]!)).and(l.le(at[i + 1]!))
        out = sl.select(here, sl.mix(col[i], col[i + 1], t), out)
        found = found.or(here)
    }
    return sl.vec4(out.mul(c.w), c.w)
}

/** Lit colour in rgb, the height's first channel as alpha, straight: the Image Exporter's Alpha pack. */
export function alphaPack(color: Vec4, height: Vec4): Vec4 {
    return sl.vec4(unpremultiply(color), height.x)
}

// neighbourhoods (spec 4)

/** The pixel `p + offset` on one axis, wrapped `((p % n) + n) % n` or clamped to the edge. */
function edgeIndex(p: S, n: S, wrap: boolean): S {
    if (!wrap) return p.clamp(0, n.sub(1))
    return p.sub(n.mul(p.div(n).floor()))
}

/** Blur's Gaussian (spec 4.1): sigma radius / 3, taps -k..k with k = ceil(radius). */
export function blurGaussian(radius: number): { sigma: number, taps: number } {
    const r = Math.min(Math.max(radius, 0), 1000)
    return { sigma: Math.max(r / 3, 0.1), taps: Math.min(Math.max(Math.ceil(r), 1), 512) }
}

/** Normal Map's pre-smooth (spec 4.2): sigma radius / 2, k = int(radius + 0.5). Not Blur's. */
export function smoothGaussian(radius: number): { sigma: number, taps: number } {
    return { sigma: Math.max(radius / 2, 0.5), taps: Math.trunc(radius + 0.5) }
}

/** One pass of Magerie's separable Gaussian: weights exp(-i^2 / 2 sigma^2) over taps -k..k, normalised. */
export function blurAxis(s: Scope, src: TexRead, sigma: number, k: number, axis: "x" | "y", wrap: boolean): Vec4 {
    const twoSigma2 = s.f(2 * sigma * sigma)
    const kk = s.f(k)
    const n: S = axis === "x" ? src.size.x : src.size.y
    const [sum, weight] = sl.loop(
        [sl.vec4(0, 0, 0, 0), 0, sl.float(0).sub(kk)],
        (st: S[]) => st[2].le(kk),
        (st: S[]) => {
            const [acc, wsum, i] = st
            const w: S = sl.exp(i.mul(i).neg().div(twoSigma2))
            const along = edgeIndex((axis === "x" ? s.pixel.x : s.pixel.y).add(i), n, wrap)
            const at = axis === "x" ? sl.vec2(along, s.pixel.y) : sl.vec2(s.pixel.x, along)
            return [acc.add(src.fetch(at).mul(w)), wsum.add(w), i.add(1)]
        },
        1025,
    ) as S[]
    return sum.div(weight)
}

/** Magerie's Warp (spec 4.4): the displacement's own centre is neutral. */
export function warp(s: Scope, src: TexRead, displacement: TexRead, strength: number): Vec4 {
    const uv: S = s.pixel.add(0.5).div(s.size)
    const d: S = displacement.sample(uv)
    const neutral: S = displacement.sample(sl.vec2(0.5, 0.5))
    const offset = d.xy.sub(neutral.xy).mul(s.f(strength).mul(2)).div(s.size)
    return src.sample(uv.add(offset))
}

export interface TileValues { repeatX: number, repeatY: number, offsetX: number, offsetY: number, mirror: boolean }

/** Magerie's Tile (spec 7.1): nearest neighbour, at the input's size. */
export function tile(s: Scope, src: TexRead, v: TileValues): Vec4 {
    const repeat: S = sl.vec2(s.f(Math.trunc(v.repeatX)), s.f(Math.trunc(v.repeatY)))
    const t: S = s.pixel.div(s.size).mul(repeat).sub(sl.vec2(s.f(v.offsetX), s.f(v.offsetY)))
    const i: S = t.floor()
    let f: S = t.sub(i)
    if (v.mirror) {
        const flipped: S = max(sl.vec2(0, 0), sl.vec2(1, 1).sub(f).sub(repeat.div(s.size)))
        const odd = (c: S): S => c.sub(c.mul(0.5).floor().mul(2)).gt(0.5)
        f = sl.vec2(sl.select(odd(i.x), flipped.x, f.x), sl.select(odd(i.y), flipped.y, f.y))
    }
    const at: S = min(f.mul(src.size).floor(), src.size.sub(1))
    return src.fetch(at)
}

// delivery

/**
 * The last pass's colour, for the texture a mesh reads: straight, and in
 * linear light, so the copy into an sRGB texture stores the bytes Magerie
 * stores. Alpha is data (a height, a mask) and stays as it is.
 */
export function deliver(c: Vec4, straight: boolean): Vec4 {
    const rgb = straight ? c.xyz : unpremultiply(c)
    return sl.vec4(sl.toLinear(rgb), c.w)
}

// height filters (spec 4.2, 4.3 and section 6). Each reads height as the
// Rec. 601 luma of the stored values, premultiplied and gamma, as Magerie's do.

const luma = (c: S): S => c.xyz.dot(sl.vec3(0.299, 0.587, 0.114))

/** The 3 x 3 neighbourhood's heights around `pixel`, at texel centres, wrapped or clamped. */
function heights3(src: TexRead, pixel: S, wrap: boolean, read: (c: S) => S = luma): S[][] {
    const rows: S[][] = []
    for (let dy = -1; dy <= 1; dy++) {
        const row: S[] = []
        for (let dx = -1; dx <= 1; dx++) {
            const x = edgeIndex(pixel.x.add(dx), src.size.x, wrap)
            const y = edgeIndex(pixel.y.add(dy), src.size.y, wrap)
            row.push(read(src.fetch(sl.vec2(x, y))))
        }
        rows.push(row)
    }
    return rows
}

/** Sobel, y down: dx = right - left columns, dy = bottom - top rows. */
function sobel(h: S[][]): [S, S] {
    const [[tl, t, tr], [l, , r], [bl, b, br]] = h as [[S, S, S], [S, S, S], [S, S, S]]
    const dx = tr.add(r.mul(2)).add(br).sub(tl.add(l.mul(2)).add(bl))
    const dy = bl.add(b.mul(2)).add(br).sub(tl.add(t.mul(2)).add(tr))
    return [dx, dy]
}

/** Magerie's Normal Map, after any pre-smooth (spec 4.2): OpenGL green up unless flipped. */
export function normalMap(s: Scope, src: TexRead, strength: number, flipY: boolean, wrap: boolean): Vec4 {
    const [dx, dy] = sobel(heights3(src, s.pixel, wrap))
    const k = s.f(strength)
    const n: S = sl.vec3(dx.mul(k).neg(), dy.mul(k).mul(flipY ? 1 : -1), 1).normalize()
    return sl.vec4(n.mul(0.5).add(0.5), 1)
}

export type CurvatureMode = "both" | "convex" | "concave"

/** Magerie's Curvature: a weighted Laplacian of the height. */
export function curvature(s: Scope, src: TexRead, intensity: number, mode: CurvatureMode, wrap: boolean): Vec4 {
    const [[tl, t, tr], [l, c, r], [bl, b, br]] = heights3(src, s.pixel, wrap) as [[S, S, S], [S, S, S], [S, S, S]]
    const lap: S = tl.add(t.mul(2)).add(tr).add(l.mul(2)).sub(c.mul(12)).add(r.mul(2)).add(bl).add(b.mul(2)).add(br).mul(s.f(intensity))
    const res: S = mode === "both" ? lap.neg().mul(0.5).add(0.5) : mode === "convex" ? max(0, lap.neg()) : max(0, lap)
    const g = res.saturate()
    return sl.vec4(g, g, g, 1)
}

/** Magerie's Histogram Scan: a smoothstep window over the height. */
export function histogramScan(s: Scope, c: Vec4, position: number, contrast: number): Vec4 {
    const v = luma(c)
    const half: S = max(sl.float(1).sub(s.f(contrast)).mul(0.5), 1e-5)
    const p = s.f(position)
    const t: S = sl.smoothstep(p.sub(half), p.add(half), v)
    return sl.vec4(t, t, t, 1)
}

export type SlopeBlurMode = "blur" | "max" | "min"

/** Magerie's Slope Blur (spec 4.3): walks uphill on the slope's red, gathering the source. */
export function slopeBlur(s: Scope, src: TexRead, slope: TexRead, intensity: number, samples: number, mode: SlopeBlurMode): Vec4 {
    const n = Math.min(Math.max(Math.round(samples), 1), 64)
    const texel: S = sl.vec2(1, 1).div(src.size)
    const step: S = texel.mul(s.f(Math.max(0, intensity) / Math.max(n - 1, 1)))
    const red = (o: S): S => slope.sample(o).x
    const [acc] = sl.loop(
        [mode === "min" ? sl.vec4(1, 1, 1, 1) : sl.vec4(0, 0, 0, 0), s.pixel.add(0.5).div(s.size), 0],
        (st: S[]) => st[2].lt(s.f(n)),
        (st: S[]) => {
            const [a, p, i] = st as [S, S, S]
            const c = src.sample(p)
            const next = mode === "blur" ? a.add(c) : mode === "max" ? a.max(c) : a.min(c)
            const h: S[][] = []
            for (let dy = -1; dy <= 1; dy++) {
                const row: S[] = []
                for (let dx = -1; dx <= 1; dx++) row.push(red(p.add(sl.vec2(dx, dy).mul(texel))))
                h.push(row)
            }
            const [gx, gy] = sobel(h)
            const g: S = sl.vec2(gx, gy)
            const len: S = g.length()
            const moved = sl.select(len.gt(1e-6), p.add(g.div(max(len, 1e-6)).mul(step)), p)
            return [next, moved, i.add(1)]
        },
        64,
    ) as S[]
    return mode === "blur" ? acc.div(n) : acc
}

/** Magerie's Ambient Occlusion: horizon angles in N directions, rotated per pixel by interleaved gradient noise. */
export function ambientOcclusion(s: Scope, src: TexRead, radius: number, intensity: number, samples: number): Vec4 {
    const PI = 3.14159265
    const uv: S = s.pixel.add(0.5).div(s.size)
    const texel: S = sl.vec2(1, 1).div(src.size)
    const centre = luma(src.sample(uv))
    const N = Math.trunc(samples)
    const angleStep = (2 * PI) / N
    const steps = Math.max(1, Math.trunc(radius))
    const R = s.f(radius)
    // Interleaved gradient noise on the integer pixel, no + 0.5.
    const ign: S = s.pixel.x.mul(0.06711056).add(s.pixel.y.mul(0.00583715)).fract().mul(52.9829189).fract()
    const rotation = ign.mul(angleStep)
    const [occlusion] = sl.loop(
        [0, 0],
        (st: S[]) => st[1].lt(s.f(N)),
        (st: S[]) => {
            const [occ, d] = st as [S, S]
            const angle: S = d.mul(s.f(angleStep)).add(rotation)
            const dir: S = sl.vec2(sl.cos(angle), sl.sin(angle))
            const dirLen: S = dir.mul(texel).length()
            const [maxAngle] = sl.loop(
                [0, 1],
                (inner: S[]) => inner[1].le(s.f(steps)),
                (inner: S[]) => {
                    const [m, k] = inner as [S, S]
                    const t: S = max(k.sub(1).add(ign).div(steps), 0.25 / steps)
                    const h = luma(src.sample(uv.add(dir.mul(texel).mul(R).mul(t))))
                    return [max(m, sl.atan2(h.sub(centre), R.mul(t).mul(dirLen))), k.add(1)]
                },
                64,
            ) as S[]
            return [occ.add(sl.sin(maxAngle.clamp(0, PI / 2))), d.add(1)]
        },
        64,
    ) as S[]
    const ao: S = sl.float(1).sub(occlusion.div(N).mul(s.f(intensity))).saturate()
    return sl.vec4(ao, ao, ao, 1)
}
