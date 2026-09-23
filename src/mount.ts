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

import { createElement, useEffect, useState, type ReactNode } from "react"
import { render, ScreenProvider, View } from "onejs-react"
import { getCurrentRuntime } from "./runtime"
import { startStandalone } from "./standalone"
import { stageOf, type Stage } from "./stage"
import { applyTheme } from "./theme"

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
    return createElement(
        View,
        {
            style: {
                position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
                overflow: "hidden",
                backgroundColor: BACKDROP,
            },
        },
        // Provided here so useBreakpoint and friends work in a game with no setup.
        createElement(ScreenProvider, { size: stage, children }),
    )
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
    render(createElement(StagePresenter, null, element) as never, runtime.root as never)
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
