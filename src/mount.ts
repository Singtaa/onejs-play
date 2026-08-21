/**
 * Mounting and reading the stage, without a game having to plumb `oj.root`
 * through its component tree.
 *
 * The container knows the root and the stage; a game should not have to hold
 * either. `mount(<Game />)` is the whole entry point, and useStage re-renders
 * on resize the way a hook should.
 */

import { useEffect, useState, type ReactNode } from "react"
import { render } from "onejs-react"
import { getCurrentRuntime } from "./runtime"
import { computeStageLayout, normalizeStage, type StageLayout } from "./stage"

function requireRuntime(what: string) {
    const runtime = getCurrentRuntime()
    if (runtime === null) {
        throw new Error(`[oj] ${what} needs a running container; none is installed`)
    }
    return runtime
}

/** Renders a game into the container's root. */
export function mount(element: ReactNode): void {
    render(element as never, requireRuntime("mount").root as never)
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
