import { View, mount, fx } from "oj"

/**
 * The card: the same fire, framed 16 by 9 and made to loop. Scrolling noise
 * never repeats, so each field is crossfaded with a copy one period behind;
 * at the end of the period the picture is back where it started.
 */

const SECONDS = 6
const PERIOD = SECONDS * 1.01
const canvas = fx.canvas(512)

const shape = canvas.sdf("egg", { h: 0.6, r: 0.17, rTop: 0.02, bulge: 0.7, y: 0 }).blur(40)
const fadeToTip = canvas.gradient(["#ffffff", "#000000"], "up").pow(0.68)
const mask = shape.multiply(fadeToTip)

const body: fx.NoiseOptions = { type: "turbulence", seed: 1, octaves: 3, scale: [0.5, 0.3] }
const detail: fx.NoiseOptions = { type: "turbulence", seed: 2, octaves: 3, scale: [0.9, 0.5] }

const embers = [
    { color: "#400000", alpha: 0, at: 0 },
    { color: "#800000", at: 0.2 },
    { color: "#ffd800", at: 0.24 },
    { color: "#ffd800", at: 0.7 },
    { color: "#ffffff", at: 0.75 },
]

function looping(field: fx.NoiseOptions, speed: number, t: number) {
    const rising = (at: number) => canvas.noise({ ...field, offset: [0, -at * speed] })
    const blend = (t % PERIOD) / PERIOD
    return rising(t).lerp(rising(t - PERIOD), blend)
}

function Cover() {
    const flame = fx.useAnimatedTexture(canvas, (t) => {
        const heat = looping(body, 0.7, t).multiply(looping(detail, 1.1, t)).multiply(2).multiply(mask)
        return heat.threshold(0, 0.16).ramp(embers)
    })
    return (
        <View style={{ width: 960, height: 540, backgroundColor: "#07070a", alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 540, height: 540, backgroundImage: flame }} />
        </View>
    )
}

mount(<Cover />)
