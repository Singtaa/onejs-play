/**
 * Unity-shaped math helpers, implemented in JavaScript.
 *
 * Container games cannot reach CS.*, so Mathf is a plain JS object rather than
 * a bridge to UnityEngine.Mathf. That is faster than the real thing (no
 * crossing, no handle-table entry) and it keeps the container decoupled from
 * Unity's API surface. Ejected games get the identical object, because oj ships
 * this same module on native.
 *
 * Method names are PascalCase to mirror Unity exactly, so existing snippets
 * paste in unchanged. This is a deliberate exception to the camelCase rule,
 * the same one painter.ts makes for Painter.FillRule.
 *
 * Parity is faithful, including the cases that surprise people:
 *   Mathf.Sign(0)    ===  1     (not 0)
 *   Mathf.Round(0.5) ===  0     (banker's rounding, not JS Math.round)
 *   Mathf.Round(2.5) ===  2
 */

/** float.Epsilon, matching UnityEngine.Mathf.Epsilon. */
const EPSILON = 1.401298e-45

/** Rounds half to even, matching C# Math.Round(x, MidpointRounding.ToEven). */
function roundToEven(f: number): number {
    if (!Number.isFinite(f)) return f
    const floor = Math.floor(f)
    const diff = f - floor
    if (diff > 0.5) return floor + 1
    if (diff < 0.5) return floor
    return floor % 2 === 0 ? floor : floor + 1
}

function clamp01(value: number): number {
    if (value < 0) return 0
    if (value > 1) return 1
    return value
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min
    if (value > max) return max
    return value
}

function repeat(t: number, length: number): number {
    return clamp(t - Math.floor(t / length) * length, 0, length)
}

function deltaAngle(current: number, target: number): number {
    let delta = repeat(target - current, 360)
    if (delta > 180) delta -= 360
    return delta
}

function moveTowards(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target
    return current + Math.sign(target - current) * maxDelta
}

export const Mathf = {
    PI: Math.PI,
    Infinity: Number.POSITIVE_INFINITY,
    NegativeInfinity: Number.NEGATIVE_INFINITY,
    Epsilon: EPSILON,
    Deg2Rad: Math.PI / 180,
    Rad2Deg: 180 / Math.PI,

    Abs: Math.abs,
    Sqrt: Math.sqrt,
    Pow: Math.pow,
    Exp: Math.exp,
    Log: Math.log,
    Log10: Math.log10,
    Sin: Math.sin,
    Cos: Math.cos,
    Tan: Math.tan,
    Asin: Math.asin,
    Acos: Math.acos,
    Atan: Math.atan,
    Atan2: Math.atan2,
    Floor: Math.floor,
    Ceil: Math.ceil,

    /** Banker's rounding, matching Unity. Mathf.Round(0.5) is 0, not 1. */
    Round: roundToEven,

    /** Returns 1 for zero and positive input, -1 for negative. Matches Unity. */
    Sign(f: number): number {
        return f >= 0 ? 1 : -1
    },

    Min(...values: number[]): number {
        return Math.min(...values)
    },

    Max(...values: number[]): number {
        return Math.max(...values)
    },

    Clamp: clamp,
    Clamp01: clamp01,

    /** Linear interpolation with t clamped to [0, 1]. */
    Lerp(a: number, b: number, t: number): number {
        return a + (b - a) * clamp01(t)
    },

    /** Linear interpolation without clamping t. */
    LerpUnclamped(a: number, b: number, t: number): number {
        return a + (b - a) * t
    },

    /** Interpolates between two angles in degrees, taking the shortest path. */
    LerpAngle(a: number, b: number, t: number): number {
        let delta = repeat(b - a, 360)
        if (delta > 180) delta -= 360
        return a + delta * clamp01(t)
    },

    /** Where value sits between a and b, as [0, 1]. Returns 0 when a equals b. */
    InverseLerp(a: number, b: number, value: number): number {
        if (a === b) return 0
        return clamp01((value - a) / (b - a))
    },

    /** Loops t so it never exceeds length and never goes negative. */
    Repeat: repeat,

    /** Bounces t back and forth between 0 and length. */
    PingPong(t: number, length: number): number {
        const r = repeat(t, length * 2)
        return length - Math.abs(r - length)
    },

    /** Smooth Hermite interpolation, t clamped to [0, 1]. */
    SmoothStep(from: number, to: number, t: number): number {
        const c = clamp01(t)
        const s = -2 * c * c * c + 3 * c * c
        return to * s + from * (1 - s)
    },

    /** Moves current toward target by at most maxDelta, never overshooting. */
    MoveTowards: moveTowards,

    /** Shortest-path MoveTowards for angles in degrees. */
    MoveTowardsAngle(current: number, target: number, maxDelta: number): number {
        const delta = deltaAngle(current, target)
        if (-maxDelta < delta && delta < maxDelta) return target
        return moveTowards(current, current + delta, maxDelta)
    },

    /** Shortest signed difference between two angles in degrees, in [-180, 180]. */
    DeltaAngle: deltaAngle,

    /** Compares floats with a relative tolerance, matching Unity's rule. */
    Approximately(a: number, b: number): boolean {
        return Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), EPSILON * 8)
    },
} as const
