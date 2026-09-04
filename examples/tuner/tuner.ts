/**
 * The parts of Tuner that are not the shader.
 *
 * Tuner is a demonstration rather than a game: it exists to show that the Play
 * container can do real shader programming, and that doing it is ergonomic. So
 * there is no target to find and no score. There are three uniforms, three
 * controls, and the code that turns them into pixels shown beside the result.
 */

export type DialName = "warp" | "hue" | "speed"

export interface Dials { warp: number; hue: number; speed: number }

/**
 * Each uniform, and what it does to the picture.
 *
 * The description is not decoration. Somebody meeting a shader for the first
 * time needs to know that a uniform is an ordinary number they can change,
 * which is easiest to believe while watching one change something.
 */
export const DIALS: readonly { name: DialName; does: string }[] = [
    { name: "warp", does: "how tightly the waves fold" },
    { name: "hue", does: "where the colour ramp starts" },
    { name: "speed", does: "how fast time moves" },
]

export const DIAL_NAMES: readonly DialName[] = DIALS.map((d) => d.name)

/**
 * Three layouts, not one layout multiplied by a number.
 *
 * The first attempt scaled every size by stage.width / 960, which is not
 * responsive design: it is one design shrunk, and it makes 13px type into 9px
 * type on a narrow stage while the proportions stay wrong anyway. Type has
 * sizes that are legible and sizes that are not, and there is no useful value
 * between them. So the sizes are fixed per step, and what changes between
 * steps is what is on screen and how it is arranged.
 */
export interface Step {
    pad: number; title: number; body: number; small: number; code: number
    gap: number; stacked: boolean; prose: boolean; strapline: boolean; code_: boolean
}

export function stepFor(width: number): Step {
    if (width >= 900) {
        return { pad: 30, title: 22, body: 15, small: 13, code: 12.5,
            gap: 22, stacked: false, prose: true, strapline: true, code_: true }
    }
    if (width >= 640) {
        return { pad: 24, title: 20, body: 15, small: 13, code: 11.5,
            gap: 16, stacked: false, prose: false, strapline: true, code_: true }
    }
    if (width >= 430) {
        return { pad: 18, title: 19, body: 14, small: 12, code: 11.5,
            gap: 12, stacked: true, prose: false, strapline: false, code_: true }
    }
    return { pad: 14, title: 18, body: 14, small: 12, code: 11,
        gap: 10, stacked: true, prose: false, strapline: false, code_: false }
}

/**
 * What fits in the box, and at what size.
 *
 * The step is chosen by width, because width decides whether type is legible
 * and whether two panels sit beside each other. Height decides one thing on
 * top of that: whether there is room for the code at all. The steps alone
 * once said yes at 600 by 420 (an embed, or a phone on its side), and the
 * layout engine answered the shortfall by shrinking twelve lines of code into
 * each other. The panel's own comment says it is the first thing to go when
 * the stage cannot hold both, so this is where that is decided.
 *
 * The estimate is deliberately rough and errs toward hiding: a code panel
 * that is missing on a stage where it would just have fit teaches less than
 * one that overlaps, but not by much, and the overflow rule on the panel
 * turns any remaining miss into a clipped last line rather than a smear.
 */
export function layoutFor(width: number, height: number, lines: number): {
    step: Step; shader: number; code: boolean
} {
    const step = stepFor(width)
    const room = width - step.pad * 2
    // Layout sizes DO follow the space, which is the part that should. A panel
    // is a shape in a box; type is not.
    const shader = Math.round(Math.max(130, Math.min(
        step.stacked ? room : room * 0.42,
        height * (step.stacked ? 0.34 : 0.58),
    )))
    const codeHeight = lines * Math.round(step.code * 1.5) + 24
    const dials = 3 * (Math.round(step.body * 1.4) + 10)
    const chrome = 16 + Math.round(step.title * 1.4) + 12 + 14 + dials + 6 + Math.round(step.small * 1.4) + 12
    const panels = step.stacked ? shader + step.gap + codeHeight : Math.max(shader, codeHeight)
    return { step, shader, code: step.code_ && chrome + panels <= height }
}
