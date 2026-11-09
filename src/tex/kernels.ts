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
export interface Stop { at: number, color: [number, number, number], /** The colour's alpha: Gradient uses it, Gradient Map does not. */ alpha: number }

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

// curves (spec 5.3; magerie-one js/src/nodes/filters/curves/toneCurve.ts)

/**
 * Magerie's tone curve as its 256-entry table: a Fritsch-Carlson monotone
 * cubic through `points`, sampled at i / 255 and rounded to bytes. Computed
 * here in doubles exactly as Magerie computes it before uploading it, so the
 * table is Magerie's to the byte and only the lookup runs on the GPU.
 */
export function toneTable(points: readonly (readonly [number, number])[]): Uint8Array {
    const sorted = points.slice().sort((a, b) => a[0] - b[0])
    const n = sorted.length
    const x = sorted.map((p) => p[0]), y = sorted.map((p) => p[1])
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
    let sample: (t: number) => number
    if (n === 0) sample = clamp01
    else if (n === 1) sample = () => clamp01(y[0]!)
    else {
        const delta = new Float64Array(n - 1)
        for (let i = 0; i < n - 1; i++) {
            const dx = x[i + 1]! - x[i]!
            delta[i] = dx > 1e-12 ? (y[i + 1]! - y[i]!) / dx : 0
        }
        // Tangents: the mean of the secants either side, the end secants at the ends.
        const m = new Float64Array(n)
        m[0] = delta[0]!
        m[n - 1] = delta[n - 2]!
        for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1]! + delta[i]!) / 2
        // Fritsch-Carlson: a flat secant flattens both ends, and steep tangents are scaled back so no segment overshoots.
        for (let i = 0; i < n - 1; i++) {
            if (Math.abs(delta[i]!) < 1e-12) { m[i] = 0; m[i + 1] = 0; continue }
            const a = m[i]! / delta[i]!, b = m[i + 1]! / delta[i]!
            const sum = a * a + b * b
            if (sum > 9) {
                const tau = 3 / Math.sqrt(sum)
                m[i] = tau * a * delta[i]!
                m[i + 1] = tau * b * delta[i]!
            }
        }
        sample = (t) => {
            if (t <= x[0]!) return clamp01(y[0]!)
            if (t >= x[n - 1]!) return clamp01(y[n - 1]!)
            let j = 0
            for (let i = 0; i < n - 1; i++) if (t >= x[i]! && t < x[i + 1]!) { j = i; break }
            const h = x[j + 1]! - x[j]!
            const s = h > 1e-12 ? (t - x[j]!) / h : 0
            const s2 = s * s, s3 = s2 * s
            return clamp01((2 * s3 - 3 * s2 + 1) * y[j]! + (s3 - 2 * s2 + s) * h * m[j]! + (-2 * s3 + 3 * s2) * y[j + 1]! + (s3 - s2) * h * m[j + 1]!)
        }
    }
    const table = new Uint8Array(256)
    for (let i = 0; i < 256; i++) table[i] = Math.max(0, Math.min(255, Math.round(sample(i / 255) * 255)))
    return table
}

export type CurvesChannel = "rgb" | "red" | "green" | "blue"

/**
 * Magerie's Curves: each chosen channel's PREMULTIPLIED value looked up in
 * the table, alpha untouched. Magerie truncates `v * 255`; a tex value is
 * always a stored byte over 255, so rounding finds the same entry without
 * trusting a GPU's `k / 255 * 255` to land on k.
 */
export function curves(c: Vec4, table: TexRead, channel: CurvesChannel): Vec4 {
    const look = (v: Float): Float => table.fetch(sl.vec2(v.mul(255).add(0.5).floor().clamp(0, 255), 0)).x
    return sl.vec4(
        channel === "rgb" || channel === "red" ? look(c.x) : c.x,
        channel === "rgb" || channel === "green" ? look(c.y) : c.y,
        channel === "rgb" || channel === "blue" ? look(c.z) : c.z,
        c.w,
    )
}

// auto levels (spec 6, autoLevels)

export type AutoLevelsMode = "luminance" | "perChannel"

/**
 * What Auto Levels reduces, per pixel: the histogram bins it counts, packed
 * so ONE running minimum finds both ends. A maximum is kept as the minimum of
 * `1 - bin`. Luminance packs (min, 1 - max) once; per channel needs two
 * reductions, `"low"` (rMin, gMin, bMin, 1 - rMax) and `"high"`
 * (1 - gMax, 1 - bMax). A pixel Magerie skips (alpha under half a level)
 * reads 1 everywhere, which a minimum ignores; an image of nothing else ends
 * with min 1 and max 0, read as Magerie's empty histogram.
 */
export type RangeKey = "luma" | "low" | "high"

function rangeKey(c: Vec4, key: RangeKey): Vec4 {
    // Bins as Magerie counts them: Metal's round(straight * 255), half away from zero, clamped.
    const bin = (v: S): S => v.mul(255).add(0.5).floor().clamp(0, 255).div(255)
    const st: S = c.xyz.div(max(c.w, 1e-5))
    const one = (v: S): S => sl.float(1).sub(v)
    let k: S
    if (key === "luma") { const l = bin(st.dot(sl.vec3(0.299, 0.587, 0.114))); k = sl.vec4(l, one(l), 1, 1) }
    else if (key === "low") { const b = bin(st); k = sl.vec4(b.x, b.y, b.z, one(b.x)) }
    else { const b = bin(st); k = sl.vec4(one(b.y), one(b.z), 1, 1) }
    return sl.select(c.w.lt(0.5 / 255), sl.vec4(1, 1, 1, 1), k) as Vec4
}

/**
 * A 4 by 4 block's minimum, one texel of an image a quarter the size: the
 * step Auto Levels repeats down to one texel. The first step reads the
 * picture and keys it; the rest read keys. A block past the edge repeats the
 * edge texel, which a minimum does not notice.
 */
export function rangeStep(s: Scope, src: TexRead, key: RangeKey | null): Vec4 {
    const last: S = src.size.sub(1)
    let m: S
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            const p: S = s.pixel.mul(4).add(sl.vec2(x, y)).min(last)
            const t: S = src.fetch(p)
            const v = key === null ? t : rangeKey(t, key)
            m = m === undefined ? v : m.min(v)
        }
    }
    return m
}

/** Magerie's Auto Levels remap, on the PREMULTIPLIED colour (spec 6), from the reduced ranges. */
export function autoLevels(c: Vec4, low: TexRead, high: TexRead | null, mode: AutoLevelsMode): Vec4 {
    const origin = sl.vec2(0, 0)
    const a: S = low.fetch(origin)
    let lo: S, hi: S
    if (mode === "luminance") { lo = a.x; hi = sl.float(1).sub(a.y) }
    else { const b: S = high!.fetch(origin); lo = a.xyz; hi = sl.vec3(sl.float(1).sub(a.w), sl.float(1).sub(b.x), sl.float(1).sub(b.y)) }
    // An empty histogram is [0, 0].
    const empty: S = (mode === "luminance" ? lo : lo.x).gt(mode === "luminance" ? hi : hi.x)
    lo = sl.select(empty, mode === "luminance" ? sl.float(0) : sl.vec3(0, 0, 0), lo)
    hi = sl.select(empty, mode === "luminance" ? sl.float(0) : sl.vec3(0, 0, 0), hi)
    if (mode === "luminance") {
        const range: S = hi.sub(lo)
        const rgb: S = sl.select(range.lt(1 / 1024), sl.vec3(0.5, 0.5, 0.5), c.xyz.sub(lo).div(max(range, 1 / 1024)).clamp(0, 1))
        return sl.vec4(rgb, c.w)
    }
    const range: S = hi.sub(lo).max(1 / 255)
    return sl.vec4(c.xyz.sub(lo).div(range).clamp(0, 1), c.w)
}

// directional warp (spec 6, directionalWarp)

/** Magerie's Directional Warp: the source read `map.r * intensity` pixels along `angle` (0 right, 90 down), bilinear. */
export function directionalWarp(s: Scope, src: TexRead, map: TexRead, angle: number, intensity: number, bothWays: boolean): Vec4 {
    const uv: S = s.pixel.add(0.5).div(s.size)
    const rad = s.f(angle).mul(3.14159265358979 / 180)
    const dir = sl.vec2(sl.cos(rad), sl.sin(rad))
    let m: S = map.sample(uv).x
    if (bothWays) {
        const half = 0.5 / 255
        const d: S = m.sub(0.5)
        m = sl.sign(d).mul(max(d.abs().sub(half), 0)).div(0.5 - half)
    }
    return src.sample(uv.add(dir.mul(m).mul(s.f(intensity)).div(s.size)))
}

// material light (spec 8.2; magerie-one js/src/nodes/material/litPreview.ts)

/** A Material channel: a picture, or a scalar slider stored as one byte (spec 8.1: 0.5 is 128 / 255). */
export type Channel = TexRead | number

export interface LightValues { angle: number, elevation: number, strength: number, ambient: number }

/** Magerie's Material Light: Blinn-Phong with Toksvig, in gamma 2.2 (not the sRGB curve). */
export function materialLight(
    s: Scope, albedo: TexRead, normal: TexRead | null,
    ch: { roughness: Channel, metallic: Channel, ao: Channel, emissive: TexRead | null, opacity: Channel },
    v: LightValues,
): Vec4 {
    const uv: S = s.pixel.add(0.5).div(s.size)
    const at = (t: TexRead): S => t.sample(uv)
    const data = (c: Channel): S => typeof c === "number" ? s.f(Math.round(Math.min(Math.max(c, 0), 1) * 255) / 255) : at(c).x
    const deg = Math.PI / 180
    const az = s.f(v.angle).mul(deg), el = s.f(v.elevation).mul(deg)
    const L: S = sl.vec3(sl.cos(az).mul(sl.cos(el)), sl.sin(az).mul(sl.cos(el)), sl.sin(el))
    const unpack = (n: S): S => sl.vec3(n.x.mul(2).sub(1), sl.float(1).sub(n.y).mul(2).sub(1), n.z.mul(2).sub(1)).normalize()
    // An unwired normal is RGBA8 (128, 128, 255): a hair off flat, and the same in all nine taps.
    const flat = sl.vec3(128 / 255, 128 / 255, 1)
    const N: S = unpack(normal === null ? flat : at(normal))
    let navg: S
    if (normal === null) navg = unpack(flat).length()
    else {
        let sum: S
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const n = unpack(normal.sample(uv.add(sl.vec2(dx, dy).div(normal.size))))
                sum = sum === undefined ? n : sum.add(n)
            }
        }
        navg = sum.div(9).length()
    }
    const A: S = at(albedo)
    const straight: S = sl.select(A.w.gt(0), A.xyz.div(max(A.w, 1e-6)), sl.vec3(0, 0, 0))
    const alb: S = straight.max(0).pow(2.2)
    const rough: S = data(ch.roughness).clamp(0.04, 1)
    const metal: S = data(ch.metallic).clamp(0, 1)
    const ao: S = data(ch.ao).clamp(0, 1)
    const opacity: S = data(ch.opacity).clamp(0, 1)
    const emissive: S = ch.emissive === null ? sl.vec3(0, 0, 0) : at(ch.emissive).xyz.max(0).pow(2.2)
    const diffuseC: S = alb.mul(sl.float(1).sub(metal))
    const specC: S = sl.mix(sl.vec3(0.04, 0.04, 0.04), alb, metal)
    const H: S = L.add(sl.vec3(0, 0, 1)).normalize()
    let shin: S = sl.float(2).pow(sl.float(1).sub(rough).mul(10).add(1)).min(512)
    shin = shin.mul(navg).div(sl.float(1).add(shin.mul(sl.float(1).sub(navg))))
    const spec: S = max(N.dot(H), 0).pow(shin).mul(shin.add(8)).div(8)
    const NL: S = max(N.dot(L), 0)
    const strength = s.f(v.strength), ambient = s.f(v.ambient)
    let color: S = diffuseC.mul(NL.mul(strength).add(ambient.mul(ao)))
        .add(specC.mul(spec).mul(NL).mul(strength))
        .add(alb.mul(ambient.mul(ao).mul(metal)))
        .add(emissive)
    // A soft shoulder above 0.8, per channel.
    const K = 0.8
    const over: S = sl.float(K).add(sl.float(1 - K).mul(sl.float(1).sub(sl.exp(color.sub(K).div(1 - K).neg()))))
    // Per channel without a vector bool: the step is 1 above K, and at K both sides are K.
    color = sl.mix(color, over, sl.sign(color.sub(K)).max(0))
    color = color.clamp(0, 1).pow(1 / 2.2)
    const a: S = A.w.mul(opacity)
    return sl.vec4(color.mul(a), a)
}

// gradient and solid colour (magerie-one MetalRenderer+Gradient.mm:96-186)

export type GradientType = "linear" | "radial" | "angular"

/** Magerie's 4 by 4 Bayer dither (MetalRenderer.mm:1094-1104): a level's worth of ordered noise on rgb. */
function dither8(s: Scope, rgb: S): S {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    const x: S = s.pixel.x.sub(s.pixel.x.div(4).floor().mul(4))
    const y: S = s.pixel.y.sub(s.pixel.y.div(4).floor().mul(4))
    const idx: S = y.mul(4).add(x)
    // A 16-entry table by index, as a chain of selects on whole numbers.
    let b: S = sl.float(bayer[15]!)
    for (let i = 14; i >= 0; i--) b = sl.select(idx.lt(i + 0.5), sl.float(bayer[i]!), b)
    return rgb.add(b.div(16).sub(0.5).div(255)).saturate()
}

/** Magerie's Gradient generator: premultiplied stops, interpolated premultiplied, dithered unless every stop is one colour. */
export function gradient(s: Scope, type: GradientType, stops: readonly Stop[], angle: number, center: [number, number]): Vec4 {
    const uv: S = s.pixel.add(0.5).div(s.size)
    let t: S
    if (type === "linear") {
        const p: S = uv.sub(0.5)
        const a = s.f(angle * Math.PI / 180)
        t = p.x.mul(sl.cos(a)).add(p.y.mul(sl.sin(a))).add(0.5)
    } else {
        const d: S = uv.sub(sl.vec2(s.f(center[0]), s.f(center[1])))
        if (type === "radial") t = d.length().mul(2).clamp(0, 1)
        else {
            const tau = 2 * 3.14159265359
            const at = atan2(d.y, d.x)
            t = at.add(3.14159265359).div(tau).add(s.f(angle * Math.PI / 180).div(tau)).fract()
        }
    }
    t = t.clamp(0, 1)
    const at = stops.map((stop) => s.f(stop.at))
    const col = stops.map((stop) => s.f4([stop.color[0] * stop.alpha, stop.color[1] * stop.alpha, stop.color[2] * stop.alpha, stop.alpha]))
    const last = stops.length - 1
    let out: S = col[last]
    let found: S = t.ge(at[last])
    out = sl.select(t.le(at[0]!), col[0], out)
    found = found.or(t.le(at[0]!))
    for (let i = 0; i < last; i++) {
        const span = at[i + 1]!.sub(at[i]!)
        const f: S = sl.select(span.gt(0), t.sub(at[i]!).div(max(span, 1e-9)), sl.float(0))
        const here = found.not().and(t.ge(at[i]!)).and(t.le(at[i + 1]!))
        out = sl.select(here, sl.mix(col[i], col[i + 1], f), out)
        found = found.or(here)
    }
    const flat = stops.every((p) => p.color.every((c, i) => c === stops[0]!.color[i]) && p.alpha === stops[0]!.alpha)
    const rgb: S = flat ? out.xyz : dither8(s, out.xyz).min(out.w)
    return sl.vec4(rgb, out.w)
}

/** atan2 from atan's quadrants, which the shader language spells as asin and acos only. */
function atan2(y: S, x: S): S {
    const r: S = max(sl.vec2(x, y).length(), 1e-20)
    // acos(x / r) is the angle from +x, 0 to pi; its sign comes from y.
    const a: S = sl.acos(x.div(r).clamp(-1, 1))
    return sl.select(y.lt(0), a.neg(), a)
}

// hsl adjust (MetalRenderer.mm:5339-5389, 2287-2334)

export interface HslValues { hue: number, saturation: number, lightness: number, targetHue: number, targetRange: number, targetFalloff: number }

function rgb2hsl(c: S): S {
    const mx: S = max(max(c.x, c.y), c.z), mn: S = c.x.min(c.y).min(c.z)
    const l: S = mx.add(mn).div(2)
    const d: S = mx.sub(mn)
    const dd: S = max(d, 1e-9)
    const sat: S = sl.select(l.gt(0.5), d.div(max(sl.float(2).sub(mx).sub(mn), 1e-9)), d.div(max(mx.add(mn), 1e-9)))
    const hr: S = c.y.sub(c.z).div(dd).add(sl.select(c.y.lt(c.z), sl.float(6), sl.float(0)))
    const hg: S = c.z.sub(c.x).div(dd).add(2)
    const hb: S = c.x.sub(c.y).div(dd).add(4)
    const h: S = sl.select(mx.eq(c.x), hr, sl.select(mx.eq(c.y), hg, hb)).div(6)
    const grey: S = mx.eq(mn)
    return sl.vec3(sl.select(grey, sl.float(0), h), sl.select(grey, sl.float(0), sat), l)
}

function hue2rgb(p: S, q: S, t0: S): S {
    let t: S = sl.select(t0.lt(0), t0.add(1), t0)
    t = sl.select(t.gt(1), t.sub(1), t)
    const a: S = p.add(q.sub(p).mul(6).mul(t))
    const c: S = p.add(q.sub(p).mul(sl.float(2 / 3).sub(t)).mul(6))
    return sl.select(t.lt(1 / 6), a, sl.select(t.lt(0.5), q, sl.select(t.lt(2 / 3), c, p)))
}

/** Magerie's HSL Adjust: hue turns, saturation and lightness ADD, weighted by the target band; on straight colour. */
export function hslAdjust(s: Scope, c: Vec4, v: HslValues): Vec4 {
    if (v.hue === 0 && v.saturation === 0 && v.lightness === 0) return c
    const x: S = unpremultiply(c).clamp(0, 1)
    const hsl: S = rgb2hsl(x)
    let w: S = sl.float(1)
    if (v.targetRange < 180) {
        let dist: S = hsl.x.mul(360).sub(s.f(v.targetHue)).abs()
        dist = sl.select(dist.gt(180), sl.float(360).sub(dist), dist)
        const range = s.f(v.targetRange), fw = v.targetRange * v.targetFalloff
        const soft: S = fw <= 0 ? sl.float(0)
            : sl.select(dist.ge(range.add(fw)), sl.float(0), sl.cos(dist.sub(range).div(fw).mul(Math.PI)).add(1).mul(0.5))
        w = sl.select(dist.le(range), sl.float(1), soft)
    }
    let h: S = hsl.x.add(s.f(v.hue / 360).mul(w))
    h = sl.select(h.lt(0), h.add(1), sl.select(h.gt(1), h.sub(1), h))
    const S2: S = hsl.y.add(s.f(v.saturation).mul(w)).clamp(0, 1)
    const L: S = hsl.z.add(s.f(v.lightness).mul(w)).clamp(0, 1)
    const q: S = sl.select(L.lt(0.5), L.mul(sl.float(1).add(S2)), L.add(S2).sub(L.mul(S2)))
    const p: S = L.mul(2).sub(q)
    const rgb: S = sl.select(S2.eq(0), sl.vec3(L, L, L),
        sl.vec3(hue2rgb(p, q, h.add(1 / 3)), hue2rgb(p, q, h), hue2rgb(p, q, h.sub(1 / 3)))).clamp(0, 1)
    return sl.vec4(rgb.mul(c.w), c.w)
}

// mask, channel math, alpha merge

/** Magerie's Mask: every premultiplied channel scaled by the mask's straight luma times its alpha. */
export function mask(c: Vec4, m: Vec4, invert: boolean): Vec4 {
    let l: S = luma601(unpremultiply(m)).mul(m.w)
    if (invert) l = sl.float(1).sub(l)
    return c.mul(l)
}

export type ChannelMathOp = "add" | "subtract" | "multiply" | "screen" | "overlay" | "difference" | "divide"
export type ChannelMathChannels = "rgb" | "rgba" | "r" | "g" | "b" | "a"

/** Magerie's Channel Math, on the stored (premultiplied) values, clamped, where `channels` says; A elsewhere. */
export function channelMath(a: Vec4, b: Vec4, op: ChannelMathOp, channels: ChannelMathChannels): Vec4 {
    const one = sl.vec4(1, 1, 1, 1)
    let r: S
    switch (op) {
        case "add": r = a.add(b); break
        case "subtract": r = a.sub(b); break
        case "multiply": r = a.mul(b); break
        case "screen": r = one.sub(one.sub(a).mul(one.sub(b))); break
        case "overlay": r = sl.mix(a.mul(b).mul(2), one.sub(one.sub(a).mul(one.sub(b)).mul(2)), sl.sign(a.sub(0.5)).add(1).min(1)); break
        case "difference": r = a.sub(b).abs(); break
        case "divide": {
            const q: S = a.div(b.max(1 / 255)).min(1)
            // b under half a level divides to 1, per channel without a vector bool.
            r = sl.mix(q, one, sl.sign(sl.vec4(0.5 / 255, 0.5 / 255, 0.5 / 255, 0.5 / 255).sub(b)).max(0))
            break
        }
    }
    const m = { rgba: [1, 1, 1, 1], rgb: [1, 1, 1, 0], r: [1, 0, 0, 0], g: [0, 1, 0, 0], b: [0, 0, 1, 0], a: [0, 0, 0, 1] }[channels]
    return sl.mix(a, r.clamp(0, 1), sl.vec4(m[0]!, m[1]!, m[2]!, m[3]!)) as Vec4
}

export type AlphaChannel = "luma" | "red" | "alpha"

/** Magerie's Alpha Merge: the RGB as stored, times a new alpha from the second picture. Stored at 16 bits, not 8. */
export function alphaMerge(rgb: Vec4, src: Vec4, channel: AlphaChannel): Vec4 {
    const alpha: S = channel === "red" ? src.x : channel === "alpha" ? src.w : src.xyz.dot(sl.vec3(0.299, 0.587, 0.114))
    return sl.vec4(rgb.xyz.mul(alpha), alpha)
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

// the SDF group (MetalRenderer.mm generateSDFShape, applyThreshold,
// applyComposite; _jfaDistance.ts; channelShuffle's generated kernel)

export type ShapeType = "circle" | "ellipse" | "vesica"

/** Shape's parameters as its kernel takes them: packShapeParams' A and B, rotation as its cosine and sine. */
export interface ShapeValues {
    shape: ShapeType
    a: number
    b: number
    cos: number
    sin: number
    offset: [number, number]
    edgeBand: number
    fill: number[]
    edge: number[]
    background: number[]
}

/** IQ's ellipse as Magerie's Metal has it, both branches drawn and one kept. */
function sdEllipse(p: S, a: S, b: S): S {
    const pa = p.abs()
    const swap = pa.x.gt(pa.y)
    const px: S = sl.select(swap, pa.y, pa.x), py: S = sl.select(swap, pa.x, pa.y)
    const ax: S = sl.select(swap, b, a), ay: S = sl.select(swap, a, b)
    const l: S = ay.mul(ay).sub(ax.mul(ax))
    const m: S = ax.mul(px).div(l), m2: S = m.mul(m)
    const n: S = ay.mul(py).div(l), n2: S = n.mul(n)
    const c: S = m2.add(n2).sub(1).div(3), c3: S = c.mul(c).mul(c)
    const q: S = c3.add(m2.mul(n2).mul(2))
    const d: S = c3.add(m2.mul(n2))
    const g: S = m.add(m.mul(n2))
    const root3 = Math.sqrt(3)
    // d < 0
    const h1: S = sl.acos(q.div(c3)).div(3)
    const s1: S = sl.cos(h1), t1: S = sl.sin(h1).mul(root3)
    const rx1: S = sl.sqrt(c.neg().mul(s1.add(t1).add(2)).add(m2))
    const ry1: S = sl.sqrt(c.neg().mul(s1.sub(t1).add(2)).add(m2))
    const co1: S = ry1.add(sl.sign(l).mul(rx1)).add(g.abs().div(rx1.mul(ry1))).sub(m).div(2)
    // d >= 0
    const h2: S = m.mul(n).mul(2).mul(sl.sqrt(d))
    const cube = (v: S): S => sl.sign(v).mul(v.abs().pow(1 / 3))
    const s2: S = cube(q.add(h2)), u2: S = cube(q.sub(h2))
    const rx2: S = s2.neg().sub(u2).sub(c.mul(4)).add(m2.mul(2))
    const ry2: S = s2.sub(u2).mul(root3)
    const rm: S = sl.sqrt(rx2.mul(rx2).add(ry2.mul(ry2)))
    const co2: S = ry2.div(sl.sqrt(rm.sub(rx2))).add(g.mul(2).div(rm)).sub(m).div(2)
    const co: S = sl.select(d.lt(0), co1, co2)
    const r2: S = sl.vec2(ax.mul(co), ay.mul(sl.sqrt(sl.float(1).sub(co.mul(co)))))
    const pp: S = sl.vec2(px, py)
    return r2.sub(pp).length().mul(sl.sign(py.sub(r2.y)))
}

/** IQ's vesica as Magerie's Metal has it: w the half width, h the half height. */
function sdVesica(p: S, w: number, h: number): S {
    const d = 0.5 * (w * w - h * h) / h
    const q: S = p.abs()
    const tip: S = sl.vec2(q.x.sub(w), q.y).length()
    const arc: S = sl.vec2(q.x, q.y.add(d)).length().sub(d + h)
    return sl.select(q.y.mul(w).lt(q.x.sub(w).mul(d)), tip, arc)
}

/** Magerie's Shape (generateSDFShape): uv from the pixel's corner, both axes on [-1, 1], 1.5 px of antialiasing, premultiplied. */
export function sdfShape(s: Scope, v: ShapeValues): Vec4 {
    const uv: S = s.pixel.div(s.size).sub(0.5).mul(2).sub(sl.vec2(s.f(v.offset[0] * 2), s.f(v.offset[1] * 2)))
    const c = s.f(v.cos), n = s.f(v.sin)
    const p: S = sl.vec2(uv.x.mul(c).add(uv.y.mul(n)), uv.x.neg().mul(n).add(uv.y.mul(c)))
    const A = s.f(v.a), B = s.f(v.b)
    let d: S
    if (v.shape === "circle") d = p.length().sub(A)
    // Magerie's near-circle guard, decided where the sizes are known.
    else if (v.shape === "ellipse") d = Math.abs(v.a - v.b) / Math.max(v.a, v.b, 1e-10) < 0.001 ? p.length().sub(s.f((v.a + v.b) / 2)) : sdEllipse(p, A, B)
    else d = sdVesica(p, v.a, v.b)
    const aa: S = sl.float(3).div(min(s.size.x, s.size.y))
    const inside: S = sl.float(1).sub(sl.smoothstep(aa.neg(), aa, d))
    let color: S = sl.mix(s.f4(v.background), s.f4(v.fill), inside)
    if (v.edgeBand > 0) {
        const eb = s.f(v.edgeBand)
        const edge: S = sl.smoothstep(eb.neg().sub(aa), eb.neg(), d).mul(sl.float(1).sub(sl.smoothstep(eb, eb.add(aa), d)))
        color = sl.mix(color, s.f4(v.edge), edge)
    }
    return sl.vec4(color.xyz.mul(color.w), color.w)
}

/** Where Channel Shuffle takes each output channel from: one of the stored channels, or a constant. */
export type ChannelSource = "r" | "g" | "b" | "a" | "0" | "1"

/** Magerie's Channel Shuffle: the stored (premultiplied) channels as they are, rearranged. */
export function channelShuffle(c: Vec4, out: readonly ChannelSource[]): Vec4 {
    const pick = (k: ChannelSource): S => (k === "0" ? 0 : k === "1" ? 1 : (c as S)[k === "r" ? "x" : k === "g" ? "y" : k === "b" ? "z" : "w"])
    return sl.vec4(pick(out[0]!), pick(out[1]!), pick(out[2]!), pick(out[3]!))
}

/** Magerie's Threshold (applyThreshold): luma of the straight colour, hard or smoothstepped, alpha kept. */
export function threshold(s: Scope, c: Vec4, at: number, smoothness: number): Vec4 {
    const lum: S = unpremultiply(c).dot(sl.vec3(0.299, 0.587, 0.114))
    const t = s.f(at)
    const value: S = smoothness > 0.0001
        ? sl.smoothstep(t.sub(s.f(smoothness)), t.add(s.f(smoothness)), lum)
        : sl.select(lum.ge(t), sl.float(1), sl.float(0))
    return sl.vec4(sl.vec3(value, value, value).mul(c.w), c.w)
}

/** Premultiplied Porter-Duff over: Magerie's Composite, one layer at a time. */
export function over(base: Vec4, layer: Vec4): Vec4 {
    const keep: S = sl.float(1).sub(layer.w)
    return (layer as S).add((base as S).mul(keep)) as Vec4
}

/**
 * A seed for Distance's jump flood: where the nearest pixel of the other
 * class is, as whole pixels in x and y and their fractions in z and w, so a
 * half-float target holds it as exactly as Magerie's 32-bit one does at any
 * size up to 2048. x below 0 is no seed yet.
 */
const noSeed = (): S => sl.vec4(-1, 0, 0, 0)
const seedAt = (pos: S): S => { const f: S = pos.floor(); return sl.vec4(f.x, f.y, pos.x.sub(f.x), pos.y.sub(f.y)) }
const seedPos = (t: S): S => sl.vec2(t.x.add(t.z), t.y.add(t.w))
/** The shortest way round a tiling picture (Metal's round, but for exact halves). */
const nearestImage = (d: S, size: S, wrap: boolean): S => (wrap ? d.sub(d.div(size).add(0.5).floor().mul(size)) : d)

/** Distance's seed pass (_jfaDistance.ts): every pixel of the other class, a boundary one moved to where luma crosses the threshold. */
export function distanceSeed(s: Scope, src: TexRead, at: number, inside: boolean, wrap: boolean): Vec4 {
    const t = s.f(at)
    const lumAt = (dx: number, dy: number): S => luma(src.fetch(sl.vec2(edgeIndex(s.pixel.x.add(dx), src.size.x, wrap), edgeIndex(s.pixel.y.add(dy), src.size.y, wrap))))
    const l: S = luma(src.fetch(s.pixel))
    const fore: S = l.ge(t)
    const lL = lumAt(-1, 0), lR = lumAt(1, 0), lU = lumAt(0, -1), lD = lumAt(0, 1)
    const differs = (n: S): S => n.ge(t).ne(fore)
    const boundary: S = l.gt(0).and(l.lt(1)).or(differs(lL)).or(differs(lR)).or(differs(lU)).or(differs(lD))
    const grad: S = sl.vec2(lR.sub(lL).mul(0.5), lD.sub(lU).mul(0.5))
    const gl2: S = grad.dot(grad)
    const off: S = grad.mul(t.sub(l).div(max(gl2, 1e-8))).clamp(-0.5, 0.5)
    const moved: S = sl.select(boundary.and(gl2.gt(1e-8)), sl.float(1), sl.float(0))
    const seed = seedAt(s.pixel.add(off.mul(moved)))
    return sl.select(inside ? fore.not() : fore, seed, noSeed()) as Vec4
}

/** One jump-flood step: the nearest of the seeds `step` away in the eight directions and here. */
export function distanceStep(s: Scope, src: TexRead, step: number, wrap: boolean): Vec4 {
    let best: S = noSeed()
    let bestD2: S = sl.float(1e30)
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const nb: S = src.fetch(sl.vec2(edgeIndex(s.pixel.x.add(dx * step), src.size.x, wrap), edgeIndex(s.pixel.y.add(dy * step), src.size.y, wrap)))
            const d: S = nearestImage(seedPos(nb).sub(s.pixel), src.size, wrap)
            const d2: S = d.dot(d)
            const better: S = nb.x.ge(0).and(d2.lt(bestD2))
            best = sl.select(better, nb, best)
            bestD2 = sl.select(better, d2, bestD2)
        }
    }
    return best
}

/** Distance's output: the distance to the nearest seed over maxDistance, clamped, 1 where no seed reached. */
export function distanceRemap(s: Scope, src: TexRead, maxDistance: number, wrap: boolean): Vec4 {
    const sd: S = src.fetch(s.pixel)
    const d: S = nearestImage(seedPos(sd).sub(s.pixel), src.size, wrap)
    const v: S = sl.select(sd.x.ge(0), d.length().div(s.f(Math.max(maxDistance, 1))).saturate(), sl.float(1))
    return sl.vec4(v, v, v, 1)
}
