import { useRef, useState } from "react"
import { View, Text, Button, Slider, ScrollView, mount, useFrame, useStage, fx, Mathf } from "oj"

/**
 * A fire with no art in it.
 *
 * Vertically stretched noise rising through a soft tapered envelope, thresholded
 * into tongues and coloured by a ramp. Every frame is one crossing into C# and a
 * handful of fragment blits, which is why this runs in a browser at all: the
 * compute shader version of this effect cannot, because WebGL2 has no compute
 * shaders.
 *
 * Every number that shapes it is on a slider, because none of them can be
 * reasoned to: the only way to find them is to watch the picture while you move
 * them. The three thumbnails under the flame are its actual inputs, which the
 * finished picture never shows: it multiplies them, thresholds the product and
 * colours what survives, and by then a field that has gone flat and one that has
 * gone to static look much the same through the ramp.
 */

const TEX = 512
/** Thumbnails render at this size whatever they are shown at: the noise is a
 *  function of normalised uv, so a smaller box is the same field sampled coarser. */
const PREVIEW = 96
const PAD = 20
const GAP = 16
const PANEL_W = 320
/** Below this the flame and the panel side by side leave neither enough room,
 *  so the panel stops taking a column and overlays instead. */
const SIDE_BY_SIDE_MIN = 900

/** How far, in degrees, a drag all the way to one edge leans the flame. */
const LEAN_MAX = 14

const EMBERS: { color: [number, number, number, number]; at: number }[] = [
    { color: [0.15, 0, 0, 0], at: 0 },          // transparent: sits on any background
    { color: [0.7, 0.06, 0, 0.55], at: 0.3 },   // dark red, still see-through
    { color: [1, 0.28, 0.02, 0.92], at: 0.52 }, // orange body
    { color: [1, 0.62, 0.08, 1], at: 0.74 },    // yellow
    { color: [1, 0.93, 0.62, 1], at: 1 },       // near-white, only at the hottest
]

/** One noise field. The two are independent all the way down. */
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

/** Found by dragging, which is the only way any of these were ever going to be. */
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
 * Which knobs feed the envelope, and so cost a blur when they move. Everything
 * else is read fresh each frame and costs nothing to change.
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
 * Ranges are deliberately generous at the low end. The first pass floored scale
 * at 0.5 and stretch at 0.2, and the settings worth having turned out to sit on
 * both of those stops, which is the shape of a range that is wrong rather than a
 * value that is right.
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
function buildEnvelope(p: Params, lean: number) {
    const shape = fx.image
        .sdf(TEX, TEX, "unevenCapsule", {
            rBottom: p.rBottom, rTop: p.rTop, h: p.height, y: p.baseY,
            // Leaning the silhouette is what selling "blowing on it" needs: the
            // noise alone reads as flicker, not as direction.
            rotation: lean,
        })
        .clamp(0, 1)
        .blur(Math.round(p.blur))
    // The gradient's 0 stop sits at low v, and low v is the bottom of the
    // element, so white at 0 is a bright base.
    const fromBase = fx.image
        .gradient(TEX, TEX, [
            { color: [1, 1, 1, 1], at: 0 },
            { color: [0.06, 0.06, 0.06, 1], at: 1 },
        ], 90)
        .pow(p.falloff)
    return shape.multiply(fromBase)
}

/**
 * One layer of rising turbulence.
 *
 * Stretching it, rather than adding octaves, is what makes it read as flame: an
 * isotropic field gives round blobs, and a flame is vertical streaks.
 *
 * The offset is negative in y because the field has to travel the way the flame
 * rises. Scrolling it positive is the same picture flowing downward, which is
 * unmistakable to look at and invisible to every numeric check.
 *
 * Simplex, not the default value noise. Value noise interpolates a square grid,
 * so at the octave gain a flame wants its cells show through as blocks.
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

function Thumb({ label, texture, size }: { label: string; texture: unknown; size: number }) {
    return (
        <View style={{ alignItems: "center" }}>
            <View style={{ width: size, height: size, backgroundColor: "#101014",
                           borderWidth: 1, borderColor: "#26262f", borderRadius: 4,
                           backgroundImage: texture as any }} />
            <Text style={{ color: "#6b6b7a", fontSize: 10, marginTop: 5 }}>{label}</Text>
        </View>
    )
}

/**
 * Its own component, so its animated target is its own. Deps are empty on
 * purpose: the build reads the live params, so a slider changes what this shows
 * on the next frame without tearing down the loop.
 *
 * Rendered small, since the noise is a function of normalised uv: a 96 square is
 * the same field as the 512 one, just sampled coarser.
 */
function FieldThumb({ label, pick, seed, ox, live, size }: {
    label: string; pick: (p: Params) => Field; seed: number; ox: number
    live: { current: Params }; size: number
}) {
    const tex = fx.useAnimatedTexture(PREVIEW, PREVIEW,
        (t) => layer(pick(live.current), seed, ox, t, PREVIEW), [])
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
    const [p, setP] = useState<Params>(DEFAULTS)
    const [panel, setPanel] = useState(true)
    const stage = useStage()

    // Every size below is derived from the stage rather than declared, which is
    // the whole difference between this and the fixed 960x700 it used to be.
    const sideBySide = stage.width >= SIDE_BY_SIDE_MIN
    const preview = Math.round(Mathf.Clamp(stage.width * 0.09, 52, PREVIEW))
    const thumbGap = preview >= 80 ? 10 : 6
    // The thumbnails, their labels and the hint all sit under the flame.
    const belowFlame = preview + 66
    const columnW = stage.width - PAD * 2 - (sideBySide && panel ? PANEL_W + GAP : 0)
    const flameSize = Math.round(Mathf.Clamp(
        Math.min(columnW, stage.height - PAD * 2 - belowFlame), 160, 560))
    const panelW = Math.round(Math.min(PANEL_W, stage.width - PAD * 2))
    const panelH = Math.round(stage.height - PAD * 2)

    /**
     * The same values the sliders show, readable from inside the frame loop.
     *
     * State alone would not do: the animated chain is built by a callback whose
     * effect only re-runs when its deps change, so it would keep whichever
     * params it closed over. Putting them in a ref lets every knob outside the
     * envelope take effect on the very next frame without restarting the loop.
     */
    const live = useRef<Params>(p)
    const set = (k: keyof Params, v: number) => {
        live.current = { ...live.current, [k]: v }
        setP(live.current)
    }
    const reset = () => { live.current = DEFAULTS; setP(DEFAULTS) }

    // Quantised, so the envelope is rebuilt only when the lean visibly changes
    // rather than on every pointer move: it contains a blur.
    const [lean, setLean] = useState(0)
    const target = useRef(0)

    /**
     * The flame's own box, used to turn a pointer position into a lean.
     *
     * A pointer event reports { x, y } in PANEL space, and worldBound is in that
     * same space, so the two subtract cleanly whatever the stage is scaled to.
     * The previous version read input.mouse.position instead, which is Unity
     * screen space: a different origin, physical rather than logical pixels, and
     * blind to the letterbox offset. It also tested input.mouse.held, which does
     * not exist on the mouse (the member is leftButton), so the whole gesture was
     * reading undefined and the flame never leaned at all.
     */
    const flameBox = useRef<any>(null)
    const drag = useRef({ active: false, nx: 0 })

    const leanFrom = (e: { x: number }): number => {
        const el = flameBox.current
        if (el === null) return 0
        const b = el.worldBound
        // worldBound is NaN until the first layout pass, and NaN propagates
        // silently through the lerp into the envelope's rotation, where it
        // renders as nothing at all rather than as an error.
        if (!b || !(b.width > 0)) return 0
        const nx = ((e.x - b.x) / b.width - 0.5) * 2
        return Number.isNaN(nx) ? 0 : Mathf.Clamp(nx, -1, 1)
    }

    useFrame((dt) => {
        const wanted = drag.current.active ? drag.current.nx * LEAN_MAX : 0
        target.current = Mathf.Lerp(target.current, wanted, 1 - Math.pow(0.02, dt))
        const step = Math.round(target.current / 2) * 2
        if (step !== lean) setLean(step)
    })

    const envelope = fx.useImage(() => buildEnvelope(p, lean),
        [...ENVELOPE_KEYS.map(k => p[k]), lean])

    const flame = fx.useAnimatedTexture(TEX, TEX, (t) => {
        const q = live.current
        // Two rates, so the fine detail outruns the body and the whole thing
        // never resolves into one sliding texture.
        const turbulence = layer(fieldA(q), 1, 0, t)
            .multiply(1 - q.mix)
            .add(layer(fieldB(q), 2, 3.7, t).multiply(q.mix))
        const heat = envelope ? turbulence.multiply(envelope) : turbulence
        // The threshold is what turns fog into licks: the band starts above the
        // product's mean so only the peaks survive, and the envelope's falloff
        // means fewer of them survive the higher up they are.
        return heat.remap(q.lo, q.hi, 0, 1).clamp(0, 1).ramp(EMBERS)
    }, [envelope])

    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "#07070a",
                       flexDirection: "row", alignItems: "center",
                       justifyContent: "center", padding: PAD }}>

            {/* The fire, and the gesture. Handlers sit here rather than on the
                stage root so dragging a slider never also leans the flame. */}
            <View
                style={{ alignItems: "center", justifyContent: "center", flexGrow: 1 }}
                onPointerDown={(e: any) => { drag.current.active = true; drag.current.nx = leanFrom(e) }}
                onPointerMove={(e: any) => { if (drag.current.active) drag.current.nx = leanFrom(e) }}
                onPointerUp={() => { drag.current.active = false }}
                onPointerLeave={() => { drag.current.active = false }}
            >
                <View ref={flameBox as any}
                      style={{ width: flameSize, height: flameSize, backgroundImage: flame as any }} />

                <View style={{ flexDirection: "row", justifyContent: "center",
                               marginTop: 14 }}>
                    <View style={{ marginLeft: thumbGap, marginRight: thumbGap }}>
                        <FieldThumb label="field A, the body" pick={fieldA} seed={1} ox={0}
                                    live={live} size={preview} />
                    </View>
                    <View style={{ marginLeft: thumbGap, marginRight: thumbGap }}>
                        <FieldThumb label="field B, the detail" pick={fieldB} seed={2} ox={3.7}
                                    live={live} size={preview} />
                    </View>
                    <View style={{ marginLeft: thumbGap, marginRight: thumbGap }}>
                        {/* No render of its own: the flame already holds this one. */}
                        <Thumb label="envelope, blurred" size={preview}
                               texture={envelope ? envelope.texture() : null} />
                    </View>
                </View>

                <Text style={{ color: "#5a5a68", fontSize: 12, marginTop: 14 }}>
                    drag across the flame to blow on it
                </Text>
            </View>

            {panel && (
                <View style={sideBySide
                    ? { width: PANEL_W, height: panelH, marginLeft: GAP,
                        backgroundColor: "#0b0b10", borderRadius: 8,
                        borderWidth: 1, borderColor: "#1c1c24", padding: 14 }
                    : { position: "absolute", right: PAD, top: PAD,
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
                <View style={{ position: "absolute", top: PAD, right: PAD }}>
                    <Button text="controls" onClick={() => setPanel(true)}
                            style={{ fontSize: 11 }} />
                </View>
            )}
        </View>
    )
}

mount(<Tinder />)
