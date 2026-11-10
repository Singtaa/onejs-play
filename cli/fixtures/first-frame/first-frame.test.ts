import { describe, it, expect } from "vitest"
import { firstFrameProblems, FRAMES } from "./first-frame.playtest.mjs"

const deep = [128, 128, 128], shallow = [32, 32, 32]
const steady = Array.from({ length: FRAMES }, () => ({ deep, shallow }))

describe("the first-frame playtest", () => {
    it("passes frames that all read alike, with the shallow half faded", () => {
        expect(firstFrameProblems(steady)).toEqual([])
    })

    it("fails a first frame that drew the sheet over white, as the editor did", () => {
        const flash = [{ deep: [255, 255, 255], shallow: [255, 255, 255] }, ...steady.slice(1)]
        expect(firstFrameProblems(flash).join()).toMatch(/frame 1 reads/)
    })

    it("fails when nothing was faded", () => {
        const flat = steady.map(() => ({ deep, shallow: deep }))
        expect(firstFrameProblems(flat).join()).toMatch(/nothing was faded/)
    })

    it("fails a black screen", () => {
        const black = steady.map(() => ({ deep: [0, 0, 0], shallow: [0, 0, 0] }))
        expect(firstFrameProblems(black).join()).toMatch(/nothing was drawn/)
    })

    it("fails when no frames were read, since nothing was compared", () => {
        expect(firstFrameProblems([]).join()).toMatch(/nothing was compared/)
    })
})
