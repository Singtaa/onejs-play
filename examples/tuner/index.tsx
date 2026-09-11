import { useState } from "react"
import { View, Text, Slider, Code, mount, useStage, ShaderProgram } from "oj"
import { DIALS, layoutFor, type DialName, type Dials, type Step } from "./tuner"

/**
 * THE SHADER IS THE POINT.
 *
 * This is not a game. It is the shortest honest answer to "can the Play
 * container do shader programming, and is it pleasant?" So it shows a program
 * running on the GPU, the three numbers feeding it, and the file that produced
 * it, all at once. Nothing is hidden and there is nothing to win.
 *
 * `plasma.sl` is parsed and encoded BY THE BUILD, so what this import resolves
 * to is a small object of numbers: no parser and no shader text ride along in
 * the bundle a player downloads.
 *
 * `source` is the file's own text, and it is why the panel beside the picture
 * cannot be wrong. It used to be a copy of the program typed out as an array of
 * strings, kept honest by a test that compared the two line by line, because a
 * snippet that drifts from the code it claims to show teaches an API that does
 * not exist. Now there is one copy of the program and the panel reads it. The
 * named export is dropped from any bundle that does not ask for it.
 */
import plasma, { source } from "./plasma.sl"

const SOURCE = source.trimEnd().split("\n")

const INK = "#e6edf3"
const DIM = "#8b95a5"
const FAINT = "#6b7688"

/** One uniform: what it is called, what it does, and a control for it. */
function Dial({ name, does, value, onChange, step }: {
    name: DialName; does: string; value: number
    onChange: (value: number) => void; step: Step
}) {
    return (
        <View style={{
            flexDirection: "row", alignItems: "center", marginBottom: 4,
            paddingLeft: 10, paddingRight: 10, paddingTop: 3, paddingBottom: 3,
        }}>
            <Text style={{ color: DIM, width: 82, fontSize: step.body, whiteSpace: "nowrap" }}>
                {name}
            </Text>

            {/*
             * UI Toolkit's own Slider, which is a focus target that drags with
             * a pointer and nudges with the arrow keys, and which the
             * container's theme already styles.
             *
             * This was a bar drawn by hand and moved only by polling the
             * keyboard, so it looked like a control and was not one: nobody
             * could drag it, and it was the only way to change a uniform. A
             * demonstration that the container can do shaders should not also
             * be demonstrating that it cannot do a slider.
             */}
            <Slider
                value={value} lowValue={0} highValue={1}
                onChange={(e: { value: number }) => onChange(e.value)}
                style={{ flexGrow: 1, marginRight: 10 }}
            />

            <Text style={{ color: INK, width: 46, fontSize: step.small, whiteSpace: "nowrap" }}>
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

    const stage = useStage()
    const { step, shader, code } = layoutFor(stage.width, stage.height, SOURCE.length)

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
                    program={plasma}
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
                {code
                    ? <Code source={SOURCE} fontSize={step.code} style={{
                        marginLeft: step.stacked ? 0 : step.gap,
                        marginTop: step.stacked ? step.gap : 0,
                        paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
                        backgroundColor: "#070a0f", borderRadius: 10,
                        borderWidth: 1, borderColor: "#1b2130", flexGrow: 1,
                        // If the height estimate in layoutFor is ever short,
                        // the panel clips its last lines. Without this the
                        // lines shrink to fit and draw over each other, which
                        // is how a 600 by 420 embed first looked.
                        overflow: "hidden",
                    }} />
                    : null}
            </View>

            <View style={{ marginTop: 14 }}>
                {DIALS.map((d) => (
                    <Dial key={d.name} name={d.name} does={d.does} step={step}
                        value={dials[d.name]}
                        onChange={(v) => setDials((cur) => ({ ...cur, [d.name]: v }))} />
                ))}
            </View>

            <Text style={{ color: FAINT, fontSize: step.small, marginTop: 6, whiteSpace: "nowrap" }}>
drag a slider, or tab to one and use the arrow keys
            </Text>
        </View>
    )
}

mount(<App />)
