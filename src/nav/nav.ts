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
    /** The tallest ledge it walks up. 0.4 by default, as a character's. */
    stepHeight?: number
    /** The steepest slope it walks, in degrees. 45 by default. */
    slope?: number
    /** The grid the floor is measured on, in metres. A third of the radius by default; smaller is finer and slower to build. */
    cell?: number
    /** Only bodies on these layers count. Every static, solid body by default. */
    only?: readonly string[]
    /**
     * Metres across a tile. Given, the nav is built in tiles and follows the
     * world: a static body made, destroyed or moved rebuilds the tiles it
     * touches, and `block` and `mark` change the floor without a collider.
     * The cell gives a little so a whole number of them fit a tile. Without
     * it, one navmesh, built once.
     */
    tile?: number
    /** With `tile`: milliseconds a frame the world spends rebuilding stale tiles. 1 by default; 0 leaves it to `nav.update`. */
    budget?: number
}

export interface Nav {
    /**
     * The corners of the shortest way from `from` to `to`, not including
     * `from` and ending at `to`, or as near it as can be reached. Empty when
     * `from` or `to` is nowhere near the walkable floor (`nearest` finds the
     * floor near one); `[to]` when `from` and `to` are one place on it.
     */
    path(from: Vec3, to: Vec3): Vec3[]
    /**
     * The closest point of the walkable floor to `point`, or null when none
     * is within `within` metres. Without `within`, it looks as far as `path`
     * does for its ends: four radii across and two heights up and down.
     * `nearest(p, 0.2) !== null` asks whether p is on the floor.
     */
    nearest(point: Vec3, within?: number): Vec3 | null
    /** The walkable floor as triangles, for drawing: `scene.mesh({ ...nav.polygons(), color: "#3c8" })`. */
    polygons(): { positions: Float32Array, indices: Uint32Array }
    dispose(): void
}

export const NAV_DEFAULTS = Object.freeze({ radius: 0.3, height: 1.6, stepHeight: 0.4, slope: 45 })

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

/** How far from the floor a path's ends and `nearest` look: four radii across, two heights up and down. */
export function navReach(radius: number, height: number): { x: number, y: number, z: number } {
    return { x: Math.max(1, radius * 4), y: Math.max(2, height * 2), z: Math.max(1, radius * 4) }
}

/** computePath's answer as oj's corners: without `from`, and `[to]` for a path that never leaves its polygon. */
export function cornersOf(r: { success: boolean, path: { x: number, y: number, z: number }[] }): Vec3[] {
    if (!r.success || r.path.length === 0) return []
    const points = r.path.map((p) => Object.freeze([p.x, p.y, p.z]) as unknown as Vec3)
    // Detour gives one point, not two, when both ends are one place.
    return points.length === 1 ? points : points.slice(1)
}

export function nearestOn(query: any, p: Vec3, reach: { x: number, y: number, z: number }, within: number | undefined, filter?: any): Vec3 | null {
    if (within !== undefined && !(within >= 0)) throw new Error(`[oj] nav.nearest: within is metres, not ${within}`)
    const halfExtents = within === undefined ? reach : { x: within, y: within, z: within }
    const r = query.findNearestPoly({ x: p[0], y: p[1], z: p[2] }, { halfExtents, filter })
    if (!r.success || r.nearestRef === 0) return null
    const q = r.nearestPoint
    if (within !== undefined && Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]) > within) return null
    return Object.freeze([q.x, q.y, q.z]) as unknown as Vec3
}

/** Every walkable triangle of a navmesh, three vertices each, for scene.mesh. */
export function floorOf(R: Recast, navMesh: any): { positions: Float32Array, indices: Uint32Array } {
    const [positions, indices] = R.getNavMeshPositionsAndIndices(navMesh)
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
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
    const reach = navReach(radius, o.height ?? NAV_DEFAULTS.height)
    let gone = false
    const live = () => { if (gone) throw new Error("[oj] this nav was disposed") }
    return {
        path(from: Vec3, to: Vec3): Vec3[] {
            live()
            return cornersOf(query.computePath({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, { halfExtents: reach }))
        },
        nearest(point: Vec3, within?: number): Vec3 | null {
            live()
            return nearestOn(query, point, reach, within)
        },
        polygons() {
            live()
            return floorOf(R, navMesh)
        },
        dispose() {
            if (gone) return
            gone = true
            query.destroy()
            navMesh.destroy()
        },
    }
}
