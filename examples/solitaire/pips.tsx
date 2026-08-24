import { batchedVisualContent, Painter } from "oj"

export const SUIT_COLOUR = ["rgb(27, 36, 48)", "rgb(200, 40, 60)", "rgb(200, 40, 60)", "rgb(27, 36, 48)"]

const RED = [0.784, 0.157, 0.235] as const
const BLACK = [0.106, 0.141, 0.188] as const

function heart(p: Painter, x: number, y: number, size: number): void {
    const u = (a: number) => x + a * size
    const v = (b: number) => y + b * size
    p.beginPath()
    p.moveTo(u(0.5), v(0.95))
    p.bezierCurveTo(u(-0.08), v(0.55), u(0.06), v(0.10), u(0.5), v(0.34))
    p.bezierCurveTo(u(0.94), v(0.10), u(1.08), v(0.55), u(0.5), v(0.95))
    p.closePath()
    p.fill()
}

function spade(p: Painter, x: number, y: number, size: number): void {
    const u = (a: number) => x + a * size
    const v = (b: number) => y + b * size
    // A heart upside down, then a stem, filled separately for the reason club() gives.
    p.beginPath()
    p.moveTo(u(0.5), v(0.05))
    p.bezierCurveTo(u(1.08), v(0.45), u(0.94), v(0.90), u(0.5), v(0.66))
    p.bezierCurveTo(u(0.06), v(0.90), u(-0.08), v(0.45), u(0.5), v(0.05))
    p.closePath()
    p.fill()

    p.beginPath()
    p.moveTo(u(0.36), v(0.98))
    p.bezierCurveTo(u(0.47), v(0.86), u(0.47), v(0.74), u(0.46), v(0.6))
    p.lineTo(u(0.54), v(0.6))
    p.bezierCurveTo(u(0.53), v(0.74), u(0.53), v(0.86), u(0.64), v(0.98))
    p.closePath()
    p.fill()
}

function diamond(p: Painter, x: number, y: number, size: number): void {
    const u = (a: number) => x + a * size
    const v = (b: number) => y + b * size
    p.beginPath()
    p.moveTo(u(0.5), v(0.02))
    p.lineTo(u(0.88), v(0.5))
    p.lineTo(u(0.5), v(0.98))
    p.lineTo(u(0.12), v(0.5))
    p.closePath()
    p.fill()
}

function club(p: Painter, x: number, y: number, size: number): void {
    const u = (a: number) => x + a * size
    const v = (b: number) => y + b * size
    const r = size * 0.22

    // arc() draws a line from the current point to where it begins, so each circle starts with its own moveTo.
    const circle = (cx: number, cy: number) => {
        p.moveTo(cx + r, cy)
        p.arc(cx, cy, r, 0, Math.PI * 2)
    }

    // Fill separately: two overlapping subpaths wound opposite ways cancel under non-zero winding and leave a hole.
    p.beginPath()
    circle(u(0.5), v(0.27))
    circle(u(0.26), v(0.62))
    circle(u(0.74), v(0.62))
    p.fill()

    p.beginPath()
    p.moveTo(u(0.34), v(0.99))
    p.bezierCurveTo(u(0.47), v(0.86), u(0.47), v(0.72), u(0.45), v(0.55))
    p.lineTo(u(0.55), v(0.55))
    p.bezierCurveTo(u(0.53), v(0.72), u(0.53), v(0.86), u(0.66), v(0.99))
    p.closePath()
    p.fill()
}

const SHAPES = [spade, heart, diamond, club]

// One callback per suit and size, cached: Painter2D has no transform stack, and each callback takes a native slot.
const cache = new Map<string, ReturnType<typeof batchedVisualContent>>()

export function pipFor(suit: number, size: number): ReturnType<typeof batchedVisualContent> {
    const key = `${suit}:${size}`
    const existing = cache.get(key)
    if (existing !== undefined) return existing
    const colour = suit === 1 || suit === 2 ? RED : BLACK
    const shape = SHAPES[suit]!
    const made = batchedVisualContent((p: Painter) => {
        p.fillColor(colour[0], colour[1], colour[2], 1)
        shape(p, 0, 0, size)
    })
    cache.set(key, made)
    return made
}
