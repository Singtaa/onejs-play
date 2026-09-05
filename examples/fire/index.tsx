import { View, mount, fx } from "oj"

const SIZE = 512

const shape = fx.image.sdf(SIZE, SIZE, "egg", { h: 0.5, r: 0.17, rTop: 0.02, bulge: 0.7, y: -0.06 }).blur(60)
const fadeToTip = fx.image.gradient(SIZE, SIZE, ["#ffffff", "#0f0f0f"], "up")
const mask = shape.multiply(fadeToTip)

const body: fx.NoiseOptions = { type: "turbulence", seed: 1, scale: [0.36, 0.24], scroll: [0, -0.17] }
const detail: fx.NoiseOptions = { type: "turbulence", seed: 2, scale: [0.5, 0.43], scroll: [0, -0.26] }

const embers = [
    { color: "#260000", alpha: 0, at: 0 },
    { color: "#b30f00", alpha: 0.55, at: 0.3 },
    { color: "#ff4705", alpha: 0.92, at: 0.52 },
    { color: "#ff9e14", at: 0.74 },
    { color: "#ffed9e", at: 1 },
]

function Fire() {
    const flame = fx.useAnimatedTexture(SIZE, SIZE, () => {
        const turbulence = fx.image.noise(SIZE, SIZE, body).lerp(fx.image.noise(SIZE, SIZE, detail), 0.45)
        const heat = turbulence.multiply(mask)
        return heat.threshold(0.08, 0.36).ramp(embers)
    })
    return <View style={{ width: SIZE, height: SIZE, backgroundImage: flame }} />
}

mount(<Fire />)
