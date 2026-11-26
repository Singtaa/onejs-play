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
 * Each tile is built by `buildNavTile` (nav.ts), Recast's own per tile steps
 * (rasterize, filter, mark, erode, regions, contours, polygons, detail), the
 * loop generateTiledNavMesh runs, from functions @recast-navigation/core
 * exports, with the marks applied before the erosion so a block keeps the
 * walker's radius off it as a wall does. The solo nav is one such tile. Not Detour's TileCache: the wasm oj ships binds no way to take a
 * tile out of one, so a tile built there can never be built again.
 */

import type { Vec3 } from "../models"
import { NAV_DEFAULTS, buildNavTile, cornersOf, floorOf, loadRecast, navConfig, navReach, nearestOn, type Nav, type NavOptions, type NavSolid, type Recast } from "./nav"

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
    /**
     * The tiles as built now, to be given back as `kept` to a nav made
     * later over the same world: a server's restart reads its navmesh back
     * instead of building it. Each tile carries a hash of what it was built
     * from, so a later nav keeps only the tiles its world still matches.
     */
    exportTiles(): Uint8Array
    /** What became of `kept`: how many tiles were taken in, or why none were. Null when none was given. */
    readonly kept: KeptTiles | null
}

/** A tiled nav's options. */
export interface TiledNavOptions extends NavOptions {
    /** Tile edge, metres. */
    tile: number
    /**
     * Tiles from `exportTiles`. The nav takes them in as built and builds
     * nothing when made: add the marks and blocks the world had, then
     * `update(Infinity)`. Each tile whose bodies, marks and blocks hash as
     * they did when it was built stays as it is; any other is built again.
     * Kept tiles made with other settings are refused whole, and the nav
     * builds every tile, as it would with none.
     */
    kept?: Uint8Array
}

/** The answer to `kept`. */
export interface KeptTiles {
    /** Tiles taken in. Those the world no longer matches are built again at the next update. */
    tiles: number
    /** Why none were taken, or null. */
    why: string | null
}

/** The geometry a tiled nav follows: a world's static bodies, as triangles, and word when they change. */
export interface NavSource<B extends object> {
    /** Every body that may count. */
    bodies(): Iterable<B>
    /** Its triangles in the world, or null when it does not count: destroyed, a trigger, on another layer. */
    triangles(body: B): NavGeometry | null
    /** Calls back with a body that changed, or null when any may have. Returns the unsubscribe. */
    watch(changed: (body: B | null) => void): () => void
}

/** A body's surface in the world, and for a box standing upright its inside, which is never floor. */
export interface NavGeometry {
    vertices: Float32Array
    indices: Uint32Array
    solid?: NavSolid
}

/** What the budget is timed by: its own, since Recast's build timers read performance.now too, and a test replaces this one alone. */
export const navClock = { now: (): number => performance.now() }

/** The default frame budget, milliseconds. */
export const NAV_BUDGET = 1

/** 2^12 tiles and 2^10 polygons a tile share Detour's 22 bits of a polygon id. */
const TILE_BITS = 12
const POLY_BITS = 22 - TILE_BITS
const MAX_AREAS = 15

/** A body's triangles in the world and the tiles they reach, cached while it stays put. */
interface Entry {
    vertices: Float32Array
    indices: Uint32Array
    solid: NavGeometry["solid"]
    tiles: number[]
    /** Its triangles and solid, hashed once when read: a tile's hash is the sum of its bodies'. */
    hash: TileHash
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

export async function buildTiledNav<B extends object>(source: NavSource<B>, o: TiledNavOptions): Promise<TiledNavInternal> {
    const R = await loadRecast()
    const nav = new TiledNavImpl(R, source, o)
    if (o.kept === undefined) nav.update(Infinity)
    else nav.take(o.kept)
    return nav
}

/** What a kept tile was built from, as two 32 bit lanes. Equal inputs, in any order of bodies, marks and solids, hash equal. */
type TileHash = [number, number]

/** Kept tiles: "OJNAV", a version byte, the length of the JSON that follows, the JSON, then Recast's own export of the navmesh. */
const KEPT_MAGIC = [0x4f, 0x4a, 0x4e, 0x41, 0x56]
const KEPT_VERSION = 1
const KEPT_HEAD = KEPT_MAGIC.length + 1 + 4

interface KeptJson {
    /** What the tiles were built with; a nav takes them only with the same. */
    settings: Record<string, number>
    /** Area names in id order: id 1 is the first. */
    areas: string[]
    /** Each tile built or found empty: x, z, its hash, and 1 when it is in the navmesh. */
    tiles: [number, number, number, number, 0 | 1][]
}

/** One item's words, mixed into two lanes (murmur3's finaliser on each word). */
class Mixer {
    a = 0x9e3779b9
    b = 0x85ebca6b
    private readonly f32 = new Float32Array(1)
    private readonly u32 = new Uint32Array(this.f32.buffer)
    constructor(kind: number) { this.word(kind) }
    word(w: number): void {
        let k = Math.imul(w | 0, 0xcc9e2d51)
        k = (k << 15) | (k >>> 17)
        k = Math.imul(k, 0x1b873593)
        this.a ^= k
        this.a = Math.imul((this.a << 13) | (this.a >>> 19), 5) + 0xe6546b64 | 0
        this.b = Math.imul(this.b ^ (k >>> 7) ^ w, 0x27d4eb2f) + 0x165667b1 | 0
    }
    /** A number as the float Recast reads it. */
    float(x: number): void {
        this.f32[0] = x
        this.word(this.u32[0]!)
    }
    end(): TileHash {
        const fin = (h: number) => {
            h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b)
            h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35)
            return (h ^ (h >>> 16)) >>> 0
        }
        return [fin(this.a), fin(this.b ^ this.a)]
    }
}

/** JSON as ASCII bytes, an area name's other letters escaped: no TextEncoder, which a OneJS app on QuickJS does not have. */
function asciiJson(value: unknown): Uint8Array {
    const text = JSON.stringify(value).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
    const out = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
    return out
}

function asciiText(bytes: Uint8Array): string {
    let text = ""
    for (let i = 0; i < bytes.length; i += 4096) text += String.fromCharCode(...bytes.subarray(i, i + 4096))
    return text
}

/** A body's triangles, as Recast reads them, and its solid. */
function bodyHash(vertices: Float32Array, indices: Uint32Array, solid: NavSolid | undefined): TileHash {
    const m = new Mixer(1)
    const words = new Uint32Array(vertices.buffer, vertices.byteOffset, vertices.length)
    m.word(words.length)
    for (let i = 0; i < words.length; i++) m.word(words[i]!)
    m.word(indices.length)
    for (let i = 0; i < indices.length; i++) m.word(indices[i]!)
    if (solid !== undefined) {
        m.word(2)
        for (const x of solid.poly) m.float(x)
        m.float(solid.ymin); m.float(solid.ymax)
    }
    return m.end()
}

/** Items summed lane by lane, so their order does not count. */
const addHash = (to: TileHash, h: TileHash) => { to[0] = (to[0] + h[0]) >>> 0; to[1] = (to[1] + h[1]) >>> 0 }

class TiledNavImpl<B extends object> implements TiledNavInternal {
    readonly tileSize: number
    readonly budget: number
    private readonly cs: number
    private readonly ch: number
    private readonly cells: number
    private readonly border: number
    private readonly config: any
    private navMesh: any
    private query: any
    private readonly filter: any
    private readonly ctx: any
    private readonly reach: { x: number, y: number, z: number }
    private readonly entries = new Map<B, Entry>()
    private readonly byTile = new Map<number, Set<B>>()
    private readonly marksByTile = new Map<number, Set<Mark>>()
    private readonly built = new Map<number, number>()
    /** What each tile was last built from, built or found empty, so a tile asked to build from the same is left as it is. */
    private readonly held = new Map<number, TileHash>()
    private keptAnswer: KeptTiles | null = null
    private readonly stale = new Set<number>()
    /** Bodies changed since the last update, read then, since a mesh body's triangles come after it is made. */
    private readonly changed = new Set<B>()
    private rescan = true
    private readonly areas = new Map<string, number>()
    private readonly unwatch: () => void
    private gone = false

    constructor(private readonly R: Recast, private readonly source: NavSource<B>, o: TiledNavOptions) {
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
        this.config = navConfig(R, this.cs, o, { tileSize: this.cells, borderSize: this.border })
        this.config.width = this.cells + this.border * 2
        this.config.height = this.cells + this.border * 2
        this.navMesh = new R.NavMesh()
        const params = R.NavMeshParams.create({ orig: { x: 0, y: 0, z: 0 }, tileWidth: this.tileSize, tileHeight: this.tileSize, maxTiles: 1 << TILE_BITS, maxPolys: 1 << POLY_BITS })
        if (!this.navMesh.initTiled(params)) throw new Error("[oj] world.nav: the tiled navigation mesh did not start")
        this.query = new R.NavMeshQuery(this.navMesh, { maxNodes: 8192 })
        this.filter = new R.QueryFilter()
        this.ctx = new R.RecastBuildContext()
        this.reach = navReach(radius, height)
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
    get kept(): KeptTiles | null { return this.keptAnswer }

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
        const { vertices, indices, solid } = t
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
        this.entries.set(b, { vertices, indices, solid, tiles, hash: bodyHash(vertices, indices, solid) })
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
        const start = navClock.now()
        this.settle()
        if (!(ms > 0)) return this.stale.size
        let n = 0
        for (const k of this.stale) {
            // At least one a call, so a frame always gets somewhere, then while the time lasts.
            if (n++ > 0 && navClock.now() - start >= ms) break
            this.stale.delete(k)
            this.buildTile(k)
        }
        return this.stale.size
    }

    // ---------- one tile ----------

    private buildTile(k: number): void {
        const R = this.R, [tx, tz] = unkey(k)
        const bodies = this.byTile.get(k)
        if (bodies === undefined || bodies.size === 0) {
            this.byTile.delete(k)
            this.dropTile(k)
            return
        }
        // What the tile is built from: its bodies, each hashed once when read, and its marks.
        const marks = [...this.marksByTile.get(k) ?? []]
        const hash: TileHash = [0, 0]
        for (const b of bodies) addHash(hash, this.entries.get(b)!.hash)
        for (const m of marks) {
            const s = new Mixer(3)
            for (const x of m.poly) s.float(x)
            s.float(m.hmin); s.float(m.hmax); s.word(m.area)
            addHash(hash, s.end())
        }
        // Asked to build from what it was built from, built or found empty: nothing to do, not even reading its triangles.
        // A mark added and taken away, a body made again the same, or a kept tile the world still matches.
        const held = this.held.get(k)
        if (held !== undefined && held[0] === hash[0] && held[1] === hash[1]) return
        this.dropTile(k)
        const g = this.gather(k, bodies)
        // Geometry in the apron alone makes no polygons: empty, and known to be.
        this.held.set(k, hash)
        if (g === null) return
        try {
            const data = buildNavTile(R, this.ctx, this.config, g.verts, g.tris, g.bmin, g.bmax, g.solids, marks, { x: tx, z: tz, maxPolys: 1 << POLY_BITS })
            if (data === null) return
            const added = this.navMesh.addTile(data, R.Detour.DT_TILE_FREE_DATA, 0)
            // The navmesh owns the bytes now and frees them with the tile; let go of the wrapper alone.
            data.raw.isView = true
            data.destroy()
            if (R.statusFailed(added.status)) throw new Error(`adding it (${R.statusToReadableString(added.status)})`)
            this.built.set(k, added.tileRef)
        } catch (e) {
            // Not known: tried again when next stale.
            this.held.delete(k)
            console.error(`[oj] world.nav: tile ${tx}, ${tz} did not build: ${e instanceof Error ? e.message : String(e)}`)
        }
    }

    /** The triangles that reach into a tile and its apron, or null when none reaches inside the tile proper. */
    private gather(k: number, bodies: Set<B>): { verts: number[], tris: number[], bmin: [number, number, number], bmax: [number, number, number], solids: NavSolid[] } | null {
        const [tx, tz] = unkey(k)
        const w = this.tileSize, apron = this.border * this.cs
        const ix0 = tx * w, ix1 = (tx + 1) * w, iz0 = tz * w, iz1 = (tz + 1) * w
        const x0 = ix0 - apron, x1 = ix1 + apron, z0 = iz0 - apron, z1 = iz1 + apron
        const verts: number[] = [], tris: number[] = []
        let minY = Infinity, maxY = -Infinity
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
                    const v = ei[i * 3 + j]!
                    let m = remap.get(v)
                    if (m === undefined) {
                        m = verts.length / 3
                        remap.set(v, m)
                        const y = ev[v * 3 + 1]!
                        verts.push(ev[v * 3]!, y, ev[v * 3 + 2]!)
                        if (y < minY) minY = y
                        if (y > maxY) maxY = y
                    }
                    tris.push(m)
                }
            }
        }
        if (!inside) return null
        const solids: NavSolid[] = []
        for (const b of bodies) {
            const sd = this.entries.get(b)!.solid
            if (sd !== undefined) solids.push(sd)
        }
        return { verts, tris, bmin: [x0, minY - 1, z0], bmax: [x1, maxY + 1, z1], solids }
    }

    /** Takes a tile out of the navmesh, if it is in, and forgets what it was built from. */
    private dropTile(k: number): void {
        this.held.delete(k)
        const old = this.built.get(k)
        if (old === undefined) return
        this.navMesh.removeTile(old)
        this.built.delete(k)
    }

    // ---------- kept tiles ----------

    /** What a tile's bytes depend on beyond its geometry and marks: a nav takes kept tiles only when every one is the same. */
    private settings(): Record<string, number> {
        const c = this.config
        const out: Record<string, number> = { tile: this.tileSize, cells: this.cells, tileBits: TILE_BITS, polyBits: POLY_BITS }
        for (const name of ["cs", "ch", "borderSize", "walkableRadius", "walkableHeight", "walkableClimb", "walkableSlopeAngle", "maxEdgeLen",
            "maxSimplificationError", "minRegionArea", "mergeRegionArea", "maxVertsPerPoly", "detailSampleDist", "detailSampleMaxError"]) out[name] = c[name]
        return out
    }

    exportTiles(): Uint8Array {
        this.live()
        const tiles: KeptJson["tiles"] = []
        for (const [k, h] of this.held) {
            const [tx, tz] = unkey(k)
            tiles.push([tx, tz, h[0], h[1], this.built.has(k) ? 1 : 0])
        }
        const json = asciiJson({ settings: this.settings(), areas: [...this.areas.keys()], tiles } satisfies KeptJson)
        const mesh: Uint8Array = this.R.exportNavMesh(this.navMesh)
        const out = new Uint8Array(KEPT_HEAD + json.length + mesh.length)
        out.set(KEPT_MAGIC, 0)
        out[KEPT_MAGIC.length] = KEPT_VERSION
        new DataView(out.buffer).setUint32(KEPT_MAGIC.length + 1, json.length, true)
        out.set(json, KEPT_HEAD)
        out.set(mesh, KEPT_HEAD + json.length)
        return out
    }

    /** Kept tiles in, before anything is built; the answer is in `kept`. */
    take(data: Uint8Array): void {
        const refuse = (why: string) => {
            this.keptAnswer = { tiles: 0, why }
            console.warn(`[oj] world.nav: the kept tiles were not taken: ${why}. Every tile is built instead.`)
        }
        if (!(data instanceof Uint8Array) || data.length < KEPT_HEAD || KEPT_MAGIC.some((b, i) => data[i] !== b)) return refuse("they are not tiles from exportTiles")
        if (data[KEPT_MAGIC.length] !== KEPT_VERSION) return refuse(`they are version ${data[KEPT_MAGIC.length]} and this ojplay reads ${KEPT_VERSION}`)
        const jsonLength = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(KEPT_MAGIC.length + 1, true)
        if (KEPT_HEAD + jsonLength > data.length) return refuse("they are cut short")
        let kept: KeptJson
        try { kept = JSON.parse(asciiText(data.subarray(KEPT_HEAD, KEPT_HEAD + jsonLength))) } catch { return refuse("their description does not read") }
        if (kept === null || typeof kept !== "object" || !Array.isArray(kept.tiles) || !Array.isArray(kept.areas) || typeof kept.settings !== "object" || kept.settings === null) return refuse("their description does not read")
        const mine = this.settings()
        const differ = Object.keys({ ...mine, ...kept.settings }).filter((n) => mine[n] !== kept.settings[n])
        if (differ.length > 0) return refuse(`they were built with other settings (${differ.map((n) => `${n} ${kept.settings[n]} here ${mine[n]}`).join(", ")})`)
        if (kept.areas.length > MAX_AREAS || !kept.areas.every((a) => typeof a === "string" && a !== "") || new Set(kept.areas).size !== kept.areas.length) return refuse("their area names do not read")
        const hashes = new Map<number, TileHash>(), inMesh = new Set<number>()
        for (const t of kept.tiles) {
            if (!Array.isArray(t) || t.length !== 5 || !t.every(Number.isInteger) || (t[4] !== 0 && t[4] !== 1)) return refuse("their description does not read")
            const k = key(t[0], t[1])
            hashes.set(k, [t[2] >>> 0, t[3] >>> 0])
            if (t[4] === 1) inMesh.add(k)
        }
        let mesh: any
        try { mesh = this.R.importNavMesh(data.subarray(KEPT_HEAD + jsonLength)).navMesh } catch (e) { return refuse(`Recast did not read them (${e instanceof Error ? e.message : String(e)})`) }
        // Each tile Recast read, by its place; a tile the description does not name is not kept.
        const taken = new Map<number, number>()
        const max = mesh.getMaxTiles()
        for (let i = 0; i < max; i++) {
            const tile = mesh.getTile(i), header = tile.header()
            if (header === null) continue
            const k = key(header.x(), header.y())
            if (inMesh.has(k)) taken.set(k, mesh.getTileRef(tile))
            else mesh.removeTile(mesh.getTileRef(tile))
        }
        if (taken.size !== inMesh.size) {
            mesh.destroy()
            return refuse(`they name ${inMesh.size} tiles and hold ${taken.size}`)
        }
        // The kept navmesh is this nav's now. Nothing was built into the one it replaces.
        this.query.destroy()
        this.navMesh.destroy()
        this.navMesh = mesh
        this.query = new this.R.NavMeshQuery(mesh, { maxNodes: 8192 })
        for (const [k, ref] of taken) this.built.set(k, ref)
        for (const [k, h] of hashes) {
            this.held.set(k, h)
            // Asked of the world at the next update: kept (or kept empty) if it still matches, built again if not, dropped if nothing is there now.
            this.stale.add(k)
        }
        // The names in the same order, so a mark gets the id its kept tiles hold.
        for (const name of kept.areas) this.areaId(name)
        this.keptAnswer = { tiles: taken.size, why: null }
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
        return cornersOf(this.query.computePath({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, { halfExtents: this.reach, filter: f, maxPathPolys: 1024 }))
    }

    nearest(point: Vec3, within?: number): Vec3 | null {
        this.live()
        // Any floor, an avoided area's included: what is nearest does not depend on a path's wishes.
        this.filter.excludeFlags = 0
        return nearestOn(this.query, point, this.reach, within, this.filter)
    }

    polygons(): { positions: Float32Array, indices: Uint32Array } {
        this.live()
        return floorOf(this.R, this.navMesh)
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
