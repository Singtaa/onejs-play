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
 * frame and never a step behind. The drag alone can be taken sooner: a cart
 * that reads or writes a follow camera's `heading`, `forward`, `yaw`, `pitch`
 * or `distance` in its useFrame turns it by this frame's drag first, once a
 * frame, so a character steered from `heading` faces where the camera looks
 * that frame rather than one frame's drag behind (learn Mac's finding 27).
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
 * The options `pitch` and `distance`, and the orbit's `yaw`, say where the
 * camera starts and are read once; a follow camera starts behind its target,
 * the first one it is given when it had none at mount. The object a hook
 * returns has `yaw`, `pitch` and `distance` fields, which a cart writes when it
 * means them (a cutscene, a zoom key): written in a useFrame, they take effect
 * in that frame's late phase, held to `pitchRange` and `distanceRange`. A
 * write that is not a finite number is ignored, since NaN would pass every
 * range and stay. A live option would undo every wheel zoom on the cart's next
 * render.
 *
 * TURNING WITH THE TARGET
 *
 * `turnWith` turns a follow camera by exactly what its target turned since
 * the last frame, WoW's A and D, while no drag is held: holding a drag and
 * turning leaves the camera where the hand holds it. Nor on the frame a drag
 * ends, since a cart that steered its target from the camera after the late
 * phase made a turn the camera already has (finding 28). `behind` eases the
 * camera behind the target with no drag held, always (`true`, a vehicle) or
 * only while the target moves (`"moving"`, WoW's swing back once you walk
 * after a look round). The two compose.
 *
 * WOW'S FEEL, BY DEFAULT (runtime 1.6; feel.md on primoeden-three, after WoWee)
 *
 * A follow camera's press turns nothing until it has moved 5 stage pixels,
 * or 0.8% of the bound View's short side if that is more, so a click does not
 * turn the view by its jitter; the turn starts from that point, and a right
 * press sets `heading` at once all the same. A wheel notch moves the distance
 * by 15% of it and at least 0.3 m, and what is shown eases there, 95% in
 * 0.20 s. A pinch is taken at once. An orbit has neither.
 *
 * WHAT IS IN THE WAY
 *
 * `clearance` (0.4 m) is kept between the camera and anything, the whole way
 * back from the pivot: a sphere that size is swept through the `world`, and
 * marched along the `ground`, a height function for a world whose colliders
 * are only near the player. A hit facing up is ground, any steeper a wall. A
 * wall brings the camera in at once, so it never hides the target. The ground
 * comes in on a slower timing of its own, and at once when the view turns or
 * the camera would stand in it. While it eases in, the way back is held clear
 * of the ground and not of `clearance`, so it can pass a sharp crest a few
 * centimetres nearer than `clearance` for about a quarter of a second, never
 * through it. Both go out over 0.4 s. Held short for a
 * while, the zoom itself comes in behind the camera and is given back a second
 * after nothing is in the way, so a slope does not push the camera in and out
 * with every step; a wheel notch, a pinch or a written `distance` forgets it.
 * `distance` is always what the player asked for. With `ground`, what the
 * camera looks at rises where the camera comes close over the ground, the way
 * back is tested from where it rose to, as WoWee does, and the camera never
 * stands lower than `clearance` above the ground. WoWee brings a wall in
 * over 0.06 s; at once here is the one place this differs from it.
 */

import { useEffect, useRef, useState } from "react"
import { input, type Mouse, type Touch } from "onejs-unity/input"
import type { VisualElement } from "onejs-react"
import { getCurrentRuntime } from "./runtime"
import { WORLD_CLASS } from "./over-ui"
import { heldByControl } from "./stick"
import { shape, type Shape } from "./physics3d/world"
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
    /** Degrees, short of straight up and down, where looking at a point turns over: never past 89 either way. */
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
/** A start value a cart gave: its default when it is not a finite number. */
const startOf = (v: number | undefined, fallback: number) => (v !== undefined && Number.isFinite(v) ? v : fallback)

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
    /** How far the press has moved, in a straight line from where it began, while it is still inside the dead zone. */
    travelX: number
    travelY: number
    /** The press has left its dead zone, so it turns. */
    armed: boolean
}

/** One frame of a drag. */
export interface DragFrame {
    /** Stage units the drag moved this frame: right and down are positive. */
    dx: number
    dy: number
    /** What the distance is multiplied by: a pinch, or for an orbit the wheel too. 1 with neither. */
    zoom: number
    /** A follow camera's wheel notches this frame: positive is away from the target. 0 for an orbit, whose wheel is in `zoom`. */
    notches: number
    /** A left drag or one finger is held. */
    left: boolean
    /** A right drag is held. */
    right: boolean
    /** Any drag is held. */
    active: boolean
}

export function newDragTracker(): DragTracker {
    return { source: null, fingers: [], pinch: 0, travelX: 0, travelY: 0, armed: true }
}

export function newDragFrame(): DragFrame {
    return { dx: 0, dy: 0, zoom: 1, notches: 0, left: false, right: false, active: false }
}

const ended = (t: DragTouch) => t.phase === "ended" || t.phase === "canceled"

/** A new press: nothing travelled yet, and armed at once when there is no dead zone. */
const pressed = (t: DragTracker, deadZone: number) => {
    t.travelX = 0
    t.travelY = 0
    t.armed = !(deadZone > 0)
}

/**
 * This frame's move of one pointer through the dead zone: nothing until the
 * press has gone `deadZone` stage units from where it began, as a straight
 * line, and from then only what lies past that point, so the view never jumps
 * by the zone's worth.
 */
function pastDeadZone(t: DragTracker, deadZone: number, out: DragFrame): void {
    if (t.armed) return
    t.travelX += out.dx
    t.travelY += out.dy
    const far = Math.hypot(t.travelX, t.travelY)
    if (far < deadZone) {
        out.dx = 0
        out.dy = 0
        return
    }
    t.armed = true
    const past = (far - deadZone) / far
    out.dx = t.travelX * past
    out.dy = t.travelY * past
}

/**
 * One frame of a drag, written into `out`. `inside` says whether a press at a
 * stage point is in the bound View; `claimed` whether a stick or pad has a
 * finger. Touches come first, and the mouse starts nothing while a finger is
 * down: the container reports a touch as the mouse too, so a thumb on a stick
 * would otherwise turn the camera as a mouse drag.
 *
 * `deadZone`, in stage units, is how far a mouse press or one finger moves
 * before it turns anything, so a click does not turn the view by its jitter.
 * The press still counts as held from the start (`left`, `right`, `active`);
 * only its `dx` and `dy` wait. A pinch is never held back. 0 by default.
 */
export function readDrag(
    t: DragTracker, source: DragSource, inside: (x: number, y: number) => boolean,
    claimed: (fingerId: number) => boolean, out: DragFrame, deadZone: number = 0,
): DragFrame {
    out.dx = 0
    out.dy = 0
    out.zoom = 1
    out.notches = 0
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
            if (t.fingers.length === 1) pressed(t, deadZone)
        }
        t.source = t.fingers.length > 0 ? "touch" : null
        if (t.fingers.length === 1) {
            const one = touches.find((x) => x.fingerId === t.fingers[0])!
            out.dx = one.delta.x
            out.dy = one.delta.y
            pastDeadZone(t, deadZone, out)
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
        if ((m.wasLeftPressed || m.wasRightPressed) && !m.overUI && inside(m.position.x, m.position.y)) {
            t.source = "mouse"
            pressed(t, deadZone)
        } else {
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
        pastDeadZone(t, deadZone, out)
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

/** A hit, as the 3D world's raycast and sweep answer. */
interface RayHit {
    distance: number
    /** Out of the surface: one facing up is ground, which comes in on the ground's timing. */
    normal?: Readonly<Vec3>
    body: { actor?: unknown } | null
}

type WallFilter = { only?: readonly string[], skip?: readonly unknown[] }

/**
 * The slice of a 3D world the follow camera asks. With `sweep`, a sphere of
 * `clearance` travels from the pivot to the camera, so nothing comes nearer
 * the camera than that anywhere along the way; with only `raycast`, one ray,
 * stopped `clearance` short of what it hits.
 */
export interface FollowWorld {
    raycast(from: Vec3, to: Vec3, filter?: WallFilter): RayHit | null
    sweep?(shape: Shape, from: Vec3, to: Vec3, filter?: WallFilter): RayHit | null
}

/** The ground's height anywhere, for a world whose colliders are only near the player. */
export type GroundHeight = (x: number, z: number) => number

/** A follow camera's state. Exported for tests; a cart uses useFollowCamera. */
export interface FollowState extends OrbitView {
    /** Which way the character should face: the camera's yaw while a right drag is held, the target's own yaw otherwise. */
    heading: number
    /** Both buttons are held: walk forward. */
    forward: boolean
    /** The point looked at, eased upward and downward so a step does not jolt. */
    pivot: Vec3
    /** How far the camera is from the pivot now: the zoom, or less in front of a wall or the ground. */
    reach: number
    /** The distance shown, easing to `distance` less `debt` after a wheel notch. */
    zoom: number
    /** Metres the zoom was brought in by what was in the way, given back once nothing has been for a while. */
    debt: number
    /** Seconds since nothing was in the way, for giving the debt back. */
    clearFor: number
    /** The ground's limit, eased on its own timing; Infinity while the ground is not in the way. */
    groundReach: number
    /** The camera's limit, eased; Infinity while nothing is in the way, so the camera is at the zoom. */
    limit: number
    /** What it looks at: the pivot, raised where the camera comes close to the ground. */
    look: Vec3
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
    /** A drag was held last frame, so this frame's turn of the target is not turnWith's to follow if it has ended. */
    dragging: boolean
    /** The camera's yaw and pitch as last frame left them, to tell a camera that is turning. */
    lastViewYaw: number
    lastViewPitch: number
    /** A cart wrote the distance: take it this frame rather than backing out to it. */
    snapReach: boolean
    started: boolean
    /** The yaw was given (a target at construction, or a cart's write); until it is, the first target's own yaw is taken, so the camera starts behind it. */
    aimed: boolean
}

/** Seconds for the pivot to close most of a step up or down. */
const PIVOT_SECONDS = 0.08
/** A jump further than this is a teleport, taken at once. */
const PIVOT_SNAP = 2
/** Seconds for `behind` to bring the camera most of the way round. */
const BEHIND_SECONDS = 0.35
/** Metres a second across the ground, above which `behind: "moving"` counts the target as moving. */
const MOVING_SPEED = 0.2
/**
 * How the camera meets what is in its way, in two layers (feel.md §5, after
 * WoWee). The ground's limit is eased first, in more slowly than it goes out,
 * so a slope reads as a slope rather than a nudge a step. Then the camera's
 * limit: in on GROUND_IN_SECONDS, or at once while the view turns, and at
 * once always for a wall, so a wall never hides the target; out on
 * REACH_OUT_SECONDS for both. WoWee brings a wall in on 0.06 s too; at once
 * here, since the clearance sweep and at once together are what keeps the
 * camera from ever standing in a wall.
 */
const GROUND_LIMIT_IN_SECONDS = 0.18
const GROUND_LIMIT_OUT_SECONDS = 0.45
const GROUND_IN_SECONDS = 0.06
const REACH_OUT_SECONDS = 0.4
/** A hit whose normal is at least this far up (about 53 degrees from it) is ground, and any steeper is a wall. */
const GROUND_NORMAL_Y = 0.6
/**
 * The zoom debt: while the limit is more than DEBT_SLACK short of the zoom,
 * the zoom itself comes in toward it over DEBT_IN_SECONDS, and what it took is
 * owed. Once nothing has been in the way for DEBT_SETTLE_SECONDS it is given
 * back over DEBT_OUT_SECONDS. A slope or a doorway then stops pushing the
 * camera in and out with every step.
 */
const DEBT_SLACK = 0.1
const DEBT_IN_SECONDS = 1
const DEBT_SETTLE_SECONDS = 1
const DEBT_OUT_SECONDS = 2.5
/** The wheel: the shown distance closes 1 - e^(-ZOOM_RATE t) of the gap, 95% in 0.20 s. */
const ZOOM_RATE = 15
/** One wheel notch moves the distance by this share of it, and never less than WHEEL_NOTCH_MIN metres. */
const WHEEL_NOTCH = 0.15
const WHEEL_NOTCH_MIN = 0.3
/**
 * The march along the ground reads the ground under the way back at points
 * fixed from the pivot: every GROUND_STEP metres to GROUND_NEAR, then twice
 * as far apart in each band twice as long (0.25 m to 8 m, 0.5 m to 16 m, 1 m
 * to 32 m), so the finest reading is nearest the player and a point read
 * stays where it is as the zoom eases: 36 points for a camera 10 m back, 62
 * for 30 m. Then GROUND_HALVINGS halvings between the last clear distance and
 * the first that is not. A crest kept `clearance` from the line at every point
 * can cut it between two only by rising across the line more than twice
 * `clearance` in a step: 3.2 in 1 within 8 m, 1.6 to 16 m, at the default 0.4.
 */
const GROUND_STEP = 0.25
const GROUND_NEAR = 8
const GROUND_HALVINGS = 4
/** Where a line comes near the ground between two points read, the ground is read GROUND_REFINES more times by golden sections, each keeping GOLDEN of what is left. */
const GROUND_REFINES = 8
const GOLDEN = (Math.sqrt(5) - 1) / 2
/**
 * With `ground`, the pivot rises where the camera would come within
 * LIFT_NEAR clearances of the ground under it, by up to LIFT_MAX clearances
 * (0.6 m and 1.4 m at the default 0.4).
 */
const LIFT_NEAR = 1.5
const LIFT_MAX = 3.5
/** Metres kept between the camera and anything in its way, unless a hook is told otherwise. */
export const CLEARANCE = 0.4
/** The nearest the camera comes, however close what is in its way. */
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
    /** Metres kept between the camera and anything in its way. CLEARANCE by default. */
    clearance?: number
    /** The ground's height anywhere. */
    ground?: GroundHeight | null
}

export function newFollowState(view: OrbitView, aimed: boolean = true): FollowState {
    const pivot: Vec3 = [0, 0, 0]
    return {
        ...view, heading: view.yaw, forward: false, pivot, reach: view.distance, zoom: view.distance, debt: 0, clearFor: 0, groundReach: Infinity, limit: Infinity,
        look: pivot, eye: orbitEye(pivot, view),
        of: null, own: null, filter: undefined, lastYaw: 0, lastAt: [0, 0, 0], dragging: false, lastViewYaw: view.yaw, lastViewPitch: view.pitch,
        snapReach: false, started: false, aimed,
    }
}

/**
 * One frame of a follow camera: its look (the drag), then the rest of it
 * (`followOn`). Returns the eye, which it also keeps in `s.eye`.
 */
export function followStep(s: FollowState, drag: Readonly<DragFrame>, target: FollowTarget, dt: number, o: FollowStepOptions): Vec3 {
    followLook(s, drag, o)
    return followOn(s, drag, target, dt, o)
}

/**
 * What a frame's drag does to a follow camera: turn and zoom it, set
 * `heading` and `forward`. The controller runs it once a frame, when a cart
 * first reads the camera or else in the late phase, which is why it is apart
 * from the rest of the step.
 */
export function followLook(s: FollowState, drag: Readonly<DragFrame>, o: Pick<FollowStepOptions, "limits" | "degreesPerPixel">): void {
    const [lo, hi] = o.limits.distanceRange
    // A pinch is the hand's, taken at once; a wheel notch is where the player
    // wants the camera, which the shown distance eases to. Either is the
    // player choosing a distance, so neither keeps what the collision took.
    if (drag.zoom !== 1) {
        s.distance = s.zoom = clamp((s.distance - s.debt) * drag.zoom, lo, hi)
        s.debt = 0
    }
    if (drag.notches !== 0) {
        const from = s.distance - s.debt
        s.distance = clamp(from + drag.notches * Math.max(WHEEL_NOTCH * from, WHEEL_NOTCH_MIN), lo, hi)
        s.debt = 0
    }
    orbitStep(s, drag.zoom === 1 ? drag : { dx: drag.dx, dy: drag.dy, zoom: 1 }, o.limits, o.degreesPerPixel)
    // Right drag turns the camera and the character with it, WoW's way.
    if (drag.right) s.heading = s.yaw
    else if (s.of !== null) s.heading = wrapDegrees(s.of.yaw)
    s.forward = drag.left && drag.right
}

/**
 * The rest of a follow camera's frame, after its look: `turnWith`, `behind`,
 * the pivot, and the wall. Returns the eye, which it also keeps in `s.eye`.
 */
export function followOn(s: FollowState, drag: Readonly<DragFrame>, target: FollowTarget, dt: number, o: FollowStepOptions): Vec3 {
    const p = target.position
    // A new target is learned afresh: where it stands, and which body is its own.
    if (s.of !== target) {
        s.of = target
        s.started = false
        s.own = null
    }
    if (!s.started) {
        s.started = true
        if (!s.aimed) {
            s.aimed = true
            s.yaw = s.heading = wrapDegrees(target.yaw)
        }
        s.pivot = [p[0], p[1] + o.height, p[2]]
        s.filter = o.filter
        s.lastYaw = target.yaw
        s.lastAt = [p[0], p[1], p[2]]
    }

    const turned = wrapDegrees(target.yaw - s.lastYaw)
    const moving = dt > 0 && Math.hypot(p[0] - s.lastAt[0], p[2] - s.lastAt[2]) > MOVING_SPEED * dt
    const released = s.dragging && !drag.active
    s.lastYaw = target.yaw
    s.lastAt = [p[0], p[1], p[2]]
    s.dragging = drag.active
    // A drag held is the hand's: turning the target then leaves the camera where it is.
    if (!drag.active) {
        // The frame a drag ends, the turn is the cart's last steer from the camera, which the camera already made.
        if (o.turnWith && turned !== 0 && !released) s.yaw = wrapDegrees(s.yaw + turned)
        if (o.behind === true || (o.behind === "moving" && moving)) {
            s.yaw = wrapDegrees(s.yaw + wrapDegrees(target.yaw - s.yaw) * (1 - Math.exp(-dt / BEHIND_SECONDS)))
        }
    }
    // The target's yaw as of now, which a right drag's frame does not move.
    if (!drag.right) s.heading = wrapDegrees(target.yaw)

    // Across, the target exactly, so speed never changes how far behind the
    // camera is; up and down eased, so a step or a bump does not jolt it.
    const wantY = p[1] + o.height
    const y = Math.abs(wantY - s.pivot[1]) > PIVOT_SNAP ? wantY : s.pivot[1] + (wantY - s.pivot[1]) * (1 - Math.exp(-dt / PIVOT_SECONDS))
    s.pivot = [p[0], y, p[2]]

    const clearance = o.clearance !== undefined && Number.isFinite(o.clearance) && o.clearance >= 0 ? o.clearance : CLEARANCE
    const ease = (tau: number) => 1 - Math.exp(-dt / tau)
    const turning = drag.active || s.yaw !== s.lastViewYaw || s.pitch !== s.lastViewPitch
    s.lastViewYaw = s.yaw
    s.lastViewPitch = s.pitch

    // The shown distance: where the player wants it, less what the collision took.
    if (s.snapReach) {
        s.debt = 0
        s.zoom = s.distance
    } else {
        const want = s.distance - s.debt
        s.zoom = Math.abs(want - s.zoom) < 1e-6 ? want : s.zoom + (want - s.zoom) * (1 - Math.exp(-dt * ZOOM_RATE))
    }

    // Close over the ground, the pivot rises, and the way back is tested from
    // where it rose to, as WoWee does: marched from below, a crest behind blocks
    // the line sooner and brings the camera in about twice as far.
    const ground = o.ground ?? null
    const line = ground === null ? null : groundLine(s.pivot, s, ground)
    const pre = line === null ? 0 : liftAt(line, s.zoom, groundAt(line, s.zoom), clearance)
    const from: Vec3 = pre > 0 ? [s.pivot[0], s.pivot[1] + pre, s.pivot[2]] : s.pivot

    // What is in the way, as two limits: a wall, and the ground. Infinity is nothing.
    let wall = Infinity, groundRaw = Infinity, marched = Infinity
    if (o.world !== null) {
        const hit = wallHit(s, from, target, o, clearance)
        if (hit !== null) {
            if (hit.up) groundRaw = hit.reach
            else wall = hit.reach
        }
    }
    if (line !== null) {
        marched = limitAlong(line, s.zoom, pre, clearance)
        if (marched < s.zoom) groundRaw = Math.min(groundRaw, marched)
    }
    // Further back than the ground lets it stand, as it eases in, the camera
    // keeps at least the lift the line to that limit needed: lifted only for
    // where it stands, beyond a crest, its line would pass through the crest.
    const held = line === null || marched >= s.zoom ? 0 : liftAt(line, marched, groundAt(line, marched), clearance)
    const liftTo = (d: number, under: number) => Math.max(pre, liftAt(line!, d, under, clearance), d > marched ? held : 0)
    // The ground's limit, on its own timing: from the zoom when it first comes in the way.
    if (groundRaw >= s.zoom) s.groundReach = Infinity
    else if (s.groundReach === Infinity || s.snapReach) s.groundReach = s.snapReach ? groundRaw : s.zoom
    if (s.groundReach !== Infinity) {
        s.groundReach += (groundRaw - s.groundReach) * ease(groundRaw < s.groundReach ? GROUND_LIMIT_IN_SECONDS : GROUND_LIMIT_OUT_SECONDS)
    }
    const raw = Math.min(wall, s.groundReach)

    // The camera's limit: a wall at once, the ground quickly, or at once while turning; out gently, to the zoom.
    let at = s.limit === Infinity ? s.zoom : s.limit
    const want = Math.min(raw, s.zoom)
    if (want < at) at = s.snapReach || wall <= want || turning ? want : at + (want - at) * ease(GROUND_IN_SECONDS)
    else at = s.snapReach ? want : at + (want - at) * ease(REACH_OUT_SECONDS)
    // Easing in, or held out by the ground's eased limit, the camera may graze a slope, never pass through it: where the line to it dips under the ground itself, it comes to the ground's limit at once.
    if (line !== null && at > marched && !lineClear(line, at, liftTo(at, groundAt(line, at)), 0, clearance)) {
        if (groundRaw < s.zoom) s.groundReach = Math.min(s.groundReach, groundRaw)
        at = Math.min(want, groundRaw)
    }
    s.limit = raw >= s.zoom && at >= s.zoom - 1e-3 ? Infinity : at
    s.reach = Math.max(Math.min(MIN_REACH, s.zoom), Math.min(s.zoom, at, wall))
    s.snapReach = false

    // The debt: while what is in the way is short of the zoom, the zoom comes in behind the camera; once clear a while, it is given back.
    const bite = s.distance - s.debt - raw
    if (bite > DEBT_SLACK && dt > 0) {
        s.clearFor = 0
        s.debt = Math.min(Math.max(0, s.distance - MIN_REACH), s.debt + bite * ease(DEBT_IN_SECONDS))
    } else {
        s.clearFor += dt
        if (s.clearFor > DEBT_SETTLE_SECONDS && s.debt > 0.001) s.debt -= s.debt * ease(DEBT_OUT_SECONDS)
        else if (s.debt <= 0.001) s.debt = 0
    }

    // The camera stands straight back from what it looks at, over the line's own ground at its reach.
    const under = line === null ? 0 : groundAt(line, s.reach)
    const lift = line === null ? 0 : liftTo(s.reach, under)
    s.look = lift > 0 ? [s.pivot[0], s.pivot[1] + lift, s.pivot[2]] : s.pivot
    s.eye = orbitEye(s.look, s, s.reach)
    // The camera never stands lower than clearance over the ground.
    if (line !== null && s.eye[1] < under + clearance) s.eye = [s.eye[0], under + clearance, s.eye[2]]
    return s.eye
}

/** One sphere a clearance, shared by every follow camera with that clearance. */
const spheres = new Map<number, Shape>()
const sphereOf = (radius: number): Shape => {
    let made = spheres.get(radius)
    if (made === undefined) spheres.set(radius, made = shape.sphere({ radius }))
    return made
}

/**
 * The nearest thing between the pivot and the camera at the zoom: how far the
 * camera may stand, and whether it is ground (a hit facing up) or a wall.
 * A sweep of a sphere of `clearance` when the world has one, else a ray
 * stopped `clearance` short. The target's own body is learned from the first
 * hit on it and skipped from then on.
 */
function wallHit(s: FollowState, from: Vec3, target: FollowTarget, o: FollowStepOptions, clearance: number): { reach: number, up: boolean } | null {
    const world = o.world!
    const eye = orbitEye(from, s, s.zoom)
    const sweep = world.sweep !== undefined && clearance > 0
    const ask = () => sweep ? world.sweep!(sphereOf(clearance), from, eye, s.filter) : world.raycast(from, eye, s.filter)
    let hit = ask()
    // The pivot is inside the target's own body: learn it, and look past it from now on.
    if (hit !== null && hit.body !== null && hit.body.actor === target && hit.body !== s.own) {
        s.own = hit.body
        s.filter = { only: o.filter?.only, skip: [...(o.filter?.skip ?? []), hit.body] }
        hit = ask()
    }
    if (hit === null) return null
    return { reach: sweep ? hit.distance : hit.distance - clearance, up: hit.normal !== undefined && hit.normal[1] >= GROUND_NORMAL_Y }
}

/**
 * The way back from the pivot in one frame, and the ground under it, each
 * point read once however many distances the frame tests. A camera `d` back
 * looks at the pivot raised by a lift and stands `d` along `dir` from there,
 * so every camera's line, lifted or not, is over the same ground.
 */
interface GroundLine {
    ground: GroundHeight
    pivot: Vec3
    /** The way back, a metre of it. */
    dir: Vec3
    /** The ground under the line at the march's `k`th point, read as asked. */
    heights: number[]
    /** The ground under the pivot. */
    under: number
    /** The pivot is under the ground (a cave), where the ground says nothing. */
    cave: boolean
}

function groundLine(pivot: Vec3, view: Readonly<OrbitView>, ground: GroundHeight): GroundLine {
    const unit = orbitEye(pivot, view, 1)
    const under = ground(pivot[0], pivot[2])
    return { ground, pivot, dir: [unit[0] - pivot[0], unit[1] - pivot[1], unit[2] - pivot[2]], heights: [], under, cave: pivot[1] < under }
}

const groundPoints: number[] = [0]
/** How far back from the pivot the march's `k`th point is. */
function groundPoint(k: number): number {
    while (groundPoints.length <= k) {
        const s = groundPoints[groundPoints.length - 1]!
        let step = GROUND_STEP
        for (let band = GROUND_NEAR; s >= band; band *= 2) step *= 2
        groundPoints.push(s + step)
    }
    return groundPoints[k]!
}

/** The ground `s` back along the line. */
function groundAt(l: GroundLine, s: number): number {
    return l.ground(l.pivot[0] + l.dir[0] * s, l.pivot[2] + l.dir[2] * s)
}

function heightAt(l: GroundLine, k: number): number {
    return l.heights[k] ??= groundAt(l, groundPoint(k))
}

/** How high the line is `s` back, before any lift. */
const lineY = (l: GroundLine, s: number) => l.pivot[1] + l.dir[1] * s

/**
 * How far the pivot rises for a camera `s` back over ground `under`: enough
 * to bring the camera LIFT_NEAR clearances over it, and at most LIFT_MAX
 * clearances. Nothing in a cave.
 */
function liftAt(l: GroundLine, s: number, under: number, clearance: number): number {
    return l.cave ? 0 : clamp(under + LIFT_NEAR * clearance - lineY(l, s), 0, LIFT_MAX * clearance)
}

/**
 * Whether the line to a camera `distance` back, raised by `lift`, keeps
 * `clearance` over the ground at every point read and at the camera. Where
 * the line comes nearer the ground than `near` at a point read, nearer than
 * at the points either side, the lowest it comes between those two is found
 * by GROUND_REFINES golden sections, so a crest that rises between two points
 * read is still seen.
 */
function lineClear(l: GroundLine, distance: number, lift: number, clearance: number, near: number): boolean {
    if (l.cave) return true
    const margin = (s: number) => lineY(l, s) + lift - groundAt(l, s)
    // The points read: the pivot, the march's points short of the camera, and the camera.
    let last = 0
    while (groundPoint(last + 1) < distance) last++
    const at = (k: number) => (k > last ? distance : groundPoint(k))
    const m: number[] = [lineY(l, 0) + lift - l.under]
    for (let k = 1; k <= last + 1; k++) {
        m[k] = k > last ? margin(distance) : lineY(l, groundPoint(k)) + lift - heightAt(l, k)
        if (m[k]! < clearance) return false
    }
    for (let k = 1; k <= last; k++) {
        if (m[k]! >= near || m[k]! > m[k - 1]! || m[k]! > m[k + 1]!) continue
        // Golden sections for the least margin between the points either side.
        let a = at(k - 1), b = at(k + 1)
        let c = b - GOLDEN * (b - a), d = a + GOLDEN * (b - a), mc = margin(c), md = margin(d)
        for (let r = 2; r < GROUND_REFINES; r++) {
            if (mc < md) { b = d; d = c; md = mc; c = b - GOLDEN * (b - a); mc = margin(c) }
            else { a = c; c = d; mc = md; d = a + GOLDEN * (b - a); md = margin(d) }
        }
        if (Math.min(mc, md) < clearance) return false
    }
    return true
}

/**
 * How far back the ground lets the camera stand: the farthest distance short
 * of `distance` with every camera nearer clear too, each tested from what a
 * camera there would look at. A camera further back stands higher over the
 * ground beyond a crest, so the pivot rises less; tested only from the pivot
 * lifted for the zoom, the camera would come in short of where it may stand
 * and go out again once clear, in and out while the target stands. All of
 * `distance` in a cave.
 */
function limitAlong(l: GroundLine, distance: number, pre: number, clearance: number): number {
    if (l.cave) return distance
    // Whether a camera `s` back, over `under`, is clear, given the most any nearer point needs the line raised by.
    const clearAt = (s: number, under: number, need: number) =>
        Math.max(pre, liftAt(l, s, under, clearance)) >= Math.max(need, under + clearance - lineY(l, s))
    let need = -Infinity, clear = 0
    for (let k = 1; ; k++) {
        const s = Math.min(groundPoint(k), distance)
        const under = s === distance ? groundAt(l, s) : heightAt(l, k)
        if (!clearAt(s, under, need)) {
            let lo = clear, hi = s
            for (let h = 0; h < GROUND_HALVINGS; h++) {
                const mid = (lo + hi) / 2
                if (clearAt(mid, groundAt(l, mid), need)) lo = mid
                else hi = mid
            }
            return lo
        }
        if (s === distance) return distance
        need = Math.max(need, under + clearance - lineY(l, s))
        clear = s
    }
}

/**
 * How far back from `pivot` the ground lets a camera with this view stand,
 * as a follow camera finds it. Exported for tests.
 */
export function groundLimit(pivot: Vec3, view: Readonly<OrbitView>, distance: number, ground: GroundHeight, clearance: number): number {
    if (!(distance > 0)) return distance
    const l = groundLine(pivot, view, ground)
    return limitAlong(l, distance, liftAt(l, distance, groundAt(l, distance), clearance), clearance)
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
    /**
     * Which frame it is, counted by the runtime. With it, a follow camera read
     * in a useFrame takes this frame's drag then, from this same source;
     * without, only its late frame reads the drag.
     */
    readonly frame?: number
}

/** Each wheel step multiplies an orbit's distance by this. */
const WHEEL_STEP = 1.1
/** Wheel steps a notch: a host's wheel arrives as lines or as pixels, and a notch is at most three lines either way. */
const STEPS_A_NOTCH = 3
/**
 * A follow camera's drag turns nothing until it has moved this many stage
 * units, or this share of the bound View's short side if that is more
 * (feel.md §2, WoWee's click and drag test).
 */
const DEAD_ZONE = 5
const DEAD_ZONE_SHARE = 0.008
/** Degrees a stage pixel of drag turns, unless a hook is told otherwise. */
export const DEGREES_PER_PIXEL = 0.3

const sameVec = (a: Readonly<Vec3> | null, b: Readonly<Vec3>) => a !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/** The drag, the wheel and the camera write both controllers share. */
class Rig {
    readonly tracker = newDragTracker()
    readonly drag = newDragFrame()
    /** Wheel steps since the last frame: positive is away from the player, zooming out. */
    private _wheel = 0
    /** The bound View's short side as of the last press, for the dead zone; 0 with no View bound. */
    private _short = 0
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
        this._short = 0
        if (el == null) return true
        const r = el.worldBound
        if (r == null) return true
        this._short = Math.min(r.width, r.height)
        return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
    }

    /**
     * This frame's drag. An orbit's wheel multiplies its distance at once; a
     * follow camera's comes as notches, and its drag waits out a dead zone.
     */
    read(f: CameraFrame, follow: boolean = false): DragFrame {
        const zone = follow ? Math.max(DEAD_ZONE, DEAD_ZONE_SHARE * this._short) : 0
        const drag = readDrag(this.tracker, f.source, this._inside, f.claimed, this.drag, zone)
        if (this._wheel !== 0) {
            if (follow) drag.notches = this._wheel / STEPS_A_NOTCH
            else drag.zoom *= Math.pow(WHEEL_STEP, this._wheel)
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

/** The steepest a camera looks: at 90 the look is along the up axis, and Unity picks a roll of its own. */
const MAX_PITCH = 89

const limitsOf = (o: { pitchRange?: readonly [number, number], distanceRange?: readonly [number, number] }, d: OrbitLimits): OrbitLimits => {
    const p = o.pitchRange ?? d.pitchRange
    return {
        pitchRange: p[0] < -MAX_PITCH || p[1] > MAX_PITCH ? [Math.max(-MAX_PITCH, p[0]), Math.min(MAX_PITCH, p[1])] : p,
        distanceRange: o.distanceRange ?? d.distanceRange,
    }
}

/**
 * `yaw`, `pitch` and `distance` on the object a hook returns, defined on
 * `rest` beside its own fields: a write is held to the ranges as of the last
 * frame, one that is not a finite number is ignored, and `wrote` is told
 * which field took one. `touch` runs before each read and write.
 */
function viewFields<T extends object>(
    s: OrbitView, range: { limits: OrbitLimits }, wrote: (field: keyof OrbitView) => void, rest: T, touch: () => void = () => {},
): T & OrbitView {
    const field = (name: keyof OrbitView, held: (v: number) => number): PropertyDescriptor => ({
        enumerable: true,
        get: () => {
            touch()
            return s[name]
        },
        set: (v: number) => {
            touch()
            if (!Number.isFinite(v)) return
            s[name] = held(v)
            wrote(name)
        },
    })
    return Object.defineProperties(rest, {
        yaw: field("yaw", wrapDegrees),
        pitch: field("pitch", (v) => clamp(v, range.limits.pitchRange[0], range.limits.pitchRange[1])),
        distance: field("distance", (v) => clamp(v, range.limits.distanceRange[0], range.limits.distanceRange[1])),
    }) as T & OrbitView
}

export interface OrbitOptions {
    /** The point it turns around. The origin by default. */
    target?: Readonly<Vec3>
    /** Metres from the target to start at, read once: write `orbit.distance` to change it later. 6 by default. */
    distance?: number
    /** Degrees to start at, read once: write `orbit.yaw` later. 0, looking along +z, by default. */
    yaw?: number
    /** Degrees to start at, read once: write `orbit.pitch` later. 20, a little above, by default. */
    pitch?: number
    /** Degrees. [-80, 80] by default, and never past 89 either way. */
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
        const range = this._range = { limits: limitsOf(o, ORBIT_LIMITS) }
        const { pitchRange: pr, distanceRange: dr } = range.limits
        const view = { yaw: wrapDegrees(startOf(o.yaw, 0)), pitch: clamp(startOf(o.pitch, 20), pr[0], pr[1]), distance: clamp(startOf(o.distance, 6), dr[0], dr[1]) }
        const target: Vec3 = o.target ? [o.target[0], o.target[1], o.target[2]] : [0, 0, 0]
        this._s = { ...view, target, eye: orbitEye(target, view), touched: false, written: false }
        const s = this._s
        this.orbit = viewFields(s, range, () => { s.written = true }, {
            get eye() { return s.eye },
            get target() { return s.target },
            bind: this._rig.bind,
        })
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
    /** Degrees. [-80, 80] by default, and never past 89 either way. */
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
     * Metres kept between the camera and anything in its way, the whole way
     * back from what it looks at: a sphere this size is swept through the
     * world, and the ground is kept this far below the camera. 0.4 by
     * default; a smaller one lets the camera closer to walls and slopes.
     */
    clearance?: number
    /**
     * The ground's height at any x and z, for a world whose colliders are
     * only near the player, as a streamed terrain's are. The camera keeps
     * `clearance` above it all the way back, lifts what it looks at when it
     * comes close over it, and never goes under it. None by default.
     */
    ground?: GroundHeight | null
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
 * turns the camera a quarter. Read or written in a useFrame, the camera has
 * already turned by this frame's drag, so `heading` is never a frame behind.
 */
export interface FollowCamera extends OrbitView {
    /** Which way the character should face: the camera's yaw while a right drag is held, the target's own yaw otherwise. */
    readonly heading: number
    /** Both buttons are held: the cart walks forward. */
    readonly forward: boolean
    /** Where the camera stands, in front of any wall. */
    readonly eye: Vec3
    /** What it looks at: `height` above the target, raised where the camera comes close over the `ground`. */
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
    /** The source the last frame read, and its options, for a read early in the next one. */
    private _f: CameraFrame | null = null
    private _o: FollowOptions = {}
    /** The frame whose drag has turned the view. */
    private _looked = NaN
    /** Last frame had a target: with none, the view holds and a drag turns nothing. */
    private _following = false
    readonly camera: FollowCamera

    constructor(target: FollowTarget | null | undefined, o: FollowOptions = {}) {
        const range = this._range = { limits: limitsOf(o, FOLLOW_LIMITS) }
        const { pitchRange: pr, distanceRange: dr } = range.limits
        // With no target yet (a model still loading), the first one given sets the yaw, as one here would.
        const s = this._state = newFollowState({
            yaw: wrapDegrees(startOf(target?.yaw, 0)), pitch: clamp(startOf(o.pitch, 15), pr[0], pr[1]), distance: clamp(startOf(o.distance, 5), dr[0], dr[1]),
        }, target != null)
        // A read in the frame phase, of a camera that followed something last frame, takes this frame's drag now.
        const early = () => {
            const f = this._f
            if (f !== null && f.frame !== undefined && this._following) this._look(f, this._o)
        }
        this.camera = viewFields(s, range, (field) => {
            if (field === "yaw") s.aimed = true
            // Taken this frame rather than backed out to.
            if (field === "distance") s.snapReach = true
        }, {
            get heading() {
                early()
                return s.heading
            },
            get forward() {
                early()
                return s.forward
            },
            get eye() { return s.eye },
            get target() { return s.look },
            bind: this._rig.bind,
        }, early)
    }

    /** This frame's drag, once: turns the view and sets heading and forward. */
    private _look(f: CameraFrame, o: FollowOptions): DragFrame {
        if (f.frame !== undefined && f.frame === this._looked) return this._rig.drag
        this._looked = f.frame ?? NaN
        const drag = this._rig.read(f, true)
        followLook(this._state, drag, { limits: this._range.limits, degreesPerPixel: o.degreesPerPixel ?? DEGREES_PER_PIXEL })
        return drag
    }

    /** One late frame. Null as the target holds the camera where it is. */
    frame(dt: number, target: FollowTarget | null | undefined, o: FollowOptions, f: CameraFrame): void {
        const s = this._state
        this._f = f
        this._o = o
        this._following = target != null
        if (target == null) {
            // The drag is spent, and the view held: nothing to look round.
            if (f.frame === undefined || f.frame !== this._looked) this._rig.read(f, true)
            this._looked = f.frame ?? NaN
            s.forward = false
            return
        }
        this._range.limits = limitsOf(o, FOLLOW_LIMITS)
        const drag = this._look(f, o)
        followOn(s, drag, target, dt, {
            limits: this._range.limits,
            degreesPerPixel: o.degreesPerPixel ?? DEGREES_PER_PIXEL,
            height: o.height ?? 1,
            behind: o.behind ?? false,
            turnWith: o.turnWith === true,
            world: o.world ?? null,
            filter: o.filter,
            clearance: o.clearance,
            ground: o.ground ?? null,
        })
        this._rig.write(o.camera, s.eye, s.look)
    }
}

/** A camera hook's effect: the late phase of this runtime's frames, or nothing (said) without one. Exported for tests. */
export function subscribeCamera(hook: string, run: (dt: number, f: CameraFrame) => void): (() => void) | undefined {
    const runtime = getCurrentRuntime()
    if (runtime === null) {
        console.warn(`[oj] ${hook}: no frame clock here, so the camera will not move.`)
        return undefined
    }
    const f: CameraFrame = { source: input, claimed: heldByControl, get frame() { return runtime.time.frame } }
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
