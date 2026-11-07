import { GUTTER, MAX_ATLAS, MAX_PAGES, packAtlas } from "../atlas"

const overlaps = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! + GUTTER && b[0]! < a[0]! + a[2]! + GUTTER && a[1]! < b[1]! + b[3]! + GUTTER && b[1]! < a[1]! + a[3]! + GUTTER
const metres = (sizes: number[][]) => sizes.map(([width, height]) => ({ width: width!, height: height! }))

describe("the atlas", () => {
    it("keeps a room at 24 texels a metre, every rectangle inside and apart", () => {
        // The spike's room: floor, ceiling, four walls and three boxes, footprints in metres.
        const room = [[6, 6], [6, 6], [6, 3], [6, 3], [6, 3], [6, 3], [2, 1.5], [1.5, 1], [1, 1]].map(([width, height]) => ({ width: width!, height: height! }))
        const p = packAtlas(room)!
        expect(p.detail).toBe(24)
        expect(p.pages).toBe(1)
        expect(p.page).toEqual(room.map(() => 0))
        expect(p.width).toBeLessThanOrEqual(MAX_ATLAS)
        expect(p.height).toBeLessThanOrEqual(MAX_ATLAS)
        p.rects.forEach((r, i) => {
            expect(r[2]).toBe(Math.ceil(room[i]!.width * 24))
            expect(r[0] + r[2]).toBeLessThanOrEqual(MAX_ATLAS)
            expect(r[1] + r[3]).toBeLessThanOrEqual(MAX_ATLAS)
            for (let j = 0; j < i; j++) expect(overlaps(r, p.rects[j]!)).toBe(false)
        })
    })

    it("lowers the detail for an 80 m yard on one page until it fits, to about 5", () => {
        const yard = [{ width: 80, height: 80 }, ...Array.from({ length: 4 }, () => ({ width: 80, height: 4 }))]
        const p = packAtlas(yard, 24, MAX_ATLAS, 1)!
        expect(p.detail).toBeLessThan(6.5)
        expect(p.detail).toBeGreaterThan(4)
        expect(p.width).toBeLessThanOrEqual(MAX_ATLAS)
        expect(p.height).toBeLessThanOrEqual(MAX_ATLAS)
        // And not lower than it had to be: a tenth more does not fit.
        expect(packAtlas(yard, p.detail + 0.1, MAX_ATLAS, 1)?.detail).not.toBe(p.detail + 0.1)
        // On pages the strips go on the next, and the ground alone sets the detail: 512 texels over 80 m.
        const paged = packAtlas(yard)!
        expect(paged.pages).toBe(2)
        expect(paged.detail).toBeGreaterThan(6.2)
        expect(paged.detail).toBeLessThanOrEqual(6.4)
        expect(paged.detail).toBeGreaterThan(p.detail + 1)
    })

    it("packs the first page as one atlas alone would, and lowers the detail only past the last page", () => {
        // Nine 10 m squares: 240 texels at 24, four to a page, so three pages.
        const squares = metres(Array.from({ length: 9 }, () => [10, 10]))
        const p = packAtlas(squares)!
        expect([p.detail, p.pages]).toEqual([24, 3])
        expect(p.page.filter((x) => x === 0).length).toBe(4)
        const alone = packAtlas(squares.slice(0, 4))!
        expect(p.rects.filter((_, i) => p.page[i] === 0)).toEqual(alone.rects)
        expect([p.width, p.height]).toEqual([alone.width, alone.height])
        for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) {
            if (p.page[i] === p.page[j]) expect(overlaps(p.rects[i]!, p.rects[j]!)).toBe(false)
        }
        // Seventeen take five pages at 24, so the detail comes down until they fit four: nine
        // to a page at 16.8 (three 168 texel squares and two gutters a row).
        const more = packAtlas(metres(Array.from({ length: 17 }, () => [10, 10])))!
        expect(more.detail).toBeLessThanOrEqual(16.8)
        expect(more.detail).toBeGreaterThan(16.6)
        expect(more.pages).toBeLessThanOrEqual(MAX_PAGES)
        expect(packAtlas(metres(Array.from({ length: 17 }, () => [10, 10])), 24, MAX_ATLAS, 5)!.detail).toBe(24)
    })

    it("gives up below a texel a metre", () => {
        expect(packAtlas([{ width: 2000, height: 2000 }])).toBe(null)
    })
})
