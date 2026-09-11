import { useState } from "react"
import { View, Text, Slider, Code, mount, useStage, ShaderProgram } from "oj"
import ember, { source } from "./ember.sl"

/**
 * A fire, and the file that draws it.
 *
 * `ember.sl` is parsed, checked and encoded BY THE BUILD, so this import is a
 * small object of numbers: the bundle a player downloads carries no parser and,
 * unless something asks for it, no shader text either. The panel asks, which is
 * why what it shows cannot drift from what runs. There is one copy.
 *
 * What the file is here to demonstrate:
 *
 *   texture2D smoke;        a sampler, bound by name from `textures` below
 *   for (int i = 0; i < 3;) a loop that unrolls at build time
 *   float plume(...)        a function that inlines, so it costs nothing
 *   uniform float2 source   a vector uniform, driven by the pointer
 *   ramp(t, #..., #...)     colours as written, mixed in sRGB
 *
 * It sits at 8 of the VM's 8 registers, so it is also a fair picture of what
 * fits. A ninth live value is refused when the game is built.
 *
 * Interpreted here and compiled after an eject, from the same file, with no
 * edit in between.
 */

const INK = "#f2e8dc"
const DIM = "#9a8b7d"
const FAINT = "#6f6257"
const SOURCE = source.trimEnd().split("\n")

function Dial({ name, does, value, onChange, small }: {
    name: string; does: string; value: number
    onChange: (v: number) => void; small: number
}) {
    return (
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
            <Text style={{ color: DIM, width: 52, fontSize: small, whiteSpace: "nowrap" }}>{name}</Text>
            <Slider value={value} lowValue={0} highValue={1}
                onChange={(e: { value: number }) => onChange(e.value)}
                style={{ flexGrow: 1, marginRight: 10 }} />
            <Text style={{ color: DIM, width: 42, fontSize: small, whiteSpace: "nowrap" }}>
                {value.toFixed(2)}
            </Text>
            <Text style={{ color: FAINT, fontSize: small, width: 176, whiteSpace: "nowrap" }}>{does}</Text>
        </View>
    )
}

function App() {
    const [heat, setHeat] = useState(0.55)
    const [source2, setSource] = useState<[number, number, number, number]>([0.5, 0.08, 0, 0])

    const stage = useStage()
    // The code goes first when there is not room for both: a column of clipped
    // lines teaches nothing, and the fire is the thing worth looking at.
    const wide = stage.width >= 820
    const small = stage.width < 640 ? 11 : 13
    const canvas = wide ? Math.min(440, stage.height - 190) : Math.min(stage.width - 32, stage.height - 250)

    /** Pointer position as uv, with y up, which is what the shader reads. */
    const aim = (e: { localX: number; localY: number; currentTarget?: unknown }) => {
        const size = canvas
        setSource([
            Math.min(1, Math.max(0, e.localX / size)),
            Math.min(1, Math.max(0, 1 - e.localY / size)),
            0, 0,
        ])
    }

    return (
        <View style={{
            flexGrow: 1, backgroundColor: "#0a0806",
            paddingLeft: 16, paddingRight: 16, paddingTop: 14,
        }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                <Text style={{ color: INK, fontSize: 22, whiteSpace: "nowrap" }}>Ember</Text>
                <Text style={{ color: FAINT, fontSize: small, marginLeft: 12, whiteSpace: "nowrap" }}>
                    a fire, and the shader file that draws it
                </Text>
            </View>

            <View style={{ flexDirection: wide ? "row" : "column", alignItems: "flex-start" }}>
                <View
                    onPointerDown={aim}
                    onPointerMove={(e: { localX: number; localY: number; pressure?: number }) => {
                        // Only while held: a flame that follows the cursor
                        // everywhere reads as a bug rather than a control.
                        if ((e.pressure ?? 0) > 0) aim(e)
                    }}
                    style={{
                        width: canvas, height: canvas, borderRadius: 12,
                        borderWidth: 2, borderColor: "#241a12", overflow: "hidden",
                    }}
                >
                    <ShaderProgram
                        program={ember}
                        uniforms={{ heat, source: source2 }}
                        textures={{ smoke: "noise" }}
                        style={{ width: "100%", height: "100%" }}
                    />
                </View>

                {wide
                    ? <Code source={SOURCE} fontSize={11} style={{
                        marginLeft: 18, paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 10,
                        backgroundColor: "#060504", borderRadius: 10,
                        borderWidth: 1, borderColor: "#1d160f", flexGrow: 1, overflow: "hidden",
                    }} />
                    : null}
            </View>

            <View style={{ marginTop: 12 }}>
                <Dial name="heat" does="how much fuel there is" value={heat} onChange={setHeat} small={small} />
            </View>

            <Text style={{ color: FAINT, fontSize: small, marginTop: 8, whiteSpace: "nowrap" }}>
                drag on the fire to move it
            </Text>
        </View>
    )
}

mount(<App />)
