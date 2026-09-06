import { View, mount, fx } from "oj"

const canvas = fx.canvas(512)

const shape = canvas.sdf("egg", { h: 0.5, r: 0.17, rTop: 0.02, bulge: 0.7, y: -0.06 }).blur(40)
const fadeToTip = canvas.gradient(["#ffffff", "#000000"], "up")
const mask = shape.multiply(fadeToTip)

const body: fx.NoiseOptions = { type: "turbulence", seed: 1, octaves: 2, scale: [0.8, 0.5], scroll: [0, -0.35] }
const detail: fx.NoiseOptions = { type: "turbulence", seed: 2, octaves: 2, scale: [1.6, 1], scroll: [0, -0.62] }

const embers = [
    { color: "#260000", alpha: 0, at: 0 },
    { color: "#b30f00", alpha: 0.55, at: 0.3 },
    { color: "#ff4705", alpha: 0.92, at: 0.52 },
    { color: "#ff9e14", at: 0.74 },
    { color: "#ffed9e", at: 1 },
]

function Fire() {
    const flame = fx.useAnimatedTexture(canvas, () => {
        const heat = canvas.noise(body).multiply(canvas.noise(detail)).multiply(mask)
        return heat.threshold(0.03, 0.35).ramp(embers)
    })
    return <View style={{ width: canvas.width, height: canvas.height, backgroundImage: flame }} />
}

mount(<Fire />)
