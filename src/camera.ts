/**
 * Cameras a cart drags: one that orbits a point, and one that follows an actor.
 *
 *     const orbit = useOrbit({ distance: 6, idleSpin: 10, camera: scene })
 *     <View {...orbit.bind} style={{ flexGrow: 1 }} />
 *
 *     const cam = useFollowCamera(me.actor, { distance: 5, camera: scene, world })
 *     <View {...cam.bind} style={{ flexGrow: 1 }} />
 *
 * WHERE A DRAG COMES FROM
 *
 * `input`, read once a frame, as a swipe and a stick read it: a press that
 * begins inside the bound View, on nothing that answers presses (`overUI`)
 * and on no stick or pad, starts a drag, and the drag goes on wherever the
 * pointer wanders until it lifts. The View carries `oj-world`, so a handler
 * of the cart's own on it does not turn every press into UI and kill a stick
 * beside it (over-ui.ts). Its own pointer events were the first idea, but
 * UI Toolkit's pointer ids cannot be matched to input's fingers, and Unity's
 * loop and the container's run in either order inside one animation frame.
 * Only the wheel is the View's, since its sign and size differ between hosts
 * when read from input.
 *
 * WHEN IT RUNS
 *
 * In the frame's late phase (runtime.ts), after every world has stepped and
 * placed its actors, so the camera reads where the target is drawn this
 * frame and never a step behind. A cart reading `heading` or `forward` in its
 * own useFrame sees last frame's drag, one frame of latency on a hand.
 *
 * WHICH WAY IS WHICH
 *
 * Degrees and Unity's axes, as actors use them: yaw 0 looks along +z and yaw
 * 90 along +x; a positive pitch puts the camera above its target looking
 * down. The eye is Unity's `Quaternion.Euler(pitch, yaw, 0)` turning the
 * camera's back, which one function builds for both cameras (`orbitEye`), so
 * a mirrored basis cannot come back in one of them alone. A drag right turns
 * the view as three.js's OrbitControls does, the content following the
 * pointer.
 *
 * HOW FAR A DRAG TURNS
 *
 * `degreesPerPixel` a stage pixel, 0.3 by default, mouse and finger alike. A
 * stage pixel is a CSS pixel, about the same size on every screen, so the
 * same hand movement turns the same way in the editor's small stage as full
 * screen. Before runtime 1.4 a stage height of drag was a whole turn, twice
 * as fast in a 538 px stage as full screen (engine-findings.md, "useFollowCamera
 * cannot be WoW's camera").
 *
 * START VALUES AND LIVE ONES
 *
 * The options `yaw`, `pitch` and `distance` say where the camera starts and
 * are read once. The object a hook returns has the same three fields, which a
 * cart writes when it means them (a cutscene, a zoom key): written in a
 * useFrame, they take effect in that frame's late phase, held to `pitchRange`
 * and `distanceRange`. A live option would undo every wheel zoom on the
 * cart's next render.
 *
 * TURNING WITH THE TARGET
 *
 * `turnWith` turns a follow camera by exactly what its target turned since
 * the last frame, WoW's A and D, while no drag is held: holding a drag and
 * turning leaves the camera where the hand holds it. `behind` eases the
 * camera behind the target with no drag held, always (`true`, a vehicle) or
 * only while the target moves (`"moving"`, WoW's swing back once you walk
 * after a look round). The two compose.
 */

import { useEffect, useRef, useState } from "react"
import { input, type Mouse, type Touch } from "onejs-unity/input"
import type { VisualElement } from "onejs-react"
import { getCurrentRuntime } from "./runtime"
import { WORLD_CLASS } from "./over-ui"
import { heldByControl } from "./stick"
import type { CameraOptions, Vec3 } from "./models"

const RAD = Math.PI / 180

/** Where a camera is, around the point it looks at. */
export interface OrbitView {
    /** Degrees about the up axis: 0 looks along +z, 90 along +x. */
    yaw: number
    /** Degrees: positive is above the point, looking down. */
    pitch: number
    /** Metres from the point. */
    distance: number
}

export interface OrbitLimits {
    /** Degrees, short of straight up and down, where looking at a point turns over. */
    pitchRange: readonly [number, number]
    /** Metres. */
    distanceRange: readonly [number, number]
}

/** Anything a camera writes to: a scene from useScene. */
export interface CameraTarget {
    camera(options: CameraOptions): void
}

/**
 * Where the camera stands for `view` around `target`: Unity's
 * `Quaternion.Euler(pitch, yaw, 0) * Vector3.back * distance`, added to the
 * target. `distance` defaults to the view's own.
 */
export function orbitEye(target: Readonly<Vec3>, view: Readonly<OrbitView>, distance: number = view.distance): Vec3 {
    const yaw = view.yaw * RAD, pitch = view.pitch * RAD
    const flat = Math.cos(pitch) * distance
    return [target[0] - Math.sin(yaw) * flat, target[1] + Math.sin(pitch) * distance, target[2] - Math.cos(yaw) * flat]
}

/** An angle in degrees, brought into (-180, 180]. */
export function wrapDegrees(degrees: number): number {
    const r = ((((degrees + 180) % 360) + 360) % 360) - 180
    return r === -180 ? 180 : r
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

// The drag

/** A touch as a drag reads it. */
export type DragTouch = Pick<Touch, "fingerId" | "position" | "delta" | "phase"> & Partial<Pick<Touch, "overUI">>

/** The slice of `input` a drag reads, so a test can hand in plain objects. */
export interface DragSource {
    touches: readonly DragTouch[]
    mouse: Pick<Mouse, "position" | "delta" | "leftButton" | "rightButton" | "wasLeftPressed" | "wasRightPressed" | "overUI">
}

/** What the drag held. Exported for tests; a cart uses the hooks. */
export interface DragTracker {
    source: "mouse" | "touch" | null
    /** The fingers driving it, at most two. */
    fingers: number[]
    /** Stage units between two fingers last frame, or 0 when not pinching. */
    pinch: number
}

/** One frame of a drag. */
export interface DragFrame {
    /** Stage units the drag moved this frame: right and down are positive. */
    dx: number
    dy: number
    /** What the distance is multiplied by: a pinch, or the wheel. 1 with neither. */
    zoom: number
    /** A left drag or one finger is held. */
    left: boolean
    /** A right drag is held. */
    right: boolean
    /** Any drag is held. */
    active: boolean
}

export function newDragTracker(): DragTracker {
    return { source: null, fingers: [], pinch: 0 }
}

export function newDragFrame(): DragFrame {
    return { dx: 0, dy: 0, zoom: 1, left: false, right: false, active: false }
}

const ended = (t: DragTouch) => t.phase === "ended" || t.phase === "canceled"

/**
 * One frame of a drag, written into `out`. `inside` says whether a press at a
 * stage point is in the bound View; `claimed` whether a stick or pad has a
 * finger. Touches come first, and the mouse starts nothing while a finger is
 * down: the container reports a touch as the mouse too, so a thumb on a stick
 * would otherwise turn the camera as a mouse drag.
 */
export function readDrag(
    t: DragTracker, source: DragSource, inside: (x: number, y: number) => boolean,
    claimed: (fingerId: number) => boolean, out: DragFrame,
): DragFrame {
    out.dx = 0
    out.dy = 0
    out.zoom = 1
    out.left = false
    out.right = false

    if (t.source !== "mouse") {
        const touches = source.touches
        // Fingers that lifted, or that the list no longer has, let go.
        for (let i = t.fingers.length - 1; i >= 0; i--) {
            const mine = touches.find((x) => x.fingerId === t.fingers[i])
            if (mine === undefined || ended(mine)) {
                t.fingers.splice(i, 1)
                t.pinch = 0
            }
        }
        for (const touch of touches) {
            if (t.fingers.length >= 2) break
            if (touch.phase !== "began" || touch.overUI === true || t.fingers.includes(touch.fingerId)) continue
            if (claimed(touch.fingerId) || !inside(touch.position.x, touch.position.y)) continue
            t.fingers.push(touch.fingerId)
            t.pinch = 0
        }
        t.source = t.fingers.length > 0 ? "touch" : null
        if (t.fingers.length === 1) {
            const one = touches.find((x) => x.fingerId === t.fingers[0])!
            out.dx = one.delta.x
            out.dy = one.delta.y
            out.left = true
        } else if (t.fingers.length === 2) {
            const a = touches.find((x) => x.fingerId === t.fingers[0])!
            const b = touches.find((x) => x.fingerId === t.fingers[1])!
            const apart = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y)
            // Spreading the fingers brings the camera in.
            if (t.pinch > 0 && apart > 0) out.zoom = t.pinch / apart
            t.pinch = apart
            out.left = true
        }
        if (t.source === "touch" || touches.length > 0) {
            out.active = t.source === "touch"
            return out
        }
    }

    const m = source.mouse
    if (t.source === null) {
        if ((m.wasLeftPressed || m.wasRightPressed) && !m.overUI && inside(m.position.x, m.position.y)) t.source = "mouse"
        else {
            out.active = false
            return out
        }
    } else if (!m.leftButton && !m.rightButton) {
        t.source = null
        out.active = false
        return out
    } else {
        // Not on the frame it began: the delta then is the move before the press.
        out.dx = m.delta.x
        out.dy = m.delta.y
    }
    out.left = m.leftButton
    out.right = m.rightButton
    out.active = true
    return out
}

/**
 * One frame of an orbit: the drag turns it, a pinch or the wheel zooms it.
 * Returns whether the view changed.
 */
export function orbitStep(view: OrbitView, drag: Readonly<Pick<DragFrame, "dx" | "dy" | "zoom">>, limits: OrbitLimits, degreesPerPixel: number): boolean {
    const yaw = drag.dx === 0 ? view.yaw : wrapDegrees(view.yaw + drag.dx * degreesPerPixel)
    const pitch = clamp(view.pitch + drag.dy * degreesPerPixel, limits.pitchRange[0], limits.pitchRange[1])
    const distance = clamp(view.distance * drag.zoom, limits.distanceRange[0], limits.distanceRange[1])
    const changed = yaw !== view.yaw || pitch !== view.pitch || distance !== view.distance
    view.yaw = yaw
    view.pitch = pitch
    view.distance = distance
    return changed
}

// Following

/** What a follow camera follows: an actor, or anything with where it is and which way it faces. */
export interface FollowTarget {
    readonly position: Readonly<Vec3>
    readonly yaw: number
}

/** A hit, as the 3D world's raycast answers. */
interface RayHit {
    distance: number
    body: { actor?: unknown } | null
}

/** The slice of a 3D world the follow camera asks. */
export interface FollowWorld {
    raycast(from: Vec3, to: Vec3, filter?: { only?: readonly string[], skip?: readonly unknown[] }): RayHit | null
}

/** A follow camera's state. Exported for tests; a cart uses useFollowCamera. */
export interface FollowState extends OrbitView {
    /** Which way the character should face: the camera's yaw, while a right drag is held. */
    heading: number
    /** Both buttons are held: walk forward. */
    forward: boolean
    /** The point looked at, eased upward and downward so a step does not jolt. */
    pivot: Vec3
    /** How far the camera is from the pivot now: the distance, or less in front of a wall. */
    reach: number
    /** Where the camera stands. */
    eye: Vec3
    /** The target last followed: a new one is learned afresh. */
    of: FollowTarget | null
    /** The world's body that carries the target, learned from the first ray that hit it. */
    own: object | null
    /** The filter asked of the world, rebuilt when `own` is learned. */
    filter: { only?: readonly string[], skip?: readonly unknown[] } | undefined
    /** The target's yaw and position last frame, for `turnWith` and `behind: "moving"`. */
    lastYaw: number
    lastAt: Vec3
    /** A cart wrote the distance: take it this frame rather than backing out to it. */
    snapReach: boolean
    started: boolean
}

/** Seconds for the pivot to close most of a step up or down. */
const PIVOT_SECONDS = 0.08
/** A jump further than this is a teleport, taken at once. */
const PIVOT_SNAP = 2
/** Seconds for `behind` to bring the camera most of the way round. */
const BEHIND_SECONDS = 0.35
/** Metres a second across the ground, above which `behind: "moving"` counts the target as moving. */
const MOVING_SPEED = 0.2
/** Seconds to back out from a wall once it is no longer in the way. */
const REACH_SECONDS = 0.3
/** Metres kept between the camera and a wall. */
const WALL_MARGIN = 0.2
/** The nearest the camera comes, however close the wall. */
const MIN_REACH = 0.3

export interface FollowStepOptions {
    limits: OrbitLimits
    degreesPerPixel: number
    /** Metres above the target's position that the camera looks at. */
    height: number
    behind: boolean | "moving"
    /** Turn by what the target turned, while no drag is held. */
    turnWith: boolean
    world: FollowWorld | null
    /** What a wall is: the world's filter, before the target's own body is skipped. */
    filter?: { only?: readonly string[], skip?: readonly unknown[] }
}

export function newFollowState(view: OrbitView): FollowState {
    const pivot: Vec3 = [0, 0, 0]
    return {
        ...view, heading: view.yaw, forward: false, pivot, reach: view.distance, eye: orbitEye(pivot, view),
        of: null, own: null, filter: undefined, lastYaw: 0, lastAt: [0, 0, 0], snapReach: false, started: false,
    }
}

/**
 * One frame of a follow camera: the drag, `turnWith`, `behind`, the pivot,
 * and the wall. Returns the eye, which it also keeps in `s.eye`.
 */
export function followStep(s: FollowState, drag: Readonly<DragFrame>, target: FollowTarget, dt: number, o: FollowStepOptions): Vec3 {
    const p = target.position
    // A new target is learned afresh: where it stands, and which body is its own.
    if (s.of !== target) {
        s.of = target
        s.started = false
        s.own = null
    }
    if (!s.started) {
        s.started = true
        s.pivot = [p[0], p[1] + o.height, p[2]]
        s.filter = o.filter
        s.lastYaw = target.yaw
        s.lastAt = [p[0], p[1], p[2]]
    }
    orbitStep(s, drag, o.limits, o.degreesPerPixel)
    // Right drag turns the camera and the character with it, WoW's way.
    if (drag.right) s.heading = s.yaw
    s.forward = drag.left && drag.right

    const turned = wrapDegrees(target.yaw - s.lastYaw)
    const moving = dt > 0 && Math.hypot(p[0] - s.lastAt[0], p[2] - s.lastAt[2]) > MOVING_SPEED * dt
    s.lastYaw = target.yaw
    s.lastAt = [p[0], p[1], p[2]]
    // A drag held is the hand's: turning the target then leaves the camera where it is.
    if (!drag.active) {
        if (o.turnWith && turned !== 0) s.yaw = wrapDegrees(s.yaw + turned)
        if (o.behind === true || (o.behind === "moving" && moving)) {
            s.yaw = wrapDegrees(s.yaw + wrapDegrees(target.yaw - s.yaw) * (1 - Math.exp(-dt / BEHIND_SECONDS)))
        }
    }

    // Across, the target exactly, so speed never changes how far behind the
    // camera is; up and down eased, so a step or a bump does not jolt it.
    const wantY = p[1] + o.height
    const y = Math.abs(wantY - s.pivot[1]) > PIVOT_SNAP ? wantY : s.pivot[1] + (wantY - s.pivot[1]) * (1 - Math.exp(-dt / PIVOT_SECONDS))
    s.pivot = [p[0], y, p[2]]

    let reach = s.distance
    if (o.world !== null) {
        const eye = orbitEye(s.pivot, s, s.distance)
        let hit = o.world.raycast(s.pivot, eye, s.filter)
        // The pivot is inside the target's own body: learn it, and look past it from now on.
        if (hit !== null && hit.body !== null && hit.body.actor === target && hit.body !== s.own) {
            s.own = hit.body
            s.filter = { only: o.filter?.only, skip: [...(o.filter?.skip ?? []), hit.body] }
            hit = o.world.raycast(s.pivot, eye, s.filter)
        }
        if (hit !== null) reach = Math.max(MIN_REACH, Math.min(s.distance, hit.distance - WALL_MARGIN))
    }
    // In at once, so a wall never hides the target; back out gently, unless the cart wrote the distance.
    s.reach = reach <= s.reach || s.snapReach ? reach : s.reach + (reach - s.reach) * (1 - Math.exp(-dt / REACH_SECONDS))
    s.snapReach = false
    s.reach = Math.min(s.reach, s.distance)
    s.eye = orbitEye(s.pivot, s, s.reach)
    return s.eye
}

// The controllers, and the hooks that wire them to a component

/** Spread on the View the camera is dragged in. */
export interface CameraBind {
    ref: { current: VisualElement | null }
    className: string
    onWheel: (event: { deltaY: number }) => void
}

/** What a controller reads a frame from. The hooks pass `input` and the sticks' claims. */
export interface CameraFrame {
    source: DragSource
    claimed: (fingerId: number) => boolean
}

/** Each wheel step multiplies the distance by this. */
const WHEEL_STEP = 1.1
/** Degrees a stage pixel of drag turns, unless a hook is told otherwise. */
export const DEGREES_PER_PIXEL = 0.3

const sameVec = (a: Readonly<Vec3> | null, b: Readonly<Vec3>) => a !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/** The drag, the wheel and the camera write both controllers share. */
class Rig {
    readonly tracker = newDragTracker()
    readonly drag = newDragFrame()
    /** Wheel steps since the last frame: positive is away from the player, zooming out. */
    private _wheel = 0
    private _eye: Vec3 | null = null
    private _at: Vec3 | null = null
    private _to: CameraTarget | null = null
    readonly bind: CameraBind

    constructor() {
        const ref: { current: VisualElement | null } = { current: null }
        // A host's wheel arrives as lines or as pixels: a step is at most three lines, either way.
        this.bind = { ref, className: WORLD_CLASS, onWheel: (e) => { this._wheel += clamp(e.deltaY, -3, 3) } }
    }

    /** Asked only when a press begins: the View's rect is one read then. With no View bound, the whole stage. */
    private readonly _inside = (x: number, y: number): boolean => {
        const el = this.bind.ref.current as any
        if (el == null) return true
        const r = el.worldBound
        return r == null || (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    }

    read(f: CameraFrame): DragFrame {
        const drag = readDrag(this.tracker, f.source, this._inside, f.claimed, this.drag)
        if (this._wheel !== 0) {
            drag.zoom *= Math.pow(WHEEL_STEP, this._wheel)
            this._wheel = 0
        }
        return drag
    }

    /** Moves the camera only when it moved: one bridge call a change. */
    write(to: CameraTarget | null | undefined, eye: Vec3, at: Vec3): boolean {
        if (to == null) return false
        if (to === this._to && sameVec(this._eye, eye) && sameVec(this._at, at)) return false
        this._to = to
        this._eye = eye
        this._at = at
        to.camera({ position: eye, lookAt: at })
        return true
    }
}

const limitsOf = (o: { pitchRange?: readonly [number, number], distanceRange?: readonly [number, number] }, d: OrbitLimits): OrbitLimits => ({
    pitchRange: o.pitchRange ?? d.pitchRange,
    distanceRange: o.distanceRange ?? d.distanceRange,
})

export interface OrbitOptions {
    /** The point it turns around. The origin by default. */
    target?: Readonly<Vec3>
    /** Metres from the target to start at, read once: write `orbit.distance` to change it later. 6 by default. */
    distance?: number
    /** Degrees to start at, read once: write `orbit.yaw` later. 0, looking along +z, by default. */
    yaw?: number
    /** Degrees to start at, read once: write `orbit.pitch` later. 20, a little above, by default. */
    pitch?: number
    /** Degrees. [-80, 80] by default. */
    pitchRange?: readonly [number, number]
    /** Metres a pinch or the wheel keeps it within. [1, 100] by default. */
    distanceRange?: readonly [number, number]
    /** Degrees a stage pixel of drag turns it, mouse and finger alike. 0.3 by default. */
    degreesPerPixel?: number
    /** Degrees a second it turns by itself, until the first drag. 0 by default. */
    idleSpin?: number
    /** Where to put the camera: a scene from useScene. Moved once a change. */
    camera?: CameraTarget | null
    /** Called each time the camera moves, as a path tracer wants to restart. */
    onMove?: (orbit: Orbit) => void
}

/**
 * `yaw`, `pitch` and `distance` are writable: written in a useFrame, they take
 * effect in that frame's late phase, held to the ranges.
 */
export interface Orbit extends OrbitView {
    /** Where the camera stands. */
    readonly eye: Vec3
    /** What it looks at. */
    readonly target: Vec3
    /** Spread on the View it is dragged in. */
    readonly bind: CameraBind
}

export const ORBIT_LIMITS: OrbitLimits = { pitchRange: [-80, 80], distanceRange: [1, 100] }

/** useOrbit's frame, without React. Exported for tests. */
export class OrbitController {
    private readonly _rig = new Rig()
    /** The view, where it looks and where it stands; `touched` once a drag ends idleSpin for good; `written` by the cart since the last frame. */
    private readonly _s: OrbitView & { target: Vec3, eye: Vec3, touched: boolean, written: boolean }
    /** The ranges as of the last frame, which a written field is held to. */
    private readonly _range: { limits: OrbitLimits }
    readonly orbit: Orbit

    constructor(o: OrbitOptions = {}) {
        const view = { yaw: wrapDegrees(o.yaw ?? 0), pitch: o.pitch ?? 20, distance: o.distance ?? 6 }
        const target: Vec3 = o.target ? [o.target[0], o.target[1], o.target[2]] : [0, 0, 0]
        this._s = { ...view, target, eye: orbitEye(target, view), touched: false, written: false }
        const s = this._s
        const range = this._range = { limits: limitsOf(o, ORBIT_LIMITS) }
        this.orbit = {
            get yaw() { return s.yaw },
            set yaw(v) { s.yaw = wrapDegrees(v); s.written = true },
            get pitch() { return s.pitch },
            set pitch(v) { s.pitch = clamp(v, range.limits.pitchRange[0], range.limits.pitchRange[1]); s.written = true },
            get distance() { return s.distance },
            set distance(v) { s.distance = clamp(v, range.limits.distanceRange[0], range.limits.distanceRange[1]); s.written = true },
            get eye() { return s.eye },
            get target() { return s.target },
            bind: this._rig.bind,
        }
    }

    /** One late frame. Returns whether the view moved, which re-renders the component. */
    frame(dt: number, o: OrbitOptions, f: CameraFrame): boolean {
        const s = this._s
        const drag = this._rig.read(f)
        if (drag.active) s.touched = true
        this._range.limits = limitsOf(o, ORBIT_LIMITS)
        let moved = orbitStep(s, drag, this._range.limits, o.degreesPerPixel ?? DEGREES_PER_PIXEL) || s.written
        s.written = false
        const spin = o.idleSpin ?? 0
        if (!s.touched && spin !== 0 && dt > 0) {
            s.yaw = wrapDegrees(s.yaw + spin * dt)
            moved = true
        }
        const t = o.target
        if (t && !sameVec(s.target, t)) {
            s.target = [t[0], t[1], t[2]]
            moved = true
        }
        if (moved) s.eye = orbitEye(s.target, s)
        // A scene that arrives after mount is written then, though the view did not move.
        const wrote = this._rig.write(o.camera, s.eye, s.target)
        if (moved || wrote) o.onMove?.(this.orbit)
        return moved
    }
}

export interface FollowOptions {
    /** Metres behind to start at, read once: write `cam.distance` to change it later. 5 by default. */
    distance?: number
    /** Metres above the target's position that the camera looks at. 1 by default. */
    height?: number
    /** Degrees to start at, read once: write `cam.pitch` later. 15 by default. */
    pitch?: number
    /** Degrees. [-80, 80] by default. */
    pitchRange?: readonly [number, number]
    /** Metres. [1.5, 30] by default. */
    distanceRange?: readonly [number, number]
    /** Where to put the camera: a scene from useScene. Moved once a change. */
    camera?: CameraTarget | null
    /**
     * A 3D world: a ray from the target to the camera brings the camera in
     * front of a wall it would go behind. The target's own body is never a wall.
     */
    world?: FollowWorld | null
    /** What counts as a wall, as a world query filters. Everything solid by default. */
    filter?: { only?: readonly string[], skip?: readonly unknown[] }
    /**
     * With no drag held, the camera settles behind the target's own yaw, and
     * a drag looks around until it is let go. `true` settles at all times,
     * for a vehicle; `"moving"` only while the target moves across the
     * ground, so a look round stays until the character walks.
     */
    behind?: boolean | "moving"
    /**
     * While no drag is held, the camera turns by exactly what the target
     * turned since the last frame, so A and D turn a character and its
     * camera together. Off by default: a character that faces the way a
     * stick points would swing the camera on every change of direction.
     */
    turnWith?: boolean
    /** Degrees a stage pixel of drag turns it, mouse and finger alike. 0.3 by default. */
    degreesPerPixel?: number
}

/**
 * `yaw`, `pitch` and `distance` are writable: written in a useFrame, they take
 * effect in that frame's late phase, held to the ranges. `cam.yaw += 90`
 * turns the camera a quarter.
 */
export interface FollowCamera extends OrbitView {
    /** Which way the character should face: the camera's yaw, set while a right drag is held. */
    readonly heading: number
    /** Both buttons are held: the cart walks forward. */
    readonly forward: boolean
    /** Where the camera stands, in front of any wall. */
    readonly eye: Vec3
    /** What it looks at: `height` above the target. */
    readonly target: Vec3
    /** Spread on the View it is dragged in. */
    readonly bind: CameraBind
}

export const FOLLOW_LIMITS: OrbitLimits = { pitchRange: [-80, 80], distanceRange: [1.5, 30] }

/** useFollowCamera's frame, without React. Exported for tests. */
export class FollowController {
    private readonly _rig = new Rig()
    private readonly _state: FollowState
    /** The ranges as of the last frame, which a written field is held to. */
    private readonly _range: { limits: OrbitLimits }
    readonly camera: FollowCamera

    constructor(target: FollowTarget | null | undefined, o: FollowOptions = {}) {
        const s = this._state = newFollowState({ yaw: wrapDegrees(target?.yaw ?? 0), pitch: o.pitch ?? 15, distance: o.distance ?? 5 })
        const range = this._range = { limits: limitsOf(o, FOLLOW_LIMITS) }
        this.camera = {
            get yaw() { return s.yaw },
            set yaw(v) { s.yaw = wrapDegrees(v) },
            get pitch() { return s.pitch },
            set pitch(v) { s.pitch = clamp(v, range.limits.pitchRange[0], range.limits.pitchRange[1]) },
            get distance() { return s.distance },
            set distance(v) { s.distance = clamp(v, range.limits.distanceRange[0], range.limits.distanceRange[1]); s.snapReach = true },
            get heading() { return s.heading },
            get forward() { return s.forward },
            get eye() { return s.eye },
            get target() { return s.pivot },
            bind: this._rig.bind,
        }
    }

    /** One late frame. Null as the target holds the camera where it is. */
    frame(dt: number, target: FollowTarget | null | undefined, o: FollowOptions, f: CameraFrame): void {
        const s = this._state
        const drag = this._rig.read(f)
        if (target == null) {
            s.forward = false
            return
        }
        this._range.limits = limitsOf(o, FOLLOW_LIMITS)
        followStep(s, drag, target, dt, {
            limits: this._range.limits,
            degreesPerPixel: o.degreesPerPixel ?? DEGREES_PER_PIXEL,
            height: o.height ?? 1,
            behind: o.behind ?? false,
            turnWith: o.turnWith === true,
            world: o.world ?? null,
            filter: o.filter,
        })
        this._rig.write(o.camera, s.eye, s.pivot)
    }
}

/** A camera hook's effect: the late phase of this runtime's frames, or nothing (said) without one. Exported for tests. */
export function subscribeCamera(hook: string, run: (dt: number, f: CameraFrame) => void): (() => void) | undefined {
    const runtime = getCurrentRuntime()
    if (runtime === null) {
        console.warn(`[oj] ${hook}: no frame clock here, so the camera will not move.`)
        return undefined
    }
    const f: CameraFrame = { source: input, claimed: heldByControl }
    return runtime.onLateFrame((dt) => run(dt, f))
}

function useLatePhase(hook: string, run: (dt: number, f: CameraFrame) => void): void {
    const latest = useRef(run)
    latest.current = run
    useEffect(() => subscribeCamera(hook, (dt, f) => latest.current(dt, f)), [hook])
}

/**
 * A camera that orbits a point: left drag or one finger turns it, the wheel
 * or two fingers bring it in and out. The object is live and the component
 * re-renders when the view moves, so it is read in JSX as well as in a frame.
 */
export function useOrbit(options: OrbitOptions = {}): Orbit {
    const controller = useRef<OrbitController | null>(null)
    if (controller.current === null) controller.current = new OrbitController(options)
    const [, rerender] = useState(0)
    useLatePhase("useOrbit", (dt, f) => {
        if (controller.current!.frame(dt, options, f)) rerender((n) => n + 1)
    })
    return controller.current.orbit
}

/**
 * A camera behind an actor, WoW's way: right drag turns the camera and the
 * character's `heading` with it, left drag looks around without turning it,
 * both buttons held is `forward`, the wheel or two fingers zoom, and with
 * `turnWith` the camera turns as the actor does. Follows the
 * actor (`car.body.actor`, `me.actor`), what is drawn, never a body. The
 * object is live and read in a frame: nothing re-renders as the target moves.
 * Null as the target holds the camera where it is.
 */
export function useFollowCamera(target: FollowTarget | null | undefined, options: FollowOptions = {}): FollowCamera {
    const controller = useRef<FollowController | null>(null)
    if (controller.current === null) controller.current = new FollowController(target, options)
    useLatePhase("useFollowCamera", (dt, f) => controller.current!.frame(dt, target, options, f))
    return controller.current.camera
}
