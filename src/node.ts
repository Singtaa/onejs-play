/**
 * oj in Node, for a cart's own tests.
 *
 *     // vitest.config.ts
 *     export default {
 *         resolve: { alias: { oj: "ojplay" } },
 *         test: { setupFiles: ["ojplay/node"] },
 *     }
 *
 * Two things the container provides that Node does not. The C# globals its
 * bootstrap installs (`CS`, `useExtensions`, `$typeof`), which oj's modules
 * touch as they load: stubbed here, only where missing, so importing oj works
 * and anything that really needs Unity fails when it is called. And the
 * WebAssembly engines (physics, navigation), which a browser fetches from
 * StreamingAssets and OneJS links natively: every module the package ships is
 * handed to src/wasm.ts. Never bundled into a container or a cart.
 */

import fs from "node:fs"
import { setWasmModule } from "./wasm"

const g = globalThis as any

/** A value that survives any property access, call, or construction. */
function stub(): any {
    return new Proxy(function () {}, {
        get: (_t, prop) => (typeof prop === "symbol" ? undefined : prop === "toString" ? () => "[CS stub]" : stub()),
        apply: () => stub(),
        construct: () => stub(),
    })
}
g.CS ??= stub()
g.useExtensions ??= () => {}
g.$typeof ??= () => ""

const dir = new URL("../assets/@ojplay/wasm/", import.meta.url)
for (const file of fs.readdirSync(dir)) {
    const name = /^(.+)-\d[^-]*\.wasm$/.exec(file)?.[1]
    if (name !== undefined) setWasmModule(name, new g.WebAssembly.Module(fs.readFileSync(new URL(file, dir))))
}
