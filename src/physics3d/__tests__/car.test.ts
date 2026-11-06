/**
 * world.car, driven from a script at 60 steps a second: the drive test of
 * PlaySite/docs/physics.md §9 as assertions, each against what a small road
 * car does, plus the car's place in the family (rewind, destroy, wheels).
 */
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { createWorld, type World, type Car, type CarOptions } from "../world"
import { fromQuat, toQuat } from "../rotation"
import { setActorPlacer, type ActorPlacement } from "../actors"
import type { Actor, Rotation, Vec3 } from "../../models"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

const KMH = 3.6
const run = (w: World, steps: number) => { for (let i = 0; i < steps; i++) w.step() }
const until = (w: World, done: () => boolean, most = 3600) => { let n = 0; while (!done() && n < most) { w.step(); n++ } return n / 60 }

/** A car settled on its springs on a big flat floor, facing +z. */
async function track(o: CarOptions = {}, extra?: (w: World) => void): Promise<{ w: World, car: Car }> {
    const w = await createWorld()
    w.box({ at: [0, -0.5, 0], size: [2000, 1, 2000], friction: 0.9 })
    extra?.(w)
    const car = w.car({ at: [0, 0.8, 0], ...o })
    run(w, 60)
    return { w, car }
}

describe("world.car drives like a small road car", () => {
    it("reaches 95% of top speed in about the seconds asked, and no faster than top speed", async () => {
        const { w, car } = await track()
        car.drive(1, 0)
        const t = until(w, () => car.speed >= 0.95 * 30)
        expect(t).toBeGreaterThan(7)
        expect(t).toBeLessThan(9)
        run(w, 600)
        expect(car.speed).toBeGreaterThan(29)
        expect(car.speed).toBeLessThan(30.5)
        w.dispose()
    })

    it("brakes from top speed in about 40 m", async () => {
        const { w, car } = await track()
        car.drive(1, 0)
        until(w, () => car.speed >= 29)
        const z = car.body.position[2]
        car.drive(0, 0, 1)
        until(w, () => car.speed < 0.05)
        const metres = car.body.position[2] - z
        expect(metres).toBeGreaterThan(32)
        expect(metres).toBeLessThan(50)
        w.dispose()
    })

    it("steers right with steer 1: facing +z, it turns toward +x", async () => {
        const { w, car } = await track()
        car.drive(0.5, 1)
        run(w, 120)
        expect(car.body.position[0]).toBeGreaterThan(0.5)
        expect(car.body.rotation.yaw).toBeGreaterThan(10)
        w.dispose()
    })

    it("corners at full lock with about 0.8 g at 60 km/h, upright on four wheels", async () => {
        const { w, car } = await track()
        car.drive(1, 0)
        until(w, () => car.speed * KMH >= 60)
        let rate = 0, speed = 0, fewest = 4
        for (let i = 0; i < 600; i++) {
            car.drive(car.speed * KMH < 60 ? 0.6 : 0.2, 1)
            const before = car.body.rotation.yaw
            w.step()
            fewest = Math.min(fewest, car.wheels.filter((x) => x.grounded).length)
            if (i >= 300) {
                let d = car.body.rotation.yaw - before
                if (d > 180) d -= 360
                if (d < -180) d += 360
                rate += (d * Math.PI) / 180 * 60
                speed += car.speed
            }
        }
        const g = (Math.abs(rate / 300) * (speed / 300)) / 9.81
        expect(g).toBeGreaterThan(0.65)
        expect(g).toBeLessThan(1.0)
        expect(fewest).toBe(4)
        expect(Math.abs(car.body.rotation.roll)).toBeLessThan(5)
        w.dispose()
    })

    it("stays upright through a J-turn at 95 km/h", async () => {
        const { w, car } = await track()
        car.drive(1, 0)
        until(w, () => car.speed * KMH >= 95)
        let worst = 0
        for (let i = 0; i < 180; i++) {
            car.drive(0, 1)
            w.step()
            worst = Math.max(worst, Math.abs(car.body.rotation.roll))
        }
        expect(worst).toBeLessThan(10)
        w.dispose()
    })

    it("lets go at 50 km/h and rolls to a stop", async () => {
        const { w, car } = await track()
        car.drive(1, 0)
        until(w, () => car.speed * KMH >= 50)
        car.drive(0, 0)
        const t = until(w, () => car.speed < 0.05, 60 * 40)
        expect(t).toBeGreaterThan(8)
        expect(t).toBeLessThan(25)
        w.dispose()
    })

    it("brakes when back is pressed while rolling forward, then reverses at up to a third of top speed", async () => {
        const { w, car } = await track()
        car.drive(1, 0)
        until(w, () => car.speed * KMH >= 50)
        car.drive(-1, 0)
        // As hard as the brake: 14 m/s gone in well under 2.5 s, where reversing the engine would take six.
        expect(until(w, () => car.speed < 0.5)).toBeLessThan(2.5)
        until(w, () => car.speed < 0)
        run(w, 600)
        expect(car.speed * KMH).toBeLessThan(-25)
        expect(car.speed * KMH).toBeGreaterThan(-33)
        w.dispose()
    })

    it("stays put on a 15 degree slope with the brake on, even kept awake, and rolls down it without", async () => {
        for (const brake of [1, 0]) {
            const { w, car } = await track({ at: [0, 5.5, 34] }, (w) => w.box({ at: [0, -1, 30], size: [10, 1, 40], rotation: { pitch: -15 } }))
            // Something nearby keeps a chassis from sleeping, which on its own would hold it.
            const rb = (w as any).raw.getRigidBody((car.body as any).bodyHandle)
            const awake = () => { for (let i = 0; i < 300; i++) { rb.wakeUp(); w.step() } }
            car.drive(0, 0, brake)
            const start = car.body.position[2]
            awake()
            const z = car.body.position[2]
            awake()
            if (brake) expect(Math.abs(car.body.position[2] - z)).toBeLessThan(0.005)
            else expect(z - start).toBeLessThan(-5)
            w.dispose()
        }
    })

    it("stays where it is pushed with the brake on, rather than being pulled back", async () => {
        const { w, car } = await track()
        car.drive(0, 0, 1)
        run(w, 60)
        const z = car.body.position[2]
        // A wall of a thing glides into its back slower than a crawl, leans on it for a while, and backs off.
        const pusher = w.box({ kinematic: true, at: [0, 0.8, z - 2.6], size: [3, 1, 1] })
        pusher.velocity = [0, 0, 0.3]
        run(w, 300)
        pusher.velocity = [0, 0, -1]
        run(w, 60)
        pusher.velocity = [0, 0, 0]
        const pushed = car.body.position[2] - z
        expect(pushed).toBeGreaterThan(0.5)
        run(w, 120)
        expect(car.body.position[2] - z).toBeGreaterThan(pushed - 0.025)
        w.dispose()
    })

    it("leaves a sleeping chassis alone, so it pulls away forward and not up", async () => {
        const { w, car } = await track()
        run(w, 600)
        expect(car.speed).toBe(0)
        // Asleep with nothing stored in its velocity, which would kick it on waking.
        expect(Math.hypot(...car.body.velocity)).toBeLessThan(1e-6)
        const y = car.body.position[1]
        car.drive(1, 0)
        run(w, 30)
        expect(car.speed).toBeGreaterThan(1)
        expect(Math.abs(car.body.position[1] - y)).toBeLessThan(0.05)
        w.dispose()
    })
})

describe("world.car in the family", () => {
    it("drives the same after a rewind, mid-corner", async () => {
        const { w, car } = await track()
        car.drive(1, 0.5)
        run(w, 90)
        const saved = w.snapshot()
        run(w, 60)
        const there = car.body.position, wheel = car.wheels[0]!.rotation
        car.drive(0, -1)
        run(w, 30)
        w.restore(saved)
        run(w, 60)
        expect(car.body.position).toEqual(there)
        // A wheel's roll is carried across the rewind as a sum, so it agrees to a hundredth of a degree, not to the bit.
        for (const k of ["yaw", "pitch", "roll"] as const) expect(Math.abs(car.wheels[0]!.rotation[k] - wheel[k])).toBeLessThan(0.01)
        w.dispose()
    })

    it("is gone once destroyed, comes back with a rewind to before, and is gone after one to before it was made", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [200, 1, 200] })
        const before = w.snapshot()
        const car = w.car({ at: [0, 0.8, 0] })
        run(w, 30)
        const made = w.snapshot()
        car.destroy()
        expect(car.alive).toBe(false)
        expect(() => car.drive(1, 0)).toThrow(/destroyed/)
        w.restore(made)
        expect(car.alive).toBe(true)
        car.drive(1, 0)
        run(w, 60)
        expect(car.speed).toBeGreaterThan(1)
        w.restore(before)
        expect(car.alive).toBe(false)
        run(w, 10)
        w.dispose()
    })

    it("puts each wheel at its corner, under the chassis where it is after the step, turned with the steering", async () => {
        const { w, car } = await track()
        car.drive(1, 0)
        until(w, () => car.speed >= 20)
        car.drive(0.5, 1)
        run(w, 10)
        const p = car.body.position, [fl, fr, rl, rr] = car.wheels
        // A wheel from the step before would trail the chassis by a third of a metre at this speed.
        const middle = [(fl!.position[0] + fr!.position[0] + rl!.position[0] + rr!.position[0]) / 4, (fl!.position[2] + fr!.position[2] + rl!.position[2] + rr!.position[2]) / 4]
        expect(Math.hypot(middle[0]! - p[0], middle[1]! - p[2])).toBeLessThan(0.05)
        for (const wheel of car.wheels) expect(wheel.position[1]).toBeLessThan(p[1])
        // The front wheels' axles are turned to the right of the chassis's; the rear ones' are not. An axle is what a wheel's roll leaves alone.
        const axle = (r: Readonly<Rotation>) => {
            const q = toQuat(r), x = 1 - 2 * (q.y * q.y + q.z * q.z), z = 2 * (q.x * q.z - q.w * q.y)
            return (Math.atan2(-z, x) * 180) / Math.PI
        }
        const turned = (r: Readonly<Rotation>) => ((axle(r) - axle(car.body.rotation) + 540) % 360) - 180
        expect(turned(fl!.rotation)).toBeGreaterThan(1)
        expect(Math.abs(turned(rl!.rotation))).toBeLessThan(0.5)
        w.dispose()
    })

    it("drives the wheels the options say: on the throttle at full lock, front-wheel drive runs wide and slows", async () => {
        const kmh: Record<string, number> = {}
        for (const d of ["front", "rear"] as const) {
            const { w, car } = await track({ drivenWheels: d })
            car.drive(1, 0)
            until(w, () => car.speed * KMH >= 60)
            car.drive(1, 1)
            run(w, 300)
            kmh[d] = car.speed * KMH
            w.dispose()
        }
        expect(kmh.front).toBeLessThan(50)
        expect(kmh.rear).toBeGreaterThan(80)
    })

    it("turns its front wheels at a hand's pace, to a lock that narrows with speed", async () => {
        const { w, car } = await track()
        const axle = (r: Readonly<Rotation>) => {
            const q = toQuat(r), x = 1 - 2 * (q.y * q.y + q.z * q.z), z = 2 * (q.x * q.z - q.w * q.y)
            return (Math.atan2(-z, x) * 180) / Math.PI
        }
        const turned = () => ((axle(car.wheels[0]!.rotation) - axle(car.body.rotation) + 540) % 360) - 180
        car.drive(0, 1)
        w.step()
        // A third of a second to full lock: one step is under 2 degrees of 32.
        expect(turned()).toBeLessThan(2.5)
        run(w, 30)
        expect(turned()).toBeGreaterThan(30)
        car.drive(1, 0)
        until(w, () => car.speed * KMH >= 90)
        car.drive(1, 1)
        run(w, 30)
        // At 90 km/h the lock is under a third of a crawl's.
        expect(turned()).toBeLessThan(11)
        expect(turned()).toBeGreaterThan(4)
        w.dispose()
    })
})

describe("world.car places the wheel models it is given", () => {
    /** Every placement of each of `actors`, in order, as frames hand them over. */
    function watch(actors: readonly object[]): { at: Vec3, rotation: Rotation }[][] {
        const seen = actors.map(() => [] as { at: Vec3, rotation: Rotation }[])
        setActorPlacer((list: readonly ActorPlacement[]) => {
            for (const p of list) {
                const i = actors.indexOf(p.actor)
                if (i >= 0) seen[i]!.push({ at: p.at, rotation: fromQuat(p.rotation!) })
            }
        })
        return seen
    }
    const restorePlacer = () => setActorPlacer((list) => { for (const p of list) p.actor.position = p.at })
    const near = (a: Readonly<Rotation>, b: Readonly<Rotation>) => {
        const qa = toQuat(a), qb = toQuat(b)
        return Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w)
    }

    it("puts each where car.wheels says, steered and rolled, with no chassis model of its own", async () => {
        const wheels = [{}, {}, {}, {}] as unknown as [Actor, Actor, Actor, Actor]
        const seen = watch(wheels)
        try {
            const w = await createWorld() as any
            w.box({ at: [0, -0.5, 0], size: [2000, 1, 2000], friction: 0.9 })
            const car = w.car({ at: [0, 0.8, 0], wheels }) as Car
            // Placed where it starts, before any step.
            for (const s of seen) expect(s.length).toBe(1)
            car.drive(1, 0.6)
            for (let i = 0; i < 120; i++) w.frame(1 / 60)
            expect(car.speed).toBeGreaterThan(3)
            car.wheels.forEach((x, i) => {
                const last = seen[i]!.at(-1)!
                expect(Math.hypot(...last.at.map((v, k) => v - x.position[k]!) as [number, number, number])).toBeLessThan(1e-9)
                expect(near(last.rotation, x.rotation)).toBeGreaterThan(1 - 1e-9)
            })
            // The front pair steer and the rear pair do not, as car.wheels has them.
            expect(near(seen[0]!.at(-1)!.rotation, seen[2]!.at(-1)!.rotation)).toBeLessThan(0.9999)
            w.dispose()
        } finally { restorePlacer() }
    })

    it("keeps each on the chassis as drawn between steps at 120 Hz, rolling on every frame", async () => {
        const body = {} as Actor
        const wheels = [{}, {}, {}, {}] as unknown as [Actor, Actor, Actor, Actor]
        const seen = watch([body, ...wheels])
        try {
            const w = await createWorld() as any
            w.box({ at: [0, -0.5, 0], size: [2000, 1, 2000], friction: 0.9 })
            const car = w.car({ at: [0, 0.8, 0], actor: body, wheels }) as Car
            for (const s of seen) s.length = 0
            car.drive(1)
            for (let i = 0; i < 360; i++) w.frame(1 / 120)
            expect(car.speed).toBeGreaterThan(8)
            // Each frame of the last second: the chassis was drawn, and each wheel
            // with it, at the same place on the chassis as car.wheels has after the step.
            const frames = seen[0]!.length
            for (const s of seen) expect(s.length).toBe(frames)
            const offset = (wheel: Vec3, at: Vec3, r: Rotation) => {
                const q = toQuat(r), d: Vec3 = [wheel[0] - at[0], wheel[1] - at[1], wheel[2] - at[2]]
                // Into the chassis's frame: the inverse rotation.
                const x = -q.x, y = -q.y, z = -q.z, ww = q.w
                const tx = 2 * (y * d[2] - z * d[1]), ty = 2 * (z * d[0] - x * d[2]), tz = 2 * (x * d[1] - y * d[0])
                return [d[0] + ww * tx + (y * tz - z * ty), d[1] + ww * ty + (z * tx - x * tz), d[2] + ww * tz + (x * ty - y * tx)]
            }
            const truth = car.wheels.map((x) => offset(x.position, car.body.position, car.body.rotation))
            for (let f = frames - 120; f < frames; f++) {
                const c = seen[0]![f]!
                for (let i = 0; i < 4; i++) {
                    const o = offset(seen[i + 1]![f]!.at, c.at, c.rotation)
                    // The springs settle as it accelerates: within a millimetre of where the last step had them.
                    expect(Math.hypot(o[0]! - truth[i]![0]!, o[1]! - truth[i]![1]!, o[2]! - truth[i]![2]!)).toBeLessThan(1e-3)
                }
                // Rolling: the wheel turned since the frame before, steps or no step.
                expect(near(seen[3]![f]!.rotation, seen[3]![f - 1]!.rotation)).toBeLessThan(1 - 1e-6)
            }
            w.dispose()
        } finally { restorePlacer() }
    })

    it("lets them go with the car, destroyed or rewound away, as its chassis model goes, and refuses anything but four", async () => {
        const gone: object[] = []
        const wheel = () => ({ destroy() { gone.push(this) } })
        const wheels = [wheel(), wheel(), wheel(), wheel()] as unknown as [Actor, Actor, Actor, Actor]
        const seen = watch(wheels)
        try {
            const w = await createWorld() as any
            w.box({ at: [0, -0.5, 0], size: [200, 1, 200] })
            const car = w.car({ at: [0, 0.8, 0], wheels }) as Car
            expect(() => w.car({ wheels: wheels.slice(0, 2) })).toThrow(/four models/)
            for (let i = 0; i < 10; i++) w.frame(1 / 60)
            const snap = w.snapshot()
            car.destroy()
            expect(gone).toEqual(wheels)
            const before = seen[0]!.length
            for (let i = 0; i < 10; i++) w.frame(1 / 60)
            // Brought back by a rewind, it drives, without the models that went with it.
            w.restore(snap)
            expect(car.alive).toBe(true)
            car.drive(1)
            for (let i = 0; i < 30; i++) w.frame(1 / 60)
            expect(car.speed).toBeGreaterThan(0.5)
            expect(seen[0]!.length).toBe(before)
            // Rewound out of existence: a car made after the snapshot.
            gone.length = 0
            const later = [wheel(), wheel(), wheel(), wheel()] as unknown as [Actor, Actor, Actor, Actor]
            w.car({ at: [5, 0.8, 0], wheels: later })
            w.restore(snap)
            expect(gone).toEqual(later)
            w.dispose()
        } finally { restorePlacer() }
    })
})
