import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../../physics3d/rapier.version"
import { RECAST_VERSION } from "../recast.version"
import { createWorld, type World } from "../../physics3d/world"
import { navClock, type TiledNav } from "../tiled"
import { loadRecast } from "../nav"
import type { Vec3 } from "../../models"
import { hill, hills } from "./hills"

const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.join(assets, `rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.join(assets, `recast-${RECAST_VERSION}.wasm`))))
})

const len = (from: Vec3, pts: Vec3[]) => {
    let d = 0, a = from
    for (const p of pts) { d += Math.hypot(p[0] - a[0], p[2] - a[2]); a = p }
    return d
}
const ends = (pts: Vec3[], at: Vec3) => pts.length > 0 && Math.hypot(pts.at(-1)![0] - at[0], pts.at(-1)![2] - at[2]) < 0.3

/** A 40 x 40 floor at y = 0 with a wall along z = 0 from x = -20 to 14, so the way round is at x = 14 to 20. */
async function walled(): Promise<World> {
    const w = await createWorld()
    w.box({ at: [0, -0.5, 0], size: [40, 1, 40], layer: "floor" })
    w.box({ at: [-3, 1, 0], size: [34, 2, 1], layer: "wall" })
    return w
}

describe("world.nav({ tile })", () => {
    it("builds the tiles under the world's static bodies, and paths across them", async () => {
        const w = await walled()
        const nav = await w.nav({ radius: 0.3, tile: 8 })
        // 40 m of floor in 8 m tiles is 5 by 5, and the apron reaches one more each side.
        expect(nav.tiles).toBeGreaterThanOrEqual(25)
        expect(nav.pending).toBe(0)
        const from: Vec3 = [0, 0, -10], to: Vec3 = [0, 0, 10]
        const p = nav.path(from, to)
        expect(ends(p, to)).toBe(true)
        expect(p.some((q) => q[0] > 13.5)).toBe(true)
        // Two legs to the end of the wall at about x = 14.3: 2 * hypot(14.3, 10) = 34.9 m.
        expect(len(from, p)).toBeGreaterThan(34)
        expect(len(from, p)).toBeLessThan(37)
        nav.dispose()
        expect(() => nav.path(from, to)).toThrow(/disposed/)
        w.dispose()
    })

    it("is a solo navmesh's floor: the same way round, within a cell or two", async () => {
        const w = await walled()
        const solo = await w.nav({ radius: 0.3 })
        const tiled = await w.nav({ radius: 0.3, tile: 8 })
        const from: Vec3 = [-15, 0, -12], to: Vec3 = [-12, 0, 15]
        expect(Math.abs(len(from, tiled.path(from, to)) - len(from, solo.path(from, to)))).toBeLessThan(0.5)
        w.dispose()
    })

    // Sai, 8 Nov: as a Hearth builds itself, the colliders and the pathfinding update together.
    it("reroutes round a building's collider when it is made, and back when it is destroyed, a frame's budget at a time", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [60, 1, 60] })
        const nav = await w.nav({ radius: 0.4, tile: 8, budget: 2 })
        const from: Vec3 = [0, 0, -20], to: Vec3 = [0, 0, 20]
        expect(len(from, nav.path(from, to))).toBeCloseTo(40, 0)
        w.step()   // the engine's first step, which is slow for reasons of its own
        // A 20 by 20 m hall across the straight line: one call, no nav call.
        const hall = w.box({ at: [0, 4, 0], size: [20, 8, 20] })
        expect(nav.pending).toBeGreaterThan(0)
        // A clock on which every tile takes 0.7 ms, so the budget's verdict is the same on any
        // machine: a 2 ms frame starts a tile at 0, 0.7 and 1.4 ms, and not at 2.1.
        let clock = 0
        const now = vi.spyOn(navClock, "now").mockImplementation(() => (clock += 0.7))
        const perStep = stepUntilSettled(w, nav)
        now.mockRestore()
        expect(perStep.length).toBeGreaterThan(1)
        for (const n of perStep.slice(0, -1)) expect(n).toBe(3)
        expect(perStep.at(-1)).toBeLessThanOrEqual(3)
        const round = nav.path(from, to)
        expect(ends(round, to)).toBe(true)
        // Round a corner of the hall, 10.4 m out with the radius: 2 * hypot(10.4, 20) = 45 m at least.
        expect(len(from, round)).toBeGreaterThan(44)
        for (const q of round) expect(Math.abs(q[0]) > 10.3 || Math.abs(q[2]) > 10.3, `${q} inside the hall`).toBe(true)
        hall.destroy()
        expect(stepUntilSettled(w, nav).length).toBeGreaterThan(1)
        expect(len(from, nav.path(from, to))).toBeCloseTo(40, 0)
        w.dispose()
    })

    it("follows a static body moved by hand, and a world restored", async () => {
        const w = await walled()
        const nav = await w.nav({ radius: 0.3, tile: 8 })
        const from: Vec3 = [0, 0, -10], to: Vec3 = [0, 0, 10]
        const snap = w.snapshot()
        const wall = w.bodies.find((b) => (b as any).layer === "wall")! as any
        wall.position = [-3, 1, 30]   // off the floor: nothing in the way
        nav.update(Infinity)
        expect(len(from, nav.path(from, to))).toBeCloseTo(20, 0)
        w.restore(snap)
        nav.update(Infinity)
        expect(len(from, nav.path(from, to))).toBeGreaterThan(34)
        w.dispose()
    })

    it("counts what the solo nav counts: no dynamic, kinematic or trigger bodies, only the layers asked for", async () => {
        const w = await walled()
        const nav = await w.nav({ radius: 0.3, tile: 8, only: ["floor"] })
        const from: Vec3 = [0, 0, -10], to: Vec3 = [0, 0, 10]
        expect(len(from, nav.path(from, to))).toBeCloseTo(20, 0)
        w.box({ at: [0, 1, 5], size: [30, 2, 1], layer: "floor", dynamic: true })
        w.box({ at: [0, 1, 5], size: [30, 2, 1], layer: "floor", kinematic: true })
        w.box({ at: [0, 1, 5], size: [30, 2, 1], layer: "floor", trigger: true })
        w.box({ at: [0, 1, 5], size: [30, 2, 1], layer: "wall" })
        expect(nav.pending).toBe(0)
        w.dispose()
    })

    it("blocks where no collider is, and lets go when removed", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [40, 1, 40] })
        const nav = await w.nav({ radius: 0.3, tile: 8 })
        const from: Vec3 = [0, 0, -10], to: Vec3 = [0, 0, 10]
        const fire = nav.block({ at: [0, 1, 0], size: [10, 2, 2], yaw: 90 })
        // Turned 90, it lies along z: 2 m wide in x, 10 long in z, across the line.
        nav.update(Infinity)
        const round = nav.path(from, to)
        expect(ends(round, to)).toBe(true)
        expect(len(from, round)).toBeGreaterThan(20.2)
        expect(round.some((q) => Math.abs(q[0]) > 1.2)).toBe(true)
        fire.remove()
        expect(fire.alive).toBe(false)
        nav.update(Infinity)
        expect(len(from, nav.path(from, to))).toBeCloseTo(20, 0)
        w.dispose()
    })

    it("costs a named area, and avoids one", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [40, 1, 40] })
        const nav = await w.nav({ radius: 0.3, tile: 8 })
        const from: Vec3 = [-10, 0, 0], to: Vec3 = [10, 0, 0]
        // Mud across the straight line; a road round it, 6 m to the side.
        nav.mark({ at: [0, 0, 0], size: [6, 2, 10], area: "mud" })
        nav.mark({ at: [0, 0, 7], size: [24, 2, 3], area: "road" })
        nav.update(Infinity)
        expect(len(from, nav.path(from, to))).toBeCloseTo(20, 0)
        const dry = nav.path(from, to, { cost: { mud: 10, road: 0.5 } })
        expect(dry.some((q) => q[2] > 5)).toBe(true)
        const avoided = nav.path(from, to, { avoid: ["mud"] })
        for (let i = 1; i < avoided.length; i++) expect(Math.abs(avoided[i - 1]![2]) < 4.9 && Math.abs(avoided[i]![2]) < 4.9 && Math.sign(avoided[i - 1]![0]) !== Math.sign(avoided[i]![0])).toBe(false)
        expect(() => nav.path(from, to, { cost: { mud: 0 } })).toThrow(/positive/)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        for (let i = 0; i < 3; i++) nav.path(from, to, { cost: { raod: 0.5 }, avoid: ["raod"] })
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]![0]).toMatch(/no area called "raod".*Areas so far: mud, road/)
        warn.mockRestore()
        w.dispose()
    })

    for (const tile of [undefined, 8]) {
        it(`answers the nearest floor, its triangles, and a path that goes nowhere${tile ? ", in tiles" : ""}`, async () => {
            const w = await walled()
            const nav = await w.nav({ radius: 0.3, tile })
            // On the floor, a little above it: the floor under it.
            const on = nav.nearest([5, 0.3, -5])!
            expect(on[0]).toBeCloseTo(5, 1)
            expect(on[2]).toBeCloseTo(-5, 1)
            expect(Math.abs(on[1])).toBeLessThan(0.2)
            expect(nav.nearest([5, 0.1, -5], 0.2)).not.toBeNull()
            expect(nav.nearest([0, 30, 0])).toBeNull()
            expect(() => nav.nearest([0, 0, 0], -1)).toThrow(/within/)
            // Both ends one place: the place, which the solo and tiled navs once answered with nothing.
            expect(nav.path([5, 0, -5], [5, 0, -5])).toEqual([[expect.closeTo(5, 1), expect.closeTo(0, 1), expect.closeTo(-5, 1)]])
            expect(nav.path([50, 0, 50], [50, 0, 50])).toEqual([])
            // The floor as triangles, all of it at the floor's height or the wall's top.
            const { positions, indices } = nav.polygons()
            expect(indices.length % 3).toBe(0)
            let area = 0
            for (let i = 0; i < indices.length; i += 3) {
                const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3
                const ux = positions[b]! - positions[a]!, uz = positions[b + 2]! - positions[a + 2]!
                const vx = positions[c]! - positions[a]!, vz = positions[c + 2]! - positions[a + 2]!
                if (positions[a + 1]! < 1) area += Math.abs(ux * vz - uz * vx) / 2
                for (const k of [a, b, c]) expect(Math.abs(positions[k + 1]!) < 0.3 || Math.abs(positions[k + 1]! - 2) < 0.3).toBe(true)
            }
            // The floor less its edge's radius and the wall's footprint with a radius round it: 39.4^2 - 34.3 * 1.6.
            const expected = 39.4 * 39.4 - 34.3 * 1.6
            if (tile !== undefined) expect(Math.abs(area - expected) / expected).toBeLessThan(0.02)
            w.dispose()
        })
    }

    it("has no floor inside a box: inside a hall's walls, the nearest floor is outside them", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [60, 1, 60] })
        w.box({ at: [0, 4, 0], size: [20, 8, 20] })
        w.box({ at: [15, 0.1, 0], size: [4, 0.2, 4] })   // a low platform, still walked on
        w.box({ at: [-20, 1, 0], size: [4, 2, 4], rotation: { yaw: 30 } })
        const nav = await w.nav({ radius: 0.4, tile: 8 })
        const inside = nav.nearest([3, 0, 2], 12)!
        expect(Math.abs(inside[0]) > 10.3 || Math.abs(inside[2]) > 10.3, `${inside}`).toBe(true)
        expect(nav.nearest([3, 0, 2], 1)).toBeNull()
        expect(nav.nearest([-20, 0, 0], 0.5)).toBeNull()
        // On the platform's top, as Recast's cells round it up (0.2 m, read back about 0.3), not the floor beside it.
        const top = nav.nearest([15, 0.3, 0], 0.2)!
        expect(top[1]).toBeGreaterThan(0.15)
        expect(top[1]).toBeLessThan(0.35)
        // A path into the hall has nowhere to end; to the nearest floor, it ends at the wall.
        expect(nav.path([0, 0, -20], [3, 0, 2])).toEqual([])
        expect(nav.path([0, 0, -20], inside).length).toBeGreaterThan(0)
        w.dispose()
    })

    it("frees what a tile held when it is built again", async () => {
        const R = await loadRecast()
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [40, 1, 40] })
        const nav = await w.nav({ radius: 0.3, tile: 8 })
        const M = R.Raw.Module
        // Where a large block lands: the top of what is in use, since Recast's heap starts at 64 MB and never grows here.
        const top = () => { const p = M._malloc(8 << 20); M._free(p); return p }
        const churn = (n: number, leak = 0) => {
            for (let i = 0; i < n; i++) {
                const b = w.box({ at: [(i % 5) * 4 - 8, 1, 0], size: [3, 2, 3] })
                nav.update(Infinity)
                b.destroy()
                nav.update(Infinity)
                if (leak > 0) M._malloc(leak)
            }
        }
        churn(20)
        const before = top()
        churn(200)
        expect(top()).toBe(before)
        // The instrument sees a leak: 64 KB kept a churn, more than the holes below the top hold, moves it.
        churn(200, 65536)
        expect(top()).toBeGreaterThan(before)
        w.dispose()
    })

    it("takes a heightfield's ground as the triangles a mesh would give", async () => {
        const w = await createWorld()
        const n = 33, heights = hills(0, 0, n)
        w.heightfield({ at: [0, 0, 0], size: [64, 64], heights })
        const nav = await w.nav({ radius: 0.4, height: 1.8, stepHeight: 0.5, cell: 0.33, tile: 16 })
        const p = nav.path([4, hill(4, 4), 4], [60, hill(60, 60), 60])
        expect(p.length).toBeGreaterThan(0)
        const end = p.at(-1)!
        expect(Math.hypot(end[0] - 60, end[2] - 60)).toBeLessThan(0.5)
        expect(Math.abs(end[1] - hill(60, 60))).toBeLessThan(0.3)
        w.dispose()
    })
})

/** Steps until no tile is stale, and returns how many tiles each step rebuilt. */
function stepUntilSettled(w: World, nav: TiledNav): number[] {
    const out: number[] = []
    for (let i = 0; i < 600 && nav.pending > 0; i++) {
        const before = nav.pending
        w.step()
        out.push(before - nav.pending)
    }
    expect(nav.pending).toBe(0)
    return out
}
