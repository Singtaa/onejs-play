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
    /**
     * Where the emitter sits in the preview, in its pixels.
     *
     * Per preset rather than fixed, because an effect belongs somewhere: a
     * fountain starts at the bottom and snow starts at the top, and one shared
     * position makes one of them look wrong whatever it is.
     *
     * Part of the knobs, and so part of the printed config, which is the whole
     * point. An earlier version kept the position in the component and left it
     * out of what it printed, so the config on screen would have put the
     * emitter at the top left corner of whatever it was pasted into.
     */
    originX: number
    originY: number
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

/**
 * A preset is a stack of emitters, not one.
 *
 * This is the whole reason the lab is worth opening. A single emitter is
 * something you can write by hand in a minute; fire that reads as fire is a
 * flame, a plume of smoke above it and a few embers coming off, three emitters
 * whose ranges have to agree with each other. Tuning that by editing numbers and
 * rebuilding is exactly the loop this replaces.
 */
export interface Preset {
    name: string
    layers: Knobs[]
}

/** The preview the origins below are measured in. */
export const PREVIEW_W = 650
export const PREVIEW_H = 700

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
        layers: [
            {
                originX: PREVIEW_W / 2, originY: PREVIEW_H - 60,
                rate: 300, speedMin: 520, speedMax: 640, lifeMin: 1.1, lifeMax: 1.7,
                sizeMin: 4, sizeMax: 9, spreadFrom: 252, spreadTo: 288,
                gravity: 620, drag: 0, additiveness: 0.35,
                ramp: ["#9fe8ffff", "#3aa0ffff", "#1a4bd800"], grow: false,
            },
            {
                // The spray at the top, which is what stops the column reading
                // as a solid rod of water.
                originX: PREVIEW_W / 2, originY: PREVIEW_H - 60,
                rate: 90, speedMin: 560, speedMax: 700, lifeMin: 1.4, lifeMax: 2.0,
                sizeMin: 2, sizeMax: 4, spreadFrom: 240, spreadTo: 300,
                gravity: 620, drag: 0.3, additiveness: 0.8,
                ramp: ["#ffffffff", "#bfe6ffff", "#7fb8ff00"], grow: false,
            },
        ],
    },
    {
        name: "Fire",
        layers: [
            {
                originX: PREVIEW_W / 2, originY: PREVIEW_H - 70,
                rate: 260, speedMin: 60, speedMax: 150, lifeMin: 0.7, lifeMax: 1.3,
                sizeMin: 14, sizeMax: 30, spreadFrom: 250, spreadTo: 290,
                gravity: -240, drag: 1.1, additiveness: 1,
                ramp: ["#fff2c0ff", "#ff9020ff", "#c0200000"], grow: false,
            },
            {
                // Smoke, slower and wider, above the flame rather than in it.
                originX: PREVIEW_W / 2, originY: PREVIEW_H - 110,
                rate: 45, speedMin: 25, speedMax: 70, lifeMin: 1.6, lifeMax: 2.8,
                sizeMin: 26, sizeMax: 60, spreadFrom: 255, spreadTo: 285,
                gravity: -90, drag: 0.9, additiveness: 0,
                ramp: ["#3a3a4200", "#5a5a66a0", "#2a2a3200"], grow: true,
            },
            {
                // Embers: few, fast, and the thing the eye actually follows.
                originX: PREVIEW_W / 2, originY: PREVIEW_H - 70,
                rate: 22, speedMin: 120, speedMax: 260, lifeMin: 0.9, lifeMax: 1.8,
                sizeMin: 2, sizeMax: 4, spreadFrom: 235, spreadTo: 305,
                gravity: -140, drag: 1.6, additiveness: 1,
                ramp: ["#fff6d0ff", "#ff9a30ff", "#ff4a0000"], grow: false,
            },
        ],
    },
    {
        name: "Smoke",
        layers: [
            {
                originX: PREVIEW_W / 2, originY: PREVIEW_H - 60,
                rate: 80, speedMin: 30, speedMax: 80, lifeMin: 2.0, lifeMax: 3.4,
                sizeMin: 24, sizeMax: 56, spreadFrom: 255, spreadTo: 285,
                gravity: -90, drag: 0.8, additiveness: 0,
                ramp: ["#7a7f8c00", "#8d94a4b0", "#5a606c00"], grow: true,
            },
        ],
    },
    {
        name: "Snow",
        layers: [
            {
                // At the top, because snow falls. The one preset whose aim
                // points downward is also the one that has to start above
                // everything else.
                originX: PREVIEW_W / 2, originY: 8,
                rate: 150, speedMin: 30, speedMax: 70, lifeMin: 4, lifeMax: 6,
                sizeMin: 3, sizeMax: 8, spreadFrom: 60, spreadTo: 120,
                gravity: 26, drag: 0.4, additiveness: 0,
                ramp: ["#ffffff00", "#ffffffe0", "#dfe8ff00"], grow: false,
            },
        ],
    },
    {
        name: "Sparks",
        layers: [
            {
                originX: PREVIEW_W / 2, originY: PREVIEW_H * 0.55,
                rate: 340, speedMin: 220, speedMax: 620, lifeMin: 0.25, lifeMax: 0.7,
                sizeMin: 2, sizeMax: 5, spreadFrom: 0, spreadTo: 360,
                gravity: 480, drag: 2.4, additiveness: 1,
                ramp: ["#ffffffff", "#ffd27aff", "#ff6a0000"], grow: false,
            },
            {
                // A slower, dimmer set underneath, so the burst has depth
                // rather than being one flat sheet of dots.
                originX: PREVIEW_W / 2, originY: PREVIEW_H * 0.55,
                rate: 90, speedMin: 60, speedMax: 200, lifeMin: 0.6, lifeMax: 1.4,
                sizeMin: 3, sizeMax: 7, spreadFrom: 0, spreadTo: 360,
                gravity: 300, drag: 1.4, additiveness: 0.6,
                ramp: ["#ffb45aff", "#a83c1080", "#40140000"], grow: false,
            },
        ],
    },
    {
        name: "Bloom",
        layers: [
            {
                originX: PREVIEW_W / 2, originY: PREVIEW_H * 0.5,
                rate: 110, speedMin: 40, speedMax: 120, lifeMin: 1.6, lifeMax: 2.6,
                sizeMin: 8, sizeMax: 22, spreadFrom: 0, spreadTo: 360,
                gravity: 0, drag: 1.1, additiveness: 0.7,
                ramp: ["#ffd0f000", "#c07affff", "#3a2a9000"], grow: true,
            },
        ],
    },
]

/** One emitter, exactly as onejs-react's useParticles expects it. */
export function toEmitter(knobs: Knobs): Record<string, unknown> {
    return {
        pos: [Math.round(knobs.originX), Math.round(knobs.originY)],
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
export function toSource(layers: readonly Knobs[], max: number): string {
    const lines: string[] = []
    lines.push("const fx = useParticles(ref, {")
    lines.push(`    max: ${max},`)
    lines.push("    emitters: [")
    for (const knobs of layers) {
        lines.push("        {")
        for (const [key, value] of Object.entries(toEmitter(knobs))) {
            lines.push(`            ${key}: ${format(value)},`)
        }
        lines.push("        },")
    }
    lines.push("    ],")
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
