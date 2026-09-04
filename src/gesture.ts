/**
 * Gestures, read off `input` once per frame.
 *
 * A swipe is the same forty lines in every game that has one: remember where
 * the finger went down, wait until it has travelled far enough, fire once,
 * ignore the rest of the gesture, arm again on the next finger. Twos Company
 * shipped with exactly that state machine and its own finger bookkeeping, and
 * the next puzzle game would have copied both. So it lives here.
 *
 * Built on `input` rather than on React's pointer events, for the same reason
 * the input guide gives: `input` reports stage units and sees touch and mouse
 * through one API, so a swipe works with a finger on a phone and with a mouse
 * drag on a desktop without the game knowing which it got.
 */

import { useRef } from "react"
import { input, type Mouse, type Touch } from "onejs-unity/input"
import { useFrame } from "./frame"

export type SwipeDirection = "left" | "right" | "up" | "down"

/** How far a pointer has to travel, in stage units, before it counts. */
export const SWIPE_THRESHOLD = 28

export interface SwipeOptions {
    /** Distance in stage units that turns a drag into a swipe. Default 28. */
    threshold?: number
}

/** The per-gesture state. Exported for tests; a game uses `useSwipe`. */
export interface SwipeTracker {
    from: { x: number; y: number } | null
    /** Set once this gesture has fired, so it cannot fire twice. */
    spent: boolean
    /** Which finger is driving, so a second one cannot fight it. */
    finger: number | null
    /** What began the gesture. A touch also shows up as the mouse in the container, so only one is listened to at a time. */
    source: "touch" | "mouse" | null
}

export function newSwipeTracker(): SwipeTracker {
    return { from: null, spent: false, finger: null, source: null }
}

function begin(state: SwipeTracker, x: number, y: number): void {
    state.from = { x, y }
    state.spent = false
}

function end(state: SwipeTracker): void {
    state.from = null
    state.spent = false
    state.finger = null
    state.source = null
}

/** Returns a direction the first time this gesture passes the threshold, null otherwise. */
export function moveTo(state: SwipeTracker, x: number, y: number, threshold: number): SwipeDirection | null {
    if (state.from === null || state.spent) return null

    const dx = x - state.from.x
    const dy = y - state.from.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    // Measured by the longer side rather than the length, so a small diagonal
    // wobble does not count and a clear move on one axis does.
    if (Math.max(ax, ay) < threshold) return null

    state.spent = true
    // Stage coordinates count downward, so a positive dy is a swipe down.
    if (ax > ay) return dx > 0 ? "right" : "left"
    return dy > 0 ? "down" : "up"
}

/** The slice of `input` a swipe reads, so a test can hand in a plain object. */
export interface SwipeSource {
    touches: readonly Pick<Touch, "fingerId" | "position" | "phase">[]
    mouse: Pick<Mouse, "position" | "leftButton" | "wasLeftPressed" | "wasLeftReleased">
}

/**
 * One frame of the gesture. Touches are read first, and while a finger is
 * down the mouse is ignored: in the container a touch is reported as the mouse
 * too, and listening to both would fire every swipe twice.
 */
export function readSwipe(state: SwipeTracker, source: SwipeSource, threshold: number): SwipeDirection | null {
    if (state.source !== "mouse") {
        for (const touch of source.touches) {
            if (state.finger === null && touch.phase === "began") {
                state.finger = touch.fingerId
                state.source = "touch"
                begin(state, touch.position.x, touch.position.y)
                continue
            }
            if (touch.fingerId !== state.finger) continue

            if (touch.phase === "ended" || touch.phase === "canceled") {
                end(state)
                continue
            }
            const direction = moveTo(state, touch.position.x, touch.position.y, threshold)
            if (direction !== null) return direction
        }
    }

    if (state.source === "touch") return null

    const m = source.mouse
    if (state.source === null) {
        if (!m.wasLeftPressed) return null
        state.source = "mouse"
        begin(state, m.position.x, m.position.y)
        return null
    }
    if (m.wasLeftReleased || !m.leftButton) {
        end(state)
        return null
    }
    return moveTo(state, m.position.x, m.position.y, threshold)
}

/**
 * Calls `onSwipe` with a direction each time the player swipes, by finger or
 * by mouse drag, for as long as the component is mounted.
 *
 *     useSwipe((direction) => push(direction))
 *
 * The callback is the latest one rendered, so it can read state directly.
 */
export function useSwipe(onSwipe: (direction: SwipeDirection) => void, options: SwipeOptions = {}): void {
    const threshold = options.threshold ?? SWIPE_THRESHOLD
    // One tracker per hook call, kept across renders so a gesture in progress
    // keeps its origin when the component re-renders mid-swipe.
    const tracker = useRef<SwipeTracker | null>(null)
    if (tracker.current === null) tracker.current = newSwipeTracker()

    useFrame(() => {
        const direction = readSwipe(tracker.current!, input, threshold)
        if (direction !== null) onSwipe(direction)
    }, [threshold])
}
