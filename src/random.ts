/**
 * Seeded pseudo-random numbers.
 *
 * Math.random cannot be reproduced, which rules out daily challenges, shareable
 * runs, replays, and reproducing a bug an agent hit on turn 400. oj.random
 * gives every game a deterministic stream instead: the same seed always
 * produces the same sequence, on every platform and every runtime version.
 *
 *     const roll = random.int(1, 7)              // a shared, unseeded generator
 *     const rng = random("daily-2026-08-21")     // a seeded one of your own
 *     const level = rng.int(0, 12)
 *
 * The generator is mulberry32 with an xmur3 string hash for the seed. Both are
 * small, fast, and good enough for games. Neither is cryptographic; never use
 * this where unpredictability matters.
 *
 * Note the range convention differs from UnityEngine.Random, which is
 * max-exclusive for ints but max-inclusive for floats. Here both are
 * max-exclusive, because that inconsistency is a well-known source of
 * off-by-one bugs and there is no paste-compatibility to preserve: Unity's
 * Random is a static global, not a seeded instance.
 */

import { simplex2D, simplex3D } from "onejs-unity/proc/noise"

/** Options for `rng.noise()`. */
export interface NoiseOptions {
    /**
     * How many layers of detail: each one adds the same noise at twice the
     * frequency and half the weight, and the sum is rescaled to stay in -1 to 1.
     * A whole number from 1 (smooth hills, the default) to 16.
     */
    layers?: number
}

/**
 * A smooth noise field: nearby points give nearby values, from -1 to 1, the
 * same everywhere for one seed. Two numbers sample it flat, three in space
 * (use the third as time to animate a flat field).
 */
export type Noise = (x: number, y: number, z?: number) => number

const MAX_LAYERS = 16

export interface Rng {
    /** Next float in [0, 1). */
    next(): number
    /** Integer in [min, max). Empty or reversed ranges return min. */
    int(min: number, max: number): number
    /** Float in [min, max). */
    range(min: number, max: number): number
    /** True with probability p, defaulting to even odds. */
    bool(p?: number): boolean
    /** 1 or -1, evenly. */
    sign(): number
    /** A uniformly chosen element. Throws on an empty array. */
    pick<T>(items: readonly T[]): T
    /** A shuffled copy. The input is left alone. */
    shuffle<T>(items: readonly T[]): T[]
    /** A unit Vector2-shaped pair at a uniformly random angle. */
    direction(): { x: number; y: number }
    /**
     * An independent stream derived from this one and a label. Lets level
     * generation and cosmetic randomness stay reproducible without one
     * consuming draws from the other.
     */
    fork(label: string): Rng
    /**
     * A smooth noise field seeded by this generator (simplex noise), for
     * terrain, clouds and wobble. It draws nothing from this generator, so
     * `int`, `range` and the rest return what they would have without it, and
     * every call gives the same field: fork first for another one,
     * `rng.fork("caves").noise()`. Features are about 1 unit across, so divide
     * coordinates by the size you want: `n(x / 50, z / 50)`.
     */
    noise(options?: NoiseOptions): Noise
}

/** Hashes a string seed into a 32-bit integer. */
function xmur3(str: string): number {
    let h = 1779033703 ^ str.length
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^ (h >>> 16)) >>> 0
}

function toSeedInt(seed: string | number | undefined): number {
    if (seed === undefined) {
        // No seed asked for, so no reproducibility is being promised. Draw once
        // from Math.random rather than pretending a fixed default is random.
        return (Math.random() * 4294967296) >>> 0
    }
    if (typeof seed === "number") {
        return Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) >>> 0 : 0
    }
    return xmur3(seed)
}

function mulberry32(seedInt: number): () => number {
    let a = seedInt >>> 0
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Makes a generator, or draws from a shared one: `random("seed")` is a seeded
 * stream of your own, and `random.int(0, 10)` uses a shared generator with a
 * random seed, for when nothing needs to be reproduced.
 */
export interface Random extends Rng {
    /** A generator of your own. The same seed gives the same stream; no seed picks a random one. */
    (seed?: string | number): Rng
}

/**
 * Creates a seeded generator. Omitting the seed picks a random one, which means
 * the stream is not reproducible; pass a seed whenever you want it to be.
 */
function createRng(seed?: string | number): Rng {
    const seedInt = toSeedInt(seed)
    const next = mulberry32(seedInt)

    const rng: Rng = {
        next,

        int(min: number, max: number): number {
            const span = Math.floor(max) - Math.ceil(min)
            if (!(span > 0)) return Math.ceil(min)
            return Math.ceil(min) + Math.floor(next() * span)
        },

        range(min: number, max: number): number {
            return min + next() * (max - min)
        },

        bool(p = 0.5): boolean {
            return next() < p
        },

        sign(): number {
            return next() < 0.5 ? -1 : 1
        },

        pick<T>(items: readonly T[]): T {
            if (items.length === 0) throw new Error("[oj] random.pick needs a non-empty array")
            return items[Math.floor(next() * items.length)]!
        },

        shuffle<T>(items: readonly T[]): T[] {
            const out = items.slice()
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1))
                const tmp = out[i]!
                out[i] = out[j]!
                out[j] = tmp
            }
            return out
        },

        direction(): { x: number; y: number } {
            const a = next() * Math.PI * 2
            return { x: Math.cos(a), y: Math.sin(a) }
        },

        fork(label: string): Rng {
            return createRng(xmur3(`${seedInt}:${label}`))
        },

        noise(options: NoiseOptions = {}): Noise {
            return createNoise(xmur3(`${seedInt}:noise`), options)
        },
    }

    return rng
}

/**
 * A noise field from a 32-bit seed. onejs-unity's simplex is reused: it runs on
 * arithmetic, Math.floor and Math.sqrt only, which every engine computes
 * exactly, so one seed gives the same field in Chrome, Node and QuickJS.
 */
function createNoise(seedInt: number, options: NoiseOptions): Noise {
    const layers = options.layers ?? 1
    if (!Number.isInteger(layers) || layers < 1 || layers > MAX_LAYERS) {
        throw new Error(`[oj] noise({ layers }) takes a whole number from 1 to ${MAX_LAYERS}, and was given ${String(layers)}`)
    }
    const fbm = { octaves: layers, lacunarity: 2, persistence: 0.5 }
    const flat = simplex2D({ seed: seedInt })
    const deep = simplex3D({ seed: seedInt })
    const sample2 = layers === 1 ? flat.sample : flat.fbm(fbm).sample
    const sample3 = layers === 1 ? deep.sample : deep.fbm(fbm).sample
    return (x, y, z) => z === undefined ? sample2(x, y) : sample3(x, y, z)
}

// The methods are closures over their own stream, so copying them onto the factory
// gives random.int(...) a shared generator without any `this` to lose.
export const random: Random = Object.assign((seed?: string | number) => createRng(seed), createRng())
