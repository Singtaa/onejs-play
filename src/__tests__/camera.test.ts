/**
 * useOrbit and useFollowCamera (runtime-1.3.md section 8), through their step
 * functions and controllers, with input handed in as plain objects and the
 * 3D world a real one, since Rapier runs in Node.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeAll, vi } from "vitest"
import {
    FollowController, OrbitController, followStep, newDragFrame, newDragTracker, newFollowState, orbitEye, orbitStep,
    readDrag, subscribeCamera, wrapDegrees, ORBIT_LIMITS, FOLLOW_LIMITS,
    type CameraFrame, type DragSource, type DragTouch, type FollowStepOptions,
} from "../camera"
import { createRuntime } from "../runtime"
import { WORLD_CLASS } from "../over-ui"
import { toQuat } from "../physics3d/rotation"
import { setWasmModule } from "../wasm"
import { RAPIER_VERSION } from "../physics3d/rapier.version"
import { createWorld } from "../physics3d/world"
import type { Vec3 } from "../models"

const WA = (globalThis as any).WebAssembly
beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

/** A mouse and touches as input reports them, idle unless told otherwise. */
function source(mouse: Partial<DragSource["mouse"]> = {}, touches: DragTouch[] = []): DragSource {
    return {
        touches,
        mouse: {
            position: { x: 100, y: 100 }, delta: { x: 0, y: 0 },
            leftButton: false, rightButton: false, wasLeftPressed: false, wasRightPressed: false, overUI: false,
            ...mouse,
        },
    }
}
const touch = (fingerId: number, x: number, y: number, phase: DragTouch["phase"] = "moved", delta = { x: 0, y: 0 }, overUI = false): DragTouch =>
    ({ fingerId, position: { x, y }, delta, phase, overUI })
const everywhere = () => true
const nobody = () => false
const frameOf = (src: DragSource, claimed: (f: number) => boolean = nobody): CameraFrame => ({ source: src, claimed })

/** Unity's `rotation * v` for a quaternion. */
function rotate(q: { x: number, y: number, z: number, w: number }, v: Vec3): Vec3 {
    const { x, y, z, w } = q
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2]
    const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
}

describe("where the eye is", () => {
    it("is Unity's Quaternion.Euler(pitch, yaw, 0) turning the camera's back, at the distance", () => {
        for (const [yaw, pitch] of [[0, 0], [90, 0], [-135, 30], [40, -60], [179, 80]]) {
            const back = rotate(toQuat({ yaw, pitch }), [0, 0, -1])
            const eye = orbitEye([1, 2, 3], { yaw, pitch, distance: 4 })
            for (let i = 0; i < 3; i++) expect(eye[i], `${yaw}, ${pitch}`).toBeCloseTo([1, 2, 3][i]! + back[i]! * 4, 9)
        }
    })

    it("looks along +z at yaw 0 and along +x at yaw 90, from above at a positive pitch", () => {
        const at0 = orbitEye([0, 0, 0], { yaw: 0, pitch: 0, distance: 5 })
        expect(at0.map((n) => Math.round(n * 1e9) / 1e9)).toEqual([0, 0, -5])
        const at90 = orbitEye([0, 0, 0], { yaw: 90, pitch: 0, distance: 5 })
        expect(at90[0]).toBeCloseTo(-5, 9)
        expect(orbitEye([0, 0, 0], { yaw: 0, pitch: 30, distance: 5 })[1]).toBeCloseTo(2.5, 9)
    })

    it("wraps degrees into (-180, 180]", () => {
        expect([wrapDegrees(190), wrapDegrees(-180), wrapDegrees(540), wrapDegrees(-190), wrapDegrees(0)]).toEqual([-170, 180, 180, 170, 0])
    })
})

describe("an orbit's step", () => {
    const view = () => ({ yaw: 0, pitch: 0, distance: 6 })
    const still = { dx: 0, dy: 0, zoom: 1 }

    // OrbitControls' way: the camera goes left round the target, so what faces it turns right with the pointer.
    it("turns a drag right into the camera going left round the target", () => {
        const v = view()
        expect(orbitStep(v, { ...still, dx: 10 }, ORBIT_LIMITS, 1)).toBe(true)
        expect(v.yaw).toBe(10)
        expect(orbitEye([0, 0, 0], v)[0]).toBeLessThan(0)
    })

    it("raises the camera for a drag down, and holds the pitch inside its range", () => {
        const v = view()
        orbitStep(v, { ...still, dy: 30 }, ORBIT_LIMITS, 1)
        expect(v.pitch).toBe(30)
        orbitStep(v, { ...still, dy: 500 }, ORBIT_LIMITS, 1)
        expect(v.pitch).toBe(80)
        orbitStep(v, { ...still, dy: -500 }, { ...ORBIT_LIMITS, pitchRange: [-10, 45] }, 1)
        expect(v.pitch).toBe(-10)
    })

    it("zooms within the distance range, and says nothing moved when nothing did", () => {
        const v = view()
        orbitStep(v, { ...still, zoom: 0.5 }, ORBIT_LIMITS, 1)
        expect(v.distance).toBe(3)
        orbitStep(v, { ...still, zoom: 1000 }, ORBIT_LIMITS, 1)
        expect(v.distance).toBe(100)
        expect(orbitStep(v, still, ORBIT_LIMITS, 1)).toBe(false)
    })
})

describe("a drag", () => {
    it("starts on a mouse press inside the View, and moves from the next frame", () => {
        const t = newDragTracker(), out = newDragFrame()
        readDrag(t, source({ wasLeftPressed: true, leftButton: true, delta: { x: 40, y: 0 } }), everywhere, nobody, out)
        expect([out.active, out.left, out.dx]).toEqual([true, true, 0])
        readDrag(t, source({ leftButton: true, delta: { x: 7, y: -3 } }), everywhere, nobody, out)
        expect([out.dx, out.dy]).toEqual([7, -3])
        readDrag(t, source(), everywhere, nobody, out)
        expect(out.active).toBe(false)
    })

    it("does not start on UI that answers presses, or outside the View, and goes on past its edge", () => {
        const t = newDragTracker(), out = newDragFrame()
        readDrag(t, source({ wasLeftPressed: true, leftButton: true, overUI: true }), everywhere, nobody, out)
        expect(out.active).toBe(false)
        readDrag(newDragTracker(), source({ wasLeftPressed: true, leftButton: true }), () => false, nobody, out)
        expect(out.active).toBe(false)
        const inView = newDragTracker()
        let inside = true
        readDrag(inView, source({ wasLeftPressed: true, leftButton: true }), () => inside, nobody, out)
        inside = false
        readDrag(inView, source({ leftButton: true, delta: { x: 5, y: 0 } }), () => inside, nobody, out)
        expect([out.active, out.dx]).toEqual([true, 5])
    })

    it("holds both buttons as left and right", () => {
        const t = newDragTracker(), out = newDragFrame()
        readDrag(t, source({ wasRightPressed: true, rightButton: true }), everywhere, nobody, out)
        expect([out.left, out.right]).toEqual([false, true])
        readDrag(t, source({ leftButton: true, rightButton: true, wasLeftPressed: true }), everywhere, nobody, out)
        expect([out.left, out.right]).toEqual([true, true])
    })

    // The container reports a touch as the mouse too.
    it("starts nothing from the mouse while a finger is down, and leaves a stick's finger alone", () => {
        const t = newDragTracker(), out = newDragFrame()
        const stick = (f: number) => f === 3
        readDrag(t, source({ wasLeftPressed: true, leftButton: true }, [touch(3, 100, 100, "began")]), everywhere, stick, out)
        expect(out.active).toBe(false)
        readDrag(t, source({ leftButton: true, delta: { x: 9, y: 0 } }, [touch(3, 109, 100, "moved", { x: 9, y: 0 })]), everywhere, stick, out)
        expect(out.active).toBe(false)
    })

    it("leaves a finger that landed on UI alone", () => {
        const t = newDragTracker(), out = newDragFrame()
        readDrag(t, source({}, [touch(1, 10, 10, "began", { x: 0, y: 0 }, true)]), everywhere, nobody, out)
        expect(out.active).toBe(false)
    })

    it("turns with one finger and pinches with two", () => {
        const t = newDragTracker(), out = newDragFrame()
        readDrag(t, source({}, [touch(1, 100, 100, "began")]), everywhere, nobody, out)
        readDrag(t, source({}, [touch(1, 110, 100, "moved", { x: 10, y: 0 })]), everywhere, nobody, out)
        expect([out.active, out.left, out.dx]).toEqual([true, true, 10])
        readDrag(t, source({}, [touch(1, 110, 100), touch(2, 210, 100, "began")]), everywhere, nobody, out)
        expect([out.dx, out.zoom]).toEqual([0, 1])
        // Spread from 100 apart to 200: half the distance.
        readDrag(t, source({}, [touch(1, 60, 100, "moved", { x: -50, y: 0 }), touch(2, 260, 100, "moved", { x: 50, y: 0 })]), everywhere, nobody, out)
        expect(out.zoom).toBeCloseTo(0.5, 9)
        expect(out.dx).toBe(0)
        readDrag(t, source({}, [touch(1, 60, 100, "ended"), touch(2, 260, 100, "ended")]), everywhere, nobody, out)
        expect(out.active).toBe(false)
    })
})

describe("useOrbit's frame", () => {
    function scene() {
        const calls: Array<{ position: Vec3, lookAt: Vec3 }> = []
        return { calls, camera: (o: any) => { calls.push(o) } }
    }

    it("puts the camera once, then makes no call while nothing moves, and one a frame while dragged", () => {
        const s = scene()
        const c = new OrbitController({ distance: 6 })
        const o = { camera: s, degreesPerPixel: 1 }
        c.frame(1 / 60, o, frameOf(source()))
        expect(s.calls).toHaveLength(1)
        expect(s.calls[0]!.position.map((n) => Math.round(n * 1e6) / 1e6)).toEqual(orbitEye([0, 0, 0], { yaw: 0, pitch: 20, distance: 6 }).map((n) => Math.round(n * 1e6) / 1e6))
        for (let i = 0; i < 30; i++) expect(c.frame(1 / 60, o, frameOf(source()))).toBe(false)
        expect(s.calls).toHaveLength(1)
        c.frame(1 / 60, o, frameOf(source({ wasLeftPressed: true, leftButton: true })))
        for (let i = 0; i < 3; i++) expect(c.frame(1 / 60, o, frameOf(source({ leftButton: true, delta: { x: 4, y: 0 } })))).toBe(true)
        expect(s.calls).toHaveLength(4)
        expect(c.orbit.yaw).toBe(12)
    })

    it("spins by itself until the first drag, and never again after", () => {
        const c = new OrbitController({ idleSpin: 30 })
        for (let i = 0; i < 60; i++) c.frame(1 / 60, { idleSpin: 30 }, frameOf(source()))
        expect(c.orbit.yaw).toBeCloseTo(30, 6)
        c.frame(1 / 60, { idleSpin: 30 }, frameOf(source({ wasLeftPressed: true, leftButton: true })))
        c.frame(1 / 60, { idleSpin: 30 }, frameOf(source()))
        const after = c.orbit.yaw
        for (let i = 0; i < 60; i++) expect(c.frame(1 / 60, { idleSpin: 30 }, frameOf(source()))).toBe(false)
        expect(c.orbit.yaw).toBe(after)
    })

    it("writes a scene that arrives after mount, and tells onMove", () => {
        const c = new OrbitController()
        const onMove = vi.fn()
        c.frame(1 / 60, { camera: null, onMove }, frameOf(source()))
        expect(onMove).not.toHaveBeenCalled()
        const s = scene()
        c.frame(1 / 60, { camera: s, onMove }, frameOf(source()))
        expect(s.calls).toHaveLength(1)
        expect(onMove).toHaveBeenCalledTimes(1)
    })

    it("follows a target that moves, and zooms on the bound View's wheel, three steps at most", () => {
        const c = new OrbitController({ distance: 10 })
        expect(c.orbit.bind.className).toBe(WORLD_CLASS)
        expect(c.frame(1 / 60, { target: [0, 1, 0] }, frameOf(source()))).toBe(true)
        expect(c.orbit.target).toEqual([0, 1, 0])
        c.orbit.bind.onWheel({ deltaY: 1 })
        c.frame(1 / 60, { target: [0, 1, 0] }, frameOf(source()))
        expect(c.orbit.distance).toBeCloseTo(11, 9)
        c.orbit.bind.onWheel({ deltaY: -120 })
        c.frame(1 / 60, { target: [0, 1, 0] }, frameOf(source()))
        expect(c.orbit.distance).toBeCloseTo(11 / 1.1 ** 3, 9)
    })

    it("starts a drag only inside the bound View's rect", () => {
        const c = new OrbitController()
        c.orbit.bind.ref.current = { worldBound: { x: 0, y: 0, width: 50, height: 50 } } as any
        c.frame(1 / 60, {}, frameOf(source({ wasLeftPressed: true, leftButton: true, position: { x: 100, y: 100 } })))
        c.frame(1 / 60, {}, frameOf(source({ leftButton: true, delta: { x: 20, y: 0 } })))
        expect(c.orbit.yaw).toBe(0)
    })
})

describe("a follow camera's step", () => {
    const step = (over: Partial<FollowStepOptions> = {}): FollowStepOptions =>
        ({ limits: FOLLOW_LIMITS, degreesPerPixel: 1, height: 1, behind: false, turnWith: false, world: null, ...over })
    const held = (left: boolean, right: boolean, dx = 0) => ({ ...newDragFrame(), left, right, active: left || right, dx })

    it("turns the heading with a right drag, looks around with a left one, and walks with both", () => {
        const s = newFollowState({ yaw: 0, pitch: 15, distance: 5 })
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        followStep(s, held(false, true, 20), me, 1 / 60, step())
        expect([s.yaw, s.heading, s.forward]).toEqual([20, 20, false])
        followStep(s, held(true, false, 15), me, 1 / 60, step())
        expect([s.yaw, s.heading, s.forward]).toEqual([35, 20, false])
        followStep(s, held(true, true), me, 1 / 60, step())
        expect([s.heading, s.forward]).toEqual([35, true])
    })

    it("with behind, comes round behind a target that turned, and not while a drag is held", () => {
        const s = newFollowState({ yaw: 0, pitch: 15, distance: 5 })
        const car = { position: [0, 0, 0] as Vec3, yaw: 90 }
        for (let i = 0; i < 60; i++) followStep(s, held(true, false), car, 1 / 60, step({ behind: true }))
        expect(s.yaw).toBe(0)
        // Most of the way in a second, within half a degree in two.
        for (let i = 0; i < 60; i++) followStep(s, newDragFrame(), car, 1 / 60, step({ behind: true }))
        expect(s.yaw).toBeGreaterThan(80)
        for (let i = 0; i < 60; i++) followStep(s, newDragFrame(), car, 1 / 60, step({ behind: true }))
        expect(Math.abs(s.yaw - 90)).toBeLessThan(0.5)
        // The short way round: from 170 to -170 is 20 degrees through 180, not 340 back through 0.
        car.yaw = -170
        const t = newFollowState({ yaw: 170, pitch: 15, distance: 5 })
        followStep(t, newDragFrame(), car, 1 / 60, step({ behind: true }))
        const moved = wrapDegrees(t.yaw - 170)
        expect(moved).toBeGreaterThan(0)
        expect(moved).toBeLessThan(20)
    })

    it("eases the pivot up a step, and takes a teleport at once", () => {
        const s = newFollowState({ yaw: 0, pitch: 0, distance: 5 })
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        followStep(s, newDragFrame(), me, 1 / 60, step())
        me.position = [0, 0.3, 0]
        followStep(s, newDragFrame(), me, 1 / 60, step())
        expect(s.pivot[1]).toBeGreaterThan(1)
        expect(s.pivot[1]).toBeLessThan(1.3)
        for (let i = 0; i < 30; i++) followStep(s, newDragFrame(), me, 1 / 60, step())
        expect(s.pivot[1]).toBeCloseTo(1.3, 3)
        me.position = [40, 9, 0]
        followStep(s, newDragFrame(), me, 1 / 60, step())
        expect(s.pivot).toEqual([40, 10, 0])
    })

    // follow-camera.md: A and D turn a WoW character and its camera together.
    it("with turnWith, turns by exactly what the target turned, and not while a drag is held", () => {
        const s = newFollowState({ yaw: 0, pitch: 15, distance: 5 })
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        followStep(s, newDragFrame(), me, 1 / 60, step({ turnWith: true }))
        me.yaw = 90
        followStep(s, newDragFrame(), me, 1 / 60, step({ turnWith: true }))
        expect(s.yaw).toBe(90)
        // Holding a left drag and turning leaves the camera where the hand holds it.
        me.yaw = 180
        followStep(s, held(true, false), me, 1 / 60, step({ turnWith: true }))
        expect(s.yaw).toBe(90)
        // Let go, the turn already made stays made: the camera does not catch up on it.
        followStep(s, newDragFrame(), me, 1 / 60, step({ turnWith: true }))
        expect(s.yaw).toBe(90)
        // Through 180 the short way.
        me.yaw = -170
        followStep(s, newDragFrame(), me, 1 / 60, step({ turnWith: true }))
        expect(s.yaw).toBeCloseTo(100, 9)
    })

    // Lesson 1's case: D held 2 s at 180 degrees a second trailed 64 behind.
    it("with turnWith, ends a steady 180 degree a second turn within half a degree of behind, where behind alone trails 63", () => {
        const trail = (over: Partial<FollowStepOptions>) => {
            const s = newFollowState({ yaw: 0, pitch: 15, distance: 5 })
            const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
            for (let i = 0; i <= 120; i++) {
                me.yaw = wrapDegrees(180 * i / 60)
                followStep(s, newDragFrame(), me, 1 / 60, step(over))
            }
            return Math.abs(wrapDegrees(me.yaw - s.yaw))
        }
        expect(trail({ turnWith: true })).toBeLessThan(0.5)
        expect(trail({ turnWith: true, behind: "moving" })).toBeLessThan(0.5)
        const alone = trail({ behind: true })
        expect(alone).toBeGreaterThan(60)
        expect(alone).toBeLessThan(65)
    })

    it("with behind \"moving\", stays where a look round left it while the target stands, and settles as behind does once it walks", () => {
        const s = newFollowState({ yaw: 40, pitch: 15, distance: 5 })
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        for (let i = 0; i < 120; i++) followStep(s, newDragFrame(), me, 1 / 60, step({ behind: "moving" }))
        expect(s.yaw).toBe(40)
        // Walking, frame for frame what behind: true does.
        const always = newFollowState({ yaw: 40, pitch: 15, distance: 5 })
        const twin = { position: [0, 0, 0] as Vec3, yaw: 0 }
        followStep(always, newDragFrame(), twin, 1 / 60, step({ behind: true }))
        always.yaw = 40
        for (let i = 1; i <= 120; i++) {
            me.position = [0, 0, 3 * i / 60]
            twin.position = me.position
            followStep(s, newDragFrame(), me, 1 / 60, step({ behind: "moving" }))
            followStep(always, newDragFrame(), twin, 1 / 60, step({ behind: true }))
            expect(s.yaw, `frame ${i}`).toBe(always.yaw)
        }
        expect(Math.abs(s.yaw)).toBeLessThan(0.5)
        // Falling or jumping in place is not walking.
        const t = newFollowState({ yaw: 40, pitch: 15, distance: 5 })
        const jumper = { position: [0, 0, 0] as Vec3, yaw: 0 }
        for (let i = 0; i < 60; i++) {
            jumper.position = [0, Math.sin(i / 10), 0]
            followStep(t, newDragFrame(), jumper, 1 / 60, step({ behind: "moving" }))
        }
        expect(t.yaw).toBe(40)
    })
})

// follow-camera.md: a fixed rate a stage pixel, so the same hand movement turns the same way in any window.
describe("how far a drag turns", () => {
    function dragged(stageHeight: number, make: () => { frame: (f: CameraFrame) => void, yaw: () => number }) {
        const runtime = createRuntime({ root: {}, version: "1.0.0", viewport: { width: stageHeight * 16 / 9, height: stageHeight } })
        const cam = make()
        let src = source()
        const stop = subscribeCamera("test", (_dt, f) => cam.frame({ ...f, source: src }))
        src = source({ wasLeftPressed: true, leftButton: true })
        runtime.beginFrame(1 / 60)
        for (let i = 0; i < 10; i++) {
            src = source({ leftButton: true, delta: { x: 20, y: 0 } })
            runtime.beginFrame(1 / 60)
        }
        stop!()
        runtime.dispose()
        return cam.yaw()
    }
    const follow = () => {
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        const c = new FollowController(me)
        return { frame: (f: CameraFrame) => c.frame(1 / 60, me, {}, f), yaw: () => c.camera.yaw }
    }
    const orbit = (o = {}) => {
        const c = new OrbitController(o)
        return { frame: (f: CameraFrame) => { c.frame(1 / 60, o, f) }, yaw: () => c.orbit.yaw }
    }

    it("turns 60 degrees for a 200 pixel drag at 0.3 a pixel, in the site's 538 pixel stage and full screen", () => {
        for (const height of [538, 1290]) {
            expect(dragged(height, follow), `follow, ${height}`).toBeCloseTo(60, 9)
            expect(dragged(height, () => orbit()), `orbit, ${height}`).toBeCloseTo(60, 9)
        }
    })

    it("turns at the rate it is given", () => {
        expect(dragged(538, () => orbit({ degreesPerPixel: 0.34 }))).toBeCloseTo(68, 9)
    })
})

describe("fields a cart writes", () => {
    it("takes a written distance in the same frame, held to distanceRange, and the eye goes that far", () => {
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        const c = new FollowController(me)
        c.frame(1 / 60, me, {}, frameOf(source()))
        c.camera.distance = 50
        expect(c.camera.distance).toBe(FOLLOW_LIMITS.distanceRange[1])
        c.frame(1 / 60, me, {}, frameOf(source()))
        const e = c.camera.eye, p = c.camera.target
        expect(Math.hypot(e[0] - p[0], e[1] - p[1], e[2] - p[2])).toBeCloseTo(30, 9)
        c.camera.distance = 0
        expect(c.camera.distance).toBe(FOLLOW_LIMITS.distanceRange[0])
    })

    it("holds a written pitch to pitchRange, and turns by a written yaw", () => {
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        const c = new FollowController(me, { pitchRange: [-10, 40] })
        c.frame(1 / 60, me, { pitchRange: [-10, 40] }, frameOf(source()))
        c.camera.pitch = 75
        expect(c.camera.pitch).toBe(40)
        c.camera.yaw += 270
        expect(c.camera.yaw).toBe(-90)
        c.frame(1 / 60, me, { pitchRange: [-10, 40] }, frameOf(source()))
        expect(c.camera.eye[0]).toBeGreaterThan(0)
    })

    it("moves an orbit written while still, and writes the scene's camera then", () => {
        const calls: unknown[] = []
        const o = { camera: { camera: (x: unknown) => { calls.push(x) } } }
        const c = new OrbitController(o)
        c.frame(1 / 60, o, frameOf(source()))
        expect(c.frame(1 / 60, o, frameOf(source()))).toBe(false)
        c.orbit.distance = 500
        expect(c.orbit.distance).toBe(100)
        expect(c.frame(1 / 60, o, frameOf(source()))).toBe(true)
        expect(calls).toHaveLength(2)
        expect(Math.hypot(...c.orbit.eye)).toBeCloseTo(100, 9)
    })

    // Review of 1.4.0 (PlaySite/docs/reviews/1.4.0-follow-camera.md, finding 1): NaN passed
    // every range check, and one bad write left both cameras' eyes NaN for good.
    it("keeps what it had when a write or a start value is not a number", () => {
        const me = { position: [0, 0, 0] as Vec3, yaw: 0 }
        const c = new FollowController(me)
        c.camera.distance = NaN
        c.camera.pitch = Infinity
        c.camera.yaw = NaN
        c.frame(1 / 60, me, {}, frameOf(source()))
        expect([c.camera.yaw, c.camera.pitch, c.camera.distance]).toEqual([0, 15, 5])
        expect(c.camera.eye.every(Number.isFinite)).toBe(true)

        const o = new OrbitController({ distance: NaN, pitch: 0 / 0 })
        o.orbit.distance = NaN
        o.frame(1 / 60, {}, frameOf(source()))
        expect([o.orbit.pitch, o.orbit.distance]).toEqual([20, 6])
        expect(o.orbit.eye.every(Number.isFinite)).toBe(true)
    })

    it("holds start values to the ranges before the first frame", () => {
        const o = new OrbitController({ distance: 0, pitch: 90 })
        expect([o.orbit.pitch, o.orbit.distance]).toEqual([80, 1])
        expect(Math.hypot(...o.orbit.eye)).toBeCloseTo(1, 9)
    })
})

describe("a follow camera given its target late", () => {
    // Finding 2: useFollowCamera(player?.actor) has no target while the model loads, and the
    // camera started at yaw 0 whichever way the target faced, so a target facing -z was
    // looked at from in front, and with turnWith alone it stayed in front for good.
    it("starts behind the first target it is given, as it does one given at mount", () => {
        const me = { position: [0, 0, 0] as Vec3, yaw: 180 }
        const late = new FollowController(null)
        late.frame(1 / 60, null, { turnWith: true }, frameOf(source()))
        late.frame(1 / 60, me, { turnWith: true }, frameOf(source()))
        const now = new FollowController(me)
        now.frame(1 / 60, me, { turnWith: true }, frameOf(source()))
        expect(late.camera.yaw).toBe(180)
        expect(late.camera.heading).toBe(180)
        expect(late.camera.eye[2]).toBeCloseTo(now.camera.eye[2], 9)
        expect(late.camera.eye[2]).toBeGreaterThan(0)
    })

    it("keeps a yaw the cart wrote before the target came, and turns from the camera's yaw for a second target", () => {
        const me = { position: [0, 0, 0] as Vec3, yaw: 180 }
        const c = new FollowController(null)
        c.camera.yaw = 90
        c.frame(1 / 60, me, {}, frameOf(source()))
        expect(c.camera.yaw).toBe(90)
        c.frame(1 / 60, { position: [0, 0, 0] as Vec3, yaw: -45 }, {}, frameOf(source()))
        expect(c.camera.yaw).toBe(90)
    })
})

describe("a follow camera in a world", () => {
    /** A world with the target's sphere, stepped by frames, the actor placed where it is drawn. */
    async function yard() {
        const w = await createWorld({ gravity: [0, 0, 0] }) as any
        const actor: any = { position: [0, 0, 0], yaw: 0 }
        const body = w.sphere({ dynamic: true, radius: 0.5, actor })
        return { w, actor, body }
    }

    it("never takes the target's own body for a wall", async () => {
        const { w, actor } = await yard()
        // Height 0: the pivot is the sphere's centre, inside it, where every ray starts on it.
        const o = { distance: 5, height: 0, world: w }
        const c = new FollowController(actor, o)
        for (let i = 0; i < 30; i++) {
            w.frame(1 / 60)
            c.frame(1 / 60, actor, o, frameOf(source()))
            const e = c.camera.eye, p = c.camera.target
            expect(Math.hypot(e[0] - p[0], e[1] - p[1], e[2] - p[2]), `frame ${i}`).toBeCloseTo(5, 6)
        }
        const e = c.camera.eye, p = c.camera.target
        expect(Math.hypot(e[0] - p[0], e[1] - p[1], e[2] - p[2])).toBeCloseTo(5, 6)
        w.dispose()
    })

    it("comes in front of a wall it would go behind, and backs out once the wall is gone", async () => {
        const { w, actor } = await yard()
        // Behind the target, between it and the camera at yaw 0 (the camera is at -z).
        const wall = w.box({ at: [0, 1, -2.5], size: [6, 6, 0.4] })
        const c = new FollowController(actor, { pitch: 0 })
        const o = { distance: 5, pitch: 0, world: w }
        for (let i = 0; i < 10; i++) {
            w.frame(1 / 60)
            c.frame(1 / 60, actor, o, frameOf(source()))
        }
        // The wall's near face is at z -2.3; the camera stays on the target's side of it.
        expect(c.camera.eye[2]).toBeGreaterThan(-2.3)
        expect(c.camera.eye[2]).toBeLessThan(-1.5)
        wall.destroy()
        w.frame(1 / 60)
        c.frame(1 / 60, actor, o, frameOf(source()))
        expect(c.camera.eye[2]).toBeGreaterThan(-3)
        for (let i = 0; i < 120; i++) {
            w.frame(1 / 60)
            c.frame(1 / 60, actor, o, frameOf(source()))
        }
        expect(c.camera.eye[2]).toBeCloseTo(-5, 2)
        w.dispose()
    })

    // runtime-1.3.md section 8: the camera follows what is drawn, so a step
    // every other frame does not come back as judder through the camera.
    it("keeps the same distance to the drawn model on every frame when steps come every other frame", async () => {
        const { w, actor, body } = await yard()
        body.velocity = [0, 0, 8]
        const c = new FollowController(actor, { distance: 5 })
        const gaps: number[] = []
        for (let i = 0; i < 240; i++) {
            w.frame(1 / 120)
            c.frame(1 / 120, actor, { distance: 5, world: w }, frameOf(source()))
            const e = c.camera.eye, a = actor.position
            if (i >= 60) gaps.push(Math.hypot(e[0] - a[0], e[2] - a[2]))
        }
        expect(w.stepSeconds).toBeCloseTo(1 / 60, 9)
        const spread = Math.max(...gaps) - Math.min(...gaps)
        expect(spread).toBeLessThan(1e-6)
        w.dispose()
    })

    it("holds where it is while the target is null", () => {
        const c = new FollowController(null)
        const calls: unknown[] = []
        const cam = { camera: (o: unknown) => { calls.push(o) } }
        c.frame(1 / 60, null, { camera: cam }, frameOf(source({ wasLeftPressed: true, rightButton: true, leftButton: true })))
        expect(calls).toHaveLength(0)
        expect(c.camera.forward).toBe(false)
    })
})
