/**
 * useFrame: run a callback every frame.
 *
 * Reads the running runtime from module state, because a hook that took the
 * runtime as an argument would not read like a hook and a game's bundle has no
 * way to reach the container's instance.
 */

import { useEffect, useRef, type DependencyList } from "react"
import { getCurrentRuntime } from "./runtime"

/**
 * Subscribes to the frame clock for as long as the component is mounted.
 *
 * The callback that runs each frame is the one from the LATEST render, so it
 * can read state and props directly. The subscription itself is made once per
 * `deps` change (once, by default), which is what keeps re-rendering cheap:
 * a game passes an inline closure, and re-subscribing every render would
 * churn the clock's listener set sixty times a second.
 *
 * Before this the first render's closure ran for the life of the component,
 * silently. A frame loop that compared a state value against a new one always
 * saw the initial value, and the fix every game found was to mirror its state
 * into a ref, which is the kind of workaround that spreads by copy and paste.
 *
 * Outside a container there is no clock, so this is a no-op rather than a
 * throw: a component that renders in a test or a normal OneJS project should
 * not explode because nothing is driving frames.
 */
export function useFrame(callback: (dt: number) => void, deps: DependencyList = []): void {
    const latest = useRef(callback)
    latest.current = callback

    useEffect(() => {
        const runtime = getCurrentRuntime()
        if (runtime === null) return
        return runtime.onFrame((dt) => latest.current(dt))
        // deps decides when to resubscribe; the callback is read through the
        // ref, so it is deliberately not one of them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
}
