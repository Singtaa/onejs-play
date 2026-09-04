import { View, mount, fx } from "oj"

/**
 * Fire, drawn from nothing. No art files and no particle system.
 *
 * Two layers of tall noise scroll upward, a soft mask says where fire is
 * allowed to be, a threshold keeps only the bright peaks, and a colour ramp
 * makes them hot. That is the whole effect, and this is the whole game.
 */

const T = 512

// Where fire is allowed to be: a soft egg, round at the base and drawn to a
// point, fading toward the tip so the top breaks into separate tongues.
const mask = fx.image.sdf(T, T, "egg", { h: 0.5, r: 0.17, rTop: 0.02, bulge: 0.7, y: -0.06 })
    .blur(60)
    .multiply(fx.image.gradient(T, T, ["#fff", "#0f0f0f"], 90))

// Rising turbulence: simplex noise stretched tall, scrolling upward. A gain
// near 1 is what makes it stringy rather than cloudy.
const rising = (seed: number, scale: [number, number], speed: number, lacunarity: number, gain: number) =>
    fx.image.noise(T, T, { type: "simplex", scale, seed, octaves: 3, lacunarity, gain, offset: [seed * 3, 0], scroll: [0, -speed] })

function Fire() {
    // Two fields at two speeds: a body and a finer detail that outruns it.
    const flame = fx.useAnimatedTexture(T, T, () =>
        rising(1, [0.36, 0.24], 0.17, 2.35, 0.99).multiply(0.55)
            .add(rising(2, [0.5, 0.43], 0.26, 2.7, 0.95).multiply(0.45))
            .multiply(mask)
            .remap(0.11, 0.42, 0, 1)
            .ramp(["#26000000", "#b30f008c", "#ff4705eb", "#ff9e14", "#ffed9e"]))
    return <View style={{ width: T, height: T, backgroundImage: flame }} />
}

mount(<Fire />)
