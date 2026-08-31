import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DIALS, DIAL_NAMES, clamp01, turnRate, RATE, RAMP, RAMP_SECONDS } from "./tuner"

describe("the dials", () => {
    it("names each uniform the shader actually declares", () => {
        const source = readFileSync(join(import.meta.dirname, "index.tsx"), "utf8")
        for (const { name } of DIALS) {
            expect(source, `${name} is declared as a uniform`)
                .toContain(`sl.uniform.float("${name}"`)
        }
    })

    it("says what each one does, since that is the demonstration", () => {
        for (const { name, does } of DIALS) {
            expect(does.length, `${name} has a description`).toBeGreaterThan(8)
        }
    })

    it("keeps a value on the slider", () => {
        expect(clamp01(-0.4)).toBe(0)
        expect(clamp01(1.4)).toBe(1)
        expect(clamp01(0.25)).toBe(0.25)
    })
})

/**
 * The turn rate, pinned because the first one was unusable.
 *
 * It moved a dial through its whole range in 0.83s at rest and accelerated to
 * ten times that, so a tap crossed half the range and no value could be set on
 * purpose. These assertions are about feel, which is why they are expressed as
 * seconds end to end rather than as the constants.
 */
describe("how fast a dial turns", () => {
    const secondsEndToEnd = (held: number) => 1 / turnRate(held)

    it("takes a couple of seconds end to end from a standing start", () => {
        expect(secondsEndToEnd(0)).toBeGreaterThan(2)
        expect(secondsEndToEnd(0)).toBeLessThan(4)
    })

    it("never gets faster than a second end to end, however long you hold", () => {
        expect(secondsEndToEnd(RAMP_SECONDS)).toBeGreaterThan(0.8)
        expect(secondsEndToEnd(999)).toBe(secondsEndToEnd(RAMP_SECONDS))
    })

    it("moves a short tap by a usable amount rather than half the range", () => {
        // A 120ms tap at 60fps, integrated the way the frame loop does it.
        let value = 0.5, held = 0
        for (let i = 0; i < 7; i++) { held += 1 / 60; value += turnRate(held) * (1 / 60) }
        const moved = value - 0.5
        expect(moved).toBeGreaterThan(0.02)
        expect(moved).toBeLessThan(0.12)
    })

    it("speeds up while held, but only within the ramp", () => {
        expect(turnRate(0)).toBe(RATE)
        expect(turnRate(RAMP_SECONDS)).toBeCloseTo(RATE * RAMP)
        expect(turnRate(RAMP_SECONDS / 2)).toBeGreaterThan(turnRate(0))
    })

    it("treats a negative hold as no hold rather than reversing", () => {
        expect(turnRate(-5)).toBe(RATE)
    })
})

/**
 * The code shown on screen has to be the code that ran.
 *
 * A snippet beside its own output is the whole demonstration, and one that has
 * drifted from the program is worse than showing nothing: it teaches an API
 * that does not exist.
 */
describe("the source panel", () => {
    const source = readFileSync(join(import.meta.dirname, "index.tsx"), "utf8")
    const shown = /const SOURCE = \[([\s\S]*?)\n\]/.exec(source)?.[1] ?? ""
    const lines = [...shown.matchAll(/^\s*"((?:[^"\\]|\\.)*)",$/gm)]
        .map((m) => m[1]!.replace(/\\"/g, '"').trim())
        .filter((l) => l.length > 0)

    it("shows something, so an empty panel cannot pass as matching", () => {
        expect(lines.length).toBeGreaterThan(10)
    })

    it("shows only lines that are really in the program", () => {
        // Captures from `sl.program(` inclusive, because the panel shows that
        // opening line too and it has to be checked like any other.
        const program = /const field = encode\((sl\.program\([\s\S]*?\n\}\))\)/.exec(source)?.[1] ?? ""
        expect(program.length).toBeGreaterThan(200)
        // Whitespace differs, since the panel is wrapped for a narrow column.
        const flat = program.replace(/\s+/g, " ")
        for (const line of lines) {
            const needle = line.replace(/\s+/g, " ")
            expect(flat, `panel line is in the program: ${line}`).toContain(needle)
        }
    })
})

describe("the roster", () => {
    it("lists every dial name once", () => {
        expect([...new Set(DIAL_NAMES)]).toHaveLength(DIAL_NAMES.length)
        expect(DIAL_NAMES).toEqual(DIALS.map((d) => d.name))
    })
})
