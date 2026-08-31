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

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * How fast a held key turns a dial, in units per second.
 *
 * Tuned rather than guessed, because the first version was not: it moved a
 * dial through its whole range in under a second at rest and accelerated
 * tenfold, so a tap crossed half the range and nothing could be set on
 * purpose. A dial should take a couple of seconds end to end, and holding
 * should help without taking over.
 */
export const RATE = 0.35
export const RAMP = 3
export const RAMP_SECONDS = 1.5

export function turnRate(heldSeconds: number): number {
    const ramped = Math.min(Math.max(heldSeconds, 0), RAMP_SECONDS) / RAMP_SECONDS
    return RATE * (1 + ramped * (RAMP - 1))
}
