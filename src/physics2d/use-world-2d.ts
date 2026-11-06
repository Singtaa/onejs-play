/**
 * A 2D world for a component, stepped on oj's frame clock.
 *
 *     const world = useWorld2D()
 *     useEffect(() => {
 *         if (world) world.box({ at: [480, 620], size: [960, 40] })
 *     }, [world])
 *
 * Null until the engine has loaded. Stepped at a fixed rate every frame, then
 * every body's element is put where its body is. Disposed with the component.
 */

import { useSteppedWorld } from "../physics/use-stepped"
import { createWorld2D, type World2D, type World2DOptions } from "./world"

export function useWorld2D(options: World2DOptions = {}): World2D | null {
    return useSteppedWorld("useWorld2D", () => createWorld2D(options))
}
