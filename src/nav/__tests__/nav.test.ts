import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../../physics3d/rapier.version"
import { RECAST_VERSION, RECAST_WASM_SHA256, RECAST_WASM_IMPORTS } from "../recast.version"
import { createWorld } from "../../physics3d/world"
import type { Vec3 } from "../../models"

const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")
const recastWasm = fs.readFileSync(path.join(assets, `recast-${RECAST_VERSION}.wasm`))

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.join(assets, `rapier3d-${RAPIER_VERSION}.wasm`))))
    setWasmModule("recast", new WA.Module(recastWasm))
})

describe("the vendored Recast", () => {
    it("is the installed release, byte for byte, with the imports it records", () => {
        const pkgDir = path.resolve(import.meta.dirname, "../../../node_modules/@recast-navigation")
        for (const name of ["core", "generators", "wasm"]) {
            expect(JSON.parse(fs.readFileSync(path.join(pkgDir, name, "package.json"), "utf8")).version, name).toBe(RECAST_VERSION)
        }
        expect(createHash("sha256").update(recastWasm).digest("hex")).toBe(RECAST_WASM_SHA256)
        expect(createHash("sha256").update(fs.readFileSync(path.join(pkgDir, "wasm/dist/recast-navigation.wasm.wasm"))).digest("hex")).toBe(RECAST_WASM_SHA256)
        const imports = WA.Module.imports(new WA.Module(recastWasm)) as { module: string, name: string }[]
        expect(imports.map((i) => `${i.module}.${i.name}`)).toEqual(RECAST_WASM_IMPORTS)
        expect(fs.readFileSync(path.resolve(import.meta.dirname, "../recast.vendor.js"), "utf8")).not.toMatch(/base64,AGFzbQ/)
    })
})

const len = (from: Vec3, pts: Vec3[]) => {
    let d = 0, a = from
    for (const p of pts) { d += Math.hypot(p[0] - a[0], p[2] - a[2]); a = p }
    return d
}

describe("world.nav", () => {
    /** A 20 x 20 floor with a wall across the middle and a gap at x = 7. */
    async function walled() {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [20, 1, 20], layer: "floor" })
        w.box({ at: [-1.5, 1, 0], size: [17, 2, 1], layer: "wall" })
        w.box({ at: [9.5, 1, 0], size: [1, 2, 1], layer: "wall" })
        return w
    }

    it("goes round a wall through its gap, and ends where it was asked", async () => {
        const w = await walled()
        const nav = await w.nav({ radius: 0.3 })
        const from: Vec3 = [0, 0, -5], to: Vec3 = [0, 0, 5]
        const path = nav.path(from, to)
        expect(path.length).toBeGreaterThan(1)
        const end = path.at(-1)!
        expect(Math.hypot(end[0] - to[0], end[2] - to[2])).toBeLessThan(0.2)
        // Through the gap, which is between x = 7 and x = 9: no corner crosses the wall elsewhere.
        expect(path.some((p) => p[0] > 6.5 && p[0] < 9.5)).toBe(true)
        // Two legs to the gap at about x = 8: 2 * hypot(8, 5) = 18.9 m, against 10 m straight through the wall.
        expect(len(from, path)).toBeGreaterThan(18)
        expect(len(from, path)).toBeLessThan(20)
        // And every leg clears the wall by the radius, checked by the physics world itself.
        let a = from
        for (const p of path) {
            expect(w.canSee([a[0], 0.5, a[2]], [p[0], 0.5, p[2]], { only: ["wall"] }), `${a} to ${p}`).toBe(true)
            a = p
        }
        nav.dispose()
        w.dispose()
    })

    it("walks straight when nothing is in the way", async () => {
        const w = await walled()
        const nav = await w.nav()
        const path = nav.path([-5, 0, -5], [5, 0, -6])
        expect(path.length).toBe(1)
        w.dispose()
    })

    it("has no way from somewhere off the floor, and refuses after dispose", async () => {
        const w = await walled()
        const nav = await w.nav()
        expect(nav.path([50, 0, 50], [0, 0, 5])).toEqual([])
        nav.dispose()
        expect(() => nav.path([0, 0, -5], [0, 0, 5])).toThrow(/disposed/)
        w.dispose()
    })

    it("only counts static, solid bodies, from the layers asked for", async () => {
        const w = await walled()
        w.box({ at: [8, 1, 0], size: [2, 2, 1], dynamic: true })
        w.box({ at: [8, 1, -3], size: [4, 2, 1], trigger: true })
        const nav = await w.nav()
        expect(nav.path([0, 0, -5], [0, 0, 5]).some((p) => p[0] > 6.5 && p[0] < 9.5)).toBe(true)
        const floorOnly = await w.nav({ only: ["floor"] })
        expect(floorOnly.path([0, 0, -5], [0, 0, 5]).length).toBe(1)
        await expect(w.nav({ only: ["nothing"] })).rejects.toThrow(/no static bodies to walk on in layers nothing/)
        w.dispose()
    })

    it("climbs onto a low platform and not a high one", async () => {
        const w = await createWorld()
        w.box({ at: [0, -0.5, 0], size: [20, 1, 20] })
        w.box({ at: [5, 0.1, 0], size: [4, 0.2, 4] })
        w.box({ at: [-5, 1, 0], size: [4, 2, 4] })
        const nav = await w.nav({ step: 0.3 })
        expect(nav.path([0, 0, 0], [5, 0.2, 0]).at(-1)![1]).toBeCloseTo(0.2, 1)
        const high = nav.path([0, 0, 0], [-5, 2, 0]).at(-1)!
        expect(high[1]).toBeLessThan(0.5)
        w.dispose()
    })
})
