/**
 * useFrame: run a callback every frame.
 *
 * Reads the running runtime from module state, because a hook that took the
 * runtime as an argument would not read like a hook and a game's bundle has no
 * way to reach the container's instance.
 */

import { useEffect, type DependencyList } from "react"
import { getCurrentRuntime } from "./runtime"

/**
 * Subscribes to the frame clock for as long as the component is mounted.
 *
 * Outside a container there is no clock, so this is a no-op rather than a
 * throw: a component that renders in a test or a normal OneJS project should
 * not explode because nothing is driving frames.
 */
export function useFrame(callback: (dt: number) => void, deps: DependencyList = []): void {
    useEffect(() => {
        const runtime = getCurrentRuntime()
        if (runtime === null) return
        return runtime.onFrame(callback)
        // The callback is intentionally not a dependency: games pass an inline
        // closure, and re-subscribing every render would churn the set.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
}
