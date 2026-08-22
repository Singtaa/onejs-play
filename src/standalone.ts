/**
 * Running a game outside the container.
 *
 * A game written for OneJS Play imports from "oj" and calls mount(). Inside the
 * container that works because the container built a runtime first. Ejected into
 * an ordinary OneJS project there is no container, and without this mount()
 * would throw: the promise on the site is "same source, no rewrite", and a
 * download that needs a rewrite to start is not that.
 *
 * So mount() stands one up on demand. It is the same runtime the container
 * builds, minus the parts that only make sense when hosting untrusted code:
 *
 *   - No global shadowing. An ejected game is the developer's own code in their
 *     own project, and taking CS away from them there would be pure obstruction.
 *   - No input backend override. onejs-unity falls back to the real InputBridge
 *     when no backend is installed, which is the better source anyway: it sees
 *     gamepads and touches that the browser adapter cannot.
 *
 * What it keeps is the part a game depends on: the frame clock, the stage, and
 * the panel scaling that makes a declared stage fill the window.
 */

import { createRuntime, getCurrentRuntime, type ContainerRuntime } from "./runtime"
import { normalizeStage, type StageInput, type StageLayout } from "./stage"

declare const globalThis: any

/** The standalone runtime, if mount() has started one. */
let standalone: ContainerRuntime | null = null

/** The root a game renders into: whatever OneJS gave this project. */
function hostRoot(): unknown {
    const root = globalThis.__root
    if (root === undefined || root === null) {
        throw new Error(
            "[oj] no __root: mount() needs a OneJS host. In a Unity project this is " +
            "provided by JSRunner or JSPad; outside one there is nothing to render into.",
        )
    }
    return root
}

/** Physical pixels per logical one, where the concept exists. */
function pixelRatio(): number {
    const dpr = globalThis.devicePixelRatio
    return typeof dpr === "number" && dpr > 0 ? dpr : 1
}

/**
 * The PanelSettings behind our own root.
 *
 * Same route the container uses, and for the same reason: it is exact, and the
 * generic lookups are generic methods the CS bridge cannot instantiate.
 */
function panelSettings(): any {
    try {
        return globalThis.__root?.panel?.panelSettings ?? null
    } catch {
        return null
    }
}

/** The viewport in logical pixels, measured where the panel cannot mislead us. */
function viewport(): { width: number; height: number } | undefined {
    try {
        const screen = globalThis.CS?.UnityEngine?.Screen
        const dpr = pixelRatio()
        const width = Math.round(screen.width / dpr)
        const height = Math.round(screen.height / dpr)
        if (width > 0 && height > 0) return { width, height }
    } catch {
        // Fall through to the panel's own measurement.
    }
    try {
        const style = globalThis.__root.resolvedStyle
        const width = Math.round(style.width)
        const height = Math.round(style.height)
        if (Number.isFinite(width) && width > 0) return { width, height }
    } catch {
        // Nothing measurable yet; the first resize will settle it.
    }
    return undefined
}

/** Applies a layout by scaling the panel. See mount() for the contract. */
function present(layout: StageLayout) {
    const settings = panelSettings()
    if (settings === null) return
    const scale = layout.scale * pixelRatio()
    // ResolveScale returns 0 for a non-positive scale, which blanks the panel.
    settings.scale = Number.isFinite(scale) && scale > 0 ? scale : 1
}

/**
 * Starts a runtime for a game running on its own.
 *
 * Idempotent: a second mount() in the same project joins the first rather than
 * replacing it, which is what a hot reload looks like from here.
 */
export function startStandalone(stage?: StageInput): ContainerRuntime {
    const existing = getCurrentRuntime()
    if (existing !== null && standalone !== null) return standalone

    const size = viewport()
    standalone = createRuntime({
        root: hostRoot(),
        version: "standalone",
        stage: normalizeStage(stage),
        viewport: size,
        onLayout: present,
    })

    let last = { width: size?.width ?? 0, height: size?.height ?? 0, dpr: pixelRatio() }
    // null rather than 0 for "no frame yet": a timestamp of exactly 0 is a
    // legitimate first frame, and treating it as the sentinel makes the second
    // frame fall back to a synthetic delta too.
    let previous: number | null = null
    const tick = (now: number) => {
        globalThis.requestAnimationFrame(tick)
        if (standalone === null) return
        const dt = previous === null ? 1 / 60 : Math.min(0.1, (now - previous) / 1000)
        previous = now

        // Polled rather than driven by an event: nothing here can see a Unity
        // window resize or a window moving between displays of different
        // density, and a stage that only re-fits on request is usually wrong.
        const current = viewport()
        const dpr = pixelRatio()
        if (current !== undefined &&
            (current.width !== last.width || current.height !== last.height || dpr !== last.dpr)) {
            last = { width: current.width, height: current.height, dpr }
            standalone.setViewport(current.width, current.height)
        }

        standalone.beginFrame(dt)
    }
    globalThis.requestAnimationFrame(tick)

    // Hot reload tears the context down; without this the next load starts with
    // the previous run's frame callbacks still registered.
    globalThis.__onTeardown?.(() => {
        standalone?.dispose()
        standalone = null
    })

    return standalone
}
