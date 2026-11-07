import { GUTTER, MAX_ATLAS, MAX_PAGES, packAtlas, SEAM, sheetOf } from "../atlas"

const overlaps = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! + GUTTER && b[0]! < a[0]! + a[2]! + GUTTER && a[1]! < b[1]! + b[3]! + GUTTER && b[1]! < a[1]! + a[3]! + GUTTER
const metres = (sizes: number[][]) => sizes.map(([width, height]) => ({ width: width!, height: height! }))
// Every rectangle inside the sheet and apart from the rest by the gutter, its pages at most MAX_ATLAS a side.
const inside = (p: ReturnType<typeof packAtlas> & {}) => {
    const s = sheetOf(p.width, p.height, p.pages)
    expect(p.width).toBeLessThanOrEqual(MAX_ATLAS)
    expect(p.height).toBeLessThanOrEqual(MAX_ATLAS)
    expect(s.width).toBeLessThanOrEqual(2 * MAX_ATLAS - SEAM)
    p.rects.forEach((r, i) => {
        expect(r[0] + r[2]).toBeLessThanOrEqual(s.width)
        expect(r[1] + r[3]).toBeLessThanOrEqual(s.height)
        for (let j = 0; j < i; j++) expect(overlaps(r, p.rects[j]!)).toBe(false)
    })
}

describe("the atlas", () => {
    it("keeps a room at 24 texels a metre, every rectangle inside and apart", () => {
        // The spike's room: floor, ceiling, four walls and three boxes, footprints in metres.
        const room = [[6, 6], [6, 6], [6, 3], [6, 3], [6, 3], [6, 3], [2, 1.5], [1.5, 1], [1, 1]].map(([width, height]) => ({ width: width!, height: height! }))
        const p = packAtlas(room)!
        expect(p.detail).toBe(24)
        expect(p.pages).toBe(1)
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
        // On the sheet the ground and the strips under it fit at 10.4: 80 m of ground and four 4 m strips, each a
        // row of its own, in 1022 texels. On separate pages the ground alone held it to 6.4.
        const paged = packAtlas(yard)!
        expect(paged.pages).toBe(4)
        expect(paged.detail).toBeGreaterThan(10.3)
        expect(paged.detail).toBeLessThanOrEqual(10.5)
        inside(paged)
    })

    it("keeps an actor bigger than a page at the detail asked, across the seam", () => {
        // 30 m at 24 is 720 texels a side: more than a page, less than the sheet.
        const p = packAtlas(metres([[30, 30]]))!
        expect([p.detail, p.pages]).toEqual([24, 4])
        expect(p.rects).toEqual([[0, 0, 720, 720]])
        // Each page half the sheet and the seam, not 512: the sheet is no bigger than what it holds.
        expect([p.width, p.height]).toEqual([361, 361])
        expect(sheetOf(p.width, p.height, p.pages)).toEqual({ columns: 2, rows: 2, width: 720, height: 720 })
        // The sheet's side is two pages less the seam: 1022 texels fit at the detail asked, 1023 do not.
        const fits = packAtlas([{ width: 1022 / 24, height: 1 }])!
        expect([fits.detail, fits.pages, fits.width]).toEqual([24, 2, 512])
        expect(packAtlas([{ width: 1023 / 24, height: 1 }])!.detail).toBeLessThan(24)
        // 80 m of ground: the sheet's side, 1022 texels, over 80 m.
        const ground = packAtlas(metres([[80, 80]]))!
        expect(ground.detail).toBeGreaterThan(12.6)
        expect(ground.detail).toBeLessThanOrEqual(1022 / 80)
    })

    it("takes 2 pages side by side when one row is enough, and 4 only when it is not", () => {
        // Two 15 m squares, 360 texels each, do not fit 512 side by side but fit one row of the sheet.
        const two = packAtlas(metres([[15, 15], [15, 15]]))!
        expect([two.detail, two.pages, two.width, two.height]).toEqual([24, 2, 363, 360])
        expect(sheetOf(two.width, two.height, two.pages)).toEqual({ columns: 2, rows: 1, width: 724, height: 360 })
        // Nine 10 m squares, 240 texels: four to a row of the sheet, three rows.
        const nine = packAtlas(metres(Array.from({ length: 9 }, () => [10, 10])))!
        expect([nine.detail, nine.pages]).toEqual([24, 4])
        inside(nine)
        // Limited to 2 pages the rows cannot pass one page's height, so the detail falls.
        expect(packAtlas(metres(Array.from({ length: 9 }, () => [10, 10])), 24, MAX_ATLAS, 2)!.detail).toBeLessThan(24)
        // Seventeen fit four rows of five at 20.0, where separate pages held them to 16.8.
        const more = packAtlas(metres(Array.from({ length: 17 }, () => [10, 10])))!
        expect(more.detail).toBeGreaterThan(19.9)
        expect(more.detail).toBeLessThanOrEqual(20.1)
        expect(more.pages).toBeLessThanOrEqual(MAX_PAGES)
        inside(more)
    })

    it("packs a scene that fits one page exactly as before pages, its page no bigger than it needs", () => {
        const four = packAtlas(metres(Array.from({ length: 4 }, () => [10, 10])))!
        expect([four.pages, four.width, four.height]).toEqual([1, 484, 484])
        expect(four.rects).toEqual([[0, 0, 240, 240], [244, 0, 240, 240], [0, 244, 240, 240], [244, 244, 240, 240]])
    })

    it("gives up below a texel a metre", () => {
        expect(packAtlas([{ width: 2000, height: 2000 }])).toBe(null)
    })
})
