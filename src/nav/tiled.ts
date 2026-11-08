/**
 * A navmesh in tiles that follows the world: `world.nav({ tile })`.
 *
 *     const nav = await world.nav({ radius: 0.4, tile: 16 })
 *     const hut = world.box({ at: [40, 4, 12], size: [20, 8, 20] })   // the nav reroutes round it
 *     hut.destroy()                                                   // and back
 *     const fire = nav.block({ at: [8, 0, 3], size: [2, 2, 2] })      // no collider, still no way through
 *     bot.path = nav.path(bot.position, goal, { cost: { road: 0.5 } })
 *
 * The floor is cut into squares `tile` metres across, pinned to the world's
 * origin, so two builds always agree on where a tile is and Detour joins
 * their edges. A tile is built from the static bodies whose bounds touch it,
 * with an apron of the walker's radius and three cells, so it knows what lies
 * just over its edge.
 *
 * The world is the one source. A static body made, destroyed or moved marks
 * the tiles it touches as stale, and the world rebuilds stale tiles after
 * each frame, a tile at a time while the frame's `budget` lasts. So a
 * collider and its path change together, with nothing for a cart to keep in
 * step. `block` and `mark` change the floor where there is no collider: a
 * fire, a road. They mark tiles stale the same way.
 *
 * Built with Recast's own per tile steps (rasterize, filter, erode, mark,
 * regions, contours, polygons, detail), the loop generateTiledNavMesh runs,
 * from functions @recast-navigation/core exports, with the marks applied
 * before the erosion so a block keeps the walker's radius off it as a wall
 * does. Not Detour's TileCache: the wasm oj ships binds no way to take a
 * tile out of one, so a tile built there can never be built again.
 */

import type { Vec3 } from "../models"
import { NAV_DEFAULTS, loadRecast, type Nav, type NavOptions, type Recast } from "./nav"

/** Where `block` and `mark` change the floor: a box, turned about y by `yaw` degrees. */
export interface NavBox {
    /** Its middle. */
    at: Vec3
    /** Width, height, depth. */
    size: Vec3
    /** Degrees about y. 0 by default. */
    yaw?: number
}

export interface NavMarkOptions extends NavBox {
    /** The area's name, which `path`'s `cost` and `avoid` refer to. Up to 15 names a nav. */
    area: string
}

/** A block or a mark, until removed. */
export interface NavMark {
    readonly alive: boolean
    remove(): void
}

export interface PathOptions {
    /** How much a metre across each named area costs, against 1 for plain floor: 0.5 is a road, 3 is mud. */
    cost?: Readonly<Record<string, number>>
    /** Areas never crossed. */
    avoid?: readonly string[]
}

export interface TiledNav extends Nav {
    path(from: Vec3, to: Vec3, options?: PathOptions): Vec3[]
    /** Nobody walks here, collider or not. Its tiles rebuild with the world's. */
    block(box: NavBox): NavMark
    /** Floor here is `area`, which a path can cost or avoid. */
    mark(options: NavMarkOptions): NavMark
    /**
     * Rebuilds stale tiles, a tile at a time, starting another while less
     * than `ms` milliseconds have passed, and returns how many are still
     * stale. Any `ms` above 0 builds at least one. The world calls it after each
     * frame with the nav's `budget`; call it to catch up sooner, or with
     * `budget: 0` to keep the timing yours.
     */
    update(ms?: number): number
    /** Tiles waiting to be rebuilt. */
    readonly pending: number
    /** Tiles built. */
    readonly tiles: number
    /** Tile edge, metres. */
    readonly tileSize: number
}

/** The geometry a tiled nav follows: a world's static bodies, as triangles, and word when they change. */
export interface NavSource<B extends object> {
    /** Every body that may count. */
    bodies(): Iterable<B>
    /** Its triangles in the world, or null when it does not count: destroyed, a trigger, on another layer. */
    triangles(body: B): { vertices: Float32Array, indices: Uint32Array } | null
    /** Calls back with a body that changed, or null when any may have. Returns the unsubscribe. */
    watch(changed: (body: B | null) => void): () => void
}

/** The default frame budget, milliseconds. */
export const NAV_BUDGET = 1

const RC_NULL_AREA = 0
const RC_WALKABLE_AREA = 63
/** 2^12 tiles and 2^10 polygons a tile share Detour's 22 bits of a polygon id. */
const TILE_BITS = 12
const POLY_BITS = 22 - TILE_BITS
const MAX_AREAS = 15

/** A body's triangles in the world and the tiles they reach, cached while it stays put. */
interface Entry {
    vertices: Float32Array
    indices: Uint32Array
    tiles: number[]
}

interface Mark {
    /** The box's corners in x and z, in order. */
    poly: number[]
    hmin: number
    hmax: number
    /** 0 blocks; 1 to 15 are named areas. */
    area: number
    tiles: number[]
}

const key = (tx: number, tz: number) => (tx + 32768) * 65536 + (tz + 32768)
const unkey = (k: number): [number, number] => [Math.floor(k / 65536) - 32768, (k % 65536) - 32768]

/** What the world keeps of a tiled nav it steps. */
export interface TiledNavInternal extends TiledNav {
    readonly disposed: boolean
    readonly budget: number
}

export async function buildTiledNav<B extends object>(source: NavSource<B>, o: NavOptions & { tile: number }): Promise<TiledNavInternal> {
    const R = await loadRecast()
    const nav = new TiledNavImpl(R, source, o)
    nav.update(Infinity)
    return nav
}

class TiledNavImpl<B extends object> implements TiledNavInternal {
    readonly tileSize: number
    readonly budget: number
    private readonly cs: number
    private readonly ch: number
    private readonly cells: number
    private readonly border: number
    private readonly config: any
    private readonly navMesh: any
    private readonly query: any
    private readonly filter: any
    private readonly ctx: any
    private readonly reach: { x: number, y: number, z: number }
    private readonly entries = new Map<B, Entry>()
    private readonly byTile = new Map<number, Set<B>>()
    private readonly marksByTile = new Map<number, Set<Mark>>()
    private readonly built = new Map<number, number>()
    private readonly stale = new Set<number>()
    /** Bodies changed since the last update, read then, since a mesh body's triangles come after it is made. */
    private readonly changed = new Set<B>()
    private rescan = true
    private readonly areas = new Map<string, number>()
    private readonly unwatch: () => void
    private gone = false

    constructor(private readonly R: Recast, private readonly source: NavSource<B>, o: NavOptions & { tile: number }) {
        const radius = o.radius ?? NAV_DEFAULTS.radius
        const height = o.height ?? NAV_DEFAULTS.height
        // A whole number of cells to a tile, the tile exactly as asked: tiles of 16 m line up with 64 m chunks. The cell gives, by under half a cell a tile.
        const cell = o.cell ?? Math.max(0.05, radius / 3)
        if (!(o.tile > 0 && Number.isFinite(o.tile))) throw new Error(`[oj] world.nav: tile is metres across a tile, not ${o.tile}`)
        this.cells = Math.round(o.tile / cell)
        if (!(this.cells >= 8 && this.cells <= 1024)) throw new Error(`[oj] world.nav: a tile of ${o.tile} m is ${this.cells} cells of ${cell} m; make it 8 to 1024 cells`)
        this.tileSize = o.tile
        this.cs = o.tile / this.cells
        this.ch = this.cs / 2
        this.budget = o.budget ?? NAV_BUDGET
        const walkableRadius = Math.ceil(radius / this.cs)
        this.border = walkableRadius + 3
        this.config = R.createRcConfig({
            cs: this.cs, ch: this.ch,
            tileSize: this.cells,
            borderSize: this.border,
            walkableRadius,
            walkableHeight: Math.ceil(height / this.ch),
            walkableClimb: Math.floor((o.stepHeight ?? NAV_DEFAULTS.stepHeight) / this.ch),
            walkableSlopeAngle: o.slope ?? NAV_DEFAULTS.slope,
        })
        // As generateTiledNavMesh sets them: areas squared, detail distances in world units.
        const c = this.config
        c.width = this.cells + this.border * 2
        c.height = this.cells + this.border * 2
        c.minRegionArea = c.minRegionArea * c.minRegionArea
        c.mergeRegionArea = c.mergeRegionArea * c.mergeRegionArea
        c.detailSampleDist = c.detailSampleDist < 0.9 ? 0 : this.cs * c.detailSampleDist
        c.detailSampleMaxError = this.ch * c.detailSampleMaxError
        this.navMesh = new R.NavMesh()
        const params = R.NavMeshParams.create({ orig: { x: 0, y: 0, z: 0 }, tileWidth: this.tileSize, tileHeight: this.tileSize, maxTiles: 1 << TILE_BITS, maxPolys: 1 << POLY_BITS })
        if (!this.navMesh.initTiled(params)) throw new Error("[oj] world.nav: the tiled navigation mesh did not start")
        this.query = new R.NavMeshQuery(this.navMesh, { maxNodes: 8192 })
        this.filter = new R.QueryFilter()
        this.ctx = new R.RecastBuildContext()
        this.reach = { x: Math.max(1, radius * 4), y: Math.max(2, height * 2), z: Math.max(1, radius * 4) }
        this.unwatch = source.watch((b) => {
            if (b === null) this.rescan = true
            else this.changed.add(b)
        })
    }

    get disposed(): boolean { return this.gone }
    get pending(): number {
        if (!this.gone) this.settle()
        return this.stale.size
    }
    get tiles(): number { return this.built.size }

    private live(): void {
        if (this.gone) throw new Error("[oj] this nav was disposed")
    }

    // ---------- following the world ----------

    /** The tiles whose build reads geometry between these x and z bounds. */
    private tilesOver(minX: number, maxX: number, minZ: number, maxZ: number): number[] {
        const apron = this.border * this.cs, w = this.tileSize
        const out: number[] = []
        const x0 = Math.floor((minX - apron) / w), x1 = Math.floor((maxX + apron) / w)
        const z0 = Math.floor((minZ - apron) / w), z1 = Math.floor((maxZ + apron) / w)
        for (let tx = x0; tx <= x1; tx++) for (let tz = z0; tz <= z1; tz++) out.push(key(tx, tz))
        return out
    }

    private forgetBody(b: B): void {
        const e = this.entries.get(b)
        if (e === undefined) return
        this.entries.delete(b)
        for (const k of e.tiles) {
            this.byTile.get(k)?.delete(b)
            this.stale.add(k)
        }
    }

    private readBody(b: B): void {
        const t = this.source.triangles(b)
        if (t === null || t.indices.length === 0) return
        const { vertices, indices } = t
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        for (let v = 0; v < vertices.length; v += 3) {
            const x = vertices[v]!, z = vertices[v + 2]!
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (z < minZ) minZ = z
            if (z > maxZ) maxZ = z
        }
        const tiles = this.tilesOver(minX, maxX, minZ, maxZ)
        if (tiles.length > 1 << TILE_BITS) {
            console.error(`[oj] world.nav: a body ${(maxX - minX).toFixed(0)} by ${(maxZ - minZ).toFixed(0)} m touches ${tiles.length} tiles, more than a nav holds (${1 << TILE_BITS}); it is left out. Make the tiles larger, or the ground in chunks.`)
            return
        }
        this.entries.set(b, { vertices, indices, tiles })
        for (const k of tiles) {
            let set = this.byTile.get(k)
            if (set === undefined) this.byTile.set(k, set = new Set())
            set.add(b)
            this.stale.add(k)
        }
    }

    /** What changed since the last update, as stale tiles. */
    private settle(): void {
        if (this.rescan) {
            this.rescan = false
            this.changed.clear()
            for (const b of [...this.entries.keys()]) this.forgetBody(b)
            for (const b of this.source.bodies()) this.readBody(b)
            return
        }
        for (const b of this.changed) {
            this.forgetBody(b)
            this.readBody(b)
        }
        this.changed.clear()
    }

    update(ms: number = this.budget): number {
        this.live()
        const start = performance.now()
        this.settle()
        if (!(ms > 0)) return this.stale.size
        let n = 0
        for (const k of this.stale) {
            // At least one a call, so a frame always gets somewhere, then while the time lasts.
            if (n++ > 0 && performance.now() - start >= ms) break
            this.stale.delete(k)
            this.buildTile(k)
        }
        return this.stale.size
    }

    // ---------- one tile ----------

    private buildTile(k: number): void {
        const R = this.R, [tx, tz] = unkey(k)
        const old = this.built.get(k)
        if (old !== undefined) {
            this.navMesh.removeTile(old)
            this.built.delete(k)
        }
        const bodies = this.byTile.get(k)
        if (bodies === undefined || bodies.size === 0) {
            this.byTile.delete(k)
            return
        }
        // The tile and its apron, in x and z; the triangles that reach into it.
        const w = this.tileSize, apron = this.border * this.cs
        const ix0 = tx * w, ix1 = (tx + 1) * w, iz0 = tz * w, iz1 = (tz + 1) * w
        const x0 = ix0 - apron, x1 = ix1 + apron, z0 = iz0 - apron, z1 = iz1 + apron
        const verts: number[] = [], tris: number[] = []
        let minY = Infinity, maxY = -Infinity
        // Whether any of it reaches inside the tile proper: geometry in the apron alone makes no polygons.
        let inside = false
        for (const b of bodies) {
            const e = this.entries.get(b)!
            const remap = new Map<number, number>()
            const n = e.indices.length / 3, ev = e.vertices, ei = e.indices
            for (let i = 0; i < n; i++) {
                const a = ei[i * 3]! * 3, b2 = ei[i * 3 + 1]! * 3, c = ei[i * 3 + 2]! * 3
                const ax = Math.min(ev[a]!, ev[b2]!, ev[c]!), bx = Math.max(ev[a]!, ev[b2]!, ev[c]!)
                const az = Math.min(ev[a + 2]!, ev[b2 + 2]!, ev[c + 2]!), bz = Math.max(ev[a + 2]!, ev[b2 + 2]!, ev[c + 2]!)
                if (bx < x0 || ax > x1 || bz < z0 || az > z1) continue
                if (!inside && bx > ix0 && ax < ix1 && bz > iz0 && az < iz1) inside = true
                for (let j = 0; j < 3; j++) {
                    const v = e.indices[i * 3 + j]!
                    let m = remap.get(v)
                    if (m === undefined) {
                        m = verts.length / 3
                        remap.set(v, m)
                        const y = e.vertices[v * 3 + 1]!
                        verts.push(e.vertices[v * 3]!, y, e.vertices[v * 3 + 2]!)
                        if (y < minY) minY = y
                        if (y > maxY) maxY = y
                    }
                    tris.push(m)
                }
            }
        }
        if (!inside) return
        const nt = tris.length / 3
        const config = R.cloneRcConfig(this.config)
        const bmin: [number, number, number] = [x0, minY - 1, z0], bmax: [number, number, number] = [x1, maxY + 1, z1]
        for (let i = 0; i < 3; i++) { config.set_bmin(i, bmin[i]); config.set_bmax(i, bmax[i]) }
        const va = new R.VerticesArray(), ta = new R.TrianglesArray(), areas = new R.TriangleAreasArray()
        const hf = R.allocHeightfield(), chf = R.allocCompactHeightfield()
        const cset = R.allocContourSet(), pmesh = R.allocPolyMesh(), dmesh = R.allocPolyMeshDetail()
        const ctx = this.ctx
        try {
            va.copy(verts)
            ta.copy(tris)
            areas.resize(nt)
            if (!R.createHeightfield(ctx, hf, config.width, config.height, bmin, bmax, this.cs, this.ch)) throw new Error("the heightfield")
            R.markWalkableTriangles(ctx, config.walkableSlopeAngle, va, verts.length / 3, ta, nt, areas)
            if (!R.rasterizeTriangles(ctx, va, verts.length / 3, ta, areas, nt, hf, config.walkableClimb)) throw new Error("rasterizing")
            R.filterLowHangingWalkableObstacles(ctx, config.walkableClimb, hf)
            R.filterLedgeSpans(ctx, config.walkableHeight, config.walkableClimb, hf)
            R.filterWalkableLowHeightSpans(ctx, config.walkableHeight, hf)
            if (!R.buildCompactHeightfield(ctx, config.walkableHeight, config.walkableClimb, hf, chf)) throw new Error("the compact heightfield")
            // Marks before the erosion, so a block is kept clear of by the walker's radius, as a wall is.
            for (const m of this.marksByTile.get(k) ?? []) {
                const poly = new R.VerticesArray()
                poly.copy([m.poly[0]!, 0, m.poly[1]!, m.poly[2]!, 0, m.poly[3]!, m.poly[4]!, 0, m.poly[5]!, m.poly[6]!, 0, m.poly[7]!])
                R.markConvexPolyArea(ctx, poly, 4, m.hmin, m.hmax, m.area === 0 ? RC_NULL_AREA : m.area, chf)
                poly.destroy()
            }
            if (!R.erodeWalkableArea(ctx, config.walkableRadius, chf)) throw new Error("eroding")
            if (!R.buildDistanceField(ctx, chf)) throw new Error("the distance field")
            if (!R.buildRegions(ctx, chf, config.borderSize, config.minRegionArea, config.mergeRegionArea)) throw new Error("regions")
            if (!R.buildContours(ctx, chf, config.maxSimplificationError, config.maxEdgeLen, cset, R.Recast.RC_CONTOUR_TESS_WALL_EDGES)) throw new Error("contours")
            if (!R.buildPolyMesh(ctx, cset, config.maxVertsPerPoly, pmesh)) throw new Error("polygons")
            const npolys = pmesh.npolys()
            if (npolys === 0) return
            if (npolys > 1 << POLY_BITS) throw new Error(`${npolys} polygons, more than a tile holds (${1 << POLY_BITS}); use a smaller tile`)
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
            params.setWalkableHeight(config.walkableHeight * this.ch)
            params.setWalkableRadius(config.walkableRadius * this.cs)
            params.setWalkableClimb(config.walkableClimb * this.ch)
            params.setCellSize(this.cs)
            params.setCellHeight(this.ch)
            params.setBuildBvTree(true)
            params.setTileX(tx)
            params.setTileY(tz)
            const made = R.createNavMeshData(params)
            params.destroy()
            if (!made.success) throw new Error("the Detour tile")
            const added = this.navMesh.addTile(made.navMeshData, R.Detour.DT_TILE_FREE_DATA, 0)
            // The navmesh owns the bytes now and frees them with the tile; let go of the wrapper alone.
            made.navMeshData.raw.isView = true
            made.navMeshData.destroy()
            if (R.statusFailed(added.status)) throw new Error(`adding it (${R.statusToReadableString(added.status)})`)
            this.built.set(k, added.tileRef)
        } catch (e) {
            console.error(`[oj] world.nav: tile ${tx}, ${tz} did not build: ${e instanceof Error ? e.message : String(e)}`)
        } finally {
            va.destroy(); ta.destroy(); areas.destroy()
            R.freeHeightfield(hf); R.freeCompactHeightfield(chf)
            R.freeContourSet(cset); R.freePolyMesh(pmesh); R.freePolyMeshDetail(dmesh)
            R.Raw.destroy(config)
        }
    }

    // ---------- marks ----------

    private areaId(name: string): number {
        let id = this.areas.get(name)
        if (id === undefined) {
            if (this.areas.size >= MAX_AREAS) throw new Error(`[oj] a nav holds ${MAX_AREAS} areas; "${name}" would be the ${MAX_AREAS + 1}th (${[...this.areas.keys()].join(", ")})`)
            this.areas.set(name, id = this.areas.size + 1)
        }
        return id
    }

    private addMark(box: NavBox, area: number): NavMark {
        this.live()
        const [x, y, z] = box.at, [sx, sy, sz] = box.size
        if (![x, y, z, sx, sy, sz].every(Number.isFinite) || !(sx > 0 && sy > 0 && sz > 0)) throw new Error("[oj] nav.block and nav.mark take a finite at and a positive size")
        const a = ((box.yaw ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
        const poly: number[] = []
        // Turned as an actor's yaw turns it: yaw 90 turns +z to +x.
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            const lx = (u * sx) / 2, lz = (v * sz) / 2
            poly.push(x + lx * c + lz * s, z - lx * s + lz * c)
        }
        const xs = poly.filter((_, i) => i % 2 === 0), zs = poly.filter((_, i) => i % 2 === 1)
        const m: Mark = {
            poly,
            // A step below its bottom too: floor it stands on, measured up from a cell's top, is under it.
            hmin: y - sy / 2 - this.config.walkableClimb * this.ch,
            hmax: y + sy / 2,
            area,
            tiles: this.tilesOver(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)),
        }
        for (const k of m.tiles) {
            let set = this.marksByTile.get(k)
            if (set === undefined) this.marksByTile.set(k, set = new Set())
            set.add(m)
            this.stale.add(k)
        }
        let alive = true
        return {
            get alive() { return alive },
            remove: () => {
                if (!alive || this.gone) return
                alive = false
                for (const k of m.tiles) {
                    const set = this.marksByTile.get(k)
                    set?.delete(m)
                    if (set?.size === 0) this.marksByTile.delete(k)
                    this.stale.add(k)
                }
            },
        }
    }

    block(box: NavBox): NavMark { return this.addMark(box, 0) }

    mark(o: NavMarkOptions): NavMark {
        if (typeof o.area !== "string" || o.area === "") throw new Error("[oj] nav.mark needs an area name")
        return this.addMark(o, this.areaId(o.area))
    }

    // ---------- paths ----------

    private readonly unknownAreas = new Set<string>()

    /** Said once a name: a path may be asked for every frame. */
    private unknownArea(name: string): void {
        if (this.unknownAreas.has(name)) return
        this.unknownAreas.add(name)
        console.warn(`[oj] nav.path: no area called "${name}" has been marked yet, so it costs and avoids nothing. Areas so far: ${[...this.areas.keys()].join(", ") || "none"}.`)
    }

    path(from: Vec3, to: Vec3, o: PathOptions = {}): Vec3[] {
        this.live()
        const f = this.filter
        let exclude = 0
        for (const [name, id] of this.areas) {
            const cost = o.cost?.[name] ?? 1
            if (!(cost > 0) || !Number.isFinite(cost)) throw new Error(`[oj] nav.path: the cost of "${name}" must be a positive number, not ${cost}; avoid it instead`)
            f.setAreaCost(id, cost)
        }
        for (const name of o.avoid ?? []) {
            const id = this.areas.get(name)
            if (id !== undefined) exclude |= 1 << id
            else this.unknownArea(name)
        }
        for (const name of Object.keys(o.cost ?? {})) if (!this.areas.has(name)) this.unknownArea(name)
        f.includeFlags = 0xffff
        f.excludeFlags = exclude
        const r = this.query.computePath({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, { halfExtents: this.reach, filter: f, maxPathPolys: 1024 })
        if (!r.success || r.path.length === 0) return []
        return r.path.slice(1).map((p: { x: number, y: number, z: number }) => Object.freeze([p.x, p.y, p.z]) as unknown as Vec3)
    }

    dispose(): void {
        if (this.gone) return
        this.gone = true
        this.unwatch()
        this.query.destroy()
        this.navMesh.destroy()
        this.ctx.destroy()
        this.R.Raw.destroy(this.filter.raw)
    }
}
