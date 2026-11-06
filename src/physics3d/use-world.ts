/**
 * A world for a component, stepped on oj's frame clock.
 *
 *     const world = useWorld()
 *     useEffect(() => {
 *         if (world) world.box({ at: [0, -0.5, 0], size: [20, 1, 20] })
 *     }, [world])
 *
 * Null until the engine has loaded, which is one fetch the first time a cart
 * makes a world and nothing after. Stepped at a fixed rate every frame, after
 * the frame's own callbacks have moved things, and then every body's actor is
 * put where its body is. Disposed with the component.
 */

import { useEffect, useState } from "react"
import { getCurrentRuntime } from "../runtime"
import { createWorld, type World, type WorldOptions } from "./world"

interface Stepped {
    advance(seconds: number): number
    syncActors(): void
}

export function useWorld(options: WorldOptions = {}): World | null {
    const [world, setWorld] = useState<World | null>(null)
    useEffect(() => {
        let made: World | null = null
        let stop: (() => void) | undefined
        let gone = false
        createWorld(options).then((w) => {
            if (gone) {
                w.dispose()
                return
            }
            made = w
            const runtime = getCurrentRuntime()
            if (runtime === null) console.warn("[oj] useWorld: no frame clock here, so the world will not step itself. Call world.step() from your own loop.")
            stop = runtime?.onFrame((dt) => {
                const stepped = w as unknown as Stepped
                if (stepped.advance(dt) > 0) stepped.syncActors()
            })
            setWorld(w)
        }, (e) => console.error(`[oj] useWorld: the physics engine did not load. ${e instanceof Error ? e.message : String(e)}`))
        return () => {
            gone = true
            stop?.()
            made?.dispose()
        }
        // Read once, on mount, like useScene: a re-render must not rebuild the world.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return world
}
