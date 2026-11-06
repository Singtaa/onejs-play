import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { RAPIER_VERSION, RAPIER_WASM_SHA256, RAPIER_WASM_IMPORTS } from "../rapier.version"
import { setWasmModule } from "../../wasm"
import { loadRapier2D } from "../rapier"
import { fallingBoxesHash, PARITY } from "../parity.mjs"

const WA = (globalThis as any).WebAssembly
const dir = path.resolve(import.meta.dirname, "..")
const wasm = fs.readFileSync(path.resolve(dir, `../../assets/@ojplay/wasm/rapier2d-${RAPIER_VERSION}.wasm`))
const pkgDir = path.resolve(dir, "../../node_modules/@dimforge/rapier2d-deterministic")

describe("the vendored Rapier 2D", () => {
    it("is the installed package's release, byte for byte, and the same release as 3D", async () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"))
        expect(RAPIER_VERSION).toBe(pkg.version)
        expect(RAPIER_VERSION).toBe((await import("../../physics3d/rapier.version")).RAPIER_VERSION)
        expect(createHash("sha256").update(wasm).digest("hex")).toBe(RAPIER_WASM_SHA256)
        expect(createHash("sha256").update(fs.readFileSync(path.join(pkgDir, "rapier_wasm2d_bg.wasm"))).digest("hex")).toBe(RAPIER_WASM_SHA256)
    })

    it("records the imports the module really has, and the glue provides each", async () => {
        const imports = WA.Module.imports(new WA.Module(wasm)) as { name: string }[]
        expect(imports.map((i) => i.name)).toEqual(RAPIER_WASM_IMPORTS)
        const R = await import("../rapier.vendor.js")
        for (const name of RAPIER_WASM_IMPORTS) expect(typeof (R.bg as any)[name], name).toBe("function")
    })

    it("imports no .wasm file of its own, and steps as the shared core steps it", () => {
        const lines = fs.readFileSync(path.join(dir, "rapier.vendor.js"), "utf8").split(/\r?\n/)
        expect(lines.join("\n")).not.toMatch(/\.wasm["']/)
        const start = lines.indexOf("  step(eventQueue, hooks) {")
        const end = lines.indexOf("  }", start)
        expect(start).toBeGreaterThan(-1)
        expect(lines.slice(start + 1, end).map((l) => l.trim())).toEqual([
            "this.physicsPipeline.step(this.gravity, this.integrationParameters, this.islands, this.broadPhase, this.narrowPhase, this.bodies, this.colliders, this.softBodies, this.impulseJoints, this.multibodyJoints, this.ccdSolver, eventQueue, hooks);",
            "this.mapNewSoftBodies();",
        ])
    })

    it("gives the parity hash every host is held to", async () => {
        setWasmModule("rapier2d", new WA.Module(wasm))
        const R = await loadRapier2D()
        expect(fallingBoxesHash(R)).toBe(PARITY.hash)
        // One box fewer is another world, and another hash.
        expect(fallingBoxesHash(R, PARITY.boxes - 1)).not.toBe(PARITY.hash)
    })
})
