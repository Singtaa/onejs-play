/**
 * The `oj` object a game receives.
 *
 * A game bundle never imports oj: the container preloads it and marks it
 * external, so `import { View } from "oj"` compiles to a property read off this
 * object. That is what lets sandbox.ts shadow the runtime's globals, since the
 * reconciler lives out here rather than inside the game's bundle.
 *
 * So this object has to carry everything index.ts exports, plus the four things
 * only the host knows: the root element, the current stage layout, the frame
 * clock, and the runtime version.
 *
 *     const runtime = createRuntime({ root: __root, version: "1.0.0", stage })
 *     evaluateBundle(code, { oj: runtime.oj })
 *     // each frame: runtime.beginFrame(dt)
 *     // on resize:  runtime.setViewport(w, h)
 */

import * as api from "./index"
import { computeStageLayout, type StageConfig, type StageLayout } from "./stage"
import { createContainerInput, type ContainerInput } from "./input"
import { setInputBackend } from "onejs-unity/input"

/** The frame clock, reused rather than reallocated each frame. */
export interface TimeState {
    /** Seconds since the runtime started. */
    now: number
    /** Seconds since the previous frame. */
    dt: number
    /** Frames elapsed. */
    frame: number
}

type Api = typeof api

export interface OjRuntime extends Api {
    readonly version: string
    /** The root VisualElement a game renders into. */
    readonly root: unknown
    /** The current stage layout. Recomputed when the viewport changes. */
    readonly stage: StageLayout
    /** The frame clock. Reused: read it, do not retain it. */
    readonly time: Readonly<TimeState>
    /**
     * Runs a callback every frame, returning an unsubscribe.
     *
     * A callback that throws is removed rather than left to throw once per
     * frame forever, and the error is reported once.
     */
    onFrame(callback: (dt: number) => void): () => void
}

export interface RuntimeOptions {
    /** The root VisualElement. */
    root: unknown
    /** The pinned runtime version, as resolved from the manifest. */
    version: string
    /** The game's stage configuration, already normalized. */
    stage: StageConfig
    /** Initial viewport in pixels. */
    viewport?: { width: number; height: number }
}

/** What the container holds. Games only ever see `oj`. */
export interface ContainerRuntime {
    /** Inject this as the bundle's `oj` external. */
    readonly oj: OjRuntime
    /** The input the adapter pushes browser events into. */
    readonly input: ContainerInput
    /** Advance one frame. Drives the clock, input edges and frame callbacks. */
    beginFrame(dtSeconds: number): void
    /** Recompute the stage, and with it the pointer's logical coordinates. */
    setViewport(width: number, height: number): void
    /** Detach from the input module and drop frame callbacks. */
    dispose(): void
}

/**
 * The runtime the useFrame hook reads.
 *
 * A hook cannot take the runtime as an argument and still read like a hook, and
 * the game's bundle has no way to reach the container's instance, so the
 * current runtime is module state. Same seam shape as the input backend.
 */
let current: OjRuntime | null = null

/** The running runtime, or null outside a container. */
export function getCurrentRuntime(): OjRuntime | null {
    return current
}

export function createRuntime(options: RuntimeOptions): ContainerRuntime {
    const input = createContainerInput()
    setInputBackend(input.backend)

    const time: TimeState = { now: 0, dt: 0, frame: 0 }
    let layout = computeStageLayout(
        options.stage,
        options.viewport?.width ?? options.stage.width,
        options.viewport?.height ?? options.stage.height,
    )
    input.setStageLayout(layout)

    const callbacks = new Set<(dt: number) => void>()

    const oj: OjRuntime = {
        ...api,
        version: options.version,
        root: options.root,
        get stage() {
            return layout
        },
        get time() {
            return time
        },
        onFrame(callback) {
            callbacks.add(callback)
            return () => callbacks.delete(callback)
        },
    }
    current = oj

    return {
        oj,
        input,

        beginFrame(dtSeconds: number) {
            time.dt = dtSeconds
            time.now += dtSeconds
            time.frame++
            input.beginFrame()
            for (const callback of [...callbacks]) {
                try {
                    callback(dtSeconds)
                } catch (error) {
                    // Drop it rather than let it throw once a frame forever.
                    callbacks.delete(callback)
                    console.error("[oj] frame callback removed after throwing:", error)
                }
            }
        },

        setViewport(width: number, height: number) {
            layout = computeStageLayout(options.stage, width, height)
            input.setStageLayout(layout)
        },

        dispose() {
            callbacks.clear()
            setInputBackend(null)
            if (current === oj) current = null
        },
    }
}
