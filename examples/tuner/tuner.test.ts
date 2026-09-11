import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DIALS, DIAL_NAMES, layoutFor } from "./tuner"

describe("the dials", () => {
    it("names each uniform the shader actually declares", () => {
        const shader = readFileSync(join(import.meta.dirname, "plasma.sl"), "utf8")
        for (const { name } of DIALS) {
            expect(shader, `${name} is declared as a uniform`)
                .toMatch(new RegExp(`^uniform float ${name} = `, "m"))
        }
    })

    it("says what each one does, since that is the demonstration", () => {
        for (const { name, does } of DIALS) {
            expect(does.length, `${name} has a description`).toBeGreaterThan(8)
        }
    })

    /** The control is a real Slider, which is what makes it draggable. */
    it("drives each uniform with a slider bound to the same name", () => {
        const source = readFileSync(join(import.meta.dirname, "index.tsx"), "utf8")
        expect(source).toContain("<Slider")
        expect(source).toContain('lowValue={0} highValue={1}')
        // The frame loop polled the keyboard and was the only way to move a
        // dial. The control does that itself now, and polling as well would
        // move a focused slider twice per press.
        expect(source).not.toContain("input.keyboard")
    })
})

/**
 * The code shown on screen IS the code that ran.
 *
 * This used to be a copy of the program typed out as an array of strings, and
 * a describe block that compared the two line by line, because a snippet
 * beside its own output is the whole demonstration and one that has drifted
 * teaches an API that does not exist.
 *
 * The panel reads the file now. `import plasma, { source } from "./plasma.sl"`
 * gives both the encoded program and the text it was encoded from, so there is
 * one copy and nothing to keep level. What is left worth checking is that the
 * panel really reads it rather than having quietly grown a second copy again.
 */
describe("the source panel", () => {
    const index = readFileSync(join(import.meta.dirname, "index.tsx"), "utf8")

    it("shows the shader file itself", () => {
        expect(index).toContain('import plasma, { source } from "./plasma.sl"')
        expect(index).toContain("const SOURCE = source")
    })

    it("has no copy of the program in it", () => {
        // The old panel was an array of quoted lines. Anything of that shape
        // back in this file is a copy waiting to drift.
        expect(index).not.toMatch(/const SOURCE = \[/)
        expect(index).not.toContain("sl.program(")
    })

    it("draws what it read, so an empty file could not pass as matching", () => {
        const shader = readFileSync(join(import.meta.dirname, "plasma.sl"), "utf8")
        expect(shader.trimEnd().split("\n").length).toBeGreaterThan(10)
        expect(shader).toContain("float4 main()")
    })
})

describe("the roster", () => {
    it("lists every dial name once", () => {
        expect([...new Set(DIAL_NAMES)]).toHaveLength(DIAL_NAMES.length)
        expect(DIAL_NAMES).toEqual(DIALS.map((d) => d.name))
    })
})

/**
 * The code panel goes when the box is too short for it, whatever the width.
 * At 600 by 420 the width said "stacked, with code" and the height could not
 * hold the shader, twelve lines and three dials, so the lines were shrunk into
 * each other. Height has a say now.
 */
describe("the layout", () => {
    const LINES = 12

    it("shows the code on the stage it was designed for", () => {
        expect(layoutFor(960, 600, LINES).code).toBe(true)
    })

    it("shows it side by side on a wide stage, stacked on a narrow one", () => {
        expect(layoutFor(960, 600, LINES).step.stacked).toBe(false)
        expect(layoutFor(600, 900, LINES).step.stacked).toBe(true)
    })

    it("drops it in a short box, which is how an embed or a landscape phone arrives", () => {
        expect(layoutFor(600, 420, LINES).code).toBe(false)
        expect(layoutFor(960, 300, LINES).code).toBe(false)
    })

    it("keeps it on a phone held upright, where there is height to spare", () => {
        const phone = layoutFor(430, 860, LINES)
        expect(phone.step.stacked).toBe(true)
        expect(phone.code).toBe(true)
    })

    it("never asks for it on the narrowest step, where the type would be too small", () => {
        expect(layoutFor(390, 844, LINES).code).toBe(false)
    })
})
