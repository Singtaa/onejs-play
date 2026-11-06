/**
 * Paths across a world, from the colliders it already has.
 *
 *     const nav = await world.nav({ radius: 0.32, height: 1.6 })
 *     bot.path = nav.path(bot.position, goal)
 *
 * Recast turns every static body into a navigation mesh, the walkable floor
 * shrunk by the walker's radius, and Detour finds the shortest way across it.
 * The same pair most engines ship, Unity's included, here as WebAssembly
 * through src/wasm.ts like the physics engine. Built once: a level that
 * changes builds a new one.
 */

import type { Vec3 } from "../models"
import { instantiateWasm } from "../wasm"
import { RECAST_VERSION, RECAST_WASM_SHA256 } from "./recast.version"

export type Recast = typeof import("./recast.vendor.js")

export const RECAST_MODULE = { name: "recast", version: RECAST_VERSION, sha256: RECAST_WASM_SHA256 } as const

export interface NavOptions {
    /** The walker's radius: how far from a wall its centre keeps. 0.3 by default. */
    radius?: number
    /** Feet to head: the lowest gap it fits under. 1.6 by default. */
    height?: number
    /** The tallest ledge it walks up. 0.3 by default. */
    stepHeight?: number
    /** The steepest slope it walks, in degrees. 45 by default. */
    slope?: number
    /** The grid the floor is measured on, in metres. A third of the radius by default; smaller is finer and slower to build. */
    cell?: number
    /** Only bodies on these layers count. Every static, solid body by default. */
    only?: readonly string[]
}

export interface Nav {
    /**
     * The corners of the shortest way from `from` to `to`, not including
     * `from` and ending at `to`, or as near it as can be reached. Empty when
     * `from` is nowhere near the walkable floor.
     */
    path(from: Vec3, to: Vec3): Vec3[]
    dispose(): void
}

export const NAV_DEFAULTS = Object.freeze({ radius: 0.3, height: 1.6, stepHeight: 0.3, slope: 45 })

let loading: Promise<Recast> | null = null

export function loadRecast(): Promise<Recast> {
    loading ??= (async () => {
        const R = await import("./recast.vendor.js")
        // init takes the module factory; this one is handed the module instead of fetching it.
        await R.init((() => R.recastFactory({
            instantiateWasm(imports, receive) {
                instantiateWasm(RECAST_MODULE, imports).then((exports) => receive({ exports }), (e) => { throw e })
                return {}
            },
        })) as any)
        return R
    })().catch((e) => {
        loading = null
        throw e
    })
    return loading
}

/** A navigation mesh over these triangles, which must face up where they are floor. */
export async function buildNav(vertices: Float32Array, indices: Uint32Array, o: NavOptions = {}): Promise<Nav> {
    const R = await loadRecast()
    const radius = o.radius ?? NAV_DEFAULTS.radius
    const cs = o.cell ?? Math.max(0.05, radius / 3)
    const ch = cs / 2
    const { success, navMesh, error } = R.generateSoloNavMesh(vertices, indices, {
        cs, ch,
        walkableRadius: Math.ceil(radius / cs),
        walkableHeight: Math.ceil((o.height ?? NAV_DEFAULTS.height) / ch),
        walkableClimb: Math.floor((o.stepHeight ?? NAV_DEFAULTS.stepHeight) / ch),
        walkableSlopeAngle: o.slope ?? NAV_DEFAULTS.slope,
        // detailSampleDist stays the library's: it is counted in cells there, and under 0.9 crashes Recast.
    }) as any
    if (!success) throw new Error(`[oj] the navigation mesh did not build: ${error ?? "no walkable floor"}`)
    const query = new R.NavMeshQuery(navMesh)
    const reach = { x: Math.max(1, radius * 4), y: Math.max(2, (o.height ?? NAV_DEFAULTS.height) * 2), z: Math.max(1, radius * 4) }
    let gone = false
    return {
        path(from: Vec3, to: Vec3): Vec3[] {
            if (gone) throw new Error("[oj] this nav was disposed")
            const r = query.computePath({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, { halfExtents: reach })
            if (!r.success || r.path.length === 0) return []
            const points = r.path.map((p: { x: number, y: number, z: number }) => Object.freeze([p.x, p.y, p.z]) as unknown as Vec3)
            return points.slice(1)
        },
        dispose() {
            if (gone) return
            gone = true
            query.destroy()
            navMesh.destroy()
        },
    }
}
