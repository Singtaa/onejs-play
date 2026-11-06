/**
 * Thumb controls for phones: sticks that appear under a thumb, and pads that
 * stay put.
 *
 *     const move = useStick("left")
 *     const aim = useStick("right")
 *     const jump = usePad({ x: width - 70, y: height - 160, radius: 34 })
 *
 *     useFrame(() => {
 *         walk(move.x, move.y)
 *         if (jump.pressed) leap()
 *     })
 *
 *     return <>
 *         <Stick stick={move} />
 *         <Stick stick={aim} />
 *         <Pad pad={jump} label="Jump" />
 *     </>
 *
 * A stick takes the first thumb that comes down on its half of the stage and
 * keeps it until it lifts, wherever it wanders; drag to push it. A pad is a
 * circle that is down while a finger is on it. Both read `input.touches`, so
 * the frame loop that reads the keyboard reads them, and a mouse never moves
 * one. A thumb that lands on a pad belongs to the pad, never to the stick
 * whose half it is in.
 *
 * The objects are live and read in a frame loop: nothing re-renders as a
 * thumb moves. `<Stick>` and `<Pad>` draw them, positioned absolutely in
 * stage pixels, so put them at the top of the cart's tree. Both work after an
 * eject, since `input.touches` is OneJS's own.
 *
 * Gunyard (examples/gunyard) is what these were first written for.
 */

import { useEffect, useRef } from "react"
import { input, type Touch } from "onejs-unity/input"
import { useFrame, View, Text, type VisualElement } from "onejs-react"
import { useStage } from "./mount"

export interface StickState {
    /** -1 at the left to 1 at the right. */
    x: number
    /** -1 at the top to 1 at the bottom, as the stage counts. */
    y: number
    /** Whether a thumb is on it. */
    active: boolean
    /** Where the stick's centre is, in stage pixels: under the thumb while active. */
    originX: number
    originY: number
    /** How far the stick travels, in stage pixels. */
    readonly radius: number
    /** The finger driving it, or -1. */
    finger: number
}

export interface PadState {
    /** Whether a finger is on it. */
    down: boolean
    /** True on the one frame it went down. */
    pressed: boolean
    /** True on the one frame it came up. */
    released: boolean
    x: number
    y: number
    radius: number
    finger: number
}

/** The slice of a touch the controls read, so a test can hand in plain objects. */
export type TouchPoint = Pick<Touch, "fingerId" | "position" | "phase">

/** Every pad mounted now, so a stick can leave a thumb that landed on one. */
const pads = new Set<PadState>()

function onPad(x: number, y: number): boolean {
    for (const p of pads) if ((x - p.x) ** 2 + (y - p.y) ** 2 <= p.radius * p.radius) return true
    return false
}

const ended = (t: TouchPoint) => t.phase === "ended" || t.phase === "canceled"

export function newStick(radius: number, restX = 0, restY = 0): StickState {
    return { x: 0, y: 0, active: false, originX: restX, originY: restY, radius, finger: -1 }
}

/**
 * One frame of a stick. `owns` says whether a thumb coming down at a point
 * is this stick's to take.
 */
export function readStick(s: StickState, touches: readonly TouchPoint[], owns: (x: number, y: number) => boolean): void {
    const mine = s.active ? touches.find((t) => t.fingerId === s.finger) : undefined
    if (s.active && (mine === undefined || ended(mine))) {
        s.active = false
        s.finger = -1
        s.x = 0
        s.y = 0
    }
    if (!s.active) {
        const t = touches.find((t) => t.phase === "began" && owns(t.position.x, t.position.y) && !onPad(t.position.x, t.position.y))
        if (t === undefined) return
        s.active = true
        s.finger = t.fingerId
        s.originX = t.position.x
        s.originY = t.position.y
        s.x = 0
        s.y = 0
        return
    }
    let dx = mine!.position.x - s.originX
    let dy = mine!.position.y - s.originY
    const d = Math.hypot(dx, dy)
    if (d > s.radius) {
        // The centre follows a thumb that runs past the edge, so pulling back answers at once.
        s.originX += (dx / d) * (d - s.radius)
        s.originY += (dy / d) * (d - s.radius)
        dx = (dx / d) * s.radius
        dy = (dy / d) * s.radius
    }
    s.x = dx / s.radius
    s.y = dy / s.radius
}

/** One frame of a pad. */
export function readPad(p: PadState, touches: readonly TouchPoint[]): void {
    const was = p.down
    const mine = p.finger >= 0 ? touches.find((t) => t.fingerId === p.finger) : undefined
    if (p.finger >= 0 && (mine === undefined || ended(mine))) p.finger = -1
    if (p.finger < 0) {
        const t = touches.find((t) => t.phase === "began" && (t.position.x - p.x) ** 2 + (t.position.y - p.y) ** 2 <= p.radius * p.radius)
        if (t !== undefined) p.finger = t.fingerId
    }
    p.down = p.finger >= 0
    p.pressed = p.down && !was
    p.released = !p.down && was
}

export interface StickOptions {
    /** How far it travels, in stage pixels. 56 by default. */
    radius?: number
}

/**
 * A stick on one half of the stage, or anywhere a test you give says. Where
 * it rests when no thumb is on it is near that half's bottom corner.
 */
export function useStick(side: "left" | "right" | ((x: number, y: number) => boolean), options: StickOptions = {}): StickState {
    const stage = useStage()
    const radius = options.radius ?? 56
    const restX = side === "right" ? stage.width - radius * 1.6 : radius * 1.6
    const restY = stage.height - radius * 1.6
    const state = useRef<StickState | null>(null)
    if (state.current === null) state.current = newStick(radius, restX, restY)
    const s = state.current
    useFrame(() => {
        const owns = typeof side === "function" ? side : side === "left" ? (x: number) => x < stage.width / 2 : (x: number) => x >= stage.width / 2
        readStick(s, input.touches, owns)
        if (!s.active) {
            s.originX = restX
            s.originY = restY
        }
    })
    return s
}

/** A round button for a thumb, at a place on the stage. */
export function usePad(at: { x: number, y: number, radius?: number }): PadState {
    const state = useRef<PadState | null>(null)
    if (state.current === null) state.current = { down: false, pressed: false, released: false, x: at.x, y: at.y, radius: at.radius ?? 36, finger: -1 }
    const p = state.current
    p.x = at.x
    p.y = at.y
    p.radius = at.radius ?? 36
    pads.add(p)
    useFrame(() => {
        pads.add(p)
        readPad(p, input.touches)
    })
    // A pad that unmounts stops claiming thumbs.
    useEffect(() => () => { pads.delete(p) }, [p])
    return p
}

/** Draws a stick: its ring and knob under the thumb, faint where it rests. */
export function Stick({ stick, color = "#ffffff" }: { stick: StickState, color?: string }) {
    const base = useRef<VisualElement>(null)
    const knob = useRef<VisualElement>(null)
    const r = stick.radius
    useFrame(() => {
        if (base.current) {
            base.current.style.left = stick.originX - r
            base.current.style.top = stick.originY - r
            base.current.style.opacity = stick.active ? 0.9 : 0.35
        }
        if (knob.current) {
            knob.current.style.left = stick.originX + stick.x * r - r * 0.45
            knob.current.style.top = stick.originY + stick.y * r - r * 0.45
            knob.current.style.opacity = stick.active ? 1 : 0.35
        }
    })
    return (
        <>
            <View ref={base} pickingMode="Ignore" style={{ position: "absolute", width: r * 2, height: r * 2, borderRadius: r, borderWidth: 2, borderColor: color, backgroundColor: "rgba(0, 0, 0, 0.18)" }} />
            <View ref={knob} pickingMode="Ignore" style={{ position: "absolute", width: r * 0.9, height: r * 0.9, borderRadius: r * 0.45, backgroundColor: color }} />
        </>
    )
}

/** Draws a pad, brighter while it is down. */
export function Pad({ pad, label, color = "#ffffff" }: { pad: PadState, label?: string, color?: string }) {
    const el = useRef<VisualElement>(null)
    const r = pad.radius
    useFrame(() => {
        if (!el.current) return
        el.current.style.left = pad.x - r
        el.current.style.top = pad.y - r
        el.current.style.opacity = pad.down ? 1 : 0.55
    })
    return (
        <View ref={el} pickingMode="Ignore" style={{ position: "absolute", width: r * 2, height: r * 2, borderRadius: r, borderWidth: 2, borderColor: color, backgroundColor: "rgba(0, 0, 0, 0.25)", alignItems: "center", justifyContent: "center" }}>
            {label === undefined ? null : <Text style={{ color, fontSize: Math.max(10, r * 0.4), unityFontStyleAndWeight: "bold" }}>{label}</Text>}
        </View>
    )
}
