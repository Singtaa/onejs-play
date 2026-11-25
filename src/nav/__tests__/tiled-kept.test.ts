// Kept tiles: a tiled nav's tiles exported and taken in by a nav made later over the same world
// (25 Nov 2026: a game server's restart reads its land's navmesh back instead of building every tile again).
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../../physics3d/rapier.version"
import { RECAST_VERSION } from "../recast.version"
import { createWorld, type World } from "../../physics3d/world"
import { buildTiledNav, type NavSource, type TiledNav, type TiledNavOptions } from "../tiled"
import * as navModule from "../nav"
import type { Vec3 } from "../../models"
import { hill, hills } from "./hills"

/** Every tile Recast builds, counted: a kept tile that matches is never one of them. */
const built = vi.hoisted(() => ({ n: 0 }))
vi.mock("../nav", async (importOriginal) => {
    const real = await importOriginal<typeof import("../nav")>()
    return { ...real, buildNavTile: (...args: Parameters<typeof real.buildNavTile>) => { built.n++; return real.buildNavTile(...args) } }
})

const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.join(assets, `rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.join(assets, `recast-${RECAST_VERSION}.wasm`))))
})

const AGENT = { radius: 0.4, height: 1.8, stepHeight: 0.5, slope: 45, cell: 0.33, tile: 16 }
const CHUNK = 64, N = 33

interface Land {
    /** Chunks across; huts in the order made. */
    chunks?: number
    reversed?: boolean
    /** A hut moved, for a world that differs from the one kept. */
    hutAt?: Vec3
}

/** PrimoEden's ground as heightfield chunks, with two huts on it. */
async function land(o: Land = {}): Promise<World> {
    const w = await createWorld()
    const n = o.chunks ?? 2
    const makers: (() => void)[] = []
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
        makers.push(() => { w.heightfield({ at: [cx * CHUNK, 0, cz * CHUNK], size: [CHUNK, CHUNK], heights: hills(cx * CHUNK, cz * CHUNK, N) }) })
    }
    const hut = o.hutAt ?? [40, hill(40, 40) + 2, 40]
    makers.push(() => { w.box({ at: hut, size: [8, 4, 8] }) })
    makers.push(() => { w.box({ at: [90, hill(90, 30) + 2, 30], size: [6, 4, 10], rotation: { yaw: 20 } }) })
    for (const make of o.reversed ? makers.reverse() : makers) make()
    return w
}

/** The marks the world had: a road and a fire, in this order. */
function marksOn(nav: TiledNav) {
    return [
        nav.mark({ at: [64, hill(64, 64), 64], size: [100, 6, 4], yaw: 45, area: "road" }),
        nav.mark({ at: [20, hill(20, 90), 90], size: [10, 6, 10], area: "mud" }),
        nav.block({ at: [70, hill(70, 100) + 1, 100], size: [3, 4, 3] }),
    ]
}

/** Ways across the land, corner for corner, with and without the road's cost. */
function ways(nav: TiledNav, n = 2): Vec3[][] {
    const out: Vec3[][] = []
    const span = n * CHUNK - 8
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        const fx = 4 + (span * i) / 5, fz = 4 + (span * ((i * 7 + j * 3) % 6)) / 5
        const tx = 4 + (span * j) / 5, tz = 4 + (span * ((j * 5 + i) % 6)) / 5
        out.push(nav.path([fx, hill(fx, fz), fz], [tx, hill(tx, tz), tz]))
        out.push(nav.path([fx, hill(fx, fz), fz], [tx, hill(tx, tz), tz], { cost: { road: 0.3, mud: 5 } }))
    }
    return out
}

/**
 * What kept tiles say they were built from: the settings, the areas and each tile's hash, in tile order.
 * Not the bytes: a tile built again takes another slot in Recast's navmesh, so the same tiles can export in another order.
 */
function held(kept: Uint8Array) {
    const n = new DataView(kept.buffer, kept.byteOffset).getUint32(6, true)
    const json = JSON.parse(Buffer.from(kept.subarray(10, 10 + n)).toString())
    json.tiles.sort((a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1])
    return json
}

async function builtNav(w: World, o: Partial<TiledNavOptions> = {}): Promise<TiledNav> {
    const nav = await w.nav({ ...AGENT, ...o })
    marksOn(nav)
    nav.update(Infinity)
    return nav
}

/** A nav over `w` from kept tiles, the marks put back, brought up to date; and how many tiles that built. */
async function keptNav(w: World, kept: Uint8Array, o: Partial<TiledNavOptions> = {}): Promise<{ nav: TiledNav, builds: number }> {
    const before = built.n
    const nav = await w.nav({ ...AGENT, ...o, kept })
    marksOn(nav)
    nav.update(Infinity)
    return { nav, builds: built.n - before }
}

describe("a tiled nav's kept tiles", () => {
    it("are taken back as built: the same ways corner for corner, and no tile built", async () => {
        const a = await land()
        const first = await builtNav(a)
        expect(first.tiles).toBeGreaterThan(50)
        const kept = first.exportTiles()
        const b = await land()
        const made = built.n
        const nav = await b.nav({ ...AGENT, kept })
        // Made from kept tiles, it builds nothing until its marks are in and it is updated.
        expect(built.n - made).toBe(0)
        expect(nav.kept).toEqual({ tiles: first.tiles, why: null })
        expect(nav.pending).toBeGreaterThan(0)
        marksOn(nav)
        nav.update(Infinity)
        expect(built.n - made).toBe(0)
        expect(nav.pending).toBe(0)
        expect(nav.tiles).toBe(first.tiles)
        const want = ways(first), got = ways(nav)
        expect(want.filter((p) => p.length > 0).length).toBeGreaterThan(60)
        expect(got).toEqual(want)
        // And kept again as it was.
        expect(held(nav.exportTiles())).toEqual(held(kept))
        a.dispose(); b.dispose()
    })

    it("do not care in what order the bodies were made", async () => {
        const first = await builtNav(await land())
        const { nav, builds } = await keptNav(await land({ reversed: true }), first.exportTiles())
        expect(builds).toBe(0)
        expect(ways(nav)).toEqual(ways(first))
    })

    it("follow the world afterwards as a nav that was never kept does", async () => {
        const first = await builtNav(await land())
        const b = await land(), c = await land()
        const { nav } = await keptNav(b, first.exportTiles())
        const fresh = await builtNav(c)
        // The same changes to both: a body made, a mark taken away, a block added.
        const add = (w: World) => w.box({ at: [100, hill(100, 100) + 2, 100], size: [12, 4, 6] })
        add(b); add(c)
        const before = built.n
        nav.update(Infinity)
        const rebuilt = built.n - before
        fresh.update(Infinity)
        expect(rebuilt).toBeGreaterThan(0)
        expect(rebuilt).toBeLessThan(nav.tiles / 4)
        expect(ways(nav)).toEqual(ways(fresh))
        for (const n of [nav, fresh]) n.block({ at: [30, hill(30, 70) + 1, 70], size: [6, 4, 2] })
        nav.update(Infinity); fresh.update(Infinity)
        expect(ways(nav)).toEqual(ways(fresh))
        expect(held(nav.exportTiles())).toEqual(held(fresh.exportTiles()))
    })

    it("are built again where the world no longer matches them, and kept everywhere else", async () => {
        const first = await builtNav(await land())
        const b = await land({ hutAt: [20, hill(20, 20) + 2, 20] })
        const { nav, builds } = await keptNav(b, first.exportTiles())
        // The hut's old tiles and its new ones, not the land's.
        expect(builds).toBeGreaterThan(0)
        expect(builds).toBeLessThan(16)
        const fresh = await builtNav(await land({ hutAt: [20, hill(20, 20) + 2, 20] }))
        expect(ways(nav)).toEqual(ways(fresh))
        expect(held(nav.exportTiles())).toEqual(held(fresh.exportTiles()))
    })

    it("are built again where a mark differs, and the areas keep the kept ids", async () => {
        const first = await builtNav(await land())
        const before = built.n
        const nav = await (await land()).nav({ ...AGENT, kept: first.exportTiles() })
        // Marked in another order: "mud" before "road". The ids are still the kept ones, so nothing differs.
        nav.mark({ at: [20, hill(20, 90), 90], size: [10, 6, 10], area: "mud" })
        nav.mark({ at: [64, hill(64, 64), 64], size: [100, 6, 4], yaw: 45, area: "road" })
        nav.block({ at: [70, hill(70, 100) + 1, 100], size: [3, 4, 3] })
        nav.update(Infinity)
        expect(built.n - before).toBe(0)
        expect(ways(nav)).toEqual(ways(first))
        // The fire not put back: its tiles are built without it.
        const second = await (await land()).nav({ ...AGENT, kept: first.exportTiles() })
        second.mark({ at: [64, hill(64, 64), 64], size: [100, 6, 4], yaw: 45, area: "road" })
        second.mark({ at: [20, hill(20, 90), 90], size: [10, 6, 10], area: "mud" })
        const mid = built.n
        second.update(Infinity)
        expect(built.n - mid).toBeGreaterThan(0)
        expect(built.n - mid).toBeLessThanOrEqual(4)
    })

    it("leave a tile alone when a mark is added and taken away before it is built", async () => {
        const nav = await builtNav(await land())
        const before = built.n
        nav.mark({ at: [10, hill(10, 10), 10], size: [4, 6, 4], area: "road" }).remove()
        expect(nav.pending).toBeGreaterThan(0)
        nav.update(Infinity)
        expect(built.n - before).toBe(0)
    })

    it("are refused whole when made with other settings, and the nav builds every tile", async () => {
        const first = await builtNav(await land())
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { nav, builds } = await keptNav(await land(), first.exportTiles(), { slope: 30 })
        expect(nav.kept).toEqual({ tiles: 0, why: expect.stringMatching(/other settings \(walkableSlopeAngle 45 here 30\)/) })
        expect(builds).toBeGreaterThan(50)
        expect(warn.mock.calls[0]![0]).toMatch(/kept tiles were not taken.*Every tile is built instead/)
        warn.mockRestore()
    })

    it("refuse what is not kept tiles, or is cut short, and say so", async () => {
        const kept = (await builtNav(await land({ chunks: 1 }))).exportTiles()
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const cases: [Uint8Array, RegExp][] = [
            [new Uint8Array([1, 2, 3]), /not tiles from exportTiles/],
            [new Uint8Array(kept.length).fill(7), /not tiles from exportTiles/],
            [Uint8Array.from(kept, (b, i) => i === 5 ? 9 : b), /version 9/],
            [kept.subarray(0, 40), /cut short/],
            [kept.subarray(0, kept.length - 1000), /Recast did not read them|hold/],
        ]
        for (const [bytes, why] of cases) {
            const { nav } = await keptNav(await land({ chunks: 1 }), bytes)
            expect(nav.kept?.why).toMatch(why)
            expect(nav.pending).toBe(0)
            expect(nav.tiles).toBeGreaterThan(10)
        }
        warn.mockRestore()
    })

    it("drop a kept tile where the world has nothing now", async () => {
        const kept = (await builtNav(await land())).exportTiles()
        const { nav, builds } = await keptNav(await land({ chunks: 1 }), kept)
        const fresh = await builtNav(await land({ chunks: 1 }))
        expect(nav.kept!.tiles).toBeGreaterThan(fresh.tiles)
        // Only the tiles along the land's new edges, whose aprons held the other chunks' ground.
        expect(builds).toBeGreaterThan(0)
        expect(builds).toBeLessThan(fresh.tiles)
        expect(nav.tiles).toBe(fresh.tiles)
        expect(held(nav.exportTiles())).toEqual(held(fresh.exportTiles()))
        expect(nav.path([20, hill(20, 20), 20], [100, hill(100, 100), 100])).toEqual([])
    })

    it("build a tile again when the description does not name it, as one never kept", async () => {
        const first = await builtNav(await land({ chunks: 1 }))
        const kept = first.exportTiles()
        // The description less its first tile, the navmesh as it was.
        const n = new DataView(kept.buffer, kept.byteOffset).getUint32(6, true)
        const json = JSON.parse(Buffer.from(kept.subarray(10, 10 + n)).toString())
        const [tx, tz] = json.tiles.shift()
        const text = Buffer.from(JSON.stringify(json))
        const cut = new Uint8Array(10 + text.length + kept.length - 10 - n)
        cut.set(kept.subarray(0, 10)); new DataView(cut.buffer).setUint32(6, text.length, true)
        cut.set(text, 10); cut.set(kept.subarray(10 + n), 10 + text.length)
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        const { nav, builds } = await keptNav(await land({ chunks: 1 }), cut)
        expect(error).not.toHaveBeenCalled()
        error.mockRestore()
        expect(nav.kept).toEqual({ tiles: first.tiles - 1, why: null })
        expect(builds).toBe(1)
        expect(nav.tiles).toBe(first.tiles)
        expect(held(nav.exportTiles()).tiles).toContainEqual([tx, tz, expect.any(Number), expect.any(Number)])
        expect(ways(nav, 1)).toEqual(ways(first, 1))
    })

    it("are built again when a body's solid differs under the same triangles", async () => {
        // A source of one floor and a solid that is not its triangles' to say: what a NavSource may give.
        const floor = {}
        const v = new Float32Array([0, 0, 0, 0, 0, 32, 32, 0, 32, 32, 0, 0]), ix = new Uint32Array([0, 1, 2, 0, 2, 3])
        const source = (poly: number[]): NavSource<object> => ({
            bodies: () => [floor],
            triangles: () => ({ vertices: v, indices: ix, solid: { poly, ymin: -1, ymax: 2 } }),
            watch: () => () => {},
        })
        const o = { radius: 0.4, height: 1.8, stepHeight: 0.5, cell: 0.33, tile: 16 }
        const kept = (await buildTiledNav(source([4, 4, 8, 4, 8, 8, 4, 8]), o)).exportTiles()
        const same = await buildTiledNav(source([4, 4, 8, 4, 8, 8, 4, 8]), { ...o, kept })
        let before = built.n
        same.update(Infinity)
        expect(built.n - before).toBe(0)
        const moved = await buildTiledNav(source([20, 20, 24, 20, 24, 24, 20, 24]), { ...o, kept })
        before = built.n
        moved.update(Infinity)
        // Every tile the body reaches, as when a body moves.
        expect(built.n - before).toBe(same.tiles)
        expect(same.tiles).toBe(4)
    })

    it("are freed with the nav, as built ones are", async () => {
        const R = await navModule.loadRecast()
        const M = R.Raw.Module
        const top = () => { const p = M._malloc(8 << 20); M._free(p); return p }
        const kept = (await builtNav(await land({ chunks: 1 }))).exportTiles()
        const w = await land({ chunks: 1 })
        const churn = (n: number, leak = 0) => Promise.all([]).then(async () => {
            for (let i = 0; i < n; i++) {
                const nav = await w.nav({ ...AGENT, kept })
                nav.update(Infinity)
                nav.dispose()
                if (leak > 0) M._malloc(leak)
            }
        })
        await churn(5)
        const before = top()
        await churn(30)
        expect(top()).toBe(before)
        // The instrument sees a leak: 256 KB kept a nav moves it.
        await churn(30, 262144)
        expect(top()).toBeGreaterThan(before)
        w.dispose()
    })
})
