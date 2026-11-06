import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { RAPIER_VERSION, RAPIER_WASM_SHA256, RAPIER_WASM_IMPORTS } from "../rapier.version"
import { fallingBoxesHash, PARITY } from "../parity.mjs"
import { loadRapier, RAPIER_MODULE } from "../rapier"
import { setWasmModule, instantiateWasm, wasmUrl, setWasmBase } from "../../wasm"

// No DOM lib here, so the global is reached untyped.
const WA = (globalThis as any).WebAssembly
const dir = path.resolve(import.meta.dirname, "..")
const wasm = fs.readFileSync(path.resolve(dir, `../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))
const pkgDir = path.resolve(dir, "../../node_modules/@dimforge/rapier3d-deterministic")

describe("the vendored Rapier", () => {
    it("is the installed package's release, byte for byte", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"))
        expect(RAPIER_VERSION).toBe(pkg.version)
        expect(createHash("sha256").update(wasm).digest("hex")).toBe(RAPIER_WASM_SHA256)
        expect(createHash("sha256").update(fs.readFileSync(path.join(pkgDir, "rapier_wasm3d_bg.wasm"))).digest("hex")).toBe(RAPIER_WASM_SHA256)
    })

    it("records the imports the module really has, and the glue provides each", async () => {
        const imports = WA.Module.imports(new WA.Module(wasm)) as { name: string }[]
        expect(imports.map((i) => i.name)).toEqual(RAPIER_WASM_IMPORTS)
        const R = await import("../rapier.vendor.js")
        for (const name of RAPIER_WASM_IMPORTS) expect(typeof R.bg[name], name).toBe("function")
    })

    it("imports no .wasm file of its own", () => {
        expect(fs.readFileSync(path.join(dir, "rapier.vendor.js"), "utf8")).not.toMatch(/\.wasm["']/)
    })

    it("gives the parity hash every host is held to", async () => {
        setWasmModule("rapier3d", new WA.Module(wasm))
        const R = await loadRapier()
        expect(fallingBoxesHash(R)).toBe(PARITY.hash)
    })
})

describe("instantiateWasm", () => {
    const imports = { "./rapier_wasm3d_bg.js": {} }
    afterEach(() => {
        delete (globalThis as any).__wasm
        setWasmBase(null)
    })

    it("asks a native host first, with the module's hash", async () => {
        const asked: string[] = []
        ;(globalThis as any).__wasm = {
            has: (name: string, sha: string) => { asked.push(`has ${name} ${sha}`); return true },
            instantiate: (name: string, sha: string) => { asked.push(`instantiate ${name} ${sha}`); return { memory: { buffer: new ArrayBuffer(0) }, native: true } },
        }
        const exports = await instantiateWasm(RAPIER_MODULE, imports)
        expect(exports.native).toBe(true)
        expect(asked).toEqual([`has rapier3d ${RAPIER_WASM_SHA256}`, `instantiate rapier3d ${RAPIER_WASM_SHA256}`])
    })

    it("falls through when the native host has a different build", async () => {
        ;(globalThis as any).__wasm = { has: () => false, instantiate: () => { throw new Error("must not be called") } }
        setWasmModule("rapier3d", new WA.Module(wasm))
        const R = await import("../rapier.vendor.js")
        const exports = await instantiateWasm(RAPIER_MODULE, { "./rapier_wasm3d_bg.js": R.bg })
        expect(exports.memory).toBeDefined()
    })

    it("names the module and hash when there is no WebAssembly and no native build", async () => {
        const saved = WA
        ;(globalThis as any).WebAssembly = undefined
        try {
            await expect(instantiateWasm({ name: "nothing", version: "1", sha256: "abc" }, imports)).rejects.toThrow(/nothing 1 needs WebAssembly.*sha256 abc/)
        } finally {
            ;(globalThis as any).WebAssembly = saved
        }
    })

    it("refuses to guess a URL with no StreamingAssets", async () => {
        expect(wasmUrl({ name: "x", version: "2", sha256: "" })).toBeNull()
        await expect(instantiateWasm({ name: "x", version: "2", sha256: "" }, imports)).rejects.toThrow(/nowhere to load x 2/)
    })

    it("fetches from StreamingAssets by name and version", () => {
        ;(globalThis as any).__streamingAssetsPath = "https://h.test/runtime/1.0.70/StreamingAssets"
        try {
            expect(wasmUrl(RAPIER_MODULE)).toBe(`https://h.test/runtime/1.0.70/StreamingAssets/onejs/assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`)
            setWasmBase("https://cdn.test/w")
            expect(wasmUrl(RAPIER_MODULE)).toBe(`https://cdn.test/w/rapier3d-${RAPIER_VERSION}.wasm`)
        } finally {
            delete (globalThis as any).__streamingAssetsPath
        }
    })
})
