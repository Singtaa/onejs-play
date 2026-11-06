import { GUTTER, MAX_ATLAS, packAtlas } from "../atlas"

const overlaps = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! + GUTTER && b[0]! < a[0]! + a[2]! + GUTTER && a[1]! < b[1]! + b[3]! + GUTTER && b[1]! < a[1]! + a[3]! + GUTTER

describe("the atlas", () => {
    it("keeps a room at 24 texels a metre, every rectangle inside and apart", () => {
        // The spike's room: floor, ceiling, four walls and three boxes, footprints in metres.
        const room = [[6, 6], [6, 6], [6, 3], [6, 3], [6, 3], [6, 3], [2, 1.5], [1.5, 1], [1, 1]].map(([width, height]) => ({ width: width!, height: height! }))
        const p = packAtlas(room)!
        expect(p.detail).toBe(24)
        expect(p.width).toBeLessThanOrEqual(MAX_ATLAS)
        expect(p.height).toBeLessThanOrEqual(MAX_ATLAS)
        p.rects.forEach((r, i) => {
            expect(r[2]).toBe(Math.ceil(room[i]!.width * 24))
            expect(r[0] + r[2]).toBeLessThanOrEqual(MAX_ATLAS)
            expect(r[1] + r[3]).toBeLessThanOrEqual(MAX_ATLAS)
            for (let j = 0; j < i; j++) expect(overlaps(r, p.rects[j]!)).toBe(false)
        })
    })

    it("lowers the detail for an 80 m yard until it fits, to about 5", () => {
        const yard = [{ width: 80, height: 80 }, ...Array.from({ length: 4 }, () => ({ width: 80, height: 4 }))]
        const p = packAtlas(yard)!
        expect(p.detail).toBeLessThan(6.5)
        expect(p.detail).toBeGreaterThan(4)
        expect(p.width).toBeLessThanOrEqual(MAX_ATLAS)
        expect(p.height).toBeLessThanOrEqual(MAX_ATLAS)
        // And not lower than it had to be: a tenth more does not fit.
        expect(packAtlas(yard, p.detail + 0.1)?.detail).not.toBe(p.detail + 0.1)
    })

    it("gives up below a texel a metre", () => {
        expect(packAtlas([{ width: 2000, height: 2000 }])).toBe(null)
    })
})
