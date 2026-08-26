import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { sheetName, parseSheet, sheetFrame, sheetUv, attachFlipbook } from "../asset"

/**
 * The flipbook contract is the particle system's SheetConfig, and the uv math
 * here has to agree with ParticleSystem2D.cs cell for cell: frame 0 is the
 * sheet's top-left, V runs bottom-up. Several expectations below are that C#
 * mapping transcribed, so a change that breaks agreement fails a test rather
 * than shipping two contracts.
 */

describe("sheetName", () => {
    it("swaps the extension for .sheet.json", () => {
        expect(sheetName("glow.png")).toBe("glow.sheet.json")
        expect(sheetName("fx/burst.webp")).toBe("fx/burst.sheet.json")
    })

    it("appends when there is no extension, and ignores dots in folders", () => {
        expect(sheetName("glow")).toBe("glow.sheet.json")
        expect(sheetName("v1.2/glow")).toBe("v1.2/glow.sheet.json")
    })
})

describe("parseSheet", () => {
    let errors: unknown[][]
    beforeEach(() => {
        errors = []
        vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args) })
    })
    afterEach(() => vi.restoreAllMocks())

    it("fills SheetConfig's own defaults for missing fields", () => {
        const sheet = parseSheet({ cols: 8, rows: 4 }, "glow.sheet.json")
        expect(sheet).toEqual({
            cols: 8, rows: 4, frameCount: 32, mode: "life", fps: 24, randomStart: false,
        })
        expect(errors).toHaveLength(0)
    })

    it("rejects a sidecar without a grid, loudly", () => {
        expect(parseSheet({ fps: 24 }, "glow.sheet.json")).toBeNull()
        expect(parseSheet({ cols: 0, rows: 4 }, "glow.sheet.json")).toBeNull()
        expect(parseSheet({ cols: 2.5, rows: 4 }, "glow.sheet.json")).toBeNull()
        expect(errors).toHaveLength(3)
    })

    it("rejects non-object JSON, the shape a stray string or array produces", () => {
        expect(parseSheet("cols: 8", "glow.sheet.json")).toBeNull()
        expect(parseSheet(null, "glow.sheet.json")).toBeNull()
        expect(errors).toHaveLength(2)
    })

    // The one a real author hits: a padded last row described optimistically.
    it("clamps frameCount to the grid with an error instead of dying", () => {
        const sheet = parseSheet({ cols: 8, rows: 4, frameCount: 40 }, "glow.sheet.json")
        expect(sheet?.frameCount).toBe(32)
        expect(errors).toHaveLength(1)
        expect(String(errors[0][0])).toContain("frameCount 40")
    })

    it("keeps a frameCount inside the grid, for sheets whose last row is padding", () => {
        expect(parseSheet({ cols: 8, rows: 4, frameCount: 30 }, "s")?.frameCount).toBe(30)
    })
})

describe("sheetFrame", () => {
    const sheet = { cols: 4, rows: 2, frameCount: 8, mode: "life" as const, fps: 10, randomStart: false }

    it("advances at fps and loops", () => {
        expect(sheetFrame(sheet, 0)).toBe(0)
        expect(sheetFrame(sheet, 0.35)).toBe(3)
        expect(sheetFrame(sheet, 0.8)).toBe(0)
        expect(sheetFrame(sheet, 1.25)).toBe(4)
    })

    it("starts from startFrame and still loops inside frameCount", () => {
        expect(sheetFrame(sheet, 0, 5)).toBe(5)
        expect(sheetFrame(sheet, 0.4, 5)).toBe(1)
    })
})

describe("sheetUv", () => {
    // 4x2: frame 0 top-left means high V. Transcribed from ParticleSystem2D.cs.
    const sheet = { cols: 4, rows: 2, frameCount: 8, mode: "life" as const, fps: 24, randomStart: false }

    it("puts frame 0 at the top-left in bottom-up uv space", () => {
        expect(sheetUv(sheet, 0)).toEqual({ x: 0, y: 0.5, width: 0.25, height: 0.5 })
    })

    it("walks columns first, then drops a row", () => {
        expect(sheetUv(sheet, 3)).toEqual({ x: 0.75, y: 0.5, width: 0.25, height: 0.5 })
        expect(sheetUv(sheet, 4)).toEqual({ x: 0, y: 0, width: 0.25, height: 0.5 })
        expect(sheetUv(sheet, 7)).toEqual({ x: 0.75, y: 0, width: 0.25, height: 0.5 })
    })
})

describe("attachFlipbook", () => {
    /**
     * A hand-cranked raf: ticks fire only when the test advances the clock, so
     * frame timing is exact and nothing leaks past a test's end.
     */
    function crank() {
        let cb: ((ms: number) => void) | null = null
        return {
            raf: (next: (ms: number) => void) => { cb = next; return 1 },
            caf: () => { cb = null },
            tick(ms: number) { cb?.(ms) },
            get scheduled() { return cb !== null },
        }
    }
    const texture = { fake: "texture" }

    // The suite-wide CS stub answers every path, so attachFlipbook would build
    // stub Rects instead of the plain objects these tests read. No CS is also a
    // real case: it is what the hook sees under vitest and outside OneJS.
    const globals = globalThis as any
    let originalCS: unknown
    beforeEach(() => { originalCS = globals.CS; globals.CS = undefined })
    afterEach(() => { globals.CS = originalCS })

    it("shows a plain sprite whole and schedules nothing", () => {
        const el: any = {}
        const c = crank()
        const detach = attachFlipbook(el, texture, null, c.raf, c.caf)
        expect(el.image).toBe(texture)
        expect(el.uv).toEqual({ x: 0, y: 0, width: 1, height: 1 })
        expect(c.scheduled).toBe(false)
        detach()
    })

    it("writes uv only when the frame index changes", () => {
        const el: any = {}
        const writes: unknown[] = []
        Object.defineProperty(el, "uv", { set: (v) => writes.push(v), get: () => writes.at(-1) })
        const c = crank()
        const sheet = { cols: 4, rows: 1, frameCount: 4, mode: "life" as const, fps: 10, randomStart: false }
        const detach = attachFlipbook(el, texture, sheet, c.raf, c.caf)
        expect(writes).toHaveLength(1)

        c.tick(0)       // establishes the clock, frame still 0: no write
        c.tick(16)      // 16ms at 10fps: still frame 0, no write
        expect(writes).toHaveLength(1)
        c.tick(116)     // 116ms: frame 1
        expect(writes).toHaveLength(2)
        expect(writes.at(-1)).toEqual({ x: 0.25, y: 0, width: 0.25, height: 1 })
        detach()
        expect(c.scheduled).toBe(false)
    })

    it("loops back to the first cell after the last", () => {
        const el: any = {}
        const c = crank()
        const sheet = { cols: 2, rows: 1, frameCount: 2, mode: "life" as const, fps: 10, randomStart: false }
        attachFlipbook(el, texture, sheet, c.raf, c.caf)
        c.tick(0)
        c.tick(100)
        expect(el.uv).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 })
        c.tick(200)
        expect(el.uv).toEqual({ x: 0, y: 0, width: 0.5, height: 1 })
    })
})
