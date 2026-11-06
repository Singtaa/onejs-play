/**
 * oj's engines for Node, for a cart's own tests.
 *
 *     // vitest.config.ts
 *     export default { test: { setupFiles: ["ojplay/node"] } }
 *
 * A browser fetches each WebAssembly module from StreamingAssets and OneJS
 * links it natively; Node has neither, so this hands every module the package
 * ships straight to src/wasm.ts. Never bundled into a container or a cart:
 * only a test setup imports it.
 */

import fs from "node:fs"
import { setWasmModule } from "./wasm"

const dir = new URL("../assets/@ojplay/wasm/", import.meta.url)
for (const file of fs.readdirSync(dir)) {
    const name = /^(.+)-\d[^-]*\.wasm$/.exec(file)?.[1]
    if (name !== undefined) setWasmModule(name, new (globalThis as any).WebAssembly.Module(fs.readFileSync(new URL(file, dir))))
}
