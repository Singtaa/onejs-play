/**
 * How a world moves the actors its bodies carry.
 *
 * A slot rather than an import, so that a world never loads React or the scene:
 * a room script makes worlds with no scene at all. models.ts fills the slot with
 * a placer that moves every actor in one crossing (ModelBridge.PlaceMany); the
 * default here sets each actor's own properties, which is right for anything
 * shaped like an Actor that models.ts did not make.
 */

import type { Actor, Vec3 } from "../models"
import { fromQuat, type Quat } from "./rotation"

export interface ActorPlacement {
    actor: Actor
    at: Vec3
    /** Null leaves the actor's facing alone: a character is turned by the game, not by physics. */
    rotation: Quat | null
}

let placer = (list: readonly ActorPlacement[]): void => {
    for (const { actor, at, rotation } of list) {
        actor.position = at
        if (rotation !== null) actor.rotation = fromQuat(rotation)
    }
}

export function placeActors(list: readonly ActorPlacement[]): void {
    if (list.length > 0) placer(list)
}

/** Replaces how actors are moved. models.ts batches them into one crossing. */
export function setActorPlacer(next: typeof placer): void {
    placer = next
}

/**
 * Each live world's actors carried by bodies that never move: neither dynamic
 * nor kinematic. A static body is a promise the author already made, so its
 * actor is static to the scene too, and `scene.bake` bakes light into it
 * without the cart marking anything (docs/lightmapping.md §4).
 */
const stillSources = new Set<() => Iterable<Actor>>()

/** A world adds itself as it is made, and takes itself away when it is disposed. */
export function addStillActors(source: () => Iterable<Actor>): () => void {
    stillSources.add(source)
    return () => { stillSources.delete(source) }
}

/** Every actor a live world's static bodies carry, now. */
export function stillActors(): Set<Actor> {
    const found = new Set<Actor>()
    for (const source of stillSources) for (const actor of source()) found.add(actor)
    return found
}
