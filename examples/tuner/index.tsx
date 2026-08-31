import { useRef, useState } from "react"
import { View, Text, mount, useFrame, input, sl, encode, ShaderProgram } from "oj"
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

/** One uniform: what it is called, what it does, and where it currently sits. */
function Dial({ name, does, value, selected }: {
    name: DialName; does: string; value: number; selected: boolean
}) {
    return (
        <View style={{
            flexDirection: "row", alignItems: "center", marginBottom: 6,
            paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
            borderRadius: 8, backgroundColor: selected ? "#ffffff14" : "#00000000",
        }}>
            <Text style={{
                color: selected ? GOLD : DIM, width: 84, fontSize: 15,
                whiteSpace: "nowrap",
            }}>
                {selected ? "▸ " : "  "}{name}
            </Text>

            {/* A real slider: the knob is WHERE THE VALUE IS. The version this
                replaced drew distance from a hidden target, which looked
                exactly like a slider and moved the opposite way when you were
                past the target. Nobody could read it, correctly. */}
            <View style={{ width: 240, height: 6, backgroundColor: "#1b2130", borderRadius: 3 }}>
                <View style={{
                    width: clamp01(value) * 240, height: 6, borderRadius: 3,
                    backgroundColor: selected ? GOLD : "#3d4553",
                }} />
            </View>

            <Text style={{ color: selected ? INK : DIM, width: 52, fontSize: 14, marginLeft: 10 }}>
                {value.toFixed(2)}
            </Text>
            <Text style={{ color: FAINT, fontSize: 13, whiteSpace: "nowrap" }}>{does}</Text>
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

    return (
        <View style={{ flexGrow: 1, backgroundColor: "#0c1016", paddingLeft: 30, paddingRight: 30, paddingTop: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                <Text style={{ color: INK, fontSize: 22, whiteSpace: "nowrap" }}>Tuner</Text>
                <Text style={{ color: FAINT, fontSize: 14, marginLeft: 12, whiteSpace: "nowrap" }}>
                    a shader, its uniforms, and the code that made it
                </Text>
            </View>

            <View style={{ flexDirection: "row", marginTop: 8 }}>
                <ShaderProgram
                    program={field}
                    uniforms={{ warp: dials.warp, hue: dials.hue, speed: dials.speed }}
                    style={{ width: 330, height: 330, borderRadius: 12, borderWidth: 2, borderColor: "#232a37" }}
                />

                {/* The code, beside its own output. This is the demonstration:
                    that is a GPU shader, and this is all it took. */}
                <View style={{
                    marginLeft: 22, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
                    backgroundColor: "#070a0f", borderRadius: 10, borderWidth: 1, borderColor: "#1b2130",
                    flexGrow: 1,
                }}>
                    {SOURCE.map((line, i) => (
                        <Text key={i} style={{
                            color: line.trimStart().startsWith("const") || line.trimStart().startsWith("return")
                                ? "#9db2d0" : DIM,
                            fontSize: 12.5, whiteSpace: "nowrap",
                        }}>
                            {line === "" ? " " : line}
                        </Text>
                    ))}
                </View>
            </View>

            <View style={{ marginTop: 14 }}>
                {DIALS.map((d, i) => (
                    <Dial key={d.name} name={d.name} does={d.does}
                        value={dials[d.name]} selected={i === picked} />
                ))}
            </View>

            <Text style={{ color: FAINT, fontSize: 13, marginTop: 6, whiteSpace: "nowrap" }}>
                up and down to pick a uniform, left and right to change it
            </Text>
        </View>
    )
}

mount(<App />)
