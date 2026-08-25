import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, fx, Mathf } from "oj"

/**
 * A fire with no art in it.
 *
 * Vertically stretched noise rising through a soft tapered mask, thresholded
 * into tongues and coloured by a ramp. Every frame is one crossing into C# and
 * a handful of fragment blits, which is why this runs in a browser at all: the
 * compute shader version of this effect cannot, because WebGL2 has no compute
 * shaders.
 *
 * Blowing on it is the pointer: drag across the stage and the flame leans.
 */

const STAGE = 600
const TEX = 512

const EMBERS: { color: [number, number, number, number]; at: number }[] = [
    { color: [0.15, 0, 0, 0], at: 0 },
    { color: [0.7, 0.06, 0, 0.55], at: 0.3 },
    { color: [1, 0.28, 0.02, 0.92], at: 0.52 },
    { color: [1, 0.62, 0.08, 1], at: 0.74 },
    { color: [1, 0.93, 0.62, 1], at: 1 },
]

/**
 * The envelope: where a flame is allowed to exist, and how strongly.
 *
 * Soft on purpose. A hard mask multiplied into the field leaves the silhouette's
 * own outline visible wherever the noise was bright, which reads as a lit shape
 * rather than as fire. Blurred, the product falls off gradually and the
 * threshold downstream cuts a ragged edge out of it instead.
 *
 * Multiplied by a base-to-tip falloff, so the flame is dense at the base and
 * thin enough at the top for the threshold to break it into separate tongues.
 * That falloff is what makes it read as rising rather than as a filled shape.
 */
function buildEnvelope(lean: number) {
    const shape = fx.image
        .sdf(TEX, TEX, "unevenCapsule", {
            rBottom: 0.22, rTop: 0.012, h: 0.72, y: -0.26,
            // Leaning the silhouette is what selling "blowing on it" needs: the
            // noise alone reads as flicker, not as direction.
            rotation: lean,
        })
        .clamp(0, 1)
        .blur(58)
    const fromBase = fx.image
        .gradient(TEX, TEX, [
            { color: [1, 1, 1, 1], at: 0 },
            { color: [0.06, 0.06, 0.06, 1], at: 1 },
        ], 90)
        .pow(1.13)
    return shape.multiply(fromBase)
}

/**
 * One layer of rising turbulence.
 *
 * Stretched, because an isotropic field gives round blobs and a flame is made of
 * vertical streaks; the aspect is doing more for the look here than the octave
 * count is. The two fields are independent all the way down, so the detail can
 * move and break up on its own terms rather than being a scaled copy.
 *
 * The offset is negative in y because the field has to travel the way the flame
 * rises. Scrolling it positive is the same picture flowing downward, which is
 * unmistakable once seen and invisible in any numeric check.
 */
const layer = (f: Field, seed: number, ox: number, t: number) =>
    fx.image.noise(TEX, TEX, {
        scale: [f.scaleX, f.scaleY], octaves: f.octaves, seed, type: "simplex",
        lacunarity: f.lacunarity, gain: f.gain, offset: [ox, -t * f.speed],
    })

/**
 * The two fields, tuned by dragging every one of these on a slider in the dev
 * app's version of this. See Assets/Scenes/MainScene/App/~/examples/fire.tsx,
 * which is the same effect with the panel still attached.
 */
interface Field {
    scaleX: number; scaleY: number; speed: number
    octaves: number; lacunarity: number; gain: number
}
const BODY: Field = { scaleX: 0.36, scaleY: 0.24, speed: 0.17, octaves: 2, lacunarity: 1.88, gain: 0.95 }
const DETAIL: Field = { scaleX: 0.5, scaleY: 0.43, speed: 0.256, octaves: 3, lacunarity: 3.11, gain: 0.95 }
const MIX = 0.517

function Tinder() {
    // Quantised, so the envelope is rebuilt only when the lean visibly changes
    // rather than on every pointer move: it contains a blur.
    const [lean, setLean] = useState(0)
    const target = useRef(0)

    const envelope = fx.useImage(() => buildEnvelope(lean), [lean])

    useFrame((dt) => {
        // Drag left or right of centre to lean the flame that way.
        const x = input.mouse.position.x
        const wanted = input.mouse.held
            ? Mathf.Clamp((x - STAGE / 2) / (STAGE / 2), -1, 1) * 14
            : 0
        target.current = Mathf.Lerp(target.current, wanted, 1 - Math.pow(0.02, dt))
        const step = Math.round(target.current / 2) * 2
        if (step !== lean) setLean(step)
    })

    const flame = fx.useAnimatedTexture(TEX, TEX, (t) => {
        // Two rates, so the fine detail outruns the body and the whole thing
        // never resolves into one sliding texture.
        const turbulence = layer(BODY, 1, 0, t)
            .multiply(1 - MIX)
            .add(layer(DETAIL, 2, 3.7, t).multiply(MIX))
        const heat = envelope ? turbulence.multiply(envelope) : turbulence
        // The threshold is what turns fog into licks: the band starts above the
        // product's mean so only the peaks survive, and the envelope's falloff
        // means fewer of them survive the higher up they are.
        return heat.remap(0.112, 0.342, 0, 1).clamp(0, 1).ramp(EMBERS)
    }, [envelope])

    return (
        <View style={{ width: STAGE, height: STAGE, backgroundColor: "#07070a",
                       alignItems: "center", justifyContent: "flex-end" }}>
            <View style={{ width: 520, height: 520, backgroundImage: flame as any }} />
            <Text style={{ position: "absolute", top: 24, color: "#6b6b7a", fontSize: 15 }}>
                drag to blow on it
            </Text>
        </View>
    )
}

mount(<Tinder />)
