/**
 * Where a mesh collider's file comes from, without the world importing the
 * scene or the asset loader: both pull React, and a room script has neither.
 * asset.ts and models.ts fill these in; a room script hands over bytes.
 */

import type { Triangles } from "./gltf"

/** The address a model was loaded from, so `world.mesh(model)` reads the same file. */
export const modelUrls = new WeakMap<object, string>()

/**
 * A model made from arrays (`scene.mesh`): its triangles as last given, which
 * `world.mesh(model)` reads, and whether it did. A collider is made once, so a
 * model that became one keeps the shape it had, and `set` says so.
 */
export interface ArrayModel {
    triangles(): Triangles
    collider: boolean
}

export const arrayModels = new WeakMap<object, ArrayModel>()

let loader = async (name: string): Promise<Uint8Array> => {
    const response = await (globalThis as any).fetch(name)
    if (!response.ok) throw new Error(`[oj] ${name} answered ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
}

export function loadFileBytes(name: string): Promise<Uint8Array> {
    return loader(name)
}

/** asset.ts resolves a bare name the way every other loader does. */
export function setFileLoader(next: typeof loader): void {
    loader = next
}
