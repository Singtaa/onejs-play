import { MAX_PROBES, probeGrid } from "../probes"

describe("the probe grid", () => {
    it("is a metre apart over a room, a metre past its bounds", () => {
        const g = probeGrid([0, 0, 0], [6, 3, 6])
        expect(g.spacing).toBe(1)
        expect(g.origin).toEqual([-1, -1, -1])
        expect(g.counts).toEqual([9, 6, 9])
        // The last probe stands at the far corner, a metre past the bounds.
        expect(g.origin.map((o, k) => o + (g.counts[k]! - 1) * g.spacing)).toEqual([7, 4, 7])
    })

    it("spaces out over a big yard to stay under the cap, about 1.8 m over 60 by 4 m", () => {
        const g = probeGrid([-29, 0, -29], [29, 2, 29])
        const n = g.counts[0] * g.counts[1] * g.counts[2]
        expect(n).toBeLessThanOrEqual(MAX_PROBES)
        expect(g.spacing).toBeGreaterThan(1.6)
        expect(g.spacing).toBeLessThan(2)
        // As tight as fits: a centimetre closer would pass the cap.
        const size = [60, 4, 60]
        const closer = size.map((x) => Math.floor(x / (g.spacing - 0.01) + 1e-9) + 1)
        expect(closer[0]! * closer[1]! * closer[2]!).toBeGreaterThan(MAX_PROBES)
    })
})
