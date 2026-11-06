/**
 * Mounting and reading the stage, without a game having to plumb `oj.root`
 * through its component tree.
 *
 * The container knows the root and the stage; a game should not have to hold
 * either. `mount(<Game />)` is the whole entry point, and useStage re-renders
 * on resize the way a hook should.
 *
 * The stage is the window, in logical pixels. The container scales the panel
 * by devicePixelRatio, which is what makes one logical pixel one CSS pixel and
 * keeps text sharp: UI Toolkit rasterizes glyphs against the panel scale, so
 * scaling the panel renders them at the display's real resolution where a
 * transform on an element would magnify them.
 */

import { cloneElement, createElement, Fragment, isValidElement, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DependencyList, type ReactNode } from "react"
import { render, ScreenProvider, View } from "onejs-react"
import { getCurrentRuntime, setRemount } from "./runtime"
import { startStandalone } from "./standalone"
import { stageOf, type Stage } from "./stage"
import { applyTheme } from "./theme"
import { useBackdrop } from "./models"
import { startupFiles } from "./asset"
import { preload } from "./preload"

/**
 * What shows behind a game that paints nothing: dark enough to sit behind
 * anything without competing with it.
 *
 * Painted on an element, deliberately. The engine offers two lower-level ways
 * to clear a background, a camera and PanelSettings.colorClearValue, and both
 * write the value straight into the framebuffer without the sRGB conversion
 * the UI colour pipeline applies. In a linear-colour project that turns
 * #14181d into #4f565f, measured, which is the kind of bug that looks like a
 * design choice. A colour on an element cannot drift that way.
 */
const BACKDROP = "#14181d"

/** Fills the window behind the game and provides its size to the responsive hooks. */
function StagePresenter({ children }: { children: ReactNode }) {
    const stage = useStage()
    // A 3D scene draws behind the panel, so the backdrop steps aside while one is live.
    const backdrop = useBackdrop(BACKDROP)
    return createElement(
        View,
        {
            style: {
                position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
                overflow: "hidden",
                backgroundColor: backdrop,
            },
        },
        // Provided here so useBreakpoint and friends work in a game with no setup.
        createElement(ScreenProvider, { size: stage, children }),
    )
}

/**
 * The files oj.json's preload list names, loading before the cart appears:
 * a plain bar across the middle of the stage, filled by bytes, then the cart
 * with them ready. Kept for the life of a host once done, so a hot reload's
 * remount goes straight to the cart. A file that fails is logged and the cart
 * starts anyway: it fails again where it is used, which says where.
 */
let startupDone: readonly string[] | null = null

/**
 * The cart, arming the first-draw hold once its first screen has committed:
 * a layout effect, so the programs that screen mounts have already been handed
 * to the page, and before the cart's own effects subscribe to the clock.
 */
function FirstScreen({ children }: { children: ReactNode }) {
    useLayoutEffect(() => { getCurrentRuntime()?.armFirstDraw() }, [])
    return createElement(Fragment, null, children)
}

const noHold = () => () => {}
const notHolding = () => false

/** Whether the clock holds for the first screen's programs, re-rendering when it stops. */
function useHolding(): boolean {
    const runtime = getCurrentRuntime()
    return useSyncExternalStore(runtime ? (cb) => runtime.onHoldChange(cb) : noHold, runtime ? () => runtime.holding : notHolding)
}

function LoadBar({ got, total }: { got: number, total: number }) {
    return createElement(
        View,
        { style: { position: "absolute", left: "30%", width: "40%", top: "50%", height: 6, marginTop: -3, borderRadius: 3, backgroundColor: "rgba(255, 255, 255, 0.12)", overflow: "hidden" } },
        createElement(View, { style: { width: `${total > 0 ? Math.round((got / total) * 100) : 0}%`, height: "100%", backgroundColor: "rgba(255, 255, 255, 0.7)" } }),
    )
}

function LoadFirst({ files, children }: { files: readonly string[], children: ReactNode }) {
    const [progress, setProgress] = useState<[number, number]>([0, 0])
    const [done, setDone] = useState(startupDone === files)
    useEffect(() => {
        if (done) return
        let live = true
        preload(files, (got, total) => { if (live) setProgress([got, total]) })
            .catch((error) => console.error("[oj] a file oj.json preloads did not load:", error))
            .finally(() => { startupDone = files; if (live) setDone(true) })
        return () => { live = false }
    }, [files, done])
    const holding = useHolding()
    const [got, total] = progress
    // Loaded, the cart renders so its programs compile, and the bar stays full over it until they have.
    if (done) return createElement(Fragment, null, createElement(FirstScreen, null, children), holding ? createElement(LoadBar, { got: 1, total: 1 }) : null)
    return createElement(LoadBar, { got, total })
}

/**
 * Renders a game into the window.
 *
 * Inside the container the runtime already exists. Outside one, in an ejected
 * project, this starts a runtime itself so the same source runs unchanged,
 * which is the entire promise the eject download makes.
 */
export function mount(element: ReactNode, options: { theme?: boolean } = {}): void {
    const runtime = getCurrentRuntime() ?? startStandalone().oj
    // Before the render, so the first frame a player sees is already themed.
    if (options.theme !== false) applyTheme()
    const files = startupFiles()
    const draw = (cart: ReactNode) => render(createElement(StagePresenter, null,
        files.length === 0 ? createElement(FirstScreen, null, cart) : createElement(LoadFirst, { files, children: cart })) as never, runtime.root as never)
    draw(element)
    // A fresh element of the same type, so React keeps the state and renders
    // every child again (ContainerRuntime.rerender).
    setRemount(() => draw(isValidElement(element) ? cloneElement(element) : element))
}

/** Said once: useLateFrame where no runtime keeps a frame clock. */
let saidNoLateClock = false

/**
 * Runs `callback` every frame after every `useFrame` and every physics world
 * has stepped and placed its actors: Unity's LateUpdate. A camera that follows
 * a body, or anything placed from where an actor is drawn, goes here, so it
 * reads this frame's pose rather than the last one's. The order is the
 * phase's, never when a component mounted.
 *
 * Takes what `useFrame` takes: `(dt, realDt)`, the latest render's callback,
 * and `deps` for when to resubscribe, once by default.
 *
 * ```tsx
 * useLateFrame(() => scene.camera({ position: [car.x, 6, car.z - 10], lookAt: [car.x, 0, car.z] }))
 * ```
 */
export function useLateFrame(callback: (dt: number, realDt: number) => void, deps: DependencyList = []): void {
    const latest = useRef(callback)
    latest.current = callback
    // deps decides when to resubscribe; the callback is read through the ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => subscribeLate((dt, realDt) => latest.current(dt, realDt)), deps)
}

/** useLateFrame's effect: the late phase of this runtime's frames, or nothing (said once) without one. */
export function subscribeLate(run: (dt: number, realDt: number) => void): (() => void) | undefined {
    const runtime = getCurrentRuntime()
    if (runtime === null) {
        if (!saidNoLateClock) console.warn("[oj] useLateFrame: no frame clock here, so it never runs.")
        saidNoLateClock = true
        return undefined
    }
    const stop = runtime.onLateFrame(run)
    return () => { stop() }
}

/**
 * The window in logical pixels, re-rendering when it changes.
 *
 * Outside a container this falls back to a default size rather than throwing,
 * so a component can still render in a unit test.
 */
export function useStage(): Stage {
    const runtime = getCurrentRuntime()
    const [stage, setStage] = useState<Stage>(() => runtime?.stage ?? stageOf(0, 0))

    useEffect(() => {
        if (runtime === null) return
        // The runtime has no resize event of its own, so the frame clock is the
        // sampling point. Comparing the object identity is enough: setViewport
        // replaces the stage rather than mutating it.
        return runtime.onFrame(() => {
            if (runtime.stage !== stage) setStage(runtime.stage)
        })
    }, [runtime, stage])

    return stage
}
