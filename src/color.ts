/**
 * Unity-shaped Color, implemented in JavaScript.
 *
 * Components are floats in [0, 1], matching UnityEngine.Color rather than the
 * 0-255 bytes of Color32. Statics are lowercase value properties and Lerp is
 * PascalCase, mirroring Unity so snippets paste in unchanged.
 *
 * Hex parsing accepts #RGB, #RGBA, #RRGGBB and #RRGGBBAA, with or without the
 * leading hash, which is the same set the particle wire schema accepts. That
 * parser currently lives privately in onejs-react/src/particles.ts; the two are
 * kept identical by colorHexCases in the tests, and should collapse into one
 * shared export the next time particles.ts is touched.
 */

export class Color {
    r: number
    g: number
    b: number
    a: number

    constructor(r = 0, g = 0, b = 0, a = 1) {
        this.r = r
        this.g = g
        this.b = b
        this.a = a
    }

    static get white(): Color { return new Color(1, 1, 1, 1) }
    static get black(): Color { return new Color(0, 0, 0, 1) }
    static get clear(): Color { return new Color(0, 0, 0, 0) }
    static get red(): Color { return new Color(1, 0, 0, 1) }
    static get green(): Color { return new Color(0, 1, 0, 1) }
    static get blue(): Color { return new Color(0, 0, 1, 1) }
    static get yellow(): Color { return new Color(1, 0.921568632, 0.0156862754, 1) }
    static get cyan(): Color { return new Color(0, 1, 1, 1) }
    static get magenta(): Color { return new Color(1, 0, 1, 1) }
    static get gray(): Color { return new Color(0.5, 0.5, 0.5, 1) }
    static get grey(): Color { return new Color(0.5, 0.5, 0.5, 1) }

    /** Luminance using Unity's coefficients. */
    get grayscale(): number {
        return 0.299 * this.r + 0.587 * this.g + 0.114 * this.b
    }

    clone(): Color { return new Color(this.r, this.g, this.b, this.a) }

    /** A copy with a different alpha. The common case for fading something out. */
    withAlpha(a: number): Color { return new Color(this.r, this.g, this.b, a) }

    /** Multiplies rgb by a scalar, leaving alpha alone. */
    mul(s: number): Color { return new Color(this.r * s, this.g * s, this.b * s, this.a) }

    equals(c: Color): boolean {
        return this.r === c.r && this.g === c.g && this.b === c.b && this.a === c.a
    }

    /** Renders as #RRGGBBAA. Components are clamped, so out-of-range values stay valid hex. */
    toHex(): string {
        const byte = (v: number) => {
            const n = Math.round(Math.min(1, Math.max(0, v)) * 255)
            return n.toString(16).padStart(2, "0")
        }
        return `#${byte(this.r)}${byte(this.g)}${byte(this.b)}${byte(this.a)}`
    }

    /** The css-style string UI Toolkit accepts for style colors. */
    toString(): string { return this.toHex() }

    static Lerp(a: Color, b: Color, t: number): Color {
        const c = t < 0 ? 0 : t > 1 ? 1 : t
        return new Color(
            a.r + (b.r - a.r) * c,
            a.g + (b.g - a.g) * c,
            a.b + (b.b - a.b) * c,
            a.a + (b.a - a.a) * c,
        )
    }

    /** Parses #RGB, #RGBA, #RRGGBB or #RRGGBBAA. Throws on anything else. */
    static FromHex(hex: string): Color {
        let h = hex.startsWith("#") ? hex.slice(1) : hex
        if (h.length === 3 || h.length === 4) {
            h = h.split("").map((d) => d + d).join("")
        }
        if ((h.length !== 6 && h.length !== 8) || !/^[0-9a-fA-F]+$/.test(h)) {
            throw new Error(`[oj] invalid color "${hex}"`)
        }
        const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255
        return new Color(n(0), n(2), n(4), h.length === 8 ? n(6) : 1)
    }

    /** Builds from 0-255 bytes, the Color32 range. */
    static FromBytes(r: number, g: number, b: number, a = 255): Color {
        return new Color(r / 255, g / 255, b / 255, a / 255)
    }
}
