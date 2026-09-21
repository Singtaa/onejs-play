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
        if (host.current === null || host.current === undefined) {
            console.warn("[oj] usePhysics: the host ref was empty on mount, so no world was created. Put the ref on an element this component renders.")
            return
        }
        const created = createPhysicsWorld(host.current, config)
        created.onCollision((contact) => handler.current?.(contact))
        setWorld(created)

        const runtime = getCurrentRuntime()
        const stop = runtime?.onFrame(() => created.pump())

        return () => {
            stop?.()
            created.dispose()
        }
        // Mount-only, and the empty list is load-bearing rather than lazy.
        //
        // This read `[host.current]`, which is evaluated during RENDER, when a
        // ref for an element this component is about to mount is still null.
        // The effect then ran with the ref populated, built the world, and
        // setWorld re-rendered; on that pass the dep was the element, so React
        // saw the list change, disposed the world and built a second one.
        // Every world was built twice, and on a stage of 85 bodies that was 170
        // GameObjects created and thrown away, and every per-body warning the
        // engine had to say printed twice.
        //
        // Refs are attached before effects run, so reading host.current in the
        // body is enough. A host that is not mounted by then cannot be waited
        // for here either, because populating a ref does not re-render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return world
}
