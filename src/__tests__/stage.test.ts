import { describe, it, expect } from "vitest"
import {
    normalizeStage,
    computeStageLayout,
    toStage,
    fromStage,
    DEFAULT_STAGE_WIDTH,
    DEFAULT_STAGE_HEIGHT,
    type StageConfig,
} from "../stage"

const stage = (over: Partial<StageConfig> = {}): StageConfig => ({
    width: 960,
    height: 540,
    fit: "letterbox",
    pixelPerfect: false,
    ...over,
})

describe("normalizeStage", () => {
    it("defaults to 960x540 letterbox", () => {
        expect(normalizeStage(undefined)).toEqual({
            width: DEFAULT_STAGE_WIDTH,
            height: DEFAULT_STAGE_HEIGHT,
            fit: "letterbox",
            pixelPerfect: false,
        })
    })

    it("accepts size sugar", () => {
        expect(normalizeStage({ size: [1280, 720] })).toMatchObject({ width: 1280, height: 720 })
    })

    it("lets explicit width and height win over size", () => {
        expect(normalizeStage({ size: [1280, 720], width: 640 })).toMatchObject({ width: 640, height: 720 })
    })

    it("accepts every fit mode", () => {
        for (const fit of ["letterbox", "cover", "stretch", "fluid"] as const) {
            expect(normalizeStage({ fit }).fit).toBe(fit)
        }
    })

    it("rejects an unknown fit", () => {
        expect(() => normalizeStage({ fit: "contain" as never })).toThrow(/invalid stage fit/)
    })

    it("rejects a malformed size", () => {
        expect(() => normalizeStage({ size: [960] as never })).toThrow(/\[width, height\]/)
    })

    it("rejects non-positive or non-finite dimensions", () => {
        expect(() => normalizeStage({ width: 0, height: 540 })).toThrow(/positive and finite/)
        expect(() => normalizeStage({ width: -960, height: 540 })).toThrow(/positive and finite/)
        expect(() => normalizeStage({ width: NaN, height: 540 })).toThrow(/positive and finite/)
        expect(() => normalizeStage({ width: 960, height: Infinity })).toThrow(/positive and finite/)
    })
})

describe("computeStageLayout: letterbox", () => {
    it("centers horizontally when the viewport is too wide", () => {
        const l = computeStageLayout(stage(), 1920, 540)
        expect(l.scale).toBe(1)
        expect(l.offsetX).toBe((1920 - 960) / 2)
        expect(l.offsetY).toBe(0)
    })

    it("centers vertically when the viewport is too tall", () => {
        const l = computeStageLayout(stage(), 960, 1080)
        expect(l.scale).toBe(1)
        expect(l.offsetX).toBe(0)
        expect(l.offsetY).toBe((1080 - 540) / 2)
    })

    it("produces zero offsets when the aspect matches exactly", () => {
        const l = computeStageLayout(stage(), 1920, 1080)
        expect(l.scale).toBe(2)
        expect(l.offsetX).toBe(0)
        expect(l.offsetY).toBe(0)
    })

    it("keeps the logical size fixed regardless of viewport", () => {
        for (const [w, h] of [[400, 300], [1920, 1080], [100, 2000]]) {
            const l = computeStageLayout(stage(), w, h)
            expect(l.width).toBe(960)
            expect(l.height).toBe(540)
        }
    })

    it("shows the whole stage", () => {
        const l = computeStageLayout(stage(), 500, 500)
        expect(l.visible).toEqual({ x: 0, y: 0, width: 960, height: 540 })
    })

    it("reports exactly zero crop when the fit lands on a float-noisy scale", () => {
        // 500/960 does not round-trip, so (vw - width * scale) is a tiny
        // negative instead of 0. visible.x must still be exactly 0, or the
        // obvious "am I cropped" test is true for every letterboxed game.
        const l = computeStageLayout(stage(), 500, 500)
        expect(l.offsetX).toBeLessThan(0)
        expect(l.visible.x).toBe(0)
        expect(l.visible.width).toBe(960)
    })
})

describe("visible rect signals cropping", () => {
    it("is the full stage whenever nothing is cropped", () => {
        for (const [w, h] of [[1920, 1080], [500, 500], [320, 1000], [960, 540]]) {
            for (const fit of ["letterbox", "stretch"] as const) {
                const l = computeStageLayout(stage({ fit }), w, h)
                expect(l.visible).toEqual({ x: 0, y: 0, width: 960, height: 540 })
            }
        }
    })

    it("narrows on the cropped axis only", () => {
        const wide = computeStageLayout(stage({ fit: "cover" }), 500, 500)
        expect(wide.visible.width).toBeLessThan(960)
        expect(wide.visible.height).toBe(540)

        const tall = computeStageLayout(stage({ fit: "cover" }), 1920, 200)
        expect(tall.visible.width).toBe(960)
        expect(tall.visible.height).toBeLessThan(540)
    })

    it("crops a pixel-perfect letterbox whose scale was clamped up to 1", () => {
        const l = computeStageLayout(stage({ pixelPerfect: true }), 100, 100)
        expect(l.scale).toBe(1)
        expect(l.visible.x).toBeCloseTo(430, 6)
        expect(l.visible.width).toBeCloseTo(100, 6)
    })
})

describe("computeStageLayout: cover", () => {
    it("scales up to fill and crops the overflow", () => {
        const l = computeStageLayout(stage({ fit: "cover" }), 500, 500)
        expect(l.scale).toBeCloseTo(500 / 540, 10)
        expect(l.offsetX).toBeLessThan(0)
        expect(l.offsetY).toBeCloseTo(0, 10)
    })

    it("reports the cropped visible rect, centered in the stage", () => {
        const l = computeStageLayout(stage({ fit: "cover" }), 500, 500)
        expect(l.visible.x).toBeCloseTo(210, 6)
        expect(l.visible.width).toBeCloseTo(540, 6)
        expect(l.visible.y).toBeCloseTo(0, 10)
        expect(l.visible.height).toBeCloseTo(540, 6)
        // the crop is symmetric
        expect(l.visible.x + l.visible.width).toBeCloseTo(960 - l.visible.x, 6)
    })

    it("never leaves an uncovered gap", () => {
        for (const [w, h] of [[500, 500], [1920, 200], [200, 1920], [1000, 1000]]) {
            const l = computeStageLayout(stage({ fit: "cover" }), w, h)
            expect(l.width * l.scaleX).toBeGreaterThanOrEqual(w - 1e-9)
            expect(l.height * l.scaleY).toBeGreaterThanOrEqual(h - 1e-9)
        }
    })
})

describe("computeStageLayout: stretch", () => {
    it("fills exactly with independent axes", () => {
        const l = computeStageLayout(stage({ fit: "stretch" }), 480, 540)
        expect(l.scaleX).toBeCloseTo(0.5, 10)
        expect(l.scaleY).toBeCloseTo(1, 10)
        expect(l.offsetX).toBe(0)
        expect(l.offsetY).toBe(0)
    })

    it("reports the conservative axis as scale", () => {
        const l = computeStageLayout(stage({ fit: "stretch" }), 480, 540)
        expect(l.scale).toBeCloseTo(0.5, 10)
    })
})

describe("computeStageLayout: fluid", () => {
    it("makes the stage the viewport at scale 1", () => {
        const l = computeStageLayout(stage({ fit: "fluid" }), 375, 812)
        expect(l.width).toBe(375)
        expect(l.height).toBe(812)
        expect(l.scale).toBe(1)
        expect(l.offsetX).toBe(0)
        expect(l.offsetY).toBe(0)
        expect(l.visible).toEqual({ x: 0, y: 0, width: 375, height: 812 })
    })

    it("tracks the viewport as it changes", () => {
        const cfg = stage({ fit: "fluid" })
        expect(computeStageLayout(cfg, 375, 812).width).toBe(375)
        expect(computeStageLayout(cfg, 1440, 900).width).toBe(1440)
    })

    it("ignores the configured logical size", () => {
        const l = computeStageLayout(stage({ fit: "fluid", width: 100, height: 100 }), 800, 600)
        expect(l.width).toBe(800)
        expect(l.height).toBe(600)
    })
})

describe("computeStageLayout: pixelPerfect", () => {
    it("floors the letterbox scale to a whole number", () => {
        const l = computeStageLayout(stage({ width: 320, height: 180, pixelPerfect: true }), 1000, 800)
        expect(l.scale).toBe(3)
        expect(l.offsetX).toBe((1000 - 960) / 2)
        expect(l.offsetY).toBe((800 - 540) / 2)
    })

    it("never floors below 1, so a tiny viewport still renders", () => {
        const l = computeStageLayout(stage({ pixelPerfect: true }), 100, 100)
        expect(l.scale).toBe(1)
    })

    it("ceils the cover scale so coverage is preserved", () => {
        const l = computeStageLayout(stage({ width: 320, height: 180, fit: "cover", pixelPerfect: true }), 1000, 800)
        expect(l.scale).toBe(5)
        expect(320 * l.scaleX).toBeGreaterThanOrEqual(1000)
        expect(180 * l.scaleY).toBeGreaterThanOrEqual(800)
    })

    it("is ignored by stretch and fluid", () => {
        const s = computeStageLayout(stage({ fit: "stretch", pixelPerfect: true }), 1000, 800)
        expect(s.scaleX).toBeCloseTo(1000 / 960, 10)
        const f = computeStageLayout(stage({ fit: "fluid", pixelPerfect: true }), 1000, 800)
        expect(f.scale).toBe(1)
    })
})

describe("computeStageLayout: degenerate viewports", () => {
    const bad: Array<[number, number]> = [
        [0, 0], [0, 540], [960, 0], [-100, 540], [NaN, 540], [960, NaN], [Infinity, 540],
    ]

    it("never produces NaN", () => {
        for (const [w, h] of bad) {
            for (const fit of ["letterbox", "cover", "stretch", "fluid"] as const) {
                const l = computeStageLayout(stage({ fit }), w, h)
                for (const v of [l.width, l.height, l.scale, l.scaleX, l.scaleY, l.offsetX, l.offsetY]) {
                    expect(Number.isFinite(v)).toBe(true)
                }
            }
        }
    })

    it("falls back to an unscaled layout", () => {
        const l = computeStageLayout(stage(), 0, 0)
        expect(l.scale).toBe(1)
        expect(l.offsetX).toBe(0)
        expect(l.offsetY).toBe(0)
    })
})

describe("computeStageLayout: invariants", () => {
    const viewports: Array<[number, number]> = [
        [1920, 1080], [375, 812], [500, 500], [2560, 1080], [320, 1000], [1, 1],
    ]

    it("keeps every scale strictly positive and finite", () => {
        for (const [w, h] of viewports) {
            for (const fit of ["letterbox", "cover", "stretch", "fluid"] as const) {
                for (const pixelPerfect of [false, true]) {
                    const l = computeStageLayout(stage({ fit, pixelPerfect }), w, h)
                    expect(l.scaleX).toBeGreaterThan(0)
                    expect(l.scaleY).toBeGreaterThan(0)
                    expect(l.scale).toBeGreaterThan(0)
                }
            }
        }
    })

    it("keeps the visible rect inside the stage", () => {
        for (const [w, h] of viewports) {
            for (const fit of ["letterbox", "cover", "stretch"] as const) {
                const l = computeStageLayout(stage({ fit }), w, h)
                expect(l.visible.x).toBeGreaterThanOrEqual(0)
                expect(l.visible.y).toBeGreaterThanOrEqual(0)
                expect(l.visible.x + l.visible.width).toBeLessThanOrEqual(l.width + 1e-9)
                expect(l.visible.y + l.visible.height).toBeLessThanOrEqual(l.height + 1e-9)
            }
        }
    })
})

describe("toStage and fromStage", () => {
    it("maps the viewport centre to the stage centre under letterbox", () => {
        const l = computeStageLayout(stage(), 1920, 540)
        const p = toStage(l, 1920 / 2, 540 / 2)
        expect(p.x).toBeCloseTo(480, 10)
        expect(p.y).toBeCloseTo(270, 10)
    })

    it("returns negative coordinates for points in the letterbox bars", () => {
        const l = computeStageLayout(stage(), 1920, 540)
        expect(toStage(l, 10, 270).x).toBeLessThan(0)
    })

    it("round-trips through every fit mode, including non-uniform and cropped", () => {
        const points: Array<[number, number]> = [[0, 0], [480, 270], [960, 540], [123.5, 47.25], [-30, 700]]
        for (const fit of ["letterbox", "cover", "stretch", "fluid"] as const) {
            const l = computeStageLayout(stage({ fit }), 733, 411)
            for (const [x, y] of points) {
                const back = toStage(l, ...(Object.values(fromStage(l, x, y)) as [number, number]))
                expect(back.x).toBeCloseTo(x, 8)
                expect(back.y).toBeCloseTo(y, 8)
            }
        }
    })

    it("places the stage origin at the offsets", () => {
        const l = computeStageLayout(stage(), 1920, 540)
        const origin = fromStage(l, 0, 0)
        expect(origin.x).toBeCloseTo(l.offsetX, 10)
        expect(origin.y).toBeCloseTo(l.offsetY, 10)
    })
})
