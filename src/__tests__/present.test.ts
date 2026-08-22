import { describe, it, expect } from "vitest"
import { stageHostStyle } from "../mount"
import { computeStageLayout, normalizeStage } from "../stage"

/**
 * The regression these cover: the layout was computed correctly and then
 * dropped on the floor. Every game rendered unscaled at 1:1 regardless of the
 * stage it declared, which on a retina display is a small picture in the corner
 * of a large canvas.
 *
 * The contract being tested is the one mount() and the container share: the
 * host box is in points, and the container sets panel scale to
 * layout.scale x devicePixelRatio, so one point is that many physical pixels.
 */
const layoutFor = (stage: Parameters<typeof normalizeStage>[0], vw: number, vh: number) =>
    computeStageLayout(normalizeStage(stage), vw, vh)

/** What a point is worth in physical pixels, per the shared contract. */
const pointSize = (scale: number, dpr: number) => scale * dpr

describe("stageHostStyle", () => {
    it("gives the game exactly its declared stage, in points", () => {
        const style = stageHostStyle(layoutFor({ size: [600, 760] }, 1288, 805))
        expect(style.width).toBe(600)
        expect(style.height).toBe(760)
    })

    it("centres the stage in the leftover space", () => {
        // 600x760 letterboxed into 1288x805: scale 805/760, so the stage is
        // 631.6 wide and the bars take (1288 - 631.6)/2 each.
        const layout = layoutFor({ size: [600, 760] }, 1288, 805)
        const style = stageHostStyle(layout)
        expect(style.top).toBeCloseTo(0, 6)
        expect(style.left as number).toBeCloseTo(layout.offsetX / layout.scaleX, 6)
        // Converted into points, the two bars plus the stage fill the viewport.
        const viewportInPoints = layout.viewportWidth / layout.scale
        expect((style.left as number) * 2 + (style.width as number)).toBeCloseTo(viewportInPoints, 6)
    })

    it("covers the same physical pixels at any device pixel ratio", () => {
        // The whole point of the fix. A stage is the same physical size on a
        // retina display as on a normal one; what changes is how many pixels
        // are used to draw it.
        const layout = layoutFor({ size: [600, 760] }, 1288, 805)
        const style = stageHostStyle(layout)
        for (const dpr of [1, 2, 3]) {
            const physicalWidth = (style.width as number) * pointSize(layout.scale, dpr)
            expect(physicalWidth).toBeCloseTo(600 * layout.scale * dpr, 6)
            // and in CSS pixels it is the same picture regardless of dpr
            expect(physicalWidth / dpr).toBeCloseTo(600 * layout.scale, 6)
        }
    })

    it("fills the viewport when the stage is fluid", () => {
        const style = stageHostStyle(layoutFor({ fit: "fluid" }, 1288, 805))
        expect(style.left).toBe(0)
        expect(style.top).toBe(0)
        expect(style.width).toBe(1288)
        expect(style.height).toBe(805)
    })

    it("overflows on the cropped axis under cover, so the clipper earns its keep", () => {
        const layout = layoutFor({ size: [600, 760], fit: "cover" }, 1288, 805)
        const style = stageHostStyle(layout)
        const viewportInPoints = layout.viewportHeight / layout.scale
        expect(style.height as number).toBeGreaterThan(viewportInPoints)
        expect(style.top as number).toBeLessThan(0)
    })

    it("fills the root under stretch rather than leaving bars", () => {
        const layout = layoutFor({ size: [600, 760], fit: "stretch" }, 1288, 805)
        const style = stageHostStyle(layout)
        expect(style.left).toBe(0)
        expect(style.top).toBe(0)
        expect(style.width as number).toBeCloseTo(1288 / layout.scale, 6)
        expect(style.height as number).toBeCloseTo(805 / layout.scale, 6)
    })

    it("is positioned absolutely, or the clipper would lay it out in flow", () => {
        expect(stageHostStyle(layoutFor({ size: [600, 760] }, 1288, 805)).position).toBe("absolute")
    })

    it("survives a viewport that has not been measured yet", () => {
        const style = stageHostStyle(layoutFor({ size: [600, 760] }, 0, 0))
        for (const value of Object.values(style)) {
            if (typeof value === "number") expect(Number.isFinite(value)).toBe(true)
        }
        expect(style.width).toBe(600)
    })
})
