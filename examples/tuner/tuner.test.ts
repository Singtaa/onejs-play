import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DIALS, DIAL_NAMES } from "./tuner"

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
