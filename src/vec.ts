/**
 * Unity-shaped Vector2, implemented in JavaScript.
 *
 * There is no Vector3. The container is 2D only, so shipping one would be 90
 * lines of code no game can use.
 *
 * These never cross into C#. A container game's math runs entirely in JS, which
 * is both faster than bridging (no reflection crossing, no handle-table entry)
 * and what keeps oj decoupled from Unity's API surface.
 *
 * ONE SEMANTIC DIFFERENCE FROM UNITY, AND IT WILL BITE YOU:
 * UnityEngine.Vector2 is a struct, so `a = b` copies. These are JS classes, so
 * `a = b` aliases, and mutating one mutates the other. Use clone() at the point
 * where C# would have copied for you.
 *
 *     const a = new Vector2(1, 2)
 *     const b = a           // same object, NOT a copy
 *     const c = a.clone()   // what C# would have given you
 *
 * Arithmetic returns new instances (matching what Unity's operators produce);
 * set() and copyFrom() mutate in place for hot loops that want to avoid the
 * allocation.
 *
 * Statics are PascalCase and value properties are lowercase, mirroring Unity
 * exactly (Vector2.Distance, Vector2.zero) so snippets paste in unchanged.
 */

/** Unity's Vector2.kEpsilon: at or below this magnitude, normalized returns zero. */
const K_EPSILON = 1e-5

/**
 * Unity's kEpsilonNormalSqrt squared, the guard Angle applies to the product of
 * squared magnitudes before taking a square root. Verified against the
 * decompiled UnityEngine.Vector2.Angle rather than assumed.
 */
const K_ANGLE_SQR_GUARD = 1e-30

export class Vector2 {
    x: number
    y: number

    constructor(x = 0, y = 0) {
        this.x = x
        this.y = y
    }

    static get zero(): Vector2 { return new Vector2(0, 0) }
    static get one(): Vector2 { return new Vector2(1, 1) }
    static get up(): Vector2 { return new Vector2(0, 1) }
    static get down(): Vector2 { return new Vector2(0, -1) }
    static get left(): Vector2 { return new Vector2(-1, 0) }
    static get right(): Vector2 { return new Vector2(1, 0) }

    get magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y)
    }

    get sqrMagnitude(): number {
        return this.x * this.x + this.y * this.y
    }

    /**
     * Unit vector in the same direction. Zero for a near-zero vector.
     *
     * The test is written as Unity writes it, !(m > kEpsilon) rather than
     * m <= kEpsilon, because that also sends NaN to zero instead of dividing
     * by it and propagating NaN into every coordinate downstream.
     */
    get normalized(): Vector2 {
        const m = this.magnitude
        if (!(m > K_EPSILON)) return new Vector2(0, 0)
        return new Vector2(this.x / m, this.y / m)
    }

    add(v: Vector2): Vector2 { return new Vector2(this.x + v.x, this.y + v.y) }
    sub(v: Vector2): Vector2 { return new Vector2(this.x - v.x, this.y - v.y) }
    mul(s: number): Vector2 { return new Vector2(this.x * s, this.y * s) }
    div(s: number): Vector2 { return new Vector2(this.x / s, this.y / s) }
    negate(): Vector2 { return new Vector2(-this.x, -this.y) }

    /** Mutates in place. For hot loops that want to skip the allocation. */
    set(x: number, y: number): this {
        this.x = x
        this.y = y
        return this
    }

    /** Mutates in place. The explicit form of what C# assignment does implicitly. */
    copyFrom(v: Vector2): this {
        this.x = v.x
        this.y = v.y
        return this
    }

    clone(): Vector2 { return new Vector2(this.x, this.y) }

    /** Exact component equality. Use Vector2.Approximately for float-tolerant comparison. */
    equals(v: Vector2): boolean { return this.x === v.x && this.y === v.y }

    toString(): string { return `(${this.x}, ${this.y})` }

    static Dot(a: Vector2, b: Vector2): number {
        return a.x * b.x + a.y * b.y
    }

    /** The z component of the 3D cross product. Positive when b is counter-clockwise of a. */
    static Cross(a: Vector2, b: Vector2): number {
        return a.x * b.y - a.y * b.x
    }

    static Distance(a: Vector2, b: Vector2): number {
        const dx = a.x - b.x
        const dy = a.y - b.y
        return Math.sqrt(dx * dx + dy * dy)
    }

    static SqrDistance(a: Vector2, b: Vector2): number {
        const dx = a.x - b.x
        const dy = a.y - b.y
        return dx * dx + dy * dy
    }

    static Lerp(a: Vector2, b: Vector2, t: number): Vector2 {
        const c = t < 0 ? 0 : t > 1 ? 1 : t
        return new Vector2(a.x + (b.x - a.x) * c, a.y + (b.y - a.y) * c)
    }

    static LerpUnclamped(a: Vector2, b: Vector2, t: number): Vector2 {
        return new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    }

    static MoveTowards(current: Vector2, target: Vector2, maxDistanceDelta: number): Vector2 {
        const dx = target.x - current.x
        const dy = target.y - current.y
        const sqr = dx * dx + dy * dy
        if (sqr === 0 || (maxDistanceDelta >= 0 && sqr <= maxDistanceDelta * maxDistanceDelta)) {
            return target.clone()
        }
        const d = Math.sqrt(sqr)
        return new Vector2(current.x + (dx / d) * maxDistanceDelta, current.y + (dy / d) * maxDistanceDelta)
    }

    /** Component-wise multiply, matching Unity's Vector2.Scale. */
    static Scale(a: Vector2, b: Vector2): Vector2 {
        return new Vector2(a.x * b.x, a.y * b.y)
    }

    /**
     * Unsigned angle between two vectors in degrees, in [0, 180].
     *
     * The degenerate guard is applied to the product of squared magnitudes
     * before the square root, matching Unity. Guarding the square root against
     * kEpsilon instead looks equivalent and is not: two vectors of magnitude
     * 1e-3 have a product of 1e-6, which is under kEpsilon, so that version
     * returns 0 for a perfectly well-defined angle.
     */
    static Angle(from: Vector2, to: Vector2): number {
        const sqr = from.sqrMagnitude * to.sqrMagnitude
        if (sqr < K_ANGLE_SQR_GUARD) return 0
        const denom = Math.sqrt(sqr)
        const cos = Math.min(1, Math.max(-1, Vector2.Dot(from, to) / denom))
        return Math.acos(cos) * (180 / Math.PI)
    }

    /** Signed angle between two vectors in degrees, in [-180, 180]. */
    static SignedAngle(from: Vector2, to: Vector2): number {
        const unsigned = Vector2.Angle(from, to)
        const sign = from.x * to.y - from.y * to.x >= 0 ? 1 : -1
        return unsigned * sign
    }

    /** Rotates 90 degrees counter-clockwise, matching Unity. */
    static Perpendicular(v: Vector2): Vector2 {
        return new Vector2(-v.y, v.x)
    }

    static Reflect(direction: Vector2, normal: Vector2): Vector2 {
        const f = -2 * Vector2.Dot(normal, direction)
        return new Vector2(f * normal.x + direction.x, f * normal.y + direction.y)
    }

    static ClampMagnitude(v: Vector2, maxLength: number): Vector2 {
        const sqr = v.sqrMagnitude
        if (sqr <= maxLength * maxLength) return v.clone()
        const m = Math.sqrt(sqr)
        return new Vector2((v.x / m) * maxLength, (v.y / m) * maxLength)
    }

    static Min(a: Vector2, b: Vector2): Vector2 {
        return new Vector2(Math.min(a.x, b.x), Math.min(a.y, b.y))
    }

    static Max(a: Vector2, b: Vector2): Vector2 {
        return new Vector2(Math.max(a.x, b.x), Math.max(a.y, b.y))
    }

    /** Float-tolerant equality, using the same relative rule as Mathf.Approximately. */
    static Approximately(a: Vector2, b: Vector2): boolean {
        return Vector2.SqrDistance(a, b) < K_EPSILON * K_EPSILON
    }

    /** Builds a unit vector at the given angle in radians, measured from +x. */
    static FromAngle(radians: number, length = 1): Vector2 {
        return new Vector2(Math.cos(radians) * length, Math.sin(radians) * length)
    }
}
