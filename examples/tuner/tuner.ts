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
