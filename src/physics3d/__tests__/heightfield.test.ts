import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { RECAST_VERSION } from "../../nav/recast.version"
import { createWorld } from "../world"
import { heightfieldTriangles } from "../heightfield"
import { hill, hills } from "../../nav/__tests__/hills"
import type { Vec3 } from "../../models"

const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.join(assets, `rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.join(assets, `recast-${RECAST_VERSION}.wasm`))))
})

/** The same grid as triangles, two a cell split as Rapier splits a heightfield's, as a cart would hand world.mesh. */
function gridMesh(x0: number, z0: number, heights: Float32Array, n: number, step: number) {
    const vertices = new Float32Array(n * n * 3), indices: number[] = []
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
        const k = (ix + iz * n) * 3
        vertices[k] = x0 + ix * step; vertices[k + 1] = heights[ix + iz * n]!; vertices[k + 2] = z0 + iz * step
    }
    for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) {
        const a = ix + iz * n, b = a + 1, c = a + n, d = c + 1
        indices.push(a, c, b, b, c, d)
    }
    return { vertices, indices: new Uint32Array(indices) }
}

describe("world.heightfield", () => {
    it("is where a triangle mesh of the same grid is, to a ray, within a centimetre", async () => {
        const n = 33, heights = hills(64, -64, n)
        const a = await createWorld(), b = await createWorld()
        const ground = a.heightfield({ at: [64, 0, -64], size: [64, 64], heights })
        await b.mesh(gridMesh(64, -64, heights, n, 2))
        expect(ground.position).toEqual([64, 0, -64])
        let worst = 0
        for (let i = 0; i < 400; i++) {
            const x = 64 + ((i * 37) % 641) / 10, z = -64 + ((i * 53) % 641) / 10
            const ha = a.raycast([x, 50, z], [x, -50, z]), hb = b.raycast([x, 50, z], [x, -50, z])
            expect(ha, `${x}, ${z}`).not.toBeNull()
            worst = Math.max(worst, Math.abs(ha!.point[1] - hb!.point[1]))
            expect(ha!.normal[1]).toBeGreaterThan(0.5)
        }
        expect(worst).toBeLessThan(0.001)
        // Its samples are where the cart put them: x fastest, from the corner.
        expect(a.raycast([64 + 2 * 5, 50, -64 + 2 * 7], [64 + 2 * 5, -50, -64 + 2 * 7])!.point[1]).toBeCloseTo(hill(74, -50), 3)
        a.dispose(); b.dispose()
    })

    it("reads back, for nav and visibility, as the triangles Rapier collides with", async () => {
        const a = await createWorld(), b = await createWorld()
        const ground = a.heightfield({ at: [64, 0, -64], size: [64, 64], heights: hills(64, -64) })
        const c = (ground as any).collider(), t = c.translation()
        const back = heightfieldTriangles(c)
        const vertices = back.vertices.map((v, i) => v + [t.x, t.y, t.z][i % 3]!)
        await b.mesh({ vertices, indices: back.indices })
        let worst = 0
        for (let i = 0; i < 400; i++) {
            const x = 64 + ((i * 37) % 641) / 10, z = -64 + ((i * 53) % 641) / 10
            worst = Math.max(worst, Math.abs(a.raycast([x, 50, z], [x, -50, z])!.point[1] - b.raycast([x, 50, z], [x, -50, z])!.point[1]))
        }
        expect(worst).toBeLessThan(0.001)
        a.dispose(); b.dispose()
    })

    it("carries a character across the seam between two chunks without catching", async () => {
        const w = await createWorld()
        for (const cx of [0, 1]) w.heightfield({ at: [cx * 64, 0, 0], size: [64, 64], heights: hills(cx * 64, 0) })
        const me = w.character({ at: [40, hill(40, 30) + 0.05, 30], stepHeight: 0.5 })
        let stood = 0, slowest = Infinity
        for (let i = 0; i < 480; i++) {
            const before = me.position[0]
            me.walk([5, 0, 0])
            w.step()
            if (me.grounded) stood++
            // Past the first steps, every step moves it on at near its pace: nothing stops it at x = 64.
            if (i > 10) slowest = Math.min(slowest, (me.position[0] - before) * 60)
        }
        expect(me.position[0]).toBeGreaterThan(70)
        expect(slowest).toBeGreaterThan(3.5)
        expect(stood).toBeGreaterThan(460)
        w.dispose()
    })

    it("takes samples for a grid that is not square, and refuses heights that do not fit", async () => {
        const w = await createWorld()
        const heights = new Float32Array(3 * 2).map((_, k) => k)   // x 0..2, z 0..1: height ix + 3 iz
        w.heightfield({ size: [4, 2], heights, samples: [3, 2] })
        expect(w.raycast([4, 10, 2], [4, -10, 2])!.point[1]).toBeCloseTo(5, 3)
        expect(w.raycast([2, 10, 0], [2, -10, 0])!.point[1]).toBeCloseTo(1, 3)
        expect(() => w.heightfield({ size: [4, 4], heights: new Float32Array(5) })).toThrow(/not a square grid/)
        expect(() => w.heightfield({ size: [4, 4], heights: new Float32Array(6), samples: [2, 2] })).toThrow(/needs 4 heights/)
        expect(() => w.heightfield({ size: [4, 4], heights: [0, 0, NaN, 0] })).toThrow(/height 2 is NaN/)
        expect(() => w.heightfield({ size: [0, 4], heights: [0, 0, 0, 0] })).toThrow(/size/)
        w.dispose()
    })

    it("is ground to the solo nav and to visibility", async () => {
        const w = await createWorld()
        w.heightfield({ size: [64, 64], heights: hills(0, 0) })
        const nav = await w.nav({ radius: 0.4, height: 1.8, stepHeight: 0.5, cell: 0.33 })
        const to: Vec3 = [60, hill(60, 60), 60]
        const p = nav.path([4, hill(4, 4), 4], to)
        expect(Math.hypot(p.at(-1)![0] - 60, p.at(-1)![2] - 60)).toBeLessThan(0.5)
        // A ridge across the eye's plane is cut as the triangles it is, and the eye sees out over open ground.
        const sight = w.visibility([32, hill(32, 32), 32], { within: 10 })
        expect(sight.outline.length).toBeGreaterThan(8)
        w.dispose()
    })
})
