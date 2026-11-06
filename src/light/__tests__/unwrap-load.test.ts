import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { loadXAtlas } from "../unwrap"
import { XATLAS_VERSION } from "../xatlas.version"

// A file of its own: loadXAtlas keeps the module it loads, and this needs to start without one.
const WA = (globalThis as any).WebAssembly
const assets = path.resolve(import.meta.dirname, "../../../assets/@ojplay/wasm")

describe("loading xatlas", () => {
    it("rejects when the module will not instantiate, rather than waiting forever, and loads on the next try", async () => {
        // Recast's module asks for imports xatlas's glue does not provide.
        setWasmModule("xatlas", new WA.Module(fs.readFileSync(path.join(assets, "recast-0.44.0.wasm"))))
        await expect(loadXAtlas()).rejects.toThrow()
        setWasmModule("xatlas", new WA.Module(fs.readFileSync(path.join(assets, `xatlas-${XATLAS_VERSION}.wasm`))))
        const xatlas = await loadXAtlas()
        expect(typeof xatlas.createAtlas).toBe("function")
    })
})
