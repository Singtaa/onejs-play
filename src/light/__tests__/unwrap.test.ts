import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { glbTriangles } from "../../physics3d/gltf"
import { setWasmModule } from "../../wasm"
import { GUTTER, layoutAtlas } from "../atlas"
import { chartModel, layoutLight, type Unwrap } from "../unwrap"
import { XATLAS_VERSION, XATLAS_WASM_IMPORTS, XATLAS_WASM_SHA256 } from "../xatlas.version"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const wasm = fs.readFileSync(path.join(ROOT, `assets/@ojplay/wasm/xatlas-${XATLAS_VERSION}.wasm`))
const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("xatlas", new WA.Module(wasm))
})

/** The module xatlas-wasm carries inside its glue, decoded as scripts/vendor-xatlas.mjs decodes it. */
function packagedModule(): Buffer {
    const source = fs.readFileSync(path.join(ROOT, "node_modules/xatlas-wasm/dist/index.mjs"), "utf8")
    const literal = /return binaryDecode\(('(?:[^'\\]|\\.)*')\);/s.exec(source)!
    const chars: string = vm.runInNewContext(literal[1]!)
    const bytes = Buffer.alloc(chars.length)
    for (let i = 0; i < chars.length; i++) {
        const c = chars.charCodeAt(i)
        bytes[i] = ~c >> 8 & c
    }
    return bytes
}

describe("the vendored xatlas", () => {
    it("is the installed release's module, its imports and nothing inline", () => {
        expect(JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/xatlas-wasm/package.json"), "utf8")).version).toBe(XATLAS_VERSION)
        const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")
        expect(sha(wasm)).toBe(XATLAS_WASM_SHA256)
        expect(sha(packagedModule())).toBe(XATLAS_WASM_SHA256)
        const imports = WA.Module.imports(new WA.Module(wasm)) as { module: string, name: string }[]
        expect(imports.map((i) => `${i.module}.${i.name}`)).toEqual(XATLAS_WASM_IMPORTS)
        const glue = fs.readFileSync(path.resolve(import.meta.dirname, "../xatlas.vendor.js"), "utf8")
        expect(glue).not.toContain("binaryDecode('\\0asm")
        expect(glue).not.toMatch(/\bimport\(/)
    })
})

/** The spike's room: a 6 by 3 by 6 m box seen from inside, and a 1 m box on its floor. Two triangles a face, unshared corners. */
function room(): { vertices: Float32Array, indices: Uint32Array, area: number } {
    const v: number[] = []
    let area = 0
    const quad = (o: number[], u: number[], w: number[]) => {
        const at = (a: number, b: number) => [o[0]! + u[0]! * a + w[0]! * b, o[1]! + u[1]! * a + w[1]! * b, o[2]! + u[2]! * a + w[2]! * b]
        v.push(...at(0, 0), ...at(1, 0), ...at(1, 1), ...at(0, 0), ...at(1, 1), ...at(0, 1))
        const cross = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
        area += Math.hypot(cross[0]!, cross[1]!, cross[2]!)
    }
    const box = (o: number[], s: number[]) => {
        const [x, y, z] = o, [a, b, c] = s
        quad([x!, y!, z!], [a!, 0, 0], [0, 0, c!]); quad([x!, y! + b!, z!], [0, 0, c!], [a!, 0, 0])
        quad([x!, y!, z!], [0, b!, 0], [a!, 0, 0]); quad([x!, y!, z! + c!], [a!, 0, 0], [0, b!, 0])
        quad([x!, y!, z!], [0, 0, c!], [0, b!, 0]); quad([x! + a!, y!, z!], [0, b!, 0], [0, 0, c!])
    }
    box([0, 0, 0], [6, 3, 6])
    box([2, 0, 2], [1, 1, 1])
    const vertices = new Float32Array(v)
    return { vertices, indices: new Uint32Array(vertices.length / 3).map((_, i) => i), area }
}

/**
 * What would put two places' light in one texel: texel centres inside two
 * triangles, and texels of two charts with fewer than two empty texels
 * between them. The bake fills each empty texel from the chart beside it, so
 * bilinear sampling reads the right chart a texel past every edge; one empty
 * texel between two charts would have to be both.
 * A chart is the triangles joined by corners in one place and at one uv,
 * since xatlas splits every vertex on a seam; matching place as well as index
 * joins the triangles of a model whose input shares no corners.
 */
const GAP = 2

function collisions(u: Unwrap, positions: Float32Array): { overlaps: number, touching: number } {
    const n = u.uv.length / 2
    const parent = Array.from({ length: n }, (_, i) => i)
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]!))
    const first = new Map<string, number>()
    for (let i = 0; i < n; i++) {
        const src = u.xref[i]! * 3
        const key = [positions[src]!, positions[src + 1]!, positions[src + 2]!, u.uv[i * 2]!, u.uv[i * 2 + 1]!].map((x) => x.toFixed(5)).join()
        const j = first.get(key)
        if (j === undefined) first.set(key, i)
        else parent[find(i)] = find(j)
    }
    for (let t = 0; t < u.indices.length; t += 3) {
        parent[find(u.indices[t + 1]!)] = find(u.indices[t]!)
        parent[find(u.indices[t + 2]!)] = find(u.indices[t]!)
    }
    const owner = new Int32Array(u.width * u.height).fill(-1)
    let overlaps = 0
    for (let t = 0; t < u.indices.length; t += 3) {
        const chart = find(u.indices[t]!)
        const p = [0, 1, 2].map((k) => [u.uv[u.indices[t + k]! * 2]! * u.width, u.uv[u.indices[t + k]! * 2 + 1]! * u.height] as const)
        const [a, b, c] = p as [readonly [number, number], readonly [number, number], readonly [number, number]]
        const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if (Math.abs(d) < 1e-9) continue
        for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))); y <= Math.ceil(Math.max(a[1], b[1], c[1])) && y < u.height; y++) {
            for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))); x <= Math.ceil(Math.max(a[0], b[0], c[0])) && x < u.width; x++) {
                const px = x + 0.5, py = y + 0.5
                const w1 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / d
                const w2 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / d
                const w3 = 1 - w1 - w2
                // Strictly inside, so a centre on an edge two triangles of a chart share counts once.
                if (!(w1 > 1e-6 && w2 > 1e-6 && w3 > 1e-6)) continue
                if (owner[y * u.width + x] !== -1) overlaps++
                owner[y * u.width + x] = chart
            }
        }
    }
    let touching = 0
    for (let y = 0; y < u.height; y++) for (let x = 0; x < u.width; x++) {
        const o = owner[y * u.width + x]!
        if (o === -1) continue
        // Within two texels: the one empty texel between would be dilated from both charts at once.
        for (let dy = -GAP; dy <= GAP; dy++) for (let dx = -GAP; dx <= GAP; dx++) {
            const X = x + dx, Y = y + dy
            if (X >= 0 && X < u.width && Y >= 0 && Y < u.height && owner[Y * u.width + X] !== -1 && owner[Y * u.width + X] !== o) touching++
        }
    }
    return { overlaps, touching }
}

describe("unwrapping a model", () => {
    it("lays the room out at 24 texels a metre, each texel one place, every vertex traced to its source", async () => {
        const r = room()
        const charts = await chartModel(r)
        const u = charts.unwrap(24)
        // Ten faces' worth of planes at least: the room's six and the box's five that show, give or take merges xatlas finds.
        expect(u.charts).toBeGreaterThanOrEqual(10)
        expect(u.indices.length).toBe(r.indices.length)
        for (let i = 0; i < u.uv.length; i++) {
            expect(u.uv[i]).toBeGreaterThanOrEqual(0)
            expect(u.uv[i]).toBeLessThanOrEqual(1)
        }
        // Each output triangle is its input triangle, corner for corner.
        for (let k = 0; k < u.indices.length; k++) {
            const src = u.xref[u.indices[k]!]!
            expect(r.vertices.subarray(src * 3, src * 3 + 3)).toEqual(r.vertices.subarray(r.indices[k]! * 3, r.indices[k]! * 3 + 3))
        }
        expect(collisions(u, r.vertices)).toEqual({ overlaps: 0, touching: 0 })
        // The layout holds the surface at 24 texels a metre, plus padding and packing's slack, but not twice it.
        const texels = u.width * u.height
        expect(texels).toBeGreaterThan(r.area * 24 * 24)
        expect(texels).toBeLessThan(r.area * 24 * 24 * 2)
        charts.dispose()
    })

    it("takes a quarter of the texels at half the density, give or take the padding, which stays in texels", async () => {
        const charts = await chartModel(room())
        const at24 = charts.size(24), at12 = charts.size(12)
        const ratio = (at12.width * at12.height) / (at24.width * at24.height)
        expect(ratio).toBeGreaterThan(0.25)
        expect(ratio).toBeLessThan(0.4)
        charts.dispose()
    })

    it("gives the same layout every time, so a load lines up with the bake it was saved from", async () => {
        const a = await chartModel(room()), b = await chartModel(room())
        // b packs at another density first, as a layout that lowered its detail would.
        b.size(9.5)
        expect(b.unwrap(24)).toEqual(a.unwrap(24))
        a.dispose()
        b.dispose()
    })

    it("unwraps every Crate Yard model straight from its .glb", async () => {
        const dir = path.join(ROOT, "examples/crate-yard")
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".glb"))) {
            const t = glbTriangles(fs.readFileSync(path.join(dir, file)))
            const charts = await chartModel(t)
            const u = charts.unwrap(24)
            expect(u.indices.length, file).toBe(t.indices.length)
            expect(Math.max(...u.xref), file).toBeLessThan(t.vertices.length / 3)
            expect(collisions(u, t.vertices), file).toEqual({ overlaps: 0, touching: 0 })
            charts.dispose()
        }
    })

    it("refuses what is not whole triangles, and a disposed model", async () => {
        await expect(chartModel({ vertices: new Float32Array(9), indices: new Uint32Array([0, 1]) })).rejects.toThrow(/whole triangles/)
        const charts = await chartModel(room())
        charts.dispose()
        expect(() => charts.size(24)).toThrow(/disposed/)
    })
})

describe("laying out a bake", () => {
    // A model whose charts take `metres` a side at a density, plus a fixed padding of texels, as xatlas's do.
    const fake = (metres: number[], padding: number) => (m: number, density: number) => {
        const side = Math.ceil(metres[m]! * density) + 2 * padding
        return { width: side, height: side }
    }

    it("lays each model out once, at the density of its smallest actor, and gives a bigger one a bigger rectangle", () => {
        const l = layoutAtlas([{ model: 0, scale: 2 }, { model: 0, scale: 1 }, { model: 1, scale: 1 }], [1, 4, 25], fake([1, 2, 5], 2))!
        expect(l.detail).toBe(24)
        expect(l.densities).toEqual([24, 24, 0])
        expect(l.rects[1]!.slice(2)).toEqual([28, 28])
        expect(l.rects[0]!.slice(2)).toEqual([56, 56])
        expect(l.rects[2]!.slice(2)).toEqual([52, 52])
    })

    it("lays the models out again when the detail has to fall, so every rectangle is its model's layout at the detail packed", () => {
        const pack = fake([30, 30, 30, 30, 30, 30], 8)
        const actors = Array.from({ length: 6 }, (_, m) => ({ model: m, scale: 1 }))
        const l = layoutAtlas(actors, new Array(6).fill(900), pack)!
        expect(l.detail).toBeLessThan(24)
        l.rects.forEach((r, i) => {
            expect(l.densities[i]).toBe(l.detail)
            // The rectangle is the layout at that density to the texel, padding included.
            expect([r[2], r[3]]).toEqual([pack(i, l.detail).width, pack(i, l.detail).height])
        })
        for (let i = 0; i < l.rects.length; i++) for (let j = 0; j < i; j++) {
            const [a, b] = [l.rects[i]!, l.rects[j]!]
            expect(a[0] < b[0] + b[2] + GUTTER && b[0] < a[0] + a[2] + GUTTER && a[1] < b[1] + b[3] + GUTTER && b[1] < a[1] + a[3] + GUTTER).toBe(false)
        }
    })

    it("gives a layout back as its own texels at any detail, past float noise", () => {
        // 28 / 23.9 * 23.9 is 28.000000000000004, which a plain ceil makes 29.
        const l = layoutAtlas([{ model: 0, scale: 1 }], [1], () => ({ width: 28, height: 28 }), 23.9)!
        expect(l.rects[0]).toEqual([0, 0, 28, 28])
    })

    it("starts below a detail the surface alone rules out, and loses nothing a full search would find", () => {
        const asked: number[] = []
        const pack = (m: number, density: number) => {
            asked.push(density)
            return fake([80], 2)(m, density)
        }
        const l = layoutAtlas([{ model: 0, scale: 1 }], [6400], pack)!
        // 512 / 80 is 6.4: never packed at 24.
        expect(Math.max(...asked)).toBeLessThan(7)
        expect(l).toEqual(layoutAtlas([{ model: 0, scale: 1 }], [0], fake([80], 2)))
    })

    it("measures a model's surface for that bound", async () => {
        const r = room()
        const charts = await chartModel(r)
        expect(charts.area).toBeCloseTo(r.area, 4)
        charts.dispose()
    })

    it("refuses an actor with no scale", () => {
        expect(() => layoutAtlas([{ model: 0, scale: 0 }], [1], fake([1], 2))).toThrow(/positive number/)
    })

    it("unwraps each model at its layout's density, the room and its crates in one atlas", async () => {
        const charts = [await chartModel(room()), await chartModel(glbTriangles(fs.readFileSync(path.join(ROOT, "examples/crate-yard/crate.glb"))))]
        const l = layoutLight(charts, [{ model: 0, scale: 1 }, { model: 1, scale: 1 }, { model: 1, scale: 1.5 }])!
        expect(l.unwraps[0]!.density).toBe(l.densities[0])
        expect(l.unwraps[1]!.density).toBe(l.densities[1])
        expect([l.rects[0]![2], l.rects[0]![3]]).toEqual([l.unwraps[0]!.width, l.unwraps[0]!.height])
        expect(l.rects[2]![2]).toBe(Math.ceil(l.unwraps[1]!.width * 1.5 - 1e-6))
        for (const c of charts) c.dispose()
    })
})
