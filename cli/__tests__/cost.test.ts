import { describe, expect, it } from "vitest"
import { STARVED_S, gpuCores, starved } from "./cost"

describe("a run's GPU cores, read from oj test's output", () => {
    it("reads the GPU process's cores from the cost line", () => {
        expect(gpuCores("[2.1 s] [ojplay] passed\n[3.0 s] [ojplay] chrome's CPU over its 10.0 s: GPU 24.5 s (2.45 cores), renderer 5.0 s (0.50 cores)\n")).toBe(2.45)
        expect(gpuCores("[ojplay] chrome's CPU over its 4.0 s: renderer 3.0 s (0.75 cores), GPU 1.0 s (0.25 cores)")).toBe(0.25)
        // As oj test says it, with the frame rate between the length and the processes.
        expect(gpuCores("[0.0 s] [ojplay] chrome's CPU over its 6.3 s at 6.4 frames a second: GPU 4.8 s (0.77 cores), renderer 1.8 s (0.29 cores)")).toBe(0.77)
    })

    // A run with no cost line, or one whose busiest process is not the GPU's, must not read as a GPU that cost nothing.
    it("reads nothing from a run that said no cost, or named no GPU process", () => {
        expect(gpuCores("[ojplay] passed\n[ojplay] closing: list 15.0 s (the browser's socket did not open in 5 s)")).toBe(null)
        expect(gpuCores("[ojplay] chrome's CPU over its 4.0 s: renderer 3.0 s (0.75 cores), browser 0.1 s (0.03 cores)")).toBe(null)
        expect(gpuCores("[ojplay] chrome's processes (13 of them) over 2.0 s, CPU used: GPU 18.88 s (137.4 s since it started)")).toBe(null)
    })
})

// Tachi b31f8658: a run drawing in software whose machine fired the sweep's
// timers over 2 s late fails as starved, by that name, so a priority call
// that stops working reads as itself and not as a page that did not answer.
describe("a starved run", () => {
    const lowered = "[1.9 s] [ojplay] drawing below normal priority\n[9.0 s] [ojplay] chrome's CPU over its 9.1 s at 12.3 frames a second: GPU 22.2 s (2.42 cores)\n"
    it("passes a run whose timers fired within the limit", () => {
        expect(starved(0.0, lowered)).toBe(null)
        expect(starved(STARVED_S, lowered)).toBe(null)
    })

    it("fails a run whose timers fired late, saying how late, what the drawing was given and what it cost", () => {
        expect(starved(12.4, lowered)).toBe("starved: the sweep's timers fired 12.4 s late while it drew in software (drawing below normal priority; GPU 2.42 cores)")
        const own = "[1.9 s] [ojplay] drawing at its own priority (7688 GPU: EPERM)\n[35.4 s] [ojplay] failed: CDP Runtime.evaluate did not answer in 30s\n"
        expect(starved(12.4, own)).toBe("starved: the sweep's timers fired 12.4 s late while it drew in software (drawing at its own priority (7688 GPU: EPERM); GPU cores not said)")
    })

    it("names a run that never said what its drawing was given", () => {
        expect(starved(3.1, "[ojplay] passed\n")).toBe("starved: the sweep's timers fired 3.1 s late while it drew in software (it never said what its drawing was given; GPU cores not said)")
    })
})
