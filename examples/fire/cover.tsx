import { View, mount, fx } from "oj"

/**
 * The card for this game: the same fire, composed at the card's 16 by 9 and
 * made to loop.
 *
 * Scrolling noise never repeats, so no clip of it joins up on its own. Each
 * field is crossfaded with a copy one period behind: at t = 0 the result is
 * f(0) and at t = T it is f(T - T), which is f(0) again. Recording a hair
 * less than one period never reaches the reset. The crossfade is done on the
 * heat field, so everything downstream of it joins up too.
 */

const SECONDS = 6
const PERIOD = SECONDS * 1.01
const T = 512

const mask = fx.image.sdf(T, T, "egg", { h: 0.55, r: 0.22, rTop: 0.02, bulge: 0.7, y: -0.08 })
    .blur(60)
    .multiply(fx.image.gradient(T, T, ["#fff", "#0f0f0f"], 90))

const rising = (seed: number, scale: [number, number], speed: number, lacunarity: number, gain: number, t: number) =>
    fx.image.noise(T, T, { type: "simplex", scale, seed, octaves: 3, lacunarity, gain, offset: [seed * 3, -t * speed] })

const looping = (seed: number, scale: [number, number], speed: number, lacunarity: number, gain: number, t: number) => {
    const a = (t % PERIOD) / PERIOD
    return rising(seed, scale, speed, lacunarity, gain, t).multiply(1 - a)
        .add(rising(seed, scale, speed, lacunarity, gain, t - PERIOD).multiply(a))
}

function Cover() {
    const flame = fx.useAnimatedTexture(T, T, (t) =>
        looping(1, [0.36, 0.24], 0.17, 2.35, 0.99, t).multiply(0.55)
            .add(looping(2, [0.5, 0.43], 0.26, 2.7, 0.95, t).multiply(0.45))
            .multiply(mask)
            .remap(0.11, 0.34, 0, 1)
            .ramp(["#26000000", "#b30f008c", "#ff4705eb", "#ff9e14", "#ffed9e"]))
    return (
        <View style={{ width: 960, height: 540, backgroundColor: "#07070a", alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 540, height: 540, backgroundImage: flame }} />
        </View>
    )
}

mount(<Cover />)
