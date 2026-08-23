import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { THEME_USS, applyTheme, resetTheme } from "../theme"

const globals = globalThis as any

describe("the default theme", () => {
    const original = globals.compileStyleSheet

    beforeEach(() => resetTheme())
    afterEach(() => {
        resetTheme()
        globals.compileStyleSheet = original
    })

    it("styles the controls the runtime provides", () => {
        for (const selector of [".unity-button", ".unity-base-slider__dragger", ".unity-base-text-field__input"]) {
            expect(THEME_USS).toContain(selector)
        }
    })

    it("gives a button every state a pointer can put it in", () => {
        for (const state of [":hover", ":active", ":focus", ":disabled"]) {
            expect(THEME_USS).toContain(`.unity-button${state}`)
        }
    })

    /**
     * A button that brightens under the finger reads as being released rather
     * than pressed, which is the specific complaint the theme exists to fix.
     */
    it("makes the pressed state darker than the resting one", () => {
        /** The first background-color inside a given rule block. */
        const shade = (selector: string) => {
            const start = THEME_USS.indexOf(`${selector} {`)
            expect(start).toBeGreaterThanOrEqual(0)
            const block = THEME_USS.slice(start, THEME_USS.indexOf("}", start))
            const found = /background-color:\s*rgb\((\d+)/.exec(block)
            expect(found).not.toBeNull()
            return Number(found![1])
        }
        const resting = shade(".unity-button")
        expect(shade(".unity-button:active")).toBeLessThan(resting)
        expect(shade(".unity-button:hover")).toBeGreaterThan(resting)
    })

    it("never reaches for a selector a game would own", () => {
        // Only Unity's own control classes. A theme that styled bare elements
        // would fight every author with an opinion about their own Views.
        const selectors = THEME_USS.match(/^\s*\.[A-Za-z][^{]*\{/gm) ?? []
        for (const selector of selectors) {
            expect(selector.trim().startsWith(".unity-")).toBe(true)
        }
    })

    it("compiles once, however many times it is asked", () => {
        const calls: unknown[][] = []
        globals.compileStyleSheet = (...args: unknown[]) => calls.push(args)
        applyTheme()
        applyTheme()
        applyTheme()
        expect(calls).toHaveLength(1)
        expect(calls[0]![0]).toBe(THEME_USS)
    })

    it("compiles again after a reset, which is what a game swap does", () => {
        const calls: unknown[][] = []
        globals.compileStyleSheet = (...args: unknown[]) => calls.push(args)
        applyTheme()
        resetTheme()
        applyTheme()
        expect(calls).toHaveLength(2)
    })

    it("does nothing at all where there is no compiler", () => {
        delete globals.compileStyleSheet
        expect(() => applyTheme()).not.toThrow()
    })

    it("survives a compiler that throws", () => {
        globals.compileStyleSheet = () => { throw new Error("nope") }
        expect(() => applyTheme()).not.toThrow()
    })
})
