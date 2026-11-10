/**
 * PrimoEden's streamed world at 3 by 3 chunks (primoeden-three docs/terrain.md
 * §5): 64 m chunks on a 2 m grid, rolling hills, an agent of radius 0.4,
 * height 1.8 and climb 0.5 on 0.33 m cells, tiles of 16 m. What runtime 1.6's
 * tiled nav and heightfield cost against today's solo navmesh and mesh
 * collider, printed, with bounds loose enough for any CI machine: the
 * numbers in PlaySite/docs/proposals/world-scale.md come from this file.
 */

import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../../physics3d/rapier.version"
import { RECAST_VERSION } from "../recast.version"
import { createWorld, type World } from "../../physics3d/world"
import type { TiledNav } from "../tiled"
import { loadRecast } from "../nav"
import type { Vec3 } from "../../models"
import { hill, hills } from "./hills"

const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.join(assets, `rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(fs.readFileSync(path.join(assets, `recast-${RECAST_VERSION}.wasm`))))
})

const AGENT = { radius: 0.4, height: 1.8, stepHeight: 0.5, slope: 45, cell: 0.33 }
const CHUNK = 64, N = 33
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
const time = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t }
const len = (from: Vec3, pts: Vec3[]) => {
    let d = 0, a = from
    for (const p of pts) { d += Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]); a = p }
    return d
}
const at = (x: number, z: number): Vec3 => [x, hill(x, z), z]
const lines: string[] = []
const say = (s: string) => lines.push(s)
afterAll(() => console.log(["world scale, PrimoEden's case (terrain.md §5), Node " + process.version, ...lines].join("\n")))

/** Builds each stale tile alone, returning each one's milliseconds. */
function buildTiles(nav: TiledNav): number[] {
    nav.update(0)   // reads what changed, builds nothing
    const each: number[] = []
    while (nav.pending > 0) each.push(time(() => nav.update(1e-9)))
    return each
}

function chunks(w: World, n: number) {
    for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) {
        w.heightfield({ at: [cx * CHUNK, 0, cz * CHUNK], size: [CHUNK, CHUNK], heights: hills(cx * CHUNK, cz * CHUNK, N) })
    }
}

describe("a streamed world, 3 by 3 chunks", () => {
    it("builds a chunk in tiles a 2 ms job can hold, against today's solo navmesh", async () => {
        // Today: a chunk's ground as world.mesh, and one solo navmesh over it.
        const today = await createWorld()
        const t = hills(0, 0, N), vertices = new Float32Array(N * N * 3), indices: number[] = []
        for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) vertices.set([ix * 2, t[ix + iz * N]!, iz * 2], (ix + iz * N) * 3)
        for (let iz = 0; iz < N - 1; iz++) for (let ix = 0; ix < N - 1; ix++) { const a = ix + iz * N; indices.push(a, a + N, a + 1, a + 1, a + N, a + N + 1) }
        const meshMs: number[] = []
        for (let i = 0; i < 9; i++) {
            const s = performance.now()
            const b = await today.mesh({ vertices, indices: new Uint32Array(indices) })
            meshMs.push(performance.now() - s)
            if (i < 8) b.destroy()
        }
        const soloMs: number[] = []
        for (let i = 0; i < 5; i++) {
            const s = performance.now()
            const n = await today.nav(AGENT)
            soloMs.push(performance.now() - s)
            n.dispose()
        }
        // 1.6: the same chunk as world.heightfield, and its tiles.
        const w = await createWorld()
        const hfMs: number[] = []
        for (let i = 0; i < 9; i++) {
            hfMs.push(time(() => { const b = w.heightfield({ size: [CHUNK, CHUNK], heights: t }); if (i < 8) b.destroy() }))
        }
        const nav = await w.nav({ ...AGENT, tile: 16, budget: 0 })
        // A second chunk's tiles, timed one at a time once the code has run once.
        w.heightfield({ at: [CHUNK, 0, 0], size: [CHUNK, CHUNK], heights: hills(CHUNK, 0, N) })
        const had = nav.tiles
        const tiles = buildTiles(nav)
        const own = tiles.reduce((a, b) => a + b, 0)
        const made = nav.tiles - had
        say(`collider for a chunk: world.mesh ${median(meshMs).toFixed(3)} ms, world.heightfield ${median(hfMs).toFixed(3)} ms`)
        say(`nav for a chunk: solo (today) ${median(soloMs).toFixed(1)} ms in one call; tiled ${tiles.length} tiles stale and ${made} new, each median ${median(tiles).toFixed(2)} ms, slowest ${Math.max(...tiles).toFixed(2)} ms, ${own.toFixed(1)} ms in all`)
        // The milliseconds are reported above, not asserted: that a tile fits a 2 ms job is a budget
        // for a benchmark (0.4 to 0.7 ms on a Mac, 0.8 to 1.5 here, 2.1 on CI's Windows runner), and
        // a clock bound reds whenever another session is building. Asserted instead: a tile costs a
        // small part of the solo build of its chunk, timed in the same run, so load scales both.
        // Measured on 9 Nov, 16 cores: 0.040 to 0.061 over ten quiet runs, 0.018 to 0.030 over ten
        // with every core busy (load slows the longer solo build more). Each tile built ten times
        // over read 0.291. The bound, 0.15, is 2.5 times the quiet worst and half the ten-times build.
        const ratio = median(tiles) / median(soloMs)
        say(`a tile against the solo build of its chunk: ${ratio.toFixed(3)}`)
        expect(ratio).toBeLessThan(0.15)
        expect(tiles.length).toBeGreaterThanOrEqual(16)
        today.dispose(); w.dispose()
    })

    it("paths across 3 by 3 chunks, reroutes round a Hearth's building as its collider goes up, and back as it comes down", async () => {
        const w = await createWorld()
        const nav = await w.nav({ ...AGENT, tile: 16, budget: 2 })
        const M = (await loadRecast()).Raw.Module
        const top = () => { const p = M._malloc(8 << 20); M._free(p); return p }
        const heapBefore = top()
        chunks(w, 3)
        const first = buildTiles(nav)
        const built = (nav as any).built as Map<number, number>
        let bytes = 0
        for (const ref of built.values()) bytes += (nav as any).navMesh.getTileByRef?.(ref)?.dataSize?.() ?? 0
        if (bytes === 0) {
            for (const k of built.keys()) {
                const tx = Math.floor(k / 65536) - 32768, tz = (k % 65536) - 32768
                bytes += (nav as any).navMesh.getTileAt(tx, tz, 0)?.dataSize() ?? 0
            }
        }
        let cached = 0
        for (const e of (nav as any).entries.values()) cached += e.vertices.byteLength + e.indices.byteLength
        say(`3 by 3 chunks: ${nav.tiles} tiles in ${first.reduce((a, b) => a + b, 0).toFixed(0)} ms (median ${median(first).toFixed(2)} ms a tile), navmesh ${(bytes / 1024).toFixed(0)} KB, ground triangles kept ${(cached / 1024).toFixed(0)} KB, Recast's heap in use up ${((top() - heapBefore) / 1024).toFixed(0)} KB`)

        const from = at(6, 6), to = at(186, 186)
        const across = nav.path(from, to)
        expect(across.length).toBeGreaterThan(0)
        const ms: number[] = []
        for (let i = 0; i < 50; i++) ms.push(time(() => nav.path(from, to)))
        say(`a path across, corner to corner: ${len(from, across).toFixed(1)} m, ${across.length} corners, ${median(ms).toFixed(3)} ms`)

        // A 20 by 20 m hall on the line, in the middle chunk: its collider, and nothing else.
        const a = at(80, 100), b = at(120, 100)
        const before = nav.path(a, b)
        w.step()
        const hall = w.box({ at: [100, hill(100, 100) + 4, 100], size: [20, 8 + 6, 20] })
        let frames = 0, spent = 0, slowest = 0
        while (nav.pending > 0 && frames < 600) {
            const t = time(() => w.step())
            spent += t; slowest = Math.max(slowest, t); frames++
        }
        expect(nav.pending).toBe(0)
        const round = nav.path(a, b)
        for (const q of round) expect(Math.abs(q[0] - 100) > 10.3 || Math.abs(q[2] - 100) > 10.3, `${q} inside the hall`).toBe(true)
        expect(len(a, round)).toBeGreaterThan(len(a, before) + 2)
        say(`a 20 by 20 m hall's collider: rerouted in ${frames} frames at a 2 ms budget, ${spent.toFixed(1)} ms in all, slowest frame ${slowest.toFixed(2)} ms; path ${len(a, before).toFixed(1)} m, ${before.length} corners, to ${len(a, round).toFixed(1)} m, ${round.length} corners`)
        hall.destroy()
        frames = 0
        while (nav.pending > 0 && frames < 600) { w.step(); frames++ }
        expect(len(a, nav.path(a, b))).toBeCloseTo(len(a, before), 0)
        say(`  destroyed: back in ${frames} frames`)

        // The same hall as nav.block, with no collider.
        const block = nav.block({ at: [100, hill(100, 100) + 4, 100], size: [20, 14, 20] })
        const blockMs = buildTiles(nav)
        expect(len(a, nav.path(a, b))).toBeGreaterThan(len(a, before) + 2)
        block.remove()
        nav.update(Infinity)
        say(`  as nav.block: ${blockMs.length} tiles, ${blockMs.reduce((x, y) => x + y, 0).toFixed(1)} ms`)

        // Today: every change rebuilds the one solo navmesh over all nine chunks.
        const solo = time(() => { void 0 })
        const s = performance.now()
        const all = await w.nav(AGENT)
        say(`today, the solo navmesh over 3 by 3 chunks, rebuilt for any change: ${(performance.now() - s + solo).toFixed(0)} ms in one call`)
        all.dispose()
        w.dispose()
    })
})
