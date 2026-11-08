import { edgesOf, verdict } from "./triplanar.playtest.mjs"

const RED = [220, 30, 30, 255], GREEN = [30, 200, 30, 255], SKY = [150, 190, 230, 255], EDGE = [125, 115, 30, 255]

/** A column: sky, then a face of `repeats` red and green repeats `band` pixels a band, a blended pixel at each edge, then sky. */
function column(repeats: number, band = 6): number[] {
    const px: number[][] = Array.from({ length: 20 }, () => SKY)
    for (let i = 0; i < repeats * 2; i++) {
        if (i > 0) px.push(EDGE)
        for (let j = 0; j < band; j++) px.push(i % 2 === 0 ? RED : GREEN)
    }
    for (let i = 0; i < 20; i++) px.push(SKY)
    return px.flat()
}

describe("the triplanar playtest", () => {
    it("counts a band edge once, blended pixel or not, and passes over the sky", () => {
        expect(edgesOf(column(12))).toEqual({ edges: 23, pixels: 144 })
    })

    it("passes a triplanar face with 12 repeats and a uv face with 4", () => {
        expect(() => verdict(column(4, 18), column(12))).not.toThrow()
    })

    it("fails a triplanar face that stretches like the uv one", () => {
        expect(() => verdict(column(4, 18), column(4, 18))).toThrow(/the triplanar layer repeats every 13\.71 m of height, not 4/)
    })

    it("fails when the uv face is not stretched either: two faces drawn alike measured nothing", () => {
        expect(() => verdict(column(12), column(12))).toThrow(/the uv layer repeats every 4\.17 m, not stretched/)
    })

    it("fails when a face is missing, rather than passing on no bands", () => {
        expect(() => verdict(column(4, 18), column(0))).toThrow(/nothing was measured/)
    })
})
