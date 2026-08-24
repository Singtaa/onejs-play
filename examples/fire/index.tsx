import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, fx, Mathf } from "oj"

/**
 * A fire with no art in it.
 *
 * Two scrolling noise fields multiply for structure, a tapered mask cuts the
 * silhouette, and a ramp colours the result. Every frame is one crossing into
 * C# and a handful of fragment blits, which is why this runs in a browser at
 * all: the compute shader version of this effect cannot, because WebGL2 has no
 * compute shaders.
 *
 * Blowing on it is the pointer: drag across the stage and the flame leans.
 */

const STAGE = 600
const TEX = 512

const EMBERS: { color: [number, number, number, number]; at: number }[] = [
    { color: [0.4, 0.02, 0, 0], at: 0 },
    { color: [0.6, 0.05, 0, 1], at: 0.22 },
    { color: [1, 0.42, 0.04, 1], at: 0.45 },
    { color: [1, 0.8, 0.2, 1], at: 0.8 },
    { color: [1, 0.97, 0.85, 1], at: 1 },
]

/**
 * How much to eat away before the threshold sees it: the mask inverted.
 *
 * Subtracting this erodes the flame at its edges, where multiplying by the mask
 * would clip it to a hard geometric outline. Built once, since it never changes
 * and it contains a blur.
 */
function buildEroder(lean: number) {
    const shape = fx.image
        .sdf(TEX, TEX, "unevenCapsule", {
            rBottom: 0.26, rTop: 0.02, h: 0.5, y: -0.26,
            // Leaning the silhouette is what selling "blowing on it" needs: the
            // noise alone reads as flicker, not as direction.
            rotation: lean,
        })
        .clamp(0, 1)
    const towardTop = fx.image
        .gradient(TEX, TEX, [
            { color: [0, 0, 0, 1], at: 0 },
            { color: [1, 1, 1, 1], at: 1 },
        ], 90)
        .pow(1.5)
    const mask = shape.blur(44).multiply(towardTop)
        .add(shape.blur(8).multiply(towardTop.oneMinus()))
    return mask.oneMinus().multiply(0.42)
}

/** One flame field. Simplex, because value noise shows its grid at this gain. */
const field = (scale: number, octaves: number, seed: number, ox: number, oy: number) =>
    fx.image.noise(TEX, TEX, {
        scale, octaves, seed, type: "simplex",
        lacunarity: 2.9, gain: 0.75, offset: [ox, oy],
    })

function Tinder() {
    // Quantised, so the eroder is rebuilt only when the lean visibly changes
    // rather than on every pointer move: it contains two blurs.
    const [lean, setLean] = useState(0)
    const target = useRef(0)

    const eroder = fx.useImage(() => buildEroder(lean), [lean])

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
        const time = t * 1.2
        const structure = field(3, 4, 1, 0, time).multiply(field(6.5, 3, 2, 2, time * 0.431))
        return (eroder ? structure.subtract(eroder) : structure)
            .remap(0.05, 0.52, 0, 1)
            .clamp(0, 1)
            .ramp(EMBERS)
    }, [eroder])

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
