import { describe, expect, it } from "vitest"
import { gpuCores } from "./cost"

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
