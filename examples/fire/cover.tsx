import { View, mount, fx } from "oj"

/**
 * The card: the same fire, framed 16 by 9 and made to loop. Scrolling noise
 * never repeats, so each field is crossfaded with a copy one period behind;
 * at the end of the period the picture is back where it started.
 */

const SECONDS = 6
const PERIOD = SECONDS * 1.01
const canvas = fx.canvas(512)

const shape = canvas.sdf("egg", { h: 0.5, r: 0.17, rTop: 0.02, bulge: 0.7, y: -0.06 }).blur(40)
const fadeToTip = canvas.gradient(["#ffffff", "#000000"], "up")
const mask = shape.multiply(fadeToTip)

const body: fx.NoiseOptions = { type: "turbulence", seed: 1, octaves: 2, scale: [0.8, 0.5] }
const detail: fx.NoiseOptions = { type: "turbulence", seed: 2, octaves: 2, scale: [1.6, 1] }

const embers = [
    { color: "#260000", alpha: 0, at: 0 },
    { color: "#b30f00", alpha: 0.55, at: 0.3 },
    { color: "#ff4705", alpha: 0.92, at: 0.52 },
    { color: "#ff9e14", at: 0.74 },
    { color: "#ffed9e", at: 1 },
]

function looping(field: fx.NoiseOptions, speed: number, t: number) {
    const rising = (at: number) => canvas.noise({ ...field, offset: [0, -at * speed] })
    const blend = (t % PERIOD) / PERIOD
    return rising(t).lerp(rising(t - PERIOD), blend)
}

function Cover() {
    const flame = fx.useAnimatedTexture(canvas, (t) => {
        const heat = looping(body, 0.35, t).multiply(looping(detail, 0.62, t)).multiply(mask)
        return heat.threshold(0.015, 0.15).ramp(embers)
    })
    return (
        <View style={{ width: 960, height: 540, backgroundColor: "#07070a", alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 540, height: 540, backgroundImage: flame }} />
        </View>
    )
}

mount(<Cover />)
