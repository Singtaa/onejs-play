/**
 * Particle Lab: turn the knobs, watch the effect, copy the config.
 *
 * This one is a tool rather than a game, and the thing it is a tool for is the
 * particle system in oj. Every control here maps to one field of the config a
 * game passes to useParticles, and the panel at the bottom prints exactly the
 * config that is running, so what is on screen can be lifted into a real
 * project without translating anything.
 *
 * WHY IT REBUILDS THE SYSTEM ON EVERY CHANGE
 *
 * A particle system reads its config once, when it is created: the whole point
 * of the design is that steady-state emission costs no JavaScript at all, and
 * that is only possible because C# owns the numbers. Nothing sends a new speed
 * range to a running system.
 *
 * So changing a knob here disposes the system and makes a new one, which is why
 * the effect restarts as a slider moves. In a game that would be wrong; in a lab
 * it is the honest thing, because it is exactly what the printed config would do
 * if it were pasted somewhere.
 */

import { useRef, useState } from "react"
import { View, Text, Button, Slider, ScrollView, mount, useParticles } from "oj"
import { PRESETS, toEmitter, toSource, shiftHue, type Knobs } from "./presets"

const WIDTH = 980
const HEIGHT = 620
const PANEL = 330
const STAGE_W = WIDTH - PANEL
const MAX = 1400

const INK = "rgb(226, 234, 247)"
const DIM = "rgb(126, 138, 162)"
const PANEL_BG = "rgb(21, 25, 32)"

function Knob({ label, value, min, max, step, onChange, format }: {
    label: string
    value: number
    min: number
    max: number
    step?: number
    onChange: (next: number) => void
    format?: (n: number) => string
}) {
    return (
        <View style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 11, color: DIM }}>{label}</Text>
                <Text style={{ fontSize: 11, color: INK }}>
                    {(format ?? ((n: number) => String(Math.round(n))))(value)}
                </Text>
            </View>
            <Slider
                value={value}
                lowValue={min}
                highValue={max}
                pageSize={step ?? 0}
                onChange={(e: any) => onChange(e.newValue)}
            />
        </View>
    )
}

function ParticleLab() {
    const host = useRef(null)
    const [preset, setPreset] = useState(0)
    const [knobs, setKnobs] = useState<Knobs>(() => ({ ...PRESETS[0]!.knobs }))

    const set = (patch: Partial<Knobs>) => setKnobs((current) => {
        const next = { ...current, ...patch }
        // The ranges have to stay the right way round however the two ends are
        // dragged, or the emitter samples an empty range and nothing appears.
        if (next.speedMin > next.speedMax) next.speedMax = next.speedMin
        if (next.lifeMin > next.lifeMax) next.lifeMax = next.lifeMin
        if (next.sizeMin > next.sizeMax) next.sizeMax = next.sizeMin
        if (next.spreadFrom > next.spreadTo) next.spreadTo = next.spreadFrom
        return next
    })

    const choose = (index: number) => {
        setPreset(index)
        setKnobs({ ...PRESETS[index]!.knobs })
    }

    const rotate = (degrees: number) => set({ ramp: knobs.ramp.map((c) => shiftHue(c, degrees)) })

    // The dependency list is every knob, because any of them changing means a
    // different system. Serialised rather than listed one by one so a knob
    // added later cannot be forgotten here.
    const signature = JSON.stringify(knobs)

    useParticles(host, {
        max: MAX,
        emitters: [{
            ...toEmitter(knobs),
            // The emitter sits at the bottom middle of the preview, which suits
            // a fountain and a fire; the spread control is what aims it.
            pos: [STAGE_W / 2, HEIGHT * 0.72],
        }] as never,
    }, [signature])

    const source = toSource(knobs, MAX)

    return (
        <View style={{ width: WIDTH, height: HEIGHT, flexDirection: "row", backgroundColor: "rgb(12, 14, 19)" }}>
            <View style={{ width: STAGE_W, height: HEIGHT }}>
                <View ref={host} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

                <View style={{ position: "absolute", left: 22, top: 18 }} pickingMode="Ignore">
                    <Text style={{ fontSize: 20, color: INK }}>PARTICLE LAB</Text>
                    <Text style={{ fontSize: 11, marginTop: 2, color: DIM }}>
                        Every control is one field of the config below
                    </Text>
                </View>

                {/* The printed config, which is the thing to take away. */}
                <View style={{
                    position: "absolute", left: 16, right: 16, bottom: 16,
                    backgroundColor: "rgba(8, 10, 14, 0.88)", borderRadius: 8, padding: 12,
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 10.5, color: "rgb(158, 200, 240)", whiteSpace: "normal" }}>
                        {source}
                    </Text>
                </View>
            </View>

            <View style={{ width: PANEL, height: HEIGHT, backgroundColor: PANEL_BG }}>
                <ScrollView style={{ flexGrow: 1 }}>
                    <View style={{ padding: 16 }}>
                        <Text style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>PRESET</Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 14 }}>
                            {PRESETS.map((p, i) => (
                                <Button
                                    key={p.name}
                                    text={p.name}
                                    onClick={() => choose(i)}
                                    style={{
                                        marginRight: 6, marginBottom: 6,
                                        backgroundColor: i === preset ? "rgb(58, 104, 168)" : "rgb(38, 44, 56)",
                                    }}
                                />
                            ))}
                        </View>

                        <Knob label="Rate, per second" value={knobs.rate} min={0} max={600}
                            onChange={(rate) => set({ rate })} />
                        <Knob label="Speed, slowest" value={knobs.speedMin} min={0} max={600}
                            onChange={(speedMin) => set({ speedMin })} />
                        <Knob label="Speed, fastest" value={knobs.speedMax} min={0} max={600}
                            onChange={(speedMax) => set({ speedMax })} />
                        <Knob label="Life, shortest" value={knobs.lifeMin} min={0.05} max={6}
                            onChange={(lifeMin) => set({ lifeMin })}
                            format={(n) => `${n.toFixed(2)}s`} />
                        <Knob label="Life, longest" value={knobs.lifeMax} min={0.05} max={6}
                            onChange={(lifeMax) => set({ lifeMax })}
                            format={(n) => `${n.toFixed(2)}s`} />
                        <Knob label="Size, smallest" value={knobs.sizeMin} min={1} max={60}
                            onChange={(sizeMin) => set({ sizeMin })} />
                        <Knob label="Size, largest" value={knobs.sizeMax} min={1} max={60}
                            onChange={(sizeMax) => set({ sizeMax })} />
                        <Knob label="Aim, from" value={knobs.spreadFrom} min={0} max={360}
                            onChange={(spreadFrom) => set({ spreadFrom })}
                            format={(n) => `${Math.round(n)} deg`} />
                        <Knob label="Aim, to" value={knobs.spreadTo} min={0} max={360}
                            onChange={(spreadTo) => set({ spreadTo })}
                            format={(n) => `${Math.round(n)} deg`} />
                        <Knob label="Gravity" value={knobs.gravity} min={-800} max={1200}
                            onChange={(gravity) => set({ gravity })} />
                        <Knob label="Drag" value={knobs.drag} min={0} max={4}
                            onChange={(drag) => set({ drag })}
                            format={(n) => n.toFixed(2)} />
                        <Knob label="Additiveness" value={knobs.additiveness} min={0} max={1}
                            onChange={(additiveness) => set({ additiveness })}
                            format={(n) => n.toFixed(2)} />

                        <Text style={{ fontSize: 11, color: DIM, marginTop: 6, marginBottom: 6 }}>COLOUR</Text>
                        <View style={{ flexDirection: "row", marginBottom: 8 }}>
                            {knobs.ramp.map((colour, i) => (
                                <View key={i} style={{
                                    width: 34, height: 20, marginRight: 6, borderRadius: 4,
                                    backgroundColor: colour,
                                    borderWidth: 1, borderColor: "rgb(52, 60, 74)",
                                }} />
                            ))}
                        </View>
                        <View style={{ flexDirection: "row", marginBottom: 14 }}>
                            <Button text="Hue -30" onClick={() => rotate(-30)} style={{ marginRight: 6 }} />
                            <Button text="Hue +30" onClick={() => rotate(30)} />
                        </View>

                        <Button
                            text={knobs.grow ? "Grows over life" : "Shrinks over life"}
                            onClick={() => set({ grow: !knobs.grow })}
                        />
                    </View>
                </ScrollView>
            </View>
        </View>
    )
}

mount(<ParticleLab />)
