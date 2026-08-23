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
import { View, Text, Button, Slider, ScrollView, mount, useParticles, type ChangeEventData } from "oj"
import { PRESETS, PREVIEW_W, PREVIEW_H, toEmitter, toSource, shiftHue, type Knobs } from "./presets"

/**
 * The preview and the printed config get a row each.
 *
 * They used to share one box, with the config floating over the bottom of the
 * preview, and it covered the very part of the effect worth watching: a
 * fountain's base sat behind the panel. Two rows costs eighty pixels of height
 * and means nothing is ever hidden behind anything.
 */
const PANEL = 330
const WIDTH = PREVIEW_W + PANEL
const CODE_H = 240
const HEIGHT = PREVIEW_H + CODE_H
const MAX = 1400

const INK = "rgb(226, 234, 247)"
const DIM = "rgb(126, 138, 162)"
const PANEL_BG = "rgb(21, 25, 32)"

function Knob({ label, value, min, max, step, onChange, format, width }: {
    label: string
    value: number
    min: number
    max: number
    step?: number
    onChange: (next: number) => void
    format?: (n: number) => string
    /** Set when two knobs share a row. */
    width?: number
}) {
    return (
        <View style={{ marginBottom: 8, width }}>
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
                // e.value, not e.newValue. Typed rather than left as `any`,
                // because the untyped version compiled happily while handing
                // every knob undefined: one drag of any slider and the config
                // it printed said "undefined" and the render threw.
                onChange={(e: ChangeEventData<number>) => onChange(e.value)}
            />
        </View>
    )
}

/**
 * Two knobs on one line.
 *
 * Every range in this lab is a pair, and stacking the halves put the colour
 * controls below the fold of a panel with no obvious scrollbar: they read as
 * missing rather than as further down. Side by side, the whole thing fits, and
 * a minimum sitting next to its maximum is easier to reason about anyway.
 */
const PAIR_GAP = 12
const HALF = (PANEL - 32 - PAIR_GAP) / 2

function Pair({ children }: { children: React.ReactNode }) {
    return <View style={{ flexDirection: "row", justifyContent: "space-between" }}>{children}</View>
}

function ParticleLab() {
    const host = useRef(null)
    const [preset, setPreset] = useState(0)
    const [knobs, setKnobs] = useState<Knobs>(() => ({ ...PRESETS[0]!.knobs }))

    const set = (patch: Partial<Knobs>) => setKnobs((current) => {
        // A control that reports something that is not a number is dropped
        // rather than stored. A lab is a place to drag things quickly, and a
        // single bad value poisoning the state would take the whole panel down
        // with it.
        for (const [key, value] of Object.entries(patch)) {
            if (typeof value === "number" && !Number.isFinite(value)) return current
            if (value === undefined) return current
        }
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

    // Exactly what the panel below prints, and nothing added on top of it: if
    // the two could differ, the printed config would be a decoration rather
    // than something to paste.
    useParticles(host, { max: MAX, emitters: [toEmitter(knobs)] as never }, [signature])

    const source = toSource(knobs, MAX)

    return (
        <View style={{ width: WIDTH, height: HEIGHT, flexDirection: "row", backgroundColor: "rgb(12, 14, 19)" }}>
            <View style={{ width: PREVIEW_W, height: HEIGHT }}>
                {/* The effect, in a box of its own. The emitter's position is
                    measured in these pixels, which is why PREVIEW_W and
                    PREVIEW_H live beside the presets rather than here. */}
                <View style={{ width: PREVIEW_W, height: PREVIEW_H, overflow: "hidden" }}>
                    <View ref={host} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

                    <View style={{ position: "absolute", left: 22, top: 18 }} pickingMode="Ignore">
                        <Text style={{ fontSize: 20, color: INK }}>PARTICLE LAB</Text>
                        <Text style={{ fontSize: 11, marginTop: 2, color: DIM }}>
                            Every control is one field of the config below
                        </Text>
                    </View>
                </View>

                {/* The config that is running, printed to be taken away. */}
                <View style={{
                    width: PREVIEW_W, height: CODE_H,
                    backgroundColor: "rgb(9, 11, 15)", paddingLeft: 22, paddingTop: 14,
                    borderTopWidth: 1, borderTopColor: "rgb(30, 35, 45)",
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 11.5, color: "rgb(158, 200, 240)", whiteSpace: "normal" }}>
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
                        <Pair>
                            <Knob label="Speed, slowest" width={HALF} value={knobs.speedMin} min={0} max={700}
                                onChange={(speedMin) => set({ speedMin })} />
                            <Knob label="fastest" width={HALF} value={knobs.speedMax} min={0} max={700}
                                onChange={(speedMax) => set({ speedMax })} />
                        </Pair>
                        <Pair>
                            <Knob label="Life, shortest" width={HALF} value={knobs.lifeMin} min={0.05} max={6}
                                onChange={(lifeMin) => set({ lifeMin })} format={(n) => `${n.toFixed(2)}s`} />
                            <Knob label="longest" width={HALF} value={knobs.lifeMax} min={0.05} max={6}
                                onChange={(lifeMax) => set({ lifeMax })} format={(n) => `${n.toFixed(2)}s`} />
                        </Pair>
                        <Pair>
                            <Knob label="Size, smallest" width={HALF} value={knobs.sizeMin} min={1} max={60}
                                onChange={(sizeMin) => set({ sizeMin })} />
                            <Knob label="largest" width={HALF} value={knobs.sizeMax} min={1} max={60}
                                onChange={(sizeMax) => set({ sizeMax })} />
                        </Pair>
                        <Pair>
                            <Knob label="Aim, from" width={HALF} value={knobs.spreadFrom} min={0} max={360}
                                onChange={(spreadFrom) => set({ spreadFrom })}
                                format={(n) => `${Math.round(n)} deg`} />
                            <Knob label="to" width={HALF} value={knobs.spreadTo} min={0} max={360}
                                onChange={(spreadTo) => set({ spreadTo })}
                                format={(n) => `${Math.round(n)} deg`} />
                        </Pair>
                        <Knob label="Gravity" value={knobs.gravity} min={-800} max={1200}
                            onChange={(gravity) => set({ gravity })} />
                        <Pair>
                            <Knob label="Drag" width={HALF} value={knobs.drag} min={0} max={4}
                                onChange={(drag) => set({ drag })} format={(n) => n.toFixed(2)} />
                            <Knob label="Additiveness" width={HALF} value={knobs.additiveness} min={0} max={1}
                                onChange={(additiveness) => set({ additiveness })} format={(n) => n.toFixed(2)} />
                        </Pair>

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
