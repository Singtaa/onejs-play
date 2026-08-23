import { describe, it, expect } from "vitest"
import { PRESETS, toEmitter, toSource, shiftHue, type Knobs } from "./presets"

const knobs = (): Knobs => ({ ...PRESETS[0]!.knobs })

describe("the presets", () => {
    it("are all complete", () => {
        for (const preset of PRESETS) {
            expect(preset.name).toBeTruthy()
            expect(preset.knobs.ramp.length).toBeGreaterThanOrEqual(2)
            expect(preset.knobs.rate).toBeGreaterThan(0)
        }
    })

    it("keep every range the right way round", () => {
        for (const preset of PRESETS) {
            const k = preset.knobs
            expect(k.speedMin).toBeLessThanOrEqual(k.speedMax)
            expect(k.lifeMin).toBeLessThanOrEqual(k.lifeMax)
            expect(k.sizeMin).toBeLessThanOrEqual(k.sizeMax)
            expect(k.spreadFrom).toBeLessThanOrEqual(k.spreadTo)
        }
    })

    it("use colours the particle system can parse", () => {
        for (const preset of PRESETS) {
            for (const colour of preset.knobs.ramp) {
                expect(colour).toMatch(/^#[0-9a-f]{8}$/i)
            }
        }
    })

    it("stay inside the additiveness range the shader understands", () => {
        for (const preset of PRESETS) {
            expect(preset.knobs.additiveness).toBeGreaterThanOrEqual(0)
            expect(preset.knobs.additiveness).toBeLessThanOrEqual(1)
        }
    })
})

describe("toEmitter", () => {
    it("turns the pairs into ranges", () => {
        const emitter = toEmitter({ ...knobs(), speedMin: 10, speedMax: 20 })
        expect(emitter.speed).toEqual([10, 20])
    })

    it("puts gravity on the vertical axis only", () => {
        expect(toEmitter({ ...knobs(), gravity: 300 }).gravity).toEqual([0, 300])
    })

    it("passes the ramp through untouched", () => {
        const ramp = ["#ff0000ff", "#00ff00ff", "#0000ff00"]
        expect(toEmitter({ ...knobs(), ramp }).colorOverLife).toEqual(ramp)
    })

    it("shrinks by default and grows when asked", () => {
        expect(toEmitter({ ...knobs(), grow: false }).sizeOverLife).toEqual([1, 0])
        expect(toEmitter({ ...knobs(), grow: true }).sizeOverLife).toEqual([0.35, 1])
    })

    it("rounds the values that have to be whole", () => {
        const emitter = toEmitter({ ...knobs(), rate: 199.7, sizeMin: 3.4, sizeMax: 9.6 })
        expect(emitter.rate).toBe(200)
        expect(emitter.size).toEqual([3, 10])
    })

    it("keeps a sensible number of decimals on the ones that are fractional", () => {
        const emitter = toEmitter({ ...knobs(), drag: 1.23456, additiveness: 0.98765 })
        expect(emitter.drag).toBe(1.23)
        expect(emitter.additiveness).toBe(0.99)
    })
})

describe("toSource", () => {
    /**
     * The property that makes the lab worth anything: what it prints has to be
     * what it is running. Checked by reading the printed text back rather than
     * by comparing it to a copy of itself.
     */
    it("prints every field the emitter actually has", () => {
        const source = toSource(knobs(), 1200)
        for (const key of Object.keys(toEmitter(knobs()))) {
            expect(source).toContain(`${key}:`)
        }
    })

    it("prints the max it was given", () => {
        expect(toSource(knobs(), 777)).toContain("max: 777")
    })

    it("prints arrays on one line, the way somebody would write them", () => {
        expect(toSource({ ...knobs(), speedMin: 10, speedMax: 20 }, 100)).toContain("speed: [10, 20]")
    })

    it("quotes colours and leaves numbers bare", () => {
        const source = toSource({ ...knobs(), ramp: ["#ffffffff", "#00000000"] }, 100)
        expect(source).toContain('colorOverLife: ["#ffffffff", "#00000000"]')
        expect(source).toContain("drag: 0")
    })

    it("is something a person could paste", () => {
        const source = toSource(knobs(), 1000)
        expect(source.startsWith("const fx = useParticles(ref, {")).toBe(true)
        expect(source.trimEnd().endsWith("})")).toBe(true)
    })
})

describe("shiftHue", () => {
    it("leaves a colour alone when nothing is asked of it", () => {
        expect(shiftHue("#ff8000ff", 0).toLowerCase()).toBe("#ff8000ff")
    })

    it("comes back to where it started after a full turn", () => {
        expect(shiftHue("#3aa0ffff", 360).toLowerCase()).toBe("#3aa0ffff")
    })

    it("moves red toward green a third of the way round", () => {
        expect(shiftHue("#ff0000ff", 120).toLowerCase()).toBe("#00ff00ff")
    })

    /**
     * Most ramps start or end transparent so the effect fades. A picker that
     * silently made those opaque would turn every preset into a hard blob.
     */
    it("keeps the alpha exactly as it was", () => {
        expect(shiftHue("#ff000000", 40).slice(7)).toBe("00")
        expect(shiftHue("#ff0000b0", 40).slice(7)).toBe("b0")
    })

    it("assumes full alpha when none was written", () => {
        expect(shiftHue("#ff0000", 0).toLowerCase()).toBe("#ff0000ff")
    })

    it("leaves greys grey, having no hue to shift", () => {
        expect(shiftHue("#808080ff", 90).toLowerCase()).toBe("#808080ff")
    })

    it("handles a negative shift", () => {
        expect(shiftHue("#00ff00ff", -120).toLowerCase()).toBe("#ff0000ff")
    })

    it("always produces something the particle system can parse", () => {
        for (const preset of PRESETS) {
            for (const colour of preset.knobs.ramp) {
                for (const shift of [-200, -30, 17, 95, 400]) {
                    expect(shiftHue(colour, shift)).toMatch(/^#[0-9a-f]{8}$/i)
                }
            }
        }
    })
})
