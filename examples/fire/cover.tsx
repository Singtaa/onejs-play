import { View, Text, mount, fx } from "oj"

/**
 * The card for this game.
 *
 * A cover scene, not the game: same container, same runtime, same fx chain, but
 * composed for a card rather than for playing. The game's own screen is a wide
 * pane with a slider panel down one side, which crops badly into a 16 by 9 card
 * and says nothing about what the game is. This shows the flame and the three
 * fields it is built from, which is the whole idea in one picture.
 *
 * Two things a cover has to get right, and both are the reason this file exists
 * rather than the recorder being cleverer.
 *
 * It is authored at the card's shape. The stage below is 16 by 9, the same
 * aspect the card is drawn at, so nothing is cropped and there are no letterbox
 * bars in the recording.
 *
 * And it loops. A card plays on repeat forever next to fifteen others, so a clip
 * that does not join up announces its own wrap every few seconds. See LOOP.
 */

const SECONDS = 6
/*
 * The crossfade's period, deliberately a little longer than the clip.
 *
 * The blend below runs from 0 to 1 across PERIOD and then resets. Recording for
 * exactly PERIOD would start a couple of frames after the scene did and so run
 * past the reset, catching the jump inside the clip. Recording a little less
 * than a period never reaches it: the last frame sits at a weight near 1, which
 * is the copy one period back, which is where the first frame came from.
 * The margin is small on purpose. At six percent the clip ended with six
 * percent of a frame six seconds away mixed in, which closed only a seventh of
 * the gap; at one percent the copy it lands on is a twentieth of a second from
 * where the clip began. Measured by comparing the last frame against the first.
 */
const PERIOD = SECONDS * 1.01
const STAGE_W = 960
const STAGE_H = 540
const TEX = 512
const THUMB = 132

const EMBERS: { color: [number, number, number, number]; at: number }[] = [
    { color: [0.15, 0, 0, 0], at: 0 },
    { color: [0.7, 0.06, 0, 0.55], at: 0.3 },
    { color: [1, 0.28, 0.02, 0.92], at: 0.52 },
    { color: [1, 0.62, 0.08, 1], at: 0.74 },
    { color: [1, 0.93, 0.62, 1], at: 1 },
]

interface Field {
    scaleX: number; scaleY: number; speed: number
    octaves: number; lacunarity: number; gain: number
}
const BODY: Field = { scaleX: 0.36, scaleY: 0.24, speed: 0.17, octaves: 3, lacunarity: 2.35, gain: 0.99 }
const DETAIL: Field = { scaleX: 0.5, scaleY: 0.43, speed: 0.256, octaves: 3, lacunarity: 2.7, gain: 0.95 }
const MIX = 0.45

const field = (f: Field, seed: number, ox: number, t: number, size: number) =>
    fx.image.noise(size, size, {
        scale: [f.scaleX, f.scaleY], octaves: f.octaves, seed, type: "simplex",
        lacunarity: f.lacunarity, gain: f.gain, offset: [ox, -t * f.speed],
    })

/**
 * LOOP: the same field, crossfaded with a copy exactly one period behind.
 *
 * Scrolling simplex noise never repeats, so no clip of it joins up on its own
 * and no amount of choosing the length helps. Blending f(t) with f(t - T) on a
 * ramp from 0 to 1 across the period does join up, because at t = 0 the result
 * is f(0) and at t = T it is f(T - T), which is f(0) again. Everything between
 * is a continuous mix of two copies of the same field, so it still reads as one
 * moving thing rather than as two.
 *
 * Blended here rather than on the finished picture: this is the heat field, and
 * everything downstream of it (threshold, ramp) is a pure function of it, so
 * joining up here joins up the colours too. Crossfading the coloured flames
 * instead would wash the two through each other and look like a dissolve.
 *
 * It costs two chains per frame instead of one, which a card can afford: this
 * runs for six seconds at publish time, not while anybody is playing.
 */
function looping(f: Field, seed: number, ox: number, t: number, size = TEX) {
    const a = (t % PERIOD) / PERIOD
    return field(f, seed, ox, t, size).multiply(1 - a)
        .add(field(f, seed, ox, t - PERIOD, size).multiply(a))
}

/** Where a flame is allowed to be, and how strongly. Static, so it never moves. */
function buildEnvelope() {
    const shape = fx.image
        .sdf(TEX, TEX, "unevenCapsule", { rBottom: 0.206, rTop: 0.012, h: 0.72, y: -0.133 })
        .clamp(0, 1)
        .blur(61)
    const fromBase = fx.image
        .gradient(TEX, TEX, [
            { color: [1, 1, 1, 1], at: 0 },
            { color: [0.06, 0.06, 0.06, 1], at: 1 },
        ], 90)
        .pow(0.94)
    return shape.multiply(fromBase)
}

function Thumb({ label, texture }: { label: string; texture: unknown }) {
    return (
        <View style={{ alignItems: "center", marginBottom: 10 }}>
            <View style={{ width: THUMB, height: THUMB, backgroundColor: "#101014",
                           borderWidth: 1, borderColor: "#26262f", borderRadius: 5,
                           backgroundImage: texture as any }} />
            <Text style={{ color: "#6b6b7a", fontSize: 11, marginTop: 5 }}>{label}</Text>
        </View>
    )
}

function FieldThumb({ label, f, seed, ox }: {
    label: string; f: Field; seed: number; ox: number
}) {
    const tex = fx.useAnimatedTexture(THUMB, THUMB, (t) => looping(f, seed, ox, t, THUMB), [])
    return <Thumb label={label} texture={tex} />
}

function Cover() {
    const envelope = fx.useImage(() => buildEnvelope(), [])

    const flame = fx.useAnimatedTexture(TEX, TEX, (t) => {
        const turbulence = looping(BODY, 1, 0, t)
            .multiply(1 - MIX)
            .add(looping(DETAIL, 2, 3.7, t).multiply(MIX))
        const heat = envelope ? turbulence.multiply(envelope) : turbulence
        return heat.remap(0.112, 0.342, 0, 1).clamp(0, 1).ramp(EMBERS)
    }, [envelope])

    return (
        <View style={{ width: STAGE_W, height: STAGE_H, backgroundColor: "#07070a",
                       flexDirection: "row", alignItems: "center",
                       // paddingLeft/Right, not paddingHorizontal: UI Toolkit has
                       // no such property and the reconciler expands "padding",
                       // not the React Native style shorthands, so the sided
                       // version is silently ignored and the thumbnails end up
                       // against the edge of the card.
                       justifyContent: "center", paddingLeft: 40, paddingRight: 48 }}>
            <View style={{ flexGrow: 1, alignItems: "center" }}>
                <View style={{ width: 430, height: 430, backgroundImage: flame as any }} />
            </View>
            {/* The inputs, down the side: what the flame is made of, which the
                flame itself never shows. */}
            <View style={{ marginLeft: 28 }}>
                <FieldThumb label="field A, the body" f={BODY} seed={1} ox={0} />
                <FieldThumb label="field B, the detail" f={DETAIL} seed={2} ox={3.7} />
                <Thumb label="envelope, blurred"
                       texture={envelope ? envelope.texture() : null} />
            </View>
        </View>
    )
}

mount(<Cover />)
