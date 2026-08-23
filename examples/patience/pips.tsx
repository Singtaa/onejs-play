/**
 * The four suit symbols, drawn rather than typed.
 *
 * The obvious way to put a spade on a card is to write one, and it is a trap:
 * the glyphs live in a corner of Unicode that a font is free not to cover, and
 * a missing one renders as a box. Whether the cards are legible would then
 * depend on which font the runtime happened to fall back to, on that platform,
 * on that day.
 *
 * So each suit is a path. The shapes are described in a unit box with the
 * origin at the top left and y counting downward, which is how UI Toolkit
 * measures, and scaled to whatever element they are drawn into.
 *
 * There are exactly four callbacks, shared by every card of that suit rather
 * than one per card. A callback assigned to a C# delegate takes a slot in the
 * native callback table, and fifty two cards with two pips each would take a
 * hundred and four of them to draw four distinct shapes.
 */

import { batchedVisualContent, Painter } from "oj"

/** Hearts and diamonds are red; spades and clubs are near-black. */
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
    // The heart, upside down, plus a stem. Both in one path so the overlap
    // where the stem meets the body fills as a single shape.
    p.beginPath()
    p.moveTo(u(0.5), v(0.05))
    p.bezierCurveTo(u(1.08), v(0.45), u(0.94), v(0.90), u(0.5), v(0.66))
    p.bezierCurveTo(u(0.06), v(0.90), u(-0.08), v(0.45), u(0.5), v(0.05))
    p.closePath()
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
    // Three overlapping circles and a stem, filled as one path. Non-zero
    // winding unions them, so the seams where they meet do not show.
    p.beginPath()
    p.arc(u(0.5), v(0.27), size * 0.22, 0, Math.PI * 2)
    p.closePath()
    p.arc(u(0.26), v(0.62), size * 0.22, 0, Math.PI * 2)
    p.closePath()
    p.arc(u(0.74), v(0.62), size * 0.22, 0, Math.PI * 2)
    p.closePath()
    p.moveTo(u(0.34), v(0.99))
    p.bezierCurveTo(u(0.47), v(0.86), u(0.47), v(0.72), u(0.45), v(0.55))
    p.lineTo(u(0.55), v(0.55))
    p.bezierCurveTo(u(0.53), v(0.72), u(0.53), v(0.86), u(0.66), v(0.99))
    p.closePath()
    p.fill()
}

const SHAPES = [spade, heart, diamond, club]

/**
 * A callback that draws one suit at one size.
 *
 * Painter2D has no transform stack, so a path cannot be described once and
 * scaled by whatever draws it: the coordinates have to be right when they are
 * recorded. Each (suit, size) pair therefore gets its own callback, and they
 * are cached so a board of fifty two cards uses eight of them rather than a
 * hundred and four.
 */
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
