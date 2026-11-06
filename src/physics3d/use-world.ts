/**
 * A world for a component, stepped on oj's frame clock.
 *
 *     const world = useWorld()
 *     useEffect(() => {
 *         if (world) world.box({ at: [0, -0.5, 0], size: [20, 1, 20] })
 *     }, [world])
 *
 * Null until the engine has loaded. Stepped at a fixed rate every frame, then
 * every body's actor is put where its body is. Disposed with the component.
 */

import { useSteppedWorld } from "../physics/use-stepped"
import { createWorld, type World, type WorldOptions } from "./world"

export function useWorld(options: WorldOptions = {}): World | null {
    return useSteppedWorld("useWorld", () => createWorld(options))
}
