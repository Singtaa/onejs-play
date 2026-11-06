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
