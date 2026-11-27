// A long search on a large nav (26 Nov 2026, the maintainer): Detour's A* keeps a node for each polygon it reaches, from a
// pool of a fixed size. A search that runs out of nodes stops where it is and still says success, and computePath makes
// a way to the polygon nearest the goal so far, which nav.path gave as if the floor went no further.
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../../physics3d/rapier.version"
import { RECAST_VERSION } from "../recast.version"
import { createWorld, type World } from "../../physics3d/world"
import { loadRecast, navNodes } from "../nav"
import type { Vec3 } from "../../models"

const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.join(assets, `rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.join(assets, `recast-${RECAST_VERSION}.wasm`))))
})

const AGENT = { radius: 0.3, cell: 0.3 }
const off = (pts: Vec3[], at: Vec3) => pts.length === 0 ? Infinity : Math.hypot(pts.at(-1)![0] - at[0], pts.at(-1)![2] - at[2])

/**
 * A field `size` metres square, a pillar every 3 m so it is thousands of polygons, and a wall along z = 0 with
 * a gap 12 m wide at the +x end. The two sides of the wall's -x end are 3 m apart and the way between them goes
 * the field's length and back: A* spends a node on every polygon of the near side before it turns the corner.
 */
async function field(size: number): Promise<{ w: World, from: Vec3, to: Vec3 }> {
    const w = await createWorld()
    w.box({ at: [0, -0.5, 0], size: [size, 1, size] })
    for (let x = -size / 2 + 1.5; x < size / 2; x += 3) for (let z = -size / 2 + 1.5; z < size / 2; z += 3) {
        if (Math.abs(z) > 1.5) w.box({ at: [x, 1, z], size: [0.6, 2, 0.6] })
    }
    w.box({ at: [-6, 1, 0], size: [size - 12, 2, 1] })
    return { w, from: [-size / 2 + 6, 0, -1.5], to: [-size / 2 + 6, 0, 1.5] }
}

/** A maze `size` metres square: walls along x every 3 m, each open 3 m at alternate ends, so the way through is a corridor of thousands of polygons. */
async function serpentine(size: number): Promise<{ w: World, from: Vec3, to: Vec3 }> {
    const w = await createWorld()
    w.box({ at: [0, -0.5, 0], size: [size, 1, size] })
    let i = 0
    for (let z = -size / 2 + 3; z < size / 2 - 1; z += 3, i++) w.box({ at: [i % 2 ? 1.5 : -1.5, 1, z], size: [size - 3, 2, 0.6] })
    return { w, from: [-size / 2 + 6, 0, -size / 2 + 1.5], to: [-size / 2 + 6, 0, size / 2 - 1.2] }
}

describe("a long way on a large nav", () => {
    it("reaches its goal on a solo nav", async () => {
        const { w, from, to } = await field(120)
        const nav = await w.nav(AGENT)
        const p = nav.path(from, to)
        expect(off(p, to)).toBeLessThan(0.3)
        nav.dispose()
        w.dispose()
    })

    it("reaches its goal on a tiled nav, and on one made from its kept tiles", async () => {
        const { w, from, to } = await field(240)
        const nav = await w.nav({ ...AGENT, tile: 16 })
        expect(off(nav.path(from, to), to)).toBeLessThan(0.3)
        const kept = await w.nav({ ...AGENT, tile: 16, kept: nav.exportTiles() })
        kept.update(Infinity)
        expect(kept.kept).toEqual({ tiles: nav.tiles, why: null })
        expect(off(kept.path(from, to), to)).toBeLessThan(0.3)
        // The field is large enough to matter: the 8,192 nodes the tiled nav's query had stop short of the goal.
        const R = await loadRecast(), mesh = (nav as any).navMesh
        const small = new R.NavMeshQuery(mesh, { maxNodes: 8192 })
        const cut = small.computePath({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, { halfExtents: { x: 1.2, y: 2, z: 1.2 }, maxPathPolys: 1024 })
        small.destroy()
        expect(cut.success).toBe(true)
        expect(off(cut.path.map((q) => [q.x, q.y, q.z] as Vec3), to)).toBeGreaterThan(1)
        nav.dispose()
        kept.dispose()
        w.dispose()
    })

    // computePath's corridor is 256 polygons unless asked, and the solo nav never asked.
    it("reaches its goal on a solo nav when the way crosses more polygons than computePath's default", async () => {
        const { w } = await field(240)
        const nav = await w.nav(AGENT)
        // Corner to corner, which A* walks nearly straight, so it is the corridor that runs out and not the nodes.
        const far: Vec3 = [-118, 0, -118], corner: Vec3 = [118, 0, 118]
        expect(off(nav.path(far, corner), corner)).toBeLessThan(0.3)
        nav.dispose()
        w.dispose()
    })

    it("reaches its goal through a corridor of more than 1,024 polygons on a tiled nav", async () => {
        const { w, from, to } = await serpentine(120)
        const nav = await w.nav({ ...AGENT, tile: 16 })
        const p = nav.path(from, to)
        expect(off(p, to)).toBeLessThan(0.3)
        // There and back along each of the 39 walls.
        expect(p.length).toBeGreaterThan(70)
        nav.dispose()
        w.dispose()
    })

    it("still ends as near as the floor goes when the goal cannot be reached", async () => {
        const { w, from } = await field(120)
        // A pen of four walls round a goal on the far side: floor inside, no way in.
        const pen: Vec3 = [-40, 0, 30.5]
        for (const [dx, dz, sx, sz] of [[0, -3, 7, 1], [0, 3, 7, 1], [-3, 0, 1, 7], [3, 0, 1, 7]]) w.box({ at: [pen[0] + dx!, 1, pen[2] + dz!], size: [sx!, 2, sz!] })
        for (const nav of [await w.nav(AGENT), await w.nav({ ...AGENT, tile: 16 })]) {
            expect(nav.nearest(pen, 0.5)).not.toBeNull()
            const p = nav.path(from, pen)
            // Outside the pen, by its wall: 2.5 m of floor inside, a 1 m wall and the walker's radius.
            expect(p.length).toBeGreaterThan(0)
            expect(off(p, pen)).toBeGreaterThan(3)
            expect(off(p, pen)).toBeLessThan(5)
            nav.dispose()
        }
        w.dispose()
    })
})

describe("navNodes", () => {
    it("is four nodes a tiled polygon and one a solo one, from Detour's 2,048 to its 65,535", () => {
        expect(navNodes(0, 4)).toBe(2048)
        expect(navNodes(5000, 1)).toBe(5000)
        expect(navNodes(5000, 4)).toBe(20000)
        expect(navNodes(20000, 4)).toBe(65535)
    })
})
