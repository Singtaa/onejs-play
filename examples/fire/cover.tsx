import { View, mount, fx } from "oj"

/**
 * The card: the same fire, framed 16 by 9 and made to loop. Scrolling noise
 * never repeats, so each field is crossfaded with a copy one period behind;
 * at the end of the period the picture is back where it started.
 */

const SECONDS = 6
const PERIOD = SECONDS * 1.01
const SIZE = 512

const shape = fx.image.sdf(SIZE, SIZE, "egg", { h: 0.5, r: 0.17, rTop: 0.02, bulge: 0.7, y: -0.06 }).blur(60)
const fadeToTip = fx.image.gradient(SIZE, SIZE, ["#ffffff", "#0f0f0f"], "up")
const mask = shape.multiply(fadeToTip)

const body: fx.NoiseOptions = { type: "turbulence", seed: 1, scale: [0.36, 0.24] }
const detail: fx.NoiseOptions = { type: "turbulence", seed: 2, scale: [0.5, 0.43] }

const embers = [
    { color: "#260000", alpha: 0, at: 0 },
    { color: "#b30f00", alpha: 0.55, at: 0.3 },
    { color: "#ff4705", alpha: 0.92, at: 0.52 },
    { color: "#ff9e14", at: 0.74 },
    { color: "#ffed9e", at: 1 },
]

function looping(field: fx.NoiseOptions, speed: number, t: number) {
    const rising = (at: number) => fx.image.noise(SIZE, SIZE, { ...field, offset: [0, -at * speed] })
    const blend = (t % PERIOD) / PERIOD
    return rising(t).lerp(rising(t - PERIOD), blend)
}

function Cover() {
    const flame = fx.useAnimatedTexture(SIZE, SIZE, (t) => {
        const turbulence = looping(body, 0.17, t).lerp(looping(detail, 0.26, t), 0.45)
        const heat = turbulence.multiply(mask)
        return heat.threshold(0.08, 0.36).ramp(embers)
    })
    return (
        <View style={{ width: 960, height: 540, backgroundColor: "#07070a", alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 540, height: 540, backgroundImage: flame }} />
        </View>
    )
}

mount(<Cover />)
