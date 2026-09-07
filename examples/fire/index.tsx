import { View, mount, fx } from "oj"

const canvas = fx.canvas(512)

const shape = canvas.sdf("egg", { h: 0.6, r: 0.17, rTop: 0.02, bulge: 0.7, y: 0 }).blur(40)
const fadeToTip = canvas.gradient(["#ffffff", "#000000"], "up").pow(0.68)
const mask = shape.multiply(fadeToTip)

const body: fx.NoiseOptions = { type: "turbulence", seed: 1, octaves: 3, scale: [0.5, 0.3], scroll: [0, -0.7] }
const detail: fx.NoiseOptions = { type: "turbulence", seed: 2, octaves: 3, scale: [0.9, 0.5], scroll: [0, -1.1] }

const embers = [
    { color: "#400000", alpha: 0, at: 0 },
    { color: "#800000", at: 0.2 },
    { color: "#ffd800", at: 0.24 },
    { color: "#ffd800", at: 0.7 },
    { color: "#ffffff", at: 0.75 },
]

function Fire() {
    const flame = fx.useAnimatedTexture(canvas, () => {
        const heat = canvas.noise(body).multiply(canvas.noise(detail)).multiply(2).multiply(mask)
        return heat.threshold(0, 0.2).ramp(embers)
    })
    return <View style={{ width: canvas.width, height: canvas.height, backgroundImage: flame }} />
}

mount(<Fire />)
