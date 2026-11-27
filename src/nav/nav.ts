/**
 * Paths across a world, from the colliders it already has.
 *
 *     const nav = await world.nav({ radius: 0.32, height: 1.6 })
 *     bot.path = nav.path(bot.position, goal)
 *
 * Recast turns every static body into a navigation mesh, the walkable floor
 * shrunk by the walker's radius, with no floor inside an upright box, sphere
 * or capsule, and Detour finds the shortest way across it.
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

/**
 * The nodes a nav's query holds for `polygons`, when Detour may keep `states` nodes a polygon. A* takes a node for each
 * polygon it reaches, and a search that runs out stops there and still says success: its way ends at the polygon nearest
 * the goal so far, read as "the floor goes no further". So the pool holds every node a search over the whole nav can
 * take. A solo nav's polygon takes one; a tiled nav's takes one more for each tile edge it is entered across, up to
 * Detour's four. From Detour's default of 2,048 to its most, 65,535: a node is about 35 bytes with its share of the open
 * list and the hash, so 140 bytes a tiled polygon and 2.2 MB at the most, which a tiled nav reaches at 16,384 polygons.
 * A search takes nearer one node a polygon (1.1 on 16 m tiles), so that pool still covers about 55,000 of them.
 */
export function navNodes(polygons: number, states: 1 | 4): number {
    return Math.min(NAV_NODES_MAX, Math.max(NAV_NODES_MIN, polygons * states))
}

const NAV_NODES_MIN = 2048
const NAV_NODES_MAX = 65535

/** The polygons a way first asks room for. A way that needs more is asked again with room for every node. */
const WAY_POLYS = 1024

/**
 * The way from `from` to `to` as oj's corners: without `from`, and `[to]` for a path that never leaves its polygon.
 * computePath's steps (the polygons under each end, A* between them, the corners along that corridor), with room for
 * every polygon and corner the way has: computePath's buffers are fixed, and one too small cuts the way short and
 * still says success, as a search out of nodes does. A goal the floor does not reach gives the way to the polygon
 * nearest it, as computePath's does. [] when an end is off the floor.
 */
export function wayOn(R: Recast, query: any, from: Vec3, to: Vec3, reach: { x: number, y: number, z: number }, filter: any, nodes: number): Vec3[] {
    const a = { x: from[0], y: from[1], z: from[2] }, b = { x: to[0], y: to[1], z: to[2] }
    const start = query.findNearestPoly(a, { halfExtents: reach, filter }).nearestRef
    const end = query.findNearestPoly(b, { halfExtents: reach, filter }).nearestRef
    if (start === 0 || end === 0) return []
    const tooSmall = (status: number) => (status & R.Detour.DT_BUFFER_TOO_SMALL) !== 0
    let found = query.findPath(start, end, a, b, { filter, maxPathPolys: Math.min(WAY_POLYS, nodes) })
    // A corridor is never longer than the nodes its search had.
    if (tooSmall(found.status) && nodes > WAY_POLYS) {
        found.polys.destroy()
        found = query.findPath(start, end, a, b, { filter, maxPathPolys: nodes })
    }
    const polys = found.polys
    try {
        if (!R.statusSucceed(found.status) || polys.size === 0) return []
        let goal = b
        const last = polys.get(polys.size - 1)
        if (last !== end) {
            const near = query.closestPointOnPoly(last, b)
            if (!R.statusSucceed(near.status)) return []
            goal = near.closestPoint
        }
        // A corner a polygon and the two ends is room enough; asked again with more should Detour ever want it.
        for (let room = polys.size + 2; ; room *= 2) {
            const s = query.findStraightPath(a, goal, polys, { maxStraightPathPoints: room })
            try {
                if (!R.statusSucceed(s.status)) return []
                if (tooSmall(s.status)) continue
                const points: Vec3[] = []
                for (let i = 0; i < s.straightPathCount; i++) points.push(Object.freeze([s.straightPath.get(i * 3), s.straightPath.get(i * 3 + 1), s.straightPath.get(i * 3 + 2)]) as unknown as Vec3)
                // Detour gives one point, not two, when both ends are one place.
                return points.length <= 1 ? points : points.slice(1)
            } finally {
                s.straightPath.destroy(); s.straightPathFlags.destroy(); s.straightPathRefs.destroy()
            }
        }
    } finally {
        polys.destroy()
    }
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

/** A body's inside, which is never floor: its footprint's corners in x and z, in order, and its bottom and top. */
export interface NavSolid {
    poly: readonly number[]
    ymin: number
    ymax: number
}

/** A box of floor marked as an area, its footprint as a solid's. Area 0 is no floor; 1 to 15 are named areas. */
export interface NavArea {
    poly: readonly number[]
    hmin: number
    hmax: number
    area: number
}

const RC_NULL_AREA = 0
const RC_WALKABLE_AREA = 63

/**
 * Detour's polygons for one tile of triangles, by Recast's own steps
 * (rasterize, filter, mark, erode, regions, contours, polygons, detail), the
 * loop generateSoloNavMesh and generateTiledNavMesh run. Recast rasterizes
 * surfaces, so the floor inside a body taller than the walker reads as a
 * room: each solid's inside is marked unwalkable, up to a cell below its top,
 * which stays floor. Solids and areas are marked before the erosion, so the
 * walker keeps its radius off a block as off a wall. The solo nav is one of
 * these over everything, the tiled nav one per tile, so the two agree.
 * Throws the step that failed; null when there is no floor.
 */
export function buildNavTile(R: Recast, ctx: any, base: any, verts: ArrayLike<number>, tris: ArrayLike<number>, bmin: [number, number, number], bmax: [number, number, number],
    solids: readonly NavSolid[], areas: readonly NavArea[], tile: { x: number, z: number, maxPolys: number } | null): any {
    const nt = tris.length / 3
    const config = R.cloneRcConfig(base)
    for (let i = 0; i < 3; i++) { config.set_bmin(i, bmin[i]); config.set_bmax(i, bmax[i]) }
    const cs = config.cs, ch = config.ch
    const va = new R.VerticesArray(), ta = new R.TrianglesArray(), triAreas = new R.TriangleAreasArray()
    const hf = R.allocHeightfield(), chf = R.allocCompactHeightfield()
    const cset = R.allocContourSet(), pmesh = R.allocPolyMesh(), dmesh = R.allocPolyMeshDetail()
    try {
        va.copy(verts as any)
        ta.copy(tris as any)
        triAreas.resize(nt)
        if (!R.createHeightfield(ctx, hf, config.width, config.height, bmin, bmax, cs, ch)) throw new Error("the heightfield")
        R.markWalkableTriangles(ctx, config.walkableSlopeAngle, va, verts.length / 3, ta, nt, triAreas)
        if (!R.rasterizeTriangles(ctx, va, verts.length / 3, ta, triAreas, nt, hf, config.walkableClimb)) throw new Error("rasterizing")
        R.filterLowHangingWalkableObstacles(ctx, config.walkableClimb, hf)
        R.filterLedgeSpans(ctx, config.walkableHeight, config.walkableClimb, hf)
        R.filterWalkableLowHeightSpans(ctx, config.walkableHeight, hf)
        if (!R.buildCompactHeightfield(ctx, config.walkableHeight, config.walkableClimb, hf, chf)) throw new Error("the compact heightfield")
        const markBox = (xz: readonly number[], hmin: number, hmax: number, area: number) => {
            const poly = new R.VerticesArray()
            poly.copy([xz[0]!, 0, xz[1]!, xz[2]!, 0, xz[3]!, xz[4]!, 0, xz[5]!, xz[6]!, 0, xz[7]!])
            R.markConvexPolyArea(ctx, poly, 4, hmin, hmax, area, chf)
            poly.destroy()
        }
        for (const s of solids) markBox(s.poly, s.ymin - ch, s.ymax - ch * 2, RC_NULL_AREA)
        for (const a of areas) markBox(a.poly, a.hmin, a.hmax, a.area)
        if (!R.erodeWalkableArea(ctx, config.walkableRadius, chf)) throw new Error("eroding")
        if (!R.buildDistanceField(ctx, chf)) throw new Error("the distance field")
        if (!R.buildRegions(ctx, chf, config.borderSize, config.minRegionArea, config.mergeRegionArea)) throw new Error("regions")
        if (!R.buildContours(ctx, chf, config.maxSimplificationError, config.maxEdgeLen, cset, R.Recast.RC_CONTOUR_TESS_WALL_EDGES)) throw new Error("contours")
        if (!R.buildPolyMesh(ctx, cset, config.maxVertsPerPoly, pmesh)) throw new Error("polygons")
        const npolys = pmesh.npolys()
        if (npolys === 0) return null
        if (tile !== null && npolys > tile.maxPolys) throw new Error(`${npolys} polygons, more than a tile holds (${tile.maxPolys}); use a smaller tile`)
        if (!R.buildPolyMeshDetail(ctx, pmesh, chf, config.detailSampleDist, config.detailSampleMaxError, dmesh)) throw new Error("the detail mesh")
        // Plain floor is area 0; a named area keeps its number for the filter's costs. Each area is one flag bit, for `avoid`.
        for (let i = 0; i < npolys; i++) {
            const a = pmesh.areas(i) === RC_WALKABLE_AREA ? 0 : pmesh.areas(i)
            pmesh.setAreas(i, a)
            pmesh.setFlags(i, 1 << a)
        }
        const params = new R.NavMeshCreateParams()
        params.setPolyMeshCreateParams(pmesh)
        params.setPolyMeshDetailCreateParams(dmesh)
        params.setWalkableHeight(config.walkableHeight * ch)
        params.setWalkableRadius(config.walkableRadius * cs)
        params.setWalkableClimb(config.walkableClimb * ch)
        params.setCellSize(cs)
        params.setCellHeight(ch)
        params.setBuildBvTree(true)
        if (tile !== null) {
            params.setTileX(tile.x)
            params.setTileY(tile.z)
        }
        const made = R.createNavMeshData(params)
        params.destroy()
        if (!made.success) throw new Error("the Detour data")
        return made.navMeshData
    } finally {
        va.destroy(); ta.destroy(); triAreas.destroy()
        R.freeHeightfield(hf); R.freeCompactHeightfield(chf)
        R.freeContourSet(cset); R.freePolyMesh(pmesh); R.freePolyMeshDetail(dmesh)
        R.Raw.destroy(config)
    }
}

/** Recast's config for a walker, the cell sizes and its build counts as generateSoloNavMesh and generateTiledNavMesh set them. */
export function navConfig(R: Recast, cs: number, o: NavOptions, extra: { tileSize?: number, borderSize?: number } = {}): any {
    const radius = o.radius ?? NAV_DEFAULTS.radius
    const ch = cs / 2
    const c = R.createRcConfig({
        cs, ch, ...extra,
        walkableRadius: Math.ceil(radius / cs),
        walkableHeight: Math.ceil((o.height ?? NAV_DEFAULTS.height) / ch),
        walkableClimb: Math.floor((o.stepHeight ?? NAV_DEFAULTS.stepHeight) / ch),
        walkableSlopeAngle: o.slope ?? NAV_DEFAULTS.slope,
    })
    // Areas squared, detail distances in world units. detailSampleDist is counted in cells, and under 0.9 crashes Recast.
    c.minRegionArea = c.minRegionArea * c.minRegionArea
    c.mergeRegionArea = c.mergeRegionArea * c.mergeRegionArea
    c.detailSampleDist = c.detailSampleDist < 0.9 ? 0 : cs * c.detailSampleDist
    c.detailSampleMaxError = ch * c.detailSampleMaxError
    return c
}

/**
 * A navigation mesh over these triangles, which must face up where they are
 * floor, with no floor inside `solids`. One tile over all of them.
 */
export async function buildNav(vertices: Float32Array, indices: Uint32Array, o: NavOptions = {}, solids: readonly NavSolid[] = []): Promise<Nav> {
    const R = await loadRecast()
    const radius = o.radius ?? NAV_DEFAULTS.radius
    const cs = o.cell ?? Math.max(0.05, radius / 3)
    const bmin: [number, number, number] = [Infinity, Infinity, Infinity], bmax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const i of indices) for (let k = 0; k < 3; k++) {
        const v = vertices[i * 3 + k]!
        if (v < bmin[k]!) bmin[k] = v
        if (v > bmax[k]!) bmax[k] = v
    }
    const config = navConfig(R, cs, o)
    const grid = R.calcGridSize(bmin, bmax, cs)
    config.width = grid.width
    config.height = grid.height
    const ctx = new R.RecastBuildContext()
    let data: any
    try {
        data = buildNavTile(R, ctx, config, vertices, indices, bmin, bmax, solids, [], null)
    } catch (e) {
        // Not Error's second argument: a cart typechecks this file under its own lib, which may be older than ES2022.
        throw Object.assign(new Error(`[oj] the navigation mesh did not build: ${e instanceof Error ? e.message : String(e)}`), { cause: e })
    } finally {
        R.Raw.destroy(config)
        ctx.destroy()
    }
    if (data === null) throw new Error("[oj] the navigation mesh did not build: no walkable floor")
    const navMesh = new R.NavMesh()
    if (!navMesh.initSolo(data)) {
        data.destroy()
        navMesh.destroy()
        throw new Error("[oj] the navigation mesh did not build: Detour refused it")
    }
    const nodes = navNodes(navMesh.getTile(0).header()!.polyCount(), 1)
    const query = new R.NavMeshQuery(navMesh, { maxNodes: nodes })
    const reach = navReach(radius, o.height ?? NAV_DEFAULTS.height)
    let gone = false
    const live = () => { if (gone) throw new Error("[oj] this nav was disposed") }
    return {
        path(from: Vec3, to: Vec3): Vec3[] {
            live()
            return wayOn(R, query, from, to, reach, query.defaultFilter, nodes)
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
