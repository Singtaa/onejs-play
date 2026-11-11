/**
 * The `oj` object a game receives.
 *
 * A game bundle never imports oj: the container preloads it and marks it
 * external, so `import { View } from "oj"` compiles to a property read off this
 * object. That is what lets sandbox.ts shadow the runtime's globals, since the
 * reconciler lives out here rather than inside the game's bundle.
 *
 * So this object has to carry everything index.ts exports, plus the four things
 * only the host knows: the root element, the current stage, the frame clock,
 * and the runtime version.
 *
 *     const runtime = createRuntime({ root: __root, version: "1.0.0", viewport })
 *     evaluateBundle(code, { oj: runtime.oj })
 *     // each frame: runtime.beginFrame(dt)
 *     // on resize:  runtime.setViewport(w, h, devicePixelRatio)
 *
 * A frame runs in three phases, each in registration order: the frame
 * (`onFrame`, which is `useFrame`), the step (`onStep`, worlds only), then
 * late (`onLateFrame`, cameras and anything placed from a drawn pose). After
 * them the frame ends (`onFrameEnd`), where a scene sends its actors' moves. The
 * order is the phase's, never when a callback was added, so a camera reads
 * the pose this frame's step drew whether it mounted before the world loaded
 * or after.
 */

import type * as api from "./index"
import { stageOf, type Stage } from "./stage"
import { createContainerInput, type ContainerInput } from "./input"
import { setPressCheck } from "./share"
import { createPressProbe } from "./over-ui"
import { setAssetBase } from "./asset"
import { setPlayContext, type PlayContext } from "./play"
import { setInputBackend } from "onejs-unity/input"
import { setFrameClock } from "onejs-react"

/** The frame clock, reused rather than reallocated each frame. */
export interface TimeState {
    /** Seconds since the runtime started. */
    now: number
    /**
     * Seconds since the previous frame, as the game advances by: the host
     * clamps it at 100 ms, so the first frame after a stall or a hidden tab
     * does not move everything ten seconds at once.
     */
    dt: number
    /** Seconds since the previous frame as they really passed, never clamped. */
    realDt: number
    /** Frames elapsed. */
    frame: number
}

type Api = typeof api

/** What each phase's callbacks receive: the clamped seconds, then the real ones. */
type FrameCallback = (dt: number, realDt: number) => void

/**
 * What every host provides: the clock, the stage, and the root to render into.
 *
 * Separate from OjRuntime because only a host that EVALUATES a bundle has to
 * carry the package on this object. mount() in an ordinary project imports oj
 * directly, so making it carry the surface too made the whole package
 * reachable from a file that draws a box: 103 KB on a hello world.
 */
export interface HostRuntime {
    readonly version: string
    /** The root VisualElement a game renders into. */
    readonly root: unknown
    /** The window, in logical pixels. Replaced when the viewport changes. */
    readonly stage: Stage
    /** The frame clock. Reused: read it, do not retain it. */
    readonly time: Readonly<TimeState>
    /**
     * Runs a callback every frame, returning an unsubscribe.
     *
     * A callback that throws is removed rather than left to throw once per
     * frame forever, and the error is reported once.
     */
    onFrame(callback: FrameCallback): () => void
    /**
     * Runs a callback every frame after every `onFrame` callback, returning an
     * unsubscribe. For worlds: what a frame callback set (a velocity, a
     * drive) moves the body on this frame's step. Not on oj's declarations; a
     * cart's code runs in the frame or late. Errors as `onFrame`'s, so one
     * world that throws costs neither another world nor late.
     */
    onStep(callback: FrameCallback): () => void
    /**
     * Runs a callback every frame after every world has stepped and placed its
     * actors, returning an unsubscribe: Unity's LateUpdate. A camera that
     * follows a body goes here, and reads its actor, which is what is drawn.
     * Not on oj's declarations. Errors as `onFrame`'s.
     */
    onLateFrame(callback: FrameCallback): () => void
    /**
     * Runs a callback every frame after every late callback, returning an
     * unsubscribe: where a scene sends what the frame moved in one crossing.
     * Not on oj's declarations. Errors as `onFrame`'s.
     */
    onFrameEnd(callback: FrameCallback): () => void
    /**
     * Whether the frame, the step or late is running now. False in the end
     * phase and between frames (an event handler, a timer, a paused or held
     * clock), where nothing later is promised to send what was kept.
     */
    readonly inFrame: boolean
    /**
     * The cart's first screen has committed (mount calls it): where the host
     * compiles programs off the frame, the clock holds from here until they
     * have drawn once or FIRST_DRAW_CAP seconds pass, so a program's first
     * draw and the cart's first frame are one frame. Once per runtime; later
     * calls, and programs mounted later, hold nothing. Not on oj's declarations.
     */
    armFirstDraw(): void
    /** True while the clock holds for the first screen's programs. */
    readonly holding: boolean
    /** Calls back when a hold ends, returning an unsubscribe. */
    onHoldChange(callback: () => void): () => void
}

/** The longest the first screen's programs hold the clock, in seconds (Tachi: keep the 2 s cap). */
export const FIRST_DRAW_CAP = 2

/**
 * A host runtime that also carries the whole oj surface.
 *
 * This is what a container hands to a game it evaluated: the bundle's imports
 * resolve against this object, so every export has to be on it. Produced only
 * when createRuntime is given `api`.
 */
export interface OjRuntime extends HostRuntime, Api {}

export interface RuntimeOptions {
    /**
     * The whole oj surface, for a host that evaluates a bundle against it.
     *
     * Passed in rather than imported here. Importing the barrel made it
     * reachable from mount(), so an ordinary project carried physics and
     * particles whether it touched them or not. A container needs it and
     * already imports it; nothing else does.
     */
    api?: Record<string, unknown>
    /** The root VisualElement. */
    root: unknown
    /** The pinned runtime version, as resolved from the manifest. */
    version: string
    /** Initial viewport in CSS pixels, and the screen pixels per CSS pixel (1 when left out). */
    viewport?: { width: number; height: number; pixelRatio?: number }
    /**
     * Where this game's own files are served from, without a trailing slash.
     *
     * The container passes its origin plus "/assets". Left out, assetUrl falls
     * back to OneJS's project convention, which is exactly what an ejected copy
     * of the same game needs.
     */
    assetBase?: string
    /**
     * The site behind the game: where its API lives and what proves this is a
     * real play session. Absent outside a container, which is what makes
     * leaderboards and rooms report themselves unavailable rather than fail.
     */
    play?: PlayContext
    /**
     * Where input comes from.
     *
     * "container" installs the browser-fed backend, which is right when
     * something is pushing DOM events into it and useless when nothing is.
     * "host" leaves the real InputBridge in place, which is what a game running
     * in an ordinary Unity project needs; standalone.ts then wraps it so the
     * coordinates are stage pixels rather than Unity screen space.
     *
     * Defaulting to "container" keeps the container's call unchanged. It was
     * also the bug: startStandalone calls createRuntime, so an ejected game got
     * a backend with nothing feeding it and read no input at all.
     */
    inputSource?: "container" | "host"
    /**
     * How many of the page's programs are still compiling (OneJS's
     * `SLProgramBridge.PendingCompiles`). Given, the clock holds behind the
     * cart's first screen until it reads 0 (see `armFirstDraw`), asked once a
     * frame only while it holds. Left out (natively, where a program compiles
     * as it is made), nothing holds.
     */
    pendingCompiles?: () => number
}

/** What the container holds. Games only ever see `oj`. */
export interface ContainerRuntime {
    /** Inject this as the bundle's `oj` external. */
    readonly oj: OjRuntime
    /** The input the adapter pushes browser events into. */
    readonly input: ContainerInput
    /**
     * Advance one frame. Drives the clock, input edges and frame callbacks.
     * `dtSeconds` is clamped by the host; `realSeconds` is the time that
     * really passed, and is `dtSeconds` when left out.
     */
    beginFrame(dtSeconds: number, realSeconds?: number): void
    /**
     * Replace the stage with a newly measured viewport. `pixelRatio` left out
     * keeps the stage's own, so a host that never knew one is not reset to 1.
     */
    setViewport(width: number, height: number, pixelRatio?: number): void
    /**
     * Renders the mounted cart again, its state kept: what a host calls after
     * swapping something a render reads, such as a live `.sl` program (the
     * Play editor's preview). Nothing before a mount or after dispose.
     */
    rerender(): void
    /** Detach from the input module and drop frame, step and late callbacks. */
    dispose(): void
}

/**
 * The runtime the useFrame hook reads.
 *
 * A hook cannot take the runtime as an argument and still read like a hook, and
 * the game's bundle has no way to reach the container's instance, so the
 * current runtime is module state. Same seam shape as the input backend.
 */
let current: HostRuntime | null = null

/**
 * How mount() renders its cart again; see ContainerRuntime.rerender. Module
 * state for the reason `current` is: mount() is called by the game's bundle,
 * which cannot reach the container's object.
 */
let remount: (() => void) | null = null

/** Called by mount() with how to render the cart again. */
export function setRemount(next: (() => void) | null): void {
    remount = next
}

/** The running runtime, or null outside a container. */
export function getCurrentRuntime(): HostRuntime | null {
    return current
}

export function createRuntime(options: RuntimeOptions): ContainerRuntime {
    const input = createContainerInput({ overUI: createPressProbe(options.root) })
    if (options.inputSource !== "host") setInputBackend(input.backend)
    // A browser's rule for share() and copy(), so only where the browser feeds input.
    setPressCheck(options.inputSource !== "host" ? () => input.activated() : null)
    setAssetBase(options.assetBase ?? null)
    setPlayContext(options.play ?? null)

    const time: TimeState = { now: 0, dt: 0, realDt: 0, frame: 0 }

    // The first screen's hold: "idle" until the cart's first commit arms it,
    // "holding" until its programs have drawn or the cap passes, then "done".
    let hold: "idle" | "holding" | "done" = options.pendingCompiles ? "idle" : "done"
    let heldFor = 0
    const holdListeners = new Set<() => void>()
    const endHold = () => {
        hold = "done"
        for (const listener of [...holdListeners]) listener()
        holdListeners.clear()
    }
    // A host's count that cannot be read (an older OneJS) is no reason to wait.
    const pending = (): number => {
        try {
            const n = Number(options.pendingCompiles!())
            return Number.isFinite(n) ? n : 0
        } catch {
            return 0
        }
    }
    let stage = stageOf(options.viewport?.width ?? 0, options.viewport?.height ?? 0, options.viewport?.pixelRatio)

    // The three phases, in the order beginFrame runs them.
    const callbacks = new Set<FrameCallback>()
    const steps = new Set<FrameCallback>()
    const lates = new Set<FrameCallback>()
    const ends = new Set<FrameCallback>()
    let inFrame = false
    /**
     * Each frame callback's errors said so far. A callback that throws keeps
     * running, and each distinct error is said once: one bad line used to
     * remove the callback for good, so a cart whose ref style named a
     * property UI Toolkit lacks stopped its whole loop on the first frame
     * (learn Mac, engine-findings.md), and a ref read while its element
     * unmounted would do the same for one unlucky frame.
     */
    const said = new WeakMap<object, Set<string>>()
    function reportFrameError(callback: object, error: unknown, what: string): void {
        const seen = said.get(callback) ?? new Set<string>()
        said.set(callback, seen)
        const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        if (seen.has(key)) return
        seen.add(key)
        console.error(`[oj] ${what} threw; it keeps running, and this error is said once:`, error)
    }
    // A copy, so a callback that unsubscribes itself or adds another mid-phase
    // does not change who runs this phase.
    function runPhase(phase: Set<FrameCallback>, dt: number, realDt: number, what: string): void {
        if (phase.size === 0) return
        for (const callback of [...phase]) {
            try {
                callback(dt, realDt)
            } catch (error) {
                reportFrameError(callback, error, what)
            }
        }
    }

    const oj: HostRuntime = {
        ...(options.api ?? {}),
        version: options.version,
        root: options.root,
        get stage() {
            return stage
        },
        get time() {
            return time
        },
        onFrame(callback) {
            callbacks.add(callback)
            return () => callbacks.delete(callback)
        },
        onStep(callback) {
            steps.add(callback)
            return () => steps.delete(callback)
        },
        onLateFrame(callback) {
            lates.add(callback)
            return () => lates.delete(callback)
        },
        onFrameEnd(callback) {
            ends.add(callback)
            return () => ends.delete(callback)
        },
        get inFrame() {
            return inFrame
        },
        armFirstDraw() {
            if (hold === "idle") hold = "holding"
        },
        get holding() {
            return hold === "holding"
        },
        onHoldChange(callback) {
            if (hold === "done") return () => {}
            holdListeners.add(callback)
            return () => holdListeners.delete(callback)
        },
    }
    current = oj
    // onejs-react's useFrame runs on this runtime's frames, so it pauses with
    // the container and sees each frame's input edges.
    setFrameClock((callback) => oj.onFrame(callback))

    return {
        // Only a caller that passed `api` gets the whole surface on this
        // object; everything else gets HostRuntime, which is all mount,
        // useFrame and useStage read.
        oj: oj as OjRuntime,
        input,

        beginFrame(dtSeconds: number, realSeconds: number = dtSeconds) {
            if (hold === "holding") {
                heldFor += realSeconds
                if (pending() > 0 && heldFor < FIRST_DRAW_CAP) return
                endHold()
                // The first frame is a normal one, not the time held.
                dtSeconds = realSeconds = 1 / 60
            }
            time.dt = dtSeconds
            time.realDt = realSeconds
            time.now += dtSeconds
            time.frame++
            input.beginFrame()
            inFrame = true
            runPhase(callbacks, dtSeconds, realSeconds, "a frame callback")
            runPhase(steps, dtSeconds, realSeconds, "a world's step")
            runPhase(lates, dtSeconds, realSeconds, "a late frame callback")
            inFrame = false
            runPhase(ends, dtSeconds, realSeconds, "a frame's end")
        },

        setViewport(width: number, height: number, pixelRatio: number = stage.pixelRatio) {
            stage = stageOf(width, height, pixelRatio)
        },

        rerender() {
            remount?.()
        },
        dispose() {
            remount = null
            holdListeners.clear()
            callbacks.clear()
            steps.clear()
            lates.clear()
            ends.clear()
            setInputBackend(null)
            setPressCheck(null)
            setAssetBase(null)
            setPlayContext(null)
            if (current === oj) {
                current = null
                setFrameClock(null)
            }
        },
    }
}
