import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { createWorld2D, shape2D, type World2D, type Vec2, type Body2D } from "../world"
import { setElementPlacer, type ElementPlacement } from "../elements"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier2d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier2d-${RAPIER_VERSION}.wasm`))))
})

const near = (a: readonly number[], b: readonly number[], eps = 0.5) => a.every((v, i) => Math.abs(v - b[i]!) < eps)
const run = (w: World2D, steps: number) => { for (let i = 0; i < steps; i++) w.step() }

/** A floor 2000 px wide whose top is at y = 600, on a stage with y down. */
async function floored(options = {}): Promise<World2D> {
    const w = await createWorld2D(options)
    w.box({ at: [0, 650], size: [2000, 100], layer: "floor" })
    return w
}

describe("2D bodies, in stage pixels with y down", () => {
    it("fall down the screen and rest on the floor", async () => {
        const w = await floored()
        const crate = w.box({ at: [0, 100], size: [100, 100], dynamic: true })
        run(w, 180)
        expect(crate.position[1]).toBeCloseTo(550, 0)
        expect(Math.abs(crate.velocity[1])).toBeLessThan(1)
        w.dispose()
    })

    it("fall at g: 490 px in the first second at 980 px/s², at any pixelsPerMeter", async () => {
        for (const pixelsPerMeter of [100, 32]) {
            const w = await createWorld2D({ pixelsPerMeter, gravity: [0, 980] })
            const ball = w.circle({ radius: 10, dynamic: true })
            run(w, 60)
            expect(ball.position[1]).toBeGreaterThan(490 * 0.97)
            expect(ball.position[1]).toBeLessThan(490 * 1.03)
            expect(ball.velocity[1]).toBeCloseTo(980, -1)
            w.dispose()
        }
    })

    it("weigh what their area at density says, in metres of pixelsPerMeter", async () => {
        const w = await createWorld2D()
        expect(w.box({ dynamic: true }).mass).toBeCloseTo(500, 2)
        expect(w.box({ dynamic: true, size: [50, 50] }).mass).toBeCloseTo(125, 2)
        expect(w.circle({ dynamic: true, radius: 100, density: 1 }).mass).toBeCloseTo(Math.PI, 3)
        const big = await createWorld2D({ pixelsPerMeter: 200 })
        expect(big.box({ dynamic: true, size: [100, 100] }).mass).toBeCloseTo(125, 2)
        w.dispose(); big.dispose()
    })

    it("turn clockwise on the stage for a positive rotation", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        const bar = w.box({ at: [0, 0], size: [200, 10], rotation: 90, layer: "bar" })
        expect(bar.rotation).toBeCloseTo(90, 4)
        // Turned 90 clockwise, the bar stands up: a ray across at y = 80 hits it, one at x = 80 misses.
        expect(w.raycast([-300, 80], [300, 80])).not.toBeNull()
        expect(w.raycast([80, -300], [80, 300])).toBeNull()
        w.dispose()
    })

    it("push is kilogram pixels a second; addVelocity ignores mass", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        const b = w.box({ dynamic: true, mass: 2 })
        b.push([200, 0])
        expect(b.velocity[0]).toBeCloseTo(100, 3)
        b.addVelocity([0, -50])
        expect(near(b.velocity, [100, -50], 1e-3)).toBe(true)
        w.dispose()
    })

    it("a convex polygon falls and lands; an outline is ground of any shape", async () => {
        const w = await createWorld2D()
        // A V-shaped valley, its bottom at (0, 600).
        w.outline({ points: [[-500, 100], [0, 600], [500, 100]], layer: "ground" })
        const tri = w.polygon({ at: [-200, 0], points: [[-30, 20], [30, 20], [0, -30]], dynamic: true })
        const ball = w.circle({ at: [300, 0], radius: 20, dynamic: true, friction: 0 })
        run(w, 600)
        expect(Math.abs(ball.position[0])).toBeLessThan(60)
        expect(ball.position[1]).toBeGreaterThan(500)
        expect(tri.position[1]).toBeGreaterThan(300)
        expect(() => w.polygon({ points: [[0, 0], [10, 0], [20, 0]] })).toThrow(/no area/)
        expect(() => w.outline({ points: [[0, 0], [10, 0]], dynamic: true } as any)).toThrow(/static or kinematic/)
        w.dispose()
    })

    it("pass through a layer they ignore", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        w.box({ at: [300, 0], size: [20, 400], layer: "glass" })
        const ghost = w.circle({ radius: 10, dynamic: true, ignores: ["glass"] })
        const ball = w.circle({ at: [0, 100], radius: 10, dynamic: true })
        ghost.velocity = [500, 0]; ball.velocity = [500, 0]
        run(w, 90)
        expect(ghost.position[0]).toBeGreaterThan(500)
        expect(ball.position[0]).toBeLessThan(300)
        w.dispose()
    })
})

describe("2D queries", () => {
    it("raycast, sweep, overlap and clearSpot answer in pixels", async () => {
        const w = await floored()
        const wall = w.box({ at: [500, 500], size: [100, 200], layer: "wall", tag: "east" })
        const hit = w.raycast([0, 500], [1000, 500])!
        expect(hit.body).toBe(wall)
        expect(hit.distance).toBeCloseTo(450, 2)
        expect(near(hit.point, [450, 500], 1e-3)).toBe(true)
        expect(near(hit.normal, [-1, 0], 1e-4)).toBe(true)
        expect(w.sweep(shape2D.circle({ radius: 25 }), [0, 500], [1000, 500], { only: ["wall"] })!.distance).toBeCloseTo(425, 1)
        expect(w.overlap(shape2D.circle({ radius: 60 }), [400, 500], { only: ["wall"] })).toEqual([wall])
        const spot = w.clearSpot(shape2D.box({ size: [40, 40] }), [500, 500], { only: ["wall"] })!
        expect(Math.abs(spot[0] - 500) >= 70 - 1e-6 || Math.abs(spot[1] - 500) >= 120 - 1e-6).toBe(true)
        expect(w.clearSpot(shape2D.box({ size: [40, 40] }), [500, 500], { only: ["wall"], within: 30 })).toBeNull()
        w.dispose()
    })

    it("canSee a body, which does not hide itself", async () => {
        const w = await floored()
        const target = w.box({ at: [600, 500], size: [60, 60], layer: "crate" })
        expect(w.canSee([0, 500], target)).toBe(true)
        w.box({ at: [300, 500], size: [20, 200], layer: "wall" })
        expect(w.canSee([0, 500], target)).toBe(false)
        w.dispose()
    })

    it("shapes outside any world: firstTouch and overlaps in pixels", async () => {
        await createWorld2D()
        const t = shape2D.circle({ radius: 6 }).firstTouch(shape2D.circle({ radius: 32 }), {
            at: [0, 0], velocity: [2000, 0], otherAt: [1100, 0], otherVelocity: [-200, 0], within: 1,
        })!
        expect(t).toBeCloseTo((1100 - 38) / 2200, 4)
        expect(shape2D.circle({ radius: 100 }).overlaps(shape2D.box({ size: [100, 100] }), { otherAt: [120, 0] })).toBe(true)
        expect(shape2D.circle({ radius: 100 }).overlaps(shape2D.box({ size: [100, 100] }), { otherAt: [160, 0] })).toBe(false)
    })
})

describe("a 2D character", () => {
    it("walks, stops at a wall, and jumps as high as asked, up the screen", async () => {
        const w = await floored()
        w.box({ at: [400, 400], size: [40, 400], layer: "wall" })
        const me = w.character({ at: [0, 600] })
        expect(me.grounded).toBe(true)
        me.walk([300, 0])
        run(w, 120)
        expect(me.position[0]).toBeLessThan(380 - 30 + 2)
        expect(me.position[0]).toBeGreaterThan(300)
        expect(me.position[1]).toBeCloseTo(600, 0)
        me.walk([0, 0])
        me.jump(120)
        let top = 600
        for (let i = 0; i < 120; i++) { w.step(); top = Math.min(top, me.position[1]) }
        expect(600 - top).toBeGreaterThan(120 * 0.95)
        expect(600 - top).toBeLessThan(120 * 1.05)
        expect(me.grounded).toBe(true)
        w.dispose()
    })

    it("climbs a step lower than stepHeight", async () => {
        const w = await floored()
        w.box({ at: [300, 590], size: [200, 20], layer: "step" })
        const me = w.character({ at: [0, 600] })
        me.walk([200, 0])
        run(w, 90)
        expect(me.position[0]).toBeGreaterThan(250)
        expect(me.position[1]).toBeCloseTo(580, 0)
        w.dispose()
    })

    it("slides a walker it does not keep", async () => {
        const w = await floored()
        w.step()
        let at: Vec2 = [0, 600]
        for (let i = 0; i < 60; i++) at = w.slide(at, [5, 0]).at
        expect(at[0]).toBeCloseTo(300, 0)
        expect(at[1]).toBeCloseTo(600, 0)
        w.dispose()
    })
})

describe("2D events, rewind and elements", () => {
    it("says how hard a landing was, in pixels a second", async () => {
        const w = await floored()
        // Dropped 500 px at 980 px/s²: lands at the square root of 2 g h, about 990 px/s.
        const crate = w.box({ at: [0, 50], size: [100, 100], dynamic: true })
        const speeds: number[] = []
        crate.onTouch((_, c) => speeds.push(c.speed))
        run(w, 120)
        expect(speeds.length).toBe(1)
        expect(speeds[0]).toBeGreaterThan(Math.sqrt(2 * 980 * 500) * 0.85)
        expect(speeds[0]).toBeLessThan(Math.sqrt(2 * 980 * 500) * 1.15)
        w.dispose()
    })

    it("restores a snapshot, and the same steps give the same numbers", async () => {
        const once = async () => {
            const w = await floored()
            const boxes = Array.from({ length: 20 }, (_, i) => w.box({ at: [(i % 5) * 110 - 220, 100 - Math.floor(i / 5) * 110], size: [100, 100], rotation: i, dynamic: true }))
            run(w, 60)
            const snap = w.snapshot()
            run(w, 60)
            const out = boxes.flatMap((b) => [...b.position, b.rotation])
            w.restore(snap)
            run(w, 60)
            const again = boxes.flatMap((b) => [...b.position, b.rotation])
            w.dispose()
            return { out, again }
        }
        const a = await once(), b = await once()
        expect(a.again).toEqual(a.out)
        expect(b.out).toEqual(a.out)
    })

    it("is queryable the moment it is restored, from a snapshot taken before a step", async () => {
        const w = await floored()
        const wall = w.box({ at: [300, 500], size: [40, 200] })
        const snap = w.snapshot()
        wall.destroy()
        run(w, 2)
        w.restore(snap)
        expect(w.raycast([0, 0], [0, 700])?.body).toBe(w.bodies[0])
        expect(w.raycast([0, 500], [600, 500])?.body).toBe(wall)
        w.dispose()
    })

    it("moves each body's element, or the element a ref holds, centre on centre", async () => {
        const placed: ElementPlacement[][] = []
        setElementPlacer((list) => placed.push(list.map((p) => ({ ...p }))))
        try {
            const w = await createWorld2D({ gravity: [0, 0] })
            const el = { name: "crate" }, ref = { current: null as object | null }
            const crate = w.box({ at: [100, 200], size: [40, 40], rotation: 30, actor: el })
            const held = w.circle({ at: [300, 50], radius: 10, actor: ref })
            const syncActors = () => (w as unknown as { syncActors(): void }).syncActors()
            syncActors()
            const last = placed.at(-1)!
            expect(last.length).toBe(1)
            expect(last[0]!.element).toBe(el)
            expect(near(last[0]!.at, [100, 200], 1e-3)).toBe(true)
            expect(last[0]!.degrees).toBeCloseTo(30, 4)
            ref.current = { name: "ball" }
            syncActors()
            expect(placed.at(-1)!.map((p) => p.element)).toEqual([el, ref.current])
            crate.destroy()
            expect((el as Body2D | object)).toEqual({ name: "crate" })
            void held
            w.dispose()
        } finally {
            setElementPlacer(null)
        }
    })
})

describe("2D visibility, seen from above", () => {
    const inside = (poly: readonly Vec2[], x: number, y: number) => {
        let ins = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i]!, b = poly[j]!
            if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins
        }
        return ins
    }

    it("is cut by a box, in pixels, and agrees with canSee", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        w.box({ at: [500, 300], size: [100, 400] })
        w.circle({ at: [200, 650], radius: 60 })
        const eye: Vec2 = [250, 300]
        const poly = w.visibility(eye, { within: 800 }).outline
        expect(inside(poly, 400, 300)).toBe(true)
        expect(inside(poly, 700, 300)).toBe(false)
        expect(inside(poly, 700, 900)).toBe(true)
        expect(Math.min(...poly.map((p) => Math.hypot(p[0] - 450, p[1] - 100)))).toBeLessThan(0.1)
        let wrong = 0
        for (let i = 0; i < 400; i++) {
            const x = 250 + Math.cos(i * 2.4) * (i * 1.9), y = 300 + Math.sin(i * 2.4) * (i * 1.9)
            const seen = w.canSee(eye, [x, y])
            const edge = Math.min(...poly.map((p, k) => {
                const q = poly[(k + 1) % poly.length]!
                const ex = q[0] - p[0], ey = q[1] - p[1], l = ex * ex + ey * ey
                const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((x - p[0]) * ex + (y - p[1]) * ey) / l))
                return Math.hypot(p[0] + ex * t - x, p[1] + ey * t - y)
            }))
            if (edge > 1 && inside(poly, x, y) !== seen) wrong++
        }
        expect(wrong).toBe(0)
    })

    it("says what each corner lies on, in pixels, and null at the edge of range", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        // A zigzag wall of 60 segments either side of the eye, which sight holds as several pieces each.
        const zigzag = (x: number) => w.outline({ points: Array.from({ length: 61 }, (_, k): Vec2 => [x + (k % 2) * 20, -400 + k * 25]) })
        const left = zigzag(-120), right = zigzag(700)
        const box = w.box({ at: [500, 300], size: [100, 400] })
        const ball = w.circle({ at: [200, 650], radius: 60 })
        const { outline, reaches } = w.visibility([250, 300], { within: 800 })
        expect(reaches.length).toBe(outline.length)
        const on = new Map<unknown, number>()
        for (let i = 0; i < outline.length; i++) {
            const [x, y] = outline[i]!, b = reaches[i]
            on.set(b, (on.get(b) ?? 0) + 1)
            if (b === box) expect(Math.abs(x - 450) < 0.1 || Math.abs(y - 100) < 0.1 || Math.abs(y - 500) < 0.1).toBe(true)
            else if (b === ball) expect(Math.abs(Math.hypot(x - 200, y - 650) - 60)).toBeLessThan(0.1)
            else if (b === left) expect(x >= -120.1 && x <= -99.9).toBe(true)
            else if (b === right) expect(x >= 699.9 && x <= 720.1).toBe(true)
            else { expect(b).toBe(null); expect(Math.hypot(x - 250, y - 300)).toBeCloseTo(800, 4) }
        }
        for (const b of [box, ball, left, right, null]) expect(on.get(b)).toBeGreaterThan(0)
    })
})

describe("2D visibility among every shape", () => {
    const inside = (poly: readonly Vec2[], x: number, y: number) => {
        let ins = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i]!, b = poly[j]!
            if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins
        }
        return ins
    }
    const edge = (poly: readonly Vec2[], x: number, y: number) => Math.min(...poly.map((p, k) => {
        const q = poly[(k + 1) % poly.length]!
        const ex = q[0] - p[0], ey = q[1] - p[1], l = ex * ex + ey * ey
        const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((x - p[0]) * ex + (y - p[1]) * ey) / l))
        return Math.hypot(p[0] + ex * t - x, p[1] + ey * t - y)
    }))

    it("agrees with canSee among a turned box, capsules, a polygon and open and closed outlines", async () => {
        const w = await createWorld2D({ gravity: [0, 0] })
        w.box({ at: [650, 250], size: [120, 60], rotation: 25 })
        w.capsule({ at: [300, 650], radius: 30, height: 200, rotation: 70 })
        w.capsule({ at: [150, 200], radius: 40, height: 80 })
        w.polygon({ at: [700, 700], points: [[0, -70], [60, 30], [-50, 50]] })
        w.outline({ at: [0, 0], points: [[900, 100], [950, 400], [880, 600]] })
        w.outline({ at: [0, 0], points: [[100, 500], [160, 460], [200, 540]], closed: true })
        const eye: Vec2 = [480, 420]
        const poly = w.visibility(eye, { within: 700 }).outline
        let checked = 0, wrong = 0
        let seed = 3
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let i = 0; i < 3000; i++) {
            const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 690
            const x = eye[0] + Math.cos(a) * r, y = eye[1] + Math.sin(a) * r
            if (edge(poly, x, y) < 1) continue
            checked++
            if (inside(poly, x, y) !== w.canSee(eye, [x, y])) wrong++
        }
        expect(checked).toBeGreaterThan(2800)
        expect(wrong).toBe(0)
    })
})

describe("what the second cold read found, in 2D", () => {
    it("puts a character's element on its middle, where the element's centre is", async () => {
        const placed: ElementPlacement[][] = []
        setElementPlacer((list) => placed.push(list.map((p) => ({ ...p }))))
        try {
            const w = await floored()
            w.character({ at: [100, 600], height: 160, actor: { name: "hero" } })
            ;(w as unknown as { syncActors(): void }).syncActors()
            expect(near(placed.at(-1)![0]!.at, [100, 520], 1.5)).toBe(true)
            w.dispose()
        } finally {
            setElementPlacer(null)
        }
    })

    it("skips a 2D character or body in a query", async () => {
        const w = await floored()
        const me = w.character({ at: [100, 600] })
        const crate = w.box({ at: [300, 520], size: [40, 40] })
        expect(w.raycast([0, 520], [400, 520])?.body).toBe(me)
        expect(w.raycast([0, 520], [400, 520], { skip: [me] })?.body).toBe(crate)
        expect(w.raycast([0, 520], [400, 520], { skip: [me, crate] })).toBeNull()
        w.dispose()
    })

    it("walks every way in a world with no gravity, and only across in one with it", async () => {
        const top = await createWorld2D({ gravity: [0, 0] })
        const a = top.character({ at: [100, 100] })
        a.walk([0, -300])
        run(top, 60)
        expect(a.position[1]).toBeLessThan(-150)
        top.dispose()
        const side = await floored()
        const b = side.character({ at: [100, 600] })
        b.walk([300, -300])
        run(side, 60)
        expect(b.position[1]).toBeCloseTo(600, 0)
        expect(b.position[0]).toBeGreaterThan(350)
        side.dispose()
    })
})
