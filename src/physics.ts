/**
 * Physics for a game, with the per-frame wiring done.
 *
 * onejs-unity's createPhysicsWorld is host-agnostic: it hands back a world with
 * a pump() the caller drives. Inside a container there is already a frame clock,
 * so oj drives it, and disposes the world when the game goes away.
 *
 *     const world = usePhysics(hostRef, {
 *         gravity: [0, 980], bounds: true,
 *         bodies: [{ element: ballRef.current, shape: "circle", radius: 16 }],
 *     })
 *
 * The world is created once and never rebuilt from a render. Bodies are bound to
 * elements after mount, which is when refs have something in them.
 */

import { useEffect, useRef, useState, type RefObject } from "react"
import { createPhysicsWorld, type PhysicsWorld, type WorldConfig, type Contact } from "onejs-unity/physics2d"
import { getCurrentRuntime } from "./runtime"

export type { PhysicsWorld, WorldConfig, Contact, BodyConfig, BodyShape, BodyType } from "onejs-unity/physics2d"
export { createPhysicsWorld } from "onejs-unity/physics2d"

/**
 * Creates a world bound to a host element and keeps it pumped.
 *
 * The config is read once, on mount. Physics state lives in C# and a re-render
 * must not throw it away, so later changes to the object are ignored by design;
 * change a running world through its methods instead.
 */
export function usePhysics(
    host: RefObject<any>,
    config: WorldConfig,
    onCollision?: (contact: Contact) => void,
): PhysicsWorld | null {
    const [world, setWorld] = useState<PhysicsWorld | null>(null)
    // Held in a ref so a handler that closes over new state each render does not
    // rebuild the world, which would restart the simulation.
    const handler = useRef(onCollision)
    handler.current = onCollision

    useEffect(() => {
        if (host.current === null || host.current === undefined) return
        const created = createPhysicsWorld(host.current, config)
        created.onCollision((contact) => handler.current?.(contact))
        setWorld(created)

        const runtime = getCurrentRuntime()
        const stop = runtime?.onFrame(() => created.pump())

        return () => {
            stop?.()
            created.dispose()
        }
        // Deliberately mount-only: see above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [host.current])

    return world
}
