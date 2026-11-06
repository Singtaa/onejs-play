/**
 * A world for a component, stepped on oj's frame clock: what useWorld and
 * useWorld2D both are.
 *
 * Null until the engine has loaded, which is one fetch the first time a cart
 * makes a world and nothing after. Stepped at a fixed rate every frame, after
 * the frame's own callbacks have moved things, and then every body's actor is
 * put where its body is, or, when frames come faster than steps, between the
 * last two steps. Disposed with the component.
 */

import { useEffect, useState } from "react"
import { getCurrentRuntime } from "../runtime"

interface Stepped {
    frame(seconds: number): void
    dispose(): void
}

export function useSteppedWorld<W>(hook: string, create: () => Promise<W>): W | null {
    const [world, setWorld] = useState<W | null>(null)
    useEffect(() => {
        let made: Stepped | null = null
        let stop: (() => void) | undefined
        let gone = false
        create().then((w) => {
            const stepped = w as unknown as Stepped
            if (gone) {
                stepped.dispose()
                return
            }
            made = stepped
            const runtime = getCurrentRuntime()
            if (runtime === null) console.warn(`[oj] ${hook}: no frame clock here, so the world will not step itself. Call world.step() from your own loop.`)
            stop = runtime?.onFrame((dt) => stepped.frame(dt))
            setWorld(w)
        }, (e) => console.error(`[oj] ${hook}: the physics engine did not load. ${e instanceof Error ? e.message : String(e)}`))
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
