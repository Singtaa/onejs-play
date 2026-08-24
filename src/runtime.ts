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

import type * as api from "./index"
import { computeStageLayout, type StageConfig, type StageLayout } from "./stage"
import { createContainerInput, type ContainerInput } from "./input"
import { setAssetBase } from "./asset"
import { setPlayContext, type PlayContext } from "./play"
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
    /** The game's stage configuration, already normalized. */
    stage: StageConfig
    /** Initial viewport in CSS pixels. */
    viewport?: { width: number; height: number }
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
     * coordinates match the stage.
     *
     * Defaulting to "container" keeps the container's call unchanged. It was
     * also the bug: startStandalone calls createRuntime, so an ejected game got
     * a backend with nothing feeding it and read no input at all.
     */
    inputSource?: "container" | "host"
    /**
     * Applies a freshly computed layout to whatever presents the stage.
     *
     * The stage math lives here, but nothing in this package can act on it:
     * scaling the panel and sizing the host element need CS access, which only
     * the container has. Without this seam the layout was computed correctly
     * and then thrown away, so every game rendered unscaled at 1:1 whatever
     * stage it declared.
     *
     * Called once at creation and again on every viewport change.
     */
    onLayout?: (layout: StageLayout) => void
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
let current: HostRuntime | null = null

/** The running runtime, or null outside a container. */
export function getCurrentRuntime(): HostRuntime | null {
    return current
}

export function createRuntime(options: RuntimeOptions): ContainerRuntime {
    const input = createContainerInput()
    if (options.inputSource !== "host") setInputBackend(input.backend)
    setAssetBase(options.assetBase ?? null)
    setPlayContext(options.play ?? null)

    const time: TimeState = { now: 0, dt: 0, frame: 0 }
    let layout = computeStageLayout(
        options.stage,
        options.viewport?.width ?? options.stage.width,
        options.viewport?.height ?? options.stage.height,
    )
    input.setStageLayout(layout)

    /** Reports a layout without letting a throwing presenter kill the load. */
    const present = () => {
        if (options.onLayout === undefined) return
        try {
            options.onLayout(layout)
        } catch (error) {
            console.error("[oj] stage presenter failed:", error)
        }
    }
    present()

    const callbacks = new Set<(dt: number) => void>()

    const oj: HostRuntime = {
        ...(options.api ?? {}),
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
        // Only a caller that passed `api` gets the whole surface on this
        // object; everything else gets HostRuntime, which is all mount,
        // useFrame and useStage read.
        oj: oj as OjRuntime,
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
            present()
        },

        dispose() {
            callbacks.clear()
            setInputBackend(null)
            setAssetBase(null)
            setPlayContext(null)
            if (current === oj) current = null
        },
    }
}
