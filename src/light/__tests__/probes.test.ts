import { MAX_PROBES, SH_FLOATS, blend, probeAt, probeGrid } from "../probes"

describe("the probe grid", () => {
    it("is a metre apart over a room, a metre past its bounds", () => {
        const g = probeGrid([0, 0, 0], [6, 3, 6])
        expect(g.spacing).toBe(1)
        expect(g.origin).toEqual([-1, -1, -1])
        expect(g.counts).toEqual([9, 6, 9])
        expect(probeAt(g, 0)).toEqual([-1, -1, -1])
        expect(probeAt(g, g.counts[0] * g.counts[1] * g.counts[2] - 1)).toEqual([7, 4, 7])
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

describe("blending probes", () => {
    const g = probeGrid([0, 0, 0], [1, 1, 1]) // 4 by 4 by 4 probes, from -1 to 2
    const count = g.counts[0] * g.counts[1] * g.counts[2]
    const sh = new Float32Array(count * SH_FLOATS)
    // Each probe's first coefficient is its x, so a blend is easy to read.
    for (let i = 0; i < count; i++) sh[i * SH_FLOATS] = probeAt(g, i)[0]
    const all = new Uint8Array(count).fill(1)
    const out = new Float32Array(SH_FLOATS)

    it("is a probe's own light on it, and the mix between them", () => {
        expect(blend(g, sh, all, [0, 0, 0], out)).toBe(true)
        expect(out[0]).toBeCloseTo(0, 6)
        blend(g, sh, all, [0.25, 0.5, 0.5], out)
        expect(out[0]).toBeCloseTo(0.25, 6)
    })

    it("takes the nearest edge outside the grid", () => {
        blend(g, sh, all, [9, 0, 0], out)
        expect(out[0]).toBeCloseTo(2, 6)
        blend(g, sh, all, [-9, 0, 0], out)
        expect(out[0]).toBeCloseTo(-1, 6)
    })

    it("leaves out a probe inside a solid and weights its neighbours up", () => {
        const some = all.slice()
        const at = [0.5, 0, 0]
        // The probe at x 1 (y 0, z 0) is inside something.
        const i = (1 + 1) + g.counts[0] * ((0 + 1) + g.counts[1] * (0 + 1))
        expect(probeAt(g, i)).toEqual([1, 0, 0])
        some[i] = 0
        blend(g, sh, some, at, out)
        expect(out[0]).toBeCloseTo(0, 6)
        const none = new Uint8Array(count)
        expect(blend(g, sh, none, at, out)).toBe(false)
    })
})
