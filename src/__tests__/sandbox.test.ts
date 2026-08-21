import { describe, it, expect } from "vitest"
import {
    evaluateBundle,
    snapshotGlobals,
    removeAddedGlobals,
    SHADOWED_GLOBALS,
    INJECTED_GLOBALS,
} from "../sandbox"

/** An IIFE bundle in the shape esbuild emits for the container. */
const bundle = (body: string) => `var __exports = (() => { ${body} })()`

describe("evaluateBundle", () => {
    it("returns the bundle's __exports", () => {
        const out = evaluateBundle(bundle('return { tag: "A" }'), { oj: {} })
        expect(out).toEqual({ tag: "A" })
    })

    it("returns undefined when a bundle exports nothing", () => {
        expect(evaluateBundle("1 + 1", { oj: {} })).toBeUndefined()
    })

    it("injects oj", () => {
        const oj = { View: "view" }
        const out = evaluateBundle(bundle("return { seen: oj.View }"), { oj }) as { seen: string }
        expect(out.seen).toBe("view")
    })

    describe("shadowing", () => {
        it("hides CS even though the real global exists", () => {
            expect((globalThis as Record<string, unknown>).CS).toBeDefined()
            const out = evaluateBundle(bundle("return { cs: typeof CS }"), { oj: {} }) as { cs: string }
            expect(out.cs).toBe("undefined")
        })

        it("hides the filesystem surface", () => {
            const out = evaluateBundle(
                bundle("return { r: typeof readTextFile, w: typeof writeTextFile, d: typeof deleteFile }"),
                { oj: {} },
            ) as Record<string, string>
            expect(out).toEqual({ r: "undefined", w: "undefined", d: "undefined" })
        })

        it("hides useExtensions and the runtime internals", () => {
            const out = evaluateBundle(
                bundle("return { u: typeof useExtensions, r: typeof __root, b: typeof __bridge, t: typeof __runTeardown }"),
                { oj: {} },
            ) as Record<string, string>
            expect(Object.values(out)).toEqual(["undefined", "undefined", "undefined", "undefined"])
        })

        it("accepts extra names for a newer bootstrap", () => {
            const out = evaluateBundle(bundle("return { x: typeof __somethingNew }"), {
                oj: {},
                shadow: ["__somethingNew"],
            }) as { x: string }
            expect(out.x).toBe("undefined")
        })

        // The honest limit, pinned so nobody mistakes this for a jail. Closing
        // it means deleting the properties, which needs onejs-react to capture
        // CS at module scope first.
        it("does NOT stop a bundle reaching globalThis.CS", () => {
            const out = evaluateBundle(bundle("return { cs: typeof globalThis.CS }"), { oj: {} }) as { cs: string }
            expect(out.cs).not.toBe("undefined")
        })
    })

    describe("injection", () => {
        // Not optional: onejs-unity's uss-modules and tailwind plugins both emit
        // a bare compileStyleSheet call into every bundle that uses them.
        it("gives the bundle the real compileStyleSheet", () => {
            const calls: unknown[][] = []
            const out = evaluateBundle(
                bundle('compileStyleSheet(".a{}", "x.uss"); return { ok: typeof compileStyleSheet }'),
                { oj: {}, injected: { compileStyleSheet: (...a: unknown[]) => calls.push(a) } },
            ) as { ok: string }
            expect(out.ok).toBe("function")
            expect(calls).toEqual([[".a{}", "x.uss"]])
        })

        it("falls back to the host scope when no override is given", () => {
            const scope = { compileStyleSheet: () => "from-scope" } as unknown as Record<string, unknown>
            const out = evaluateBundle(bundle("return { v: compileStyleSheet() }"), { oj: {}, scope }) as { v: string }
            expect(out.v).toBe("from-scope")
        })

        it("never shadows an injected name", () => {
            for (const name of INJECTED_GLOBALS) {
                expect(SHADOWED_GLOBALS).not.toContain(name)
            }
        })
    })

    describe("strict mode", () => {
        // Turns the accidental half of hot-swap residue into an error, leaving
        // only deliberate globalThis writes to sweep up.
        it("throws on an undeclared assignment instead of creating a global", () => {
            expect(() => evaluateBundle("undeclaredThing = 1", { oj: {} })).toThrow(ReferenceError)
        })
    })

    describe("robustness", () => {
        it("survives duplicate names in the shadow list", () => {
            expect(() =>
                evaluateBundle(bundle("return {}"), { oj: {}, shadow: ["CS", "CS", "__root"] }),
            ).not.toThrow()
        })

        it("drops names that are not valid identifiers", () => {
            expect(() =>
                evaluateBundle(bundle("return {}"), { oj: {}, shadow: ["not-an-identifier", "2bad", ""] }),
            ).not.toThrow()
        })

        it("never lets a shadow entry collide with oj", () => {
            const out = evaluateBundle(bundle("return { t: typeof oj }"), { oj: { a: 1 }, shadow: ["oj"] }) as { t: string }
            expect(out.t).toBe("object")
        })

        it("propagates a syntax error rather than swallowing it", () => {
            expect(() => evaluateBundle("this is not javascript", { oj: {} })).toThrow()
        })
    })
})

describe("global residue", () => {
    it("reports what a bundle added", () => {
        const scope: Record<string, unknown> = { existing: 1 }
        const snap = snapshotGlobals(scope)
        scope.gameState = { n: 1 }
        scope.other = 2
        expect(removeAddedGlobals(snap, scope).sort()).toEqual(["gameState", "other"])
        expect(Object.keys(scope)).toEqual(["existing"])
    })

    it("leaves pre-existing globals alone", () => {
        const scope: Record<string, unknown> = { keepMe: 1 }
        const snap = snapshotGlobals(scope)
        scope.added = 2
        removeAddedGlobals(snap, scope)
        expect(scope.keepMe).toBe(1)
    })

    it("returns an empty list when nothing was added", () => {
        const scope: Record<string, unknown> = { a: 1 }
        expect(removeAddedGlobals(snapshotGlobals(scope), scope)).toEqual([])
    })

    // Reporting a non-configurable property as removed would tell the caller
    // the scope is cleaner than it is.
    it("omits properties that refuse to be deleted", () => {
        const scope: Record<string, unknown> = {}
        const snap = snapshotGlobals(scope)
        Object.defineProperty(scope, "stuck", { value: 1, configurable: false, enumerable: true })
        scope.loose = 2
        expect(removeAddedGlobals(snap, scope)).toEqual(["loose"])
        expect(scope.stuck).toBe(1)
    })
})

describe("externals", () => {
    const ext = (body: string) => `var __exports = (() => { ${body} })()`

    it("hands the bundle the modules the container provides", () => {
        const react = { useState: () => {} }
        const out = evaluateBundle(
            ext('return { r: typeof __ojExternals["react"].useState, o: __ojExternals["oj"].tag }'),
            { oj: { tag: "the-runtime" }, externals: { react } },
        ) as { r: string; o: string }
        expect(out.r).toBe("function")
        expect(out.o).toBe("the-runtime")
    })

    it("always provides oj without being asked", () => {
        const out = evaluateBundle(ext('return { has: "oj" in __ojExternals }'), { oj: {} }) as { has: boolean }
        expect(out.has).toBe(true)
    })

    // Injected rather than global, so a game cannot reach past the map.
    it("does not leak the map onto globalThis", () => {
        evaluateBundle(ext("return {}"), { oj: {} })
        expect("__ojExternals" in globalThis).toBe(false)
    })
})
