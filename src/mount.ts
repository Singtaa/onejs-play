/**
 * Mounting and reading the stage, without a game having to plumb `oj.root`
 * through its component tree.
 *
 * The container knows the root and the stage; a game should not have to hold
 * either. `mount(<Game />)` is the whole entry point, and useStage re-renders
 * on resize the way a hook should.
 *
 * WHAT MOUNT ACTUALLY DOES WITH THE STAGE
 *
 * A game declares a stage (600x760, letterbox) and lays itself out in those
 * units. Something has to map those units onto the player's window, and it is
 * here: mount wraps the game in a clipper and a host box, and the host box is
 * sized and positioned from the current layout.
 *
 * The other half of the mapping is the panel scale, which the container sets,
 * because only it can reach PanelSettings. The split matters: sizing happens in
 * points and scaling happens on the panel, so UI Toolkit rasterizes text at the
 * final device resolution instead of magnifying an atlas rendered for a smaller
 * one. A transform on the host box would scale the pixels; scaling the panel
 * renders them.
 *
 * The two halves have to agree, and the contract is one line: the container
 * sets panel scale to layout.scale x devicePixelRatio, and everything here is
 * in points, where one point is exactly that many physical pixels.
 */

import { createElement, useEffect, useState, type ReactNode } from "react"
import { render, View } from "onejs-react"
import { getCurrentRuntime } from "./runtime"
import { computeStageLayout, normalizeStage, type StageLayout } from "./stage"

function requireRuntime(what: string) {
    const runtime = getCurrentRuntime()
    if (runtime === null) {
        throw new Error(`[oj] ${what} needs a running container; none is installed`)
    }
    return runtime
}

/**
 * The host box, in points.
 *
 * One formula covers letterbox, cover and fluid: the stage is layout.width by
 * layout.height points, offset by the layout's pixel offset converted back into
 * points. For fluid that collapses to the full viewport at the origin, which is
 * exactly right, so fluid needs no special case.
 *
 * stretch is the exception. It is the only fit whose two axes scale by
 * different amounts, and a non-uniform scale needs a transform, which the style
 * pipeline cannot express yet. Filling the root instead gives a flex or
 * percentage layout the stretch it asked for; a game positioning things at
 * absolute stage coordinates gets a larger box rather than a distorted one.
 */
export function stageHostStyle(layout: StageLayout): Record<string, unknown> {
    if (layout.fit === "stretch") {
        return {
            position: "absolute",
            left: 0,
            top: 0,
            width: layout.viewportWidth / layout.scale,
            height: layout.viewportHeight / layout.scale,
        }
    }
    return {
        position: "absolute",
        left: layout.offsetX / layout.scaleX,
        top: layout.offsetY / layout.scaleY,
        width: layout.width,
        height: layout.height,
    }
}

/**
 * Wraps the game so the stage is honoured.
 *
 * The outer element clips: under `cover` the host box is deliberately larger
 * than the viewport, and without a clipper the overflow draws over the page
 * instead of being cropped.
 */
function StagePresenter({ children }: { children: ReactNode }) {
    const layout = useStage()
    return createElement(
        View,
        { style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "hidden" } },
        createElement(View, { style: stageHostStyle(layout) }, children),
    )
}

/** Renders a game into the container's root, fitted to its stage. */
export function mount(element: ReactNode): void {
    const runtime = requireRuntime("mount")
    render(createElement(StagePresenter, null, element) as never, runtime.root as never)
}

/**
 * The current stage layout, re-rendering when the viewport changes.
 *
 * Outside a container this falls back to a default layout rather than throwing,
 * so a component can still render in a unit test.
 */
export function useStage(): StageLayout {
    const runtime = getCurrentRuntime()
    const [layout, setLayout] = useState<StageLayout>(
        () => runtime?.stage ?? computeStageLayout(normalizeStage(undefined), 960, 540),
    )

    useEffect(() => {
        if (runtime === null) return
        // The runtime has no resize event of its own, so the frame clock is the
        // sampling point. Comparing the object identity is enough: setViewport
        // replaces the layout rather than mutating it.
        return runtime.onFrame(() => {
            if (runtime.stage !== layout) setLayout(runtime.stage)
        })
    }, [runtime, layout])

    return layout
}
