import { useRef, useState } from "react"
import { View, Text, mount, useFrame, useStage, input, sl, encode, ShaderProgram } from "oj"
import { DIALS, DIAL_NAMES, clamp01, turnRate, type DialName, type Dials } from "./tuner"

/**
 * THE SHADER IS THE POINT.
 *
 * This is not a game. It is the shortest honest answer to "can the Play
 * container do shader programming, and is it pleasant?" So it shows a program
 * running on the GPU, the three numbers feeding it, and the code that produced
 * it, all at once. Nothing is hidden and there is nothing to win.
 *
 * Recorded at module scope on purpose. `sl.program` runs the function ONCE,
 * here at load, to record a graph; it does not run per pixel or per frame.
 * Building it inside a component would re-record it on every render.
 */
const field = encode(sl.program(({ uv, time }) => {
    const warp = sl.uniform.float("warp", 0.5)
    const hue = sl.uniform.float("hue", 0.5)
    const speed = sl.uniform.float("speed", 0.5)

    const t = time.mul(speed.mul(1.6).add(0.1))
    const p = uv.sub(0.5).mul(warp.mul(14).add(2))

    const v = sl.sin(p.x.add(t))
        .add(sl.sin(p.y.sub(t.mul(0.8))))
        .add(sl.sin(p.x.add(p.y).mul(0.7).add(t.mul(1.3))))

    const n = v.mul(0.22).add(0.5).saturate()

    const rgb = sl.hsv2rgb(sl.vec3(hue.add(n.mul(0.18)).fract(), 0.75, n.mul(0.7).add(0.25)))
    return sl.vec4(rgb, 1)
}))

/**
 * The same program, as text, because seeing it is the demonstration.
 *
 * Kept beside the real thing and pinned by a test: code shown next to its own
 * output is only worth anything if it is actually the code that ran, and a
 * snippet that drifts is worse than none.
 */
const SOURCE = [
    "sl.program(({ uv, time }) => {",
    "  const warp  = sl.uniform.float(\"warp\", 0.5)",
    "  const hue   = sl.uniform.float(\"hue\", 0.5)",
    "  const speed = sl.uniform.float(\"speed\", 0.5)",
    "",
    "  const t = time.mul(speed.mul(1.6).add(0.1))",
    "  const p = uv.sub(0.5).mul(warp.mul(14).add(2))",
    "",
    "  const v = sl.sin(p.x.add(t))",
    "    .add(sl.sin(p.y.sub(t.mul(0.8))))",
    "    .add(sl.sin(p.x.add(p.y).mul(0.7).add(t.mul(1.3))))",
    "",
    "  const n = v.mul(0.22).add(0.5).saturate()",
    "  const rgb = sl.hsv2rgb(",
    "    sl.vec3(hue.add(n.mul(0.18)).fract(), 0.75,",
    "            n.mul(0.7).add(0.25)))",
    "  return sl.vec4(rgb, 1)",
    "})",
]

const INK = "#e6edf3"
const DIM = "#8b95a5"
const FAINT = "#6b7688"
const GOLD = "#ffd166"

/**
 * Three layouts, not one layout multiplied by a number.
 *
 * The first attempt scaled every size by stage.width / 960, which is not
 * responsive design: it is one design shrunk, and it makes 13px type into 9px
 * type on a narrow stage while the proportions stay wrong anyway. Type has
 * sizes that are legible and sizes that are not, and there is no useful value
 * between them. So the sizes are fixed per step, and what changes between
 * steps is what is on screen and how it is arranged.
 */
interface Step {
    pad: number; title: number; body: number; small: number; code: number
    gap: number; stacked: boolean; prose: boolean; strapline: boolean; code_: boolean
}

function stepFor(width: number): Step {
    if (width >= 900) {
        return { pad: 30, title: 22, body: 15, small: 13, code: 12.5,
            gap: 22, stacked: false, prose: true, strapline: true, code_: true }
    }
    if (width >= 640) {
        return { pad: 24, title: 20, body: 15, small: 13, code: 11.5,
            gap: 16, stacked: false, prose: false, strapline: true, code_: true }
    }
    if (width >= 430) {
        return { pad: 18, title: 19, body: 14, small: 12, code: 11.5,
            gap: 12, stacked: true, prose: false, strapline: false, code_: true }
    }
    return { pad: 14, title: 18, body: 14, small: 12, code: 11,
        gap: 10, stacked: true, prose: false, strapline: false, code_: false }
}

/** One uniform: what it is called, what it does, and where it currently sits. */
function Dial({ name, does, value, selected, step }: {
    name: DialName; does: string; value: number; selected: boolean; step: Step
}) {
    return (
        <View style={{
            flexDirection: "row", alignItems: "center", marginBottom: 6,
            paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
            borderRadius: 8, backgroundColor: selected ? "#ffffff14" : "#00000000",
        }}>
            <Text style={{
                color: selected ? GOLD : DIM, width: 82, fontSize: step.body,
                whiteSpace: "nowrap",
            }}>
                {selected ? "▸ " : "  "}{name}
            </Text>

            {/* A real slider: the knob is WHERE THE VALUE IS. The version this
                replaced drew distance from a hidden target, which looked
                exactly like a slider and moved the opposite way when you were
                past the target. Nobody could read it, correctly.

                The track flexes; the label and the readout beside it do not.
                Those are type, and type has a size. */}
            <View style={{
                flexGrow: 1, height: 6, backgroundColor: "#1b2130", borderRadius: 3,
                marginRight: 10,
            }}>
                <View style={{
                    width: `${clamp01(value) * 100}%`, height: 6, borderRadius: 3,
                    backgroundColor: selected ? GOLD : "#3d4553",
                }} />
            </View>

            <Text style={{
                color: selected ? INK : DIM, width: 46, fontSize: step.small, whiteSpace: "nowrap",
            }}>
                {value.toFixed(2)}
            </Text>

            {step.prose
                ? <Text style={{ color: FAINT, fontSize: step.small, width: 190, whiteSpace: "nowrap" }}>{does}</Text>
                : null}
        </View>
    )
}

function App() {
    const [dials, setDials] = useState<Dials>({ warp: 0.5, hue: 0.5, speed: 0.5 })
    const [picked, setPicked] = useState(0)

    // The frame loop reads the latest state through refs rather than through
    // its closure, which would capture whatever these were when the effect ran.
    const now = useRef({ dials, picked, hold: 0 })
    now.current.dials = dials
    now.current.picked = picked

    useFrame((dt) => {
        const s = now.current

        // Unity's spelling. The browser calls these ArrowUp and ArrowDown, and
        // the container stores them under these names; asking for the browser
        // spelling used to match nothing at all and silently do nothing.
        if (input.keyboard.wasKeyPressed("UpArrow")) {
            setPicked((i) => (i + DIAL_NAMES.length - 1) % DIAL_NAMES.length)
        }
        if (input.keyboard.wasKeyPressed("DownArrow")) {
            setPicked((i) => (i + 1) % DIAL_NAMES.length)
        }

        const move = (input.keyboard.isKeyDown("RightArrow") ? 1 : 0)
            - (input.keyboard.isKeyDown("LeftArrow") ? 1 : 0)
        s.hold = move === 0 ? 0 : s.hold + dt
        if (move === 0) return

        const name = DIAL_NAMES[s.picked]!
        setDials({ ...s.dials, [name]: clamp01(s.dials[name] + move * turnRate(s.hold) * dt) })
    }, [])

    const stage = useStage()
    const step = stepFor(stage.width)
    const room = stage.width - step.pad * 2
    // Layout sizes DO follow the space, which is the part that should. A panel
    // is a shape in a box; type is not.
    const shader = Math.round(Math.max(130, Math.min(
        step.stacked ? room : room * 0.42,
        stage.height * (step.stacked ? 0.34 : 0.58),
    )))

    return (
        <View style={{
            flexGrow: 1, backgroundColor: "#0c1016",
            paddingLeft: step.pad, paddingRight: step.pad, paddingTop: 16,
        }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                <Text style={{ color: INK, fontSize: step.title, whiteSpace: "nowrap" }}>Tuner</Text>
                {step.strapline
                    ? <Text style={{ color: FAINT, fontSize: step.small, marginLeft: 12, whiteSpace: "nowrap" }}>
                        a shader, its uniforms, and the code that made it
                    </Text>
                    : null}
            </View>

            <View style={{
                flexDirection: step.stacked ? "column" : "row",
                alignItems: step.stacked ? "stretch" : "flex-start",
                marginTop: 8,
            }}>
                <ShaderProgram
                    program={field}
                    uniforms={{ warp: dials.warp, hue: dials.hue, speed: dials.speed }}
                    style={{
                        width: step.stacked ? "100%" : shader, height: shader,
                        borderRadius: 12, borderWidth: 2, borderColor: "#232a37",
                    }}
                />

                {/* The code, beside its own output, highlighted by the runtime
                    rather than by this game. It is the first thing to go when
                    the stage cannot hold both: a column of clipped code teaches
                    nothing. */}
                {/* Drawn here rather than with the runtime's `Code`, which is
                    the right home for this and is already written and tested.
                    `oj` is baked into the container, so a game cannot use a new
                    export until a container ships with it: importing Code from
                    "oj" against runtime 1.0.26 makes it undefined and takes the
                    whole game down. This comes out the moment the runtime that
                    has it is live. */}
                {step.code_
                    ? <View style={{
                        marginLeft: step.stacked ? 0 : step.gap,
                        marginTop: step.stacked ? step.gap : 0,
                        paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
                        backgroundColor: "#070a0f", borderRadius: 10,
                        borderWidth: 1, borderColor: "#1b2130", flexGrow: 1,
                    }}>
                        {SOURCE.map((line, i) => {
                            // Indent with padding: UI Toolkit collapses leading
                            // whitespace, so spaces render flush left.
                            const body = line.trimStart()
                            const lead = line.length - body.length
                            return (
                                <Text key={i} style={{
                                    color: body.startsWith("const") || body.startsWith("return")
                                        ? "#9db2d0" : DIM,
                                    fontSize: step.code, whiteSpace: "nowrap",
                                    paddingLeft: lead * Math.round(step.code * 0.5),
                                }}>
                                    {body === "" ? " " : body}
                                </Text>
                            )
                        })}
                    </View>
                    : null}
            </View>

            <View style={{ marginTop: 14 }}>
                {DIALS.map((d, i) => (
                    <Dial key={d.name} name={d.name} does={d.does} step={step}
                        value={dials[d.name]} selected={i === picked} />
                ))}
            </View>

            <Text style={{ color: FAINT, fontSize: step.small, marginTop: 6, whiteSpace: "nowrap" }}>
                up and down to pick a uniform, left and right to change it
            </Text>
        </View>
    )
}

mount(<App />)
