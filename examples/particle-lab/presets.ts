/**
 * The starting points, and the code that turns the lab's knobs back into a
 * config a game can paste.
 *
 * Kept apart from the screen because it is the part with an answer: given a set
 * of values, there is exactly one config they mean, and printing that config
 * accurately is the whole reason the lab is useful rather than merely pretty.
 * A lab whose printed output does not match what it is showing is worse than no
 * lab at all.
 */

export interface Knobs {
    rate: number
    speedMin: number
    speedMax: number
    lifeMin: number
    lifeMax: number
    sizeMin: number
    sizeMax: number
    spreadFrom: number
    spreadTo: number
    gravity: number
    drag: number
    additiveness: number
    /** Colours the particle passes through, as hex with alpha. */
    ramp: string[]
    /** Starts at full size and ends at nothing, or the reverse. */
    grow: boolean
}

export interface Preset {
    name: string
    knobs: Knobs
}

/**
 * Six effects that between them touch every knob.
 *
 * Chosen so that reading any two of them side by side says what a knob does:
 * fire and smoke differ mostly in additiveness and colour, snow and sparks
 * mostly in speed and lifetime.
 */
export const PRESETS: Preset[] = [
    {
        name: "Fountain",
        knobs: {
            rate: 260, speedMin: 220, speedMax: 340, lifeMin: 0.9, lifeMax: 1.5,
            sizeMin: 4, sizeMax: 8, spreadFrom: 250, spreadTo: 290,
            gravity: 620, drag: 0, additiveness: 0.35,
            ramp: ["#9fe8ffff", "#3aa0ffff", "#1a4bd800"], grow: false,
        },
    },
    {
        name: "Fire",
        knobs: {
            rate: 220, speedMin: 40, speedMax: 110, lifeMin: 0.5, lifeMax: 1.1,
            sizeMin: 10, sizeMax: 22, spreadFrom: 250, spreadTo: 290,
            gravity: -180, drag: 1.2, additiveness: 1,
            ramp: ["#fff2c0ff", "#ff9020ff", "#c0200000"], grow: false,
        },
    },
    {
        name: "Smoke",
        knobs: {
            rate: 70, speedMin: 20, speedMax: 60, lifeMin: 1.6, lifeMax: 2.8,
            sizeMin: 18, sizeMax: 40, spreadFrom: 255, spreadTo: 285,
            gravity: -60, drag: 0.9, additiveness: 0,
            ramp: ["#7a7f8c00", "#8d94a4b0", "#5a606c00"], grow: true,
        },
    },
    {
        name: "Snow",
        knobs: {
            rate: 130, speedMin: 20, speedMax: 55, lifeMin: 3, lifeMax: 5,
            sizeMin: 3, sizeMax: 7, spreadFrom: 70, spreadTo: 110,
            gravity: 24, drag: 0.4, additiveness: 0,
            ramp: ["#ffffff00", "#ffffffe0", "#dfe8ff00"], grow: false,
        },
    },
    {
        name: "Sparks",
        knobs: {
            rate: 340, speedMin: 180, speedMax: 520, lifeMin: 0.2, lifeMax: 0.6,
            sizeMin: 2, sizeMax: 5, spreadFrom: 0, spreadTo: 360,
            gravity: 420, drag: 2.4, additiveness: 1,
            ramp: ["#ffffffff", "#ffd27aff", "#ff6a0000"], grow: false,
        },
    },
    {
        name: "Bloom",
        knobs: {
            rate: 90, speedMin: 30, speedMax: 90, lifeMin: 1.4, lifeMax: 2.4,
            sizeMin: 6, sizeMax: 16, spreadFrom: 0, spreadTo: 360,
            gravity: 0, drag: 1.1, additiveness: 0.7,
            ramp: ["#ffd0f000", "#c07affff", "#3a2a9000"], grow: true,
        },
    },
]

/** One emitter, exactly as onejs-react's useParticles expects it. */
export function toEmitter(knobs: Knobs): Record<string, unknown> {
    return {
        rate: Math.round(knobs.rate),
        angle: [knobs.spreadFrom, knobs.spreadTo],
        speed: [knobs.speedMin, knobs.speedMax],
        lifetime: [round(knobs.lifeMin), round(knobs.lifeMax)],
        size: [Math.round(knobs.sizeMin), Math.round(knobs.sizeMax)],
        gravity: [0, Math.round(knobs.gravity)],
        drag: round(knobs.drag),
        additiveness: round(knobs.additiveness),
        colorOverLife: knobs.ramp,
        sizeOverLife: knobs.grow ? [0.35, 1] : [1, 0],
    }
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * The config as a game would write it.
 *
 * Hand-formatted rather than JSON.stringify, because what a person wants to
 * paste is TypeScript with unquoted keys and short arrays kept on one line, and
 * JSON.stringify produces neither.
 */
export function toSource(knobs: Knobs, max: number): string {
    const emitter = toEmitter(knobs)
    const lines: string[] = []
    lines.push("const fx = useParticles(ref, {")
    lines.push(`    max: ${max},`)
    lines.push("    emitters: [{")
    for (const [key, value] of Object.entries(emitter)) {
        lines.push(`        ${key}: ${format(value)},`)
    }
    lines.push("    }],")
    lines.push("})")
    return lines.join("\n")
}

function format(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`
    }
    return typeof value === "string" ? `"${value}"` : String(value)
}

/**
 * Nudges one colour of the ramp along a hue wheel.
 *
 * The alpha is deliberately preserved: the first and last entries of most ramps
 * fade to nothing, and a colour picker that quietly made them opaque would turn
 * every effect into a hard-edged blob and look like the lab was broken.
 */
export function shiftHue(hex: string, degrees: number): string {
    const clean = hex.replace("#", "")
    const r = parseInt(clean.slice(0, 2), 16) / 255
    const g = parseInt(clean.slice(2, 4), 16) / 255
    const b = parseInt(clean.slice(4, 6), 16) / 255
    const alpha = clean.length >= 8 ? clean.slice(6, 8) : "ff"

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const light = (max + min) / 2
    const delta = max - min
    let hue = 0
    if (delta > 0) {
        if (max === r) hue = ((g - b) / delta) % 6
        else if (max === g) hue = (b - r) / delta + 2
        else hue = (r - g) / delta + 4
        hue *= 60
        if (hue < 0) hue += 360
    }
    const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1))
    const shifted = (((hue + degrees) % 360) + 360) % 360

    const c = (1 - Math.abs(2 * light - 1)) * sat
    const x = c * (1 - Math.abs(((shifted / 60) % 2) - 1))
    const m = light - c / 2
    const [rr, gg, bb] =
        shifted < 60 ? [c, x, 0] :
        shifted < 120 ? [x, c, 0] :
        shifted < 180 ? [0, c, x] :
        shifted < 240 ? [0, x, c] :
        shifted < 300 ? [x, 0, c] : [c, 0, x]

    const byte = (n: number) => Math.round(Math.min(1, Math.max(0, n + m)) * 255).toString(16).padStart(2, "0")
    return `#${byte(rr)}${byte(gg)}${byte(bb)}${alpha}`
}
