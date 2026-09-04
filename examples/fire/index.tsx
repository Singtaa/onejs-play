import { useRef, useState } from "react"
import { View, Text, Button, Slider, ScrollView, mount, useFrame, useStage, fx, Mathf, type Texture, type PointerEventData } from "oj"

/**
 * Fire, drawn from nothing. No art files and no particle system.
 *
 * The whole effect is four steps, run again every frame:
 *
 *   1. Generate two layers of moving noise, stretched tall so they read as
 *      rising streaks instead of round blobs.
 *   2. Blend the two together.
 *   3. Multiply by an envelope: a soft flame-shaped mask saying where fire is
 *      allowed to be.
 *   4. Keep only the bright peaks of what is left, and colour those through a
 *      ramp from dark red to near white.
 *
 * Every number in those steps is on a slider, so you can move one and watch
 * what it does. The three thumbnails under the flame show the raw ingredients
 * from steps 1 and 3, which the finished picture hides.
 *
 * A good place to start reading is the Tinder component near the bottom, which
 * lays the screen out and calls everything above it.
 */

/** Generated textures are this many pixels square. */
const TEX = 512
/**
 * The thumbnails are generated smaller, and it costs them nothing. The noise is
 * a function of position from 0 to 1, so a small texture is the same field
 * sampled more coarsely rather than a different picture.
 */
const PREVIEW = 96
const PAD = 20
const GAP = 16
/** The controls column: a share of the stage, with a floor and a ceiling. */
const PANEL_W = 320
const PANEL_MIN = 210
const PANEL_SHARE = 0.42

/**
 * Narrower than this and the controls cannot have a column of their own, so the
 * layout folds and the panel becomes a sheet you open over the flame.
 *
 * A game here is played at very different sizes, from a phone to a full window,
 * so a layout built for one size is wrong nearly everywhere. useStage, further
 * down, reports the size this game actually got.
 */
const SIDE_BY_SIDE_MIN = 520

/**
 * Shorter than this and there is no room for the flame and its explanation at
 * once, however wide the frame is. The fire is the game, so the fire is what
 * stays: the thumbnails and the hint are what a larger frame buys you.
 */
const COMPACT_H = 420
/** Padding, and a smallest flame, that only a roomy frame can afford. */
const COMPACT_PAD = 8
const COMPACT_FLAME_MIN = 110

/** How far, in degrees, a drag all the way to one edge leans the flame. */
const LEAN_MAX = 14

/**
 * The colour ramp: a number from 0 to 1 goes in, a colour comes out, and the
 * stops in between are blended.
 *
 * Most of what makes this look like fire is the shape. The ramp is what makes
 * the shape look hot.
 */
const EMBERS = [
    { color: "#26000000", at: 0 },    // transparent: sits on any background
    { color: "#b30f008c", at: 0.3 },  // dark red, still see-through
    { color: "#ff4705eb", at: 0.52 }, // orange body
    { color: "#ff9e14", at: 0.74 },   // yellow
    { color: "#ffed9e", at: 1 },      // near-white, only at the hottest
] as const

/** The settings for one noise layer. There are two, independent all the way down. */
interface Field {
    scaleX: number; scaleY: number; speed: number
    octaves: number; lacunarity: number; gain: number
}

interface Params {
    scaleXA: number; scaleYA: number; speedA: number
    octavesA: number; lacunarityA: number; gainA: number
    scaleXB: number; scaleYB: number; speedB: number
    octavesB: number; lacunarityB: number; gainB: number
    mix: number
    rBottom: number; rTop: number; height: number; baseY: number
    blur: number; falloff: number
    lo: number; hi: number
}

/**
 * Where the sliders start.
 *
 * There is no way to reason these out. They were found by dragging and
 * watching, which is what the sliders are for.
 */
const DEFAULTS: Params = {
    scaleXA: 0.36, scaleYA: 0.24, speedA: 0.17,
    octavesA: 3, lacunarityA: 2.35, gainA: 0.99,
    scaleXB: 0.5, scaleYB: 0.43, speedB: 0.256,
    octavesB: 3, lacunarityB: 2.7, gainB: 0.95,
    mix: 0.45,
    rBottom: 0.206, rTop: 0.012, height: 0.72, baseY: -0.133,
    blur: 61, falloff: 0.94,
    lo: 0.112, hi: 0.342,
}

/**
 * The knobs that feed the envelope.
 *
 * Moving one of these rebuilds the envelope, which costs a blur, so they are
 * listed here and used as the rebuild condition further down. Every other knob
 * is read fresh each frame and is free to move.
 */
const ENVELOPE_KEYS = ["rBottom", "rTop", "height", "baseY", "blur", "falloff"] as const

interface Control {
    key: keyof Params
    label: string
    min: number
    max: number
    group?: string
    /** Whole numbers only, for the one knob the shader takes as a loop count. */
    int?: boolean
}

/**
 * Every slider: which parameter it moves, its range, and the heading it sits
 * under.
 *
 * The ranges reach further down than looks sensible. That is deliberate. If the
 * settings worth having end up sitting on a slider's stop, the range is wrong
 * rather than the value.
 */
const CONTROLS: Control[] = [
    { key: "scaleXA", label: "scale X", min: 0.05, max: 8, group: "Field A, the body" },
    { key: "scaleYA", label: "scale Y", min: 0.02, max: 6 },
    { key: "speedA", label: "speed", min: 0, max: 2 },
    { key: "octavesA", label: "octaves", min: 1, max: 4, int: true },
    { key: "lacunarityA", label: "lacunarity", min: 1.2, max: 5 },
    { key: "gainA", label: "gain", min: 0.2, max: 0.99 },

    { key: "scaleXB", label: "scale X", min: 0.05, max: 8, group: "Field B, the detail" },
    { key: "scaleYB", label: "scale Y", min: 0.02, max: 6 },
    { key: "speedB", label: "speed", min: 0, max: 2 },
    { key: "octavesB", label: "octaves", min: 1, max: 4, int: true },
    { key: "lacunarityB", label: "lacunarity", min: 1.2, max: 5 },
    { key: "gainB", label: "gain", min: 0.2, max: 0.99 },

    { key: "mix", label: "mix, A to B", min: 0, max: 1, group: "Blend" },

    { key: "rBottom", label: "base width", min: 0.02, max: 0.5, group: "Shape" },
    { key: "rTop", label: "tip width", min: 0.001, max: 0.2 },
    { key: "height", label: "height", min: 0.1, max: 1 },
    { key: "baseY", label: "base offset", min: -0.5, max: 0.2 },
    { key: "blur", label: "blur", min: 0, max: 160 },
    { key: "falloff", label: "base to tip falloff", min: 0.3, max: 4 },

    { key: "lo", label: "threshold low", min: 0, max: 0.6, group: "Threshold" },
    { key: "hi", label: "threshold high", min: 0.1, max: 1 },
]

/**
 * Step 3: the envelope, a soft mask saying where flame is allowed to be, and
 * how strongly.
 *
 * An sdf gives the silhouette, a capsule wide at the base and narrow at the
 * tip. The blur is the part that matters. A hard mask leaves its own outline
 * showing wherever the noise behind it was bright, which reads as a lit shape
 * rather than as fire. Blurred, the edge fades out gradually and step 4 cuts a
 * ragged line through it instead.
 *
 * That is then multiplied by a gradient fading from base to tip, so the flame
 * is dense at the bottom and thin enough at the top to break into separate
 * tongues. This is what makes it read as rising rather than as a filled shape.
 */
function buildEnvelope(p: Params, lean: number) {
    const shape = fx.image
        .sdf(TEX, TEX, "unevenCapsule", {
            rBottom: p.rBottom, rTop: p.rTop, h: p.height, y: p.baseY,
            // Leaning the silhouette is what sells "blowing on it". Noise alone
            // reads as flicker, never as direction.
            rotation: lean,
        })
        .clamp(0, 1)
        .blur(Math.round(p.blur))
    // The gradient's 0 stop sits at low v, and low v is the bottom of the
    // element, so white at 0 means a bright base.
    const fromBase = fx.image.gradient(TEX, TEX, ["#fff", "#0f0f0f"], 90).pow(p.falloff)
    return shape.multiply(fromBase)
}

/**
 * Step 1: one layer of rising turbulence.
 *
 * The scale is uneven on purpose. An even field gives round blobs, and a flame
 * is vertical streaks, so the noise is stretched tall before anything else
 * happens to it.
 *
 * The offset is negative in y because the field has to travel the way a flame
 * rises. Scrolling it positive gives the same picture flowing downward, which
 * is unmistakable on screen and invisible to any numeric check.
 *
 * Simplex rather than the default value noise. Value noise interpolates a
 * square grid, and at the settings a flame wants, its cells show through as
 * blocks.
 */
const layer = (f: Field, seed: number, ox: number, t: number, size = TEX) =>
    fx.image.noise(size, size, {
        scale: [f.scaleX, f.scaleY], octaves: Math.round(f.octaves), seed, type: "simplex",
        lacunarity: f.lacunarity, gain: f.gain, offset: [ox, -t * f.speed],
    })

const fieldA = (p: Params): Field => ({
    scaleX: p.scaleXA, scaleY: p.scaleYA, speed: p.speedA,
    octaves: p.octavesA, lacunarity: p.lacunarityA, gain: p.gainA,
})
const fieldB = (p: Params): Field => ({
    scaleX: p.scaleXB, scaleY: p.scaleYB, speed: p.speedB,
    octaves: p.octavesB, lacunarity: p.lacunarityB, gain: p.gainB,
})

function Thumb({ label, texture, size }: { label: string; texture: Texture | null; size: number }) {
    return (
        <View style={{ alignItems: "center" }}>
            <View style={{ width: size, height: size, backgroundColor: "#101014",
                           borderWidth: 1, borderColor: "#26262f", borderRadius: 4,
                           backgroundImage: texture }} />
            <Text style={{ color: "#6b6b7a", fontSize: 10, marginTop: 5 }}>{label}</Text>
        </View>
    )
}

/**
 * A thumbnail that animates its own field, so it shows what that field is doing
 * right now rather than a still.
 *
 * The deps array is empty on purpose: the loop runs once for the life of the
 * thumbnail, and each frame draws with the latest `field`, because the hook
 * always calls the build function from the most recent render.
 */
function FieldThumb({ label, field, seed, ox, size }: {
    label: string; field: Field; seed: number; ox: number; size: number
}) {
    const tex = fx.useAnimatedTexture(PREVIEW, PREVIEW,
        (t) => layer(field, seed, ox, t, PREVIEW), [])
    return <Thumb label={label} texture={tex} size={size} />
}

function Knob({ c, value, onChange }: {
    c: Control; value: number; onChange: (v: number) => void
}) {
    return (
        <View style={{ marginBottom: 7 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: "#9a9aab", fontSize: 11 }}>{c.label}</Text>
                <Text style={{ color: "#e8e8ef", fontSize: 11 }}>
                    {c.int ? String(value) : value.toFixed(3)}
                </Text>
            </View>
            <Slider lowValue={c.min} highValue={c.max} value={value}
                    onChange={e => onChange(c.int ? Math.round(e.value) : e.value)} />
        </View>
    )
}

function Tinder() {
    const stage = useStage()
    // Is there room for the flame and the controls at once? Asked as a single
    // question, so there is no in-between size where the panel ends up sitting
    // on top of the flame instead of beside it.
    const compact = stage.width < SIDE_BY_SIDE_MIN || stage.height < COMPACT_H

    const [p, setP] = useState<Params>(DEFAULTS)
    // Closed to begin with on a small frame, where the panel is a sheet over
    // the fire rather than a column beside it. Somebody who has not asked for
    // the controls should see the thing the controls are for.
    const [panel, setPanel] = useState(() => !compact)

    // Every size below is worked out from the stage rather than written down,
    // which is what lets one layout serve a phone and a full window.
    const sideBySide = stage.width >= SIDE_BY_SIDE_MIN
    const pad = compact ? COMPACT_PAD : PAD
    const preview = Math.round(Mathf.Clamp(stage.width * 0.09, 52, PREVIEW))
    const thumbGap = preview >= 80 ? 10 : 6
    // The thumbnails, their labels and the hint all sit under the flame, and on
    // a compact frame they are not drawn at all.
    const belowFlame = compact ? 0 : preview + 66
    const panelColumn = Math.round(Mathf.Clamp(stage.width * PANEL_SHARE, PANEL_MIN, PANEL_W))
    const columnW = stage.width - pad * 2 - (sideBySide && panel ? panelColumn + GAP : 0)
    const flameSize = Math.round(Mathf.Clamp(
        Math.min(columnW, stage.height - pad * 2 - belowFlame),
        compact ? COMPACT_FLAME_MIN : 160, 560))
    // A column beside the flame when there is room, a full width sheet over it
    // when there is not.
    const panelW = Math.round(compact ? stage.width - pad * 2 : Math.min(panelColumn, stage.width - pad * 2))
    const panelH = Math.round(stage.height - pad * 2)

    const set = (k: keyof Params, v: number) => setP((cur) => ({ ...cur, [k]: v }))
    const reset = () => setP(DEFAULTS)

    const [lean, setLean] = useState(0)
    const target = useRef(0)
    const drag = useRef({ active: false, nx: 0 })

    /**
     * Where across the flame the pointer is, from -1 at the left edge to 1 at
     * the right. `localX` is measured from the element the handler is on, so
     * this needs no bounds of its own; the flame's width is the one number the
     * layout above already decided.
     */
    const leanFrom = (e: PointerEventData): number => {
        const nx = (e.localX / flameSize - 0.5) * 2
        // NaN spreads quietly: it would reach the envelope's rotation and the
        // flame would then draw as nothing at all, with no error to say why.
        return Number.isFinite(nx) ? Mathf.Clamp(nx, -1, 1) : 0
    }

    // Ease toward the lean the drag is asking for, then round it to every other
    // degree. The envelope contains a blur, so it is worth rebuilding only when
    // the lean changes visibly rather than on every pointer move.
    useFrame((dt) => {
        const wanted = drag.current.active ? drag.current.nx * LEAN_MAX : 0
        target.current = Mathf.Lerp(target.current, wanted, 1 - Math.pow(0.02, dt))
        const step = Math.round(target.current / 2) * 2
        if (step !== lean) setLean(step)
    })

    // Built once per change of its own knobs, never null, so the frame below
    // can multiply by it without a guard.
    const envelope = fx.useImage(() => buildEnvelope(p, lean),
        [...ENVELOPE_KEYS.map(k => p[k]), lean])

    // Steps 1, 2 and 4, once per frame. Step 3, the envelope, is built above.
    // The build reads `p` straight from this render: the hook calls the latest
    // one each frame, so every knob outside the envelope takes effect on the
    // next frame without restarting the loop. Only a new envelope restarts it.
    const flame = fx.useAnimatedTexture(TEX, TEX, (t) => {
        // Two speeds, so the fine detail outruns the body and the picture never
        // settles into one texture sliding along.
        const turbulence = layer(fieldA(p), 1, 0, t)
            .multiply(1 - p.mix)
            .add(layer(fieldB(p), 2, 3.7, t).multiply(p.mix))
        const heat = turbulence.multiply(envelope)
        // The threshold is what turns fog into licks. The band starts above the
        // average brightness, so only peaks survive, and the envelope's fade
        // means fewer of them survive the higher up they are.
        return heat.remap(p.lo, p.hi, 0, 1).clamp(0, 1).ramp(EMBERS)
    }, [envelope])

    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "#07070a",
                       flexDirection: "row", alignItems: "center",
                       justifyContent: "center", padding: pad }}>

            <View style={{ alignItems: "center", justifyContent: "center", flexGrow: 1 }}>
                {/* The fire, and the gesture that blows on it. The handlers sit
                    on the flame itself, so dragging a slider does not also
                    lean it, and so localX is measured across the flame. */}
                <View
                    style={{ width: flameSize, height: flameSize, backgroundImage: flame }}
                    onPointerDown={(e) => { drag.current.active = true; drag.current.nx = leanFrom(e) }}
                    onPointerMove={(e) => { if (drag.current.active) drag.current.nx = leanFrom(e) }}
                    onPointerUp={() => { drag.current.active = false }}
                    onPointerLeave={() => { drag.current.active = false }}
                />

                {!compact && (
                <View style={{ flexDirection: "row", justifyContent: "center",
                               marginTop: 14 }}>
                    <View style={{ marginLeft: thumbGap, marginRight: thumbGap }}>
                        <FieldThumb label="field A, the body" field={fieldA(p)} seed={1} ox={0}
                                    size={preview} />
                    </View>
                    <View style={{ marginLeft: thumbGap, marginRight: thumbGap }}>
                        <FieldThumb label="field B, the detail" field={fieldB(p)} seed={2} ox={3.7}
                                    size={preview} />
                    </View>
                    <View style={{ marginLeft: thumbGap, marginRight: thumbGap }}>
                        {/* No animation of its own: the flame above already
                            builds this one, so it just shows that texture. */}
                        <Thumb label="envelope, blurred" size={preview}
                               texture={envelope.texture()} />
                    </View>
                </View>
                )}

                {!compact && (
                    <Text style={{ color: "#5a5a68", fontSize: 12, marginTop: 14 }}>
                        drag across the flame to blow on it
                    </Text>
                )}
            </View>

            {panel && (
                <View style={sideBySide
                    ? { width: panelColumn, height: panelH, marginLeft: GAP,
                        backgroundColor: "#0b0b10", borderRadius: 8,
                        borderWidth: 1, borderColor: "#1c1c24", padding: 14 }
                    : { position: "absolute", right: pad, top: pad,
                        width: panelW, height: panelH,
                        backgroundColor: "#0b0b10", borderRadius: 8,
                        borderWidth: 1, borderColor: "#1c1c24", padding: 14 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between",
                                   alignItems: "center", marginBottom: 4 }}>
                        <Text style={{ color: "#e8e8ef", fontSize: 14 }}>Fire, from nothing</Text>
                        <View style={{ flexDirection: "row" }}>
                            <Button text="reset" onClick={reset}
                                    style={{ fontSize: 11, marginRight: 6 }} />
                            <Button text="hide" onClick={() => setPanel(false)}
                                    style={{ fontSize: 11 }} />
                        </View>
                    </View>
                    <View style={{ height: 1, backgroundColor: "#1c1c24", marginBottom: 6 }} />
                    <ScrollView style={{ flexGrow: 1 }}>
                        {CONTROLS.map(c => (
                            <View key={c.key}>
                                {c.group && (
                                    <Text style={{ color: "#6b6b7a", fontSize: 10,
                                                   marginTop: 10, marginBottom: 2 }}>
                                        {c.group.toUpperCase()}
                                    </Text>
                                )}
                                <Knob c={c} value={p[c.key]} onChange={v => set(c.key, v)} />
                            </View>
                        ))}
                    </ScrollView>
                </View>
            )}

            {!panel && (
                <View style={{ position: "absolute", top: pad, right: pad }}>
                    <Button text="controls" onClick={() => setPanel(true)}
                            style={{ fontSize: 11 }} />
                </View>
            )}
        </View>
    )
}

mount(<Tinder />)
