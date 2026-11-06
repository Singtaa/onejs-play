/** world.nav in a 2D world seen from above: stage pixels, every static body a wall. */
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../../physics2d/rapier.version"
import { RECAST_VERSION } from "../recast.version"
import { createWorld2D, type Vec2, type World2D } from "../../physics2d/world"

const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")

beforeAll(() => {
    setWasmModule("rapier2d", new WA.Module(fs.readFileSync(path.join(assets, `rapier2d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.join(assets, `recast-${RECAST_VERSION}.wasm`))))
})

const len = (from: Vec2, pts: Vec2[]) => {
    let d = 0, a = from
    for (const p of pts) { d += Math.hypot(p[0] - a[0], p[1] - a[1]); a = p }
    return d
}

/** The nearest any point along the path comes to a box, by sampling every 2 px. */
function closest(from: Vec2, pts: Vec2[], box: { x0: number, y0: number, x1: number, y1: number }): number {
    let best = Infinity, a = from
    for (const p of pts) {
        const n = Math.max(1, Math.ceil(Math.hypot(p[0] - a[0], p[1] - a[1]) / 2))
        for (let i = 0; i <= n; i++) {
            const x = a[0] + ((p[0] - a[0]) * i) / n, y = a[1] + ((p[1] - a[1]) * i) / n
            const dx = Math.max(box.x0 - x, 0, x - box.x1), dy = Math.max(box.y0 - y, 0, y - box.y1)
            best = Math.min(best, Math.hypot(dx, dy))
        }
        a = p
    }
    return best
}

/** A 1000 px room with a wall across the middle from the left, leaving a gap on the right. */
async function room(middle: "box" | "outline" = "box"): Promise<World2D> {
    const w = await createWorld2D({ gravity: [0, 0] })
    w.box({ at: [500, -10], size: [1040, 20] })
    w.box({ at: [500, 1010], size: [1040, 20] })
    w.box({ at: [-10, 500], size: [20, 1040] })
    w.box({ at: [1010, 500], size: [20, 1040] })
    if (middle === "box") w.box({ at: [400, 500], size: [800, 20], layer: "wall" })
    else w.outline({ at: [0, 500], points: [[0, 0], [800, 0]], layer: "wall" })
    return w
}
const MIDDLE = { x0: 0, y0: 490, x1: 800, y1: 510 }

describe("2D world.nav", () => {
    for (const middle of ["box", "outline"] as const) {
        it(`goes round a wall (${middle === "box" ? "a box" : "an outline"}) through the gap, keeping its radius from it`, async () => {
            const w = await room(middle)
            const nav = await w.nav({ radius: 30 })
            const from: Vec2 = [200, 200], to: Vec2 = [200, 800]
            const pts = nav.path(from, to)
            expect(pts.length).toBeGreaterThan(1)
            const end = pts[pts.length - 1]!
            expect(Math.hypot(end[0] - to[0], end[1] - to[1])).toBeLessThan(5)
            // Through the gap, so well past the straight 600 px.
            expect(len(from, pts)).toBeGreaterThan(1300)
            const wall = middle === "box" ? MIDDLE : { x0: 0, y0: 500, x1: 800, y1: 500 }
            // Its radius, to within the cell the floor is measured on (10 px by default here).
            expect(closest(from, pts, wall)).toBeGreaterThan(30 - 10)
            nav.dispose()
            w.dispose()
        })
    }

    it("goes round a round wall, and does not stand on it", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        w.box({ at: [500, -10], size: [1040, 20] })
        w.box({ at: [500, 1010], size: [1040, 20] })
        w.circle({ at: [500, 500], radius: 200 })
        const nav = await w.nav({ radius: 20 })
        const from: Vec2 = [500, 100], to: Vec2 = [500, 900]
        const pts = nav.path(from, to)
        let a = from, nearest = Infinity
        for (const p of pts) {
            for (let i = 0; i <= 50; i++) {
                const x = a[0] + ((p[0] - a[0]) * i) / 50, y = a[1] + ((p[1] - a[1]) * i) / 50
                nearest = Math.min(nearest, Math.hypot(x - 500, y - 500))
            }
            a = p
        }
        expect(nearest).toBeGreaterThan(215)
        // Inside it is no floor.
        expect(nav.path([500, 500], [500, 900])).toEqual([])
        nav.dispose()
        w.dispose()
    })

    it("leaves the inside of a bent outline open: it is a line, not a shape", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        w.outline({ points: [[100, 100], [900, 100], [900, 900]] })
        const nav = await w.nav({ radius: 20 })
        // From inside the corner the L bends round to outside it, round its open side.
        const pts = nav.path([700, 300], [300, 700])
        expect(pts.length).toBeGreaterThan(0)
        expect(len([700, 300], pts)).toBeLessThan(600)
        nav.dispose()
        w.dispose()
    })

    it("walls only the layers asked for", async () => {
        const w = await room()
        const nav = await w.nav({ radius: 30, only: ["default"] })
        // The middle wall is on "wall", so the way is straight.
        expect(len([200, 200], nav.path([200, 200], [200, 800]))).toBeLessThan(620)
        nav.dispose()
        w.dispose()
    })

    it("refuses a world with gravity, saying why", async () => {
        const w = await createWorld2D()
        w.box({ at: [0, 600], size: [1000, 20] })
        await expect(w.nav()).rejects.toThrow(/seen from above/)
        w.dispose()
    })
})
