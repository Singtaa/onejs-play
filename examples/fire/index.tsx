import { View, mount, useStage, fx } from "oj"

// The texture is a fixed 512 because that is a GPU resolution, not a layout:
// the flame is generated once at this size and scaled by the element drawing
// it. What reflows is the element, below.
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
    const stage = useStage()
    const flame = fx.useAnimatedTexture(canvas, () => {
        const heat = canvas.noise(body).multiply(canvas.noise(detail)).multiply(2).multiply(mask)
        return heat.threshold(0, 0.2).ramp(embers)
    })
    // The flame is square and must stay square, so it takes the smaller side of
    // whatever window it is given and sits in the middle of it. The dark fill
    // around it is what the manifest used to declare as a letterbox matte: the
    // same colour, now painted by the sketch because there are no bars.
    const side = Math.min(stage.width, stage.height)
    return (
        <View style={{
            width: "100%", height: "100%",
            alignItems: "center", justifyContent: "center",
            backgroundColor: "#07070a",
        }}>
            <View style={{ width: side, height: side, backgroundImage: flame }} />
        </View>
    )
}

mount(<Fire />)
