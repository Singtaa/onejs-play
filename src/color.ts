/**
 * Unity-shaped Color, implemented in JavaScript.
 *
 * Components are floats in [0, 1], matching UnityEngine.Color rather than the
 * 0-255 bytes of Color32. Statics are lowercase value properties and Lerp is
 * PascalCase, mirroring Unity so snippets paste in unchanged.
 *
 * Parsing is onejs-react's toRGBA, the one parser behind style, Painter,
 * particles and the 3D scene, so a colour means the same thing everywhere.
 */

import { toRGBA, type ColorInput } from "onejs-react"

const HEX = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

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

    /** Any colour oj takes: hex, `rgb()`, a CSS name, `[r, g, b, a]` or another Color. */
    static From(c: ColorInput): Color {
        const [r, g, b, a] = toRGBA(c, "[oj] Color.From")
        return new Color(r, g, b, a)
    }

    /** Parses #RGB, #RGBA, #RRGGBB or #RRGGBBAA. Throws on anything else. */
    static FromHex(hex: string): Color {
        if (!HEX.test(hex)) throw new Error(`[oj] invalid color "${hex}"`)
        return Color.From(hex)
    }

    /** Builds from 0-255 bytes, the Color32 range. */
    static FromBytes(r: number, g: number, b: number, a = 255): Color {
        return new Color(r / 255, g / 255, b / 255, a / 255)
    }
}
