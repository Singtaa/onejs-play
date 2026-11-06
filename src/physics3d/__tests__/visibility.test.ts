import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { createWorld, type World } from "../world"
import type { Vec3 } from "../../models"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

/** Whether a floor point is inside a polygon of floor points (x and z), by crossings. */
function inside(poly: readonly Vec3[], x: number, z: number): boolean {
    let ins = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!
        if ((a[2] > z) !== (b[2] > z) && x < ((b[0] - a[0]) * (z - a[2])) / (b[2] - a[2]) + a[0]) ins = !ins
    }
    return ins
}

/** How far a floor point is from the polygon's outline. */
function edgeDistance(poly: readonly Vec3[], x: number, z: number): number {
    let best = Infinity
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!
        const ex = b[0] - a[0], ez = b[2] - a[2]
        const len2 = ex * ex + ez * ez
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[2]) * ez) / len2))
        best = Math.min(best, Math.hypot(a[0] + ex * t - x, a[2] + ez * t - z))
    }
    return best
}

/** A floor whose top is at y = 0, and a wall 1 m thick across x = 5, z from -2 to 2. */
async function walled(): Promise<World> {
    const w = await createWorld()
    w.box({ at: [0, -0.5, 0], size: [80, 1, 80], layer: "floor" })
    w.box({ at: [5, 2, 0], size: [1, 4, 4], layer: "wall" })
    return w
}

describe("visibility", () => {
    it("is a circle `within` round the eye in an open world", async () => {
        const w = await createWorld()
        const poly = w.visibility([0, 0, 0], { within: 10 })
        expect(poly.length).toBeGreaterThanOrEqual(128)
        for (const p of poly) {
            expect(Math.hypot(p[0], p[2])).toBeCloseTo(10, 5)
            expect(p[1]).toBe(0)
        }
    })

    it("stops at a wall, its corners exact, and sees past either end of it", async () => {
        const w = await walled()
        const poly = w.visibility([0, 0, 0], { within: 20 })
        expect(inside(poly, 3, 0)).toBe(true)
        expect(inside(poly, 8, 0)).toBe(false)
        expect(inside(poly, 8, 5)).toBe(true)
        // The near face's two ends are corners of the polygon, to a millimetre.
        for (const z of [-2, 2]) expect(Math.min(...poly.map((p) => Math.hypot(p[0] - 4.5, p[2] - z)))).toBeLessThan(1e-3)
        // Its shadow's edges run from the eye through those corners.
        expect(inside(poly, 9, 3.9)).toBe(false)
        expect(inside(poly, 9, 4.1)).toBe(true)
    })

    it("agrees with canSee everywhere off its outline, among boxes, a turned box, a ball and a pillar", async () => {
        const w = await walled()
        w.box({ at: [-4, 1, 3], size: [2, 2, 1], rotation: { yaw: 30 } })
        w.box({ at: [-2, 1, -6], size: [6, 2, 0.5], rotation: { yaw: -70 } })
        w.sphere({ at: [3, 1.5, -5], radius: 1.2 })
        w.box({ at: [12, 1, 9], size: [0.2, 2, 0.2] })
        const eye: Vec3 = [0.5, 0, 0.3]
        const poly = w.visibility(eye, { within: 18, height: 1.5 })
        let checked = 0, wrong = 0
        let seed = 7
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let i = 0; i < 4000; i++) {
            const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 17.5
            const x = eye[0] + Math.cos(a) * r, z = eye[2] + Math.sin(a) * r
            if (edgeDistance(poly, x, z) < 0.02) continue
            checked++
            if (inside(poly, x, z) !== w.canSee([eye[0], 1.5, eye[2]], [x, 1.5, z])) wrong++
        }
        expect(checked).toBeGreaterThan(3800)
        expect(wrong).toBe(0)
    })

    it("keeps the corner of a box turned towards the eye, rather than cutting across it", async () => {
        const w = await createWorld()
        // Turned 45 degrees: its corners are 3√2 m from its middle along x and z, the nearest at (5.76, 3).
        w.box({ at: [10, 1, 3], size: [6, 2, 6], rotation: { yaw: 45 } })
        const poly = w.visibility([0, 0, 0], { within: 20 })
        const tip = 10 - 3 * Math.SQRT2
        expect(inside(poly, tip - 0.02, 3)).toBe(true)
        expect(inside(poly, tip + 0.05, 3)).toBe(false)
    })

    it("does not miss a thin pillar far off between two rays of its fan", async () => {
        const w = await createWorld()
        w.box({ at: [17, 1, 3], size: [0.1, 2, 0.1] })
        const poly = w.visibility([0, 0, 0], { within: 20 })
        const behind = 19 / Math.hypot(17, 3)
        expect(inside(poly, 17 * behind, 3 * behind)).toBe(false)
    })

    it("sees over what is lower than its eyes", async () => {
        const w = await createWorld()
        w.box({ at: [3, 0.5, 0], size: [1, 1, 4] })
        expect(inside(w.visibility([0, 0, 0], { within: 10 }), 6, 0)).toBe(true)
        expect(inside(w.visibility([0, 0, 0], { within: 10, height: 0.5 }), 6, 0)).toBe(false)
    })

    it("sees through what its filter leaves out", async () => {
        const w = await walled()
        expect(inside(w.visibility([0, 0, 0], { within: 20, skip: ["wall"] }), 8, 0)).toBe(true)
        expect(inside(w.visibility([0, 0, 0], { within: 20, only: ["floor"] }), 8, 0)).toBe(true)
        expect(inside(w.visibility([0, 0, 0], { within: 20, only: ["wall"] }), 8, 0)).toBe(false)
    })

    it("is blocked by a body made since the last step", async () => {
        const w = await createWorld()
        w.step()
        w.box({ at: [4, 1, 0], size: [1, 2, 2] })
        expect(inside(w.visibility([0, 0, 0], { within: 10 }), 7, 0)).toBe(false)
    })

    it("asks the engine once a look, for what is in range, and casts no ray into it", async () => {
        const w = await createWorld()
        for (let i = 0; i < 30; i++) w.box({ at: [((i * 7) % 30) - 15, 1, ((i * 11) % 30) - 15], size: [1.5, 2, 1.5], rotation: { yaw: i * 13 } })
        w.step()
        const raw = (w as any).raw
        let rays = 0, queries = 0
        const cast = raw.castRayAndGetNormal.bind(raw), query = raw.intersectionsWithShape.bind(raw)
        raw.castRayAndGetNormal = (...args: unknown[]) => { rays++; return cast(...args) }
        raw.intersectionsWithShape = (...args: unknown[]) => { queries++; return query(...args) }
        // Clear of every box: the box at the middle stands where the old version of this test stood its eye.
        const poly = w.visibility([0.3, 0, 2.5], { within: 20 })
        expect(poly.length).toBeGreaterThan(30)
        expect(rays).toBe(0)
        expect(queries).toBe(1)
    })

    it("agrees with canSee among tilted boxes, a tilted capsule, a ball cut off-centre and a mesh", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [80, 1, 80], layer: "floor" })
        w.box({ at: [5, 1, 2], size: [2, 3, 1], rotation: { pitch: 35 } })
        w.box({ at: [-4, 1.5, 4], size: [3, 1, 2], rotation: { roll: 50, yaw: 20 } })
        w.capsule({ at: [2, 1, -5], radius: 0.5, height: 4, rotation: { pitch: 60, yaw: 30 } })
        w.sphere({ at: [-5, 2, -2], radius: 1.4 })
        // A bent wall of four triangles, leaning: the plane cuts it into two segments.
        const v = new Float32Array([-9, 0, 9, -5, 0, 7, -1, 0, 9, -9, 3, 9.5, -5, 3, 7.5, -1, 3, 9.5])
        await w.mesh({ vertices: v, indices: new Uint32Array([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]) })
        const eye: Vec3 = [0.2, 0, -0.4]
        const poly = w.visibility(eye, { within: 16, height: 1.2 })
        let checked = 0, wrong = 0
        let seed = 11
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let i = 0; i < 4000; i++) {
            const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 15.5
            const x = eye[0] + Math.cos(a) * r, z = eye[2] + Math.sin(a) * r
            if (edgeDistance(poly, x, z) < 0.02) continue
            checked++
            if (inside(poly, x, z) !== w.canSee([eye[0], 1.2, eye[2]], [x, 1.2, z])) wrong++
        }
        expect(checked).toBeGreaterThan(3700)
        expect(wrong).toBe(0)
    })

    it("follows a static box moved by hand, and a restore", async () => {
        const w = await createWorld()
        const wall = w.box({ at: [5, 1, 0], size: [1, 2, 4] })
        w.step()
        const sees = () => inside(w.visibility([0, 0, 0], { within: 12 }), 8, 0)
        expect(sees()).toBe(false)
        const before = w.snapshot()
        wall.position = [5, 1, 9]
        expect(sees()).toBe(true)
        w.restore(before)
        expect(sees()).toBe(false)
    })

    it("sees nothing from inside something solid, as canSee does not", async () => {
        const w = await createWorld()
        w.box({ at: [0, 1, 0], size: [2, 2, 2] })
        const poly = w.visibility([0, 0, 0], { within: 10, height: 1 })
        expect(poly.length).toBe(1)
        expect(poly[0]).toEqual([0, 0, 0])
        expect(w.canSee([0, 1, 0], [5, 1, 0])).toBe(false)
    })

    it("puts a box's corners where they are, to a tenth of a millimetre", async () => {
        const w = await walled()
        const poly = w.visibility([0, 0, 0], { within: 20 })
        for (const z of [-2, 2]) expect(Math.min(...poly.map((p) => Math.hypot(p[0] - 4.5, p[2] - z)))).toBeLessThan(1e-4)
    })
})
