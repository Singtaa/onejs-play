import { useRef, useState } from "react"
import {
    View, Text, mount, useFrame, input, random,
    sl, encode, ShaderProgram,
} from "oj"
import {
    DIAL_NAMES, ROUND_SECONDS, closeness, isTuned, makeTarget, roundScore, clamp01,
    type DialName, type Dials,
} from "./tuner"

/**
 * THE SHADER IS THE GAME.
 *
 * Two panels run the SAME program with different uniform values. One holds the
 * target, one holds yours, and matching them is the round. That is also the
 * clearest way to see what a program is: a constant, recorded once, with the
 * values that actually vary passed in beside it.
 *
 * Recorded at module scope on purpose. `sl.program` runs the function ONCE, here
 * at load, to record a graph; it does not run per pixel or per frame. Building
 * it inside a component would re-record it on every render for no reason.
 */
const field = encode(sl.program(({ uv, time }) => {
    // Uniforms are the parts a round changes. Everything else is baked in.
    const warp = sl.uniform.float("warp", 0.5)
    const hue = sl.uniform.float("hue", 0.5)
    const speed = sl.uniform.float("speed", 0.5)

    const t = time.mul(speed.mul(1.6).add(0.1))
    const p = uv.sub(0.5).mul(warp.mul(14).add(2))

    // Three drifting waves. Their sum is the pattern, and the fact that it
    // never repeats is the whole reason this is a shader rather than a texture.
    const v = sl.sin(p.x.add(t))
        .add(sl.sin(p.y.sub(t.mul(0.8))))
        .add(sl.sin(p.x.add(p.y).mul(0.7).add(t.mul(1.3))))

    const n = v.mul(0.22).add(0.5).saturate()

    // Hue has to be a uniform, so a colour ramp cannot do this: a ramp's stops
    // are constants. hsv2rgb takes the hue as a value like any other.
    const rgb = sl.hsv2rgb(sl.vec3(hue.add(n.mul(0.18)).fract(), 0.75, n.mul(0.7).add(0.25)))
    return sl.vec4(rgb, 1)
}))

const STEP = 0.02
const rand = random()

function Panel({ dials, label, tint }: { dials: Dials; label: string; tint: string }) {
    return (
        <View style={{ alignItems: "center" }}>
            <Text style={{ color: tint, fontSize: 15, marginBottom: 6, letterSpacing: 1 }}>{label}</Text>
            <ShaderProgram
                program={field}
                uniforms={{ warp: dials.warp, hue: dials.hue, speed: dials.speed }}
                style={{
                    width: 320, height: 320, borderRadius: 12,
                    borderWidth: 2, borderColor: tint,
                }}
            />
        </View>
    )
}

function Dial({ name, value, target, selected }: {
    name: DialName; value: number; target: number; selected: boolean
}) {
    const near = closeness(value, target)
    return (
        <View style={{
            flexDirection: "row", alignItems: "center", marginBottom: 8,
            paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
            borderRadius: 8,
            backgroundColor: selected ? "#ffffff18" : "#00000000",
        }}>
            <Text style={{ color: selected ? "#ffd166" : "#9aa4b2", width: 70, fontSize: 15 }}>
                {selected ? "▸ " : "  "}{name}
            </Text>
            {/* The meter is the only feedback there is. Without it you are
                guessing at a picture; with it you are converging on one. */}
            <View style={{ width: 220, height: 10, backgroundColor: "#1b2130", borderRadius: 5 }}>
                <View style={{
                    width: Math.max(2, near * 220), height: 10, borderRadius: 5,
                    backgroundColor: near > 0.94 ? "#7ee787" : near > 0.7 ? "#ffd166" : "#4a5568",
                }} />
            </View>
        </View>
    )
}

function Game() {
    const [target, setTarget] = useState<Dials>(() => makeTarget(() => rand.next()))
    const [dials, setDials] = useState<Dials>({ warp: 0.5, hue: 0.5, speed: 0.5 })
    const [picked, setPicked] = useState(0)
    const [score, setScore] = useState(0)
    const [left, setLeft] = useState(ROUND_SECONDS)
    const [flash, setFlash] = useState("")

    /**
     * The frame loop reads the latest state through refs rather than through
     * its closure.
     *
     * Everything below could be written with `dials` and `target` directly and
     * a dependency array, and it would be subtly wrong: useFrame would capture
     * whatever they were when the effect last ran, so a round could be scored
     * against a stale target. Refs are read at the moment the frame runs.
     */
    const now = useRef({ target, dials, left, picked, hold: 0 })
    now.current.target = target
    now.current.dials = dials
    now.current.left = left
    now.current.picked = picked

    useFrame((dt) => {
        const s = now.current

        if (input.keyboard.wasKeyPressed("ArrowUp")) setPicked((i) => (i + DIAL_NAMES.length - 1) % DIAL_NAMES.length)
        if (input.keyboard.wasKeyPressed("ArrowDown")) setPicked((i) => (i + 1) % DIAL_NAMES.length)

        const move = (input.keyboard.isKeyDown("ArrowRight") ? 1 : 0) - (input.keyboard.isKeyDown("ArrowLeft") ? 1 : 0)
        s.hold = move === 0 ? 0 : s.hold + dt

        let next = s.dials
        if (move !== 0) {
            // Accelerates while held, so a coarse sweep and a fine nudge are the
            // same control rather than two.
            const rate = STEP * (1 + Math.min(s.hold, 1.5) * 6) * 60 * dt
            const name = DIAL_NAMES[s.picked]
            next = { ...s.dials, [name]: clamp01(s.dials[name] + move * rate) }
            setDials(next)
        }

        const remaining = s.left - dt

        // Both transitions happen HERE, in the frame, not during render. An
        // earlier version scored the round while rendering, which only ever
        // converged by luck: a fresh target that happened to already be tuned
        // would have set state during render forever.
        if (isTuned(s.target, next)) {
            const gained = roundScore(remaining)
            setScore((v) => v + gained)
            setFlash("+" + gained)
            setTarget(makeTarget(() => rand.next()))
            setLeft(ROUND_SECONDS)
            return
        }
        if (remaining <= 0) {
            setFlash("out of time")
            setTarget(makeTarget(() => rand.next()))
            setLeft(ROUND_SECONDS)
            return
        }
        setLeft(remaining)
    }, [])

    return (
        <View style={{ flexGrow: 1, backgroundColor: "#0c1016", alignItems: "center", paddingTop: 18 }}>
            <View style={{ flexDirection: "row", width: 900, justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: "#e6edf3", fontSize: 22 }}>Tuner</Text>
                <Text style={{ color: "#7ee787", fontSize: 22 }}>{score}</Text>
            </View>

            <View style={{ flexDirection: "row" }}>
                <Panel dials={target} label="TARGET" tint="#58a6ff" />
                <View style={{ width: 24 }} />
                <Panel dials={dials} label="YOURS" tint="#ffd166" />
            </View>

            <View style={{ marginTop: 16 }}>
                {DIAL_NAMES.map((n, i) => (
                    <Dial key={n} name={n} value={dials[n]} target={target[n]} selected={i === picked} />
                ))}
            </View>

            <Text style={{ color: "#6b7688", fontSize: 13, marginTop: 6 }}>
                up and down to pick a dial, left and right to turn it
            </Text>
            <Text style={{ color: "#9aa4b2", fontSize: 15, marginTop: 8 }}>
                {flash || `${Math.ceil(left)}s`}
            </Text>
        </View>
    )
}

mount(<Game />)
