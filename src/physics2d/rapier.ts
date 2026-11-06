/**
 * Rapier's 2D build, loaded once, as src/physics3d/rapier.ts loads the 3D one.
 */

import { instantiateWasm } from "../wasm"
import { RAPIER_VERSION, RAPIER_WASM_SHA256 } from "./rapier.version"

export type Rapier2D = typeof import("./rapier.vendor.js")

export const RAPIER2D_MODULE = { name: "rapier2d", version: RAPIER_VERSION, sha256: RAPIER_WASM_SHA256 } as const

let loading: Promise<Rapier2D> | null = null

/** Rapier 2D, ready to use. Every caller shares one instance of the module. */
export function loadRapier2D(): Promise<Rapier2D> {
    loading ??= (async () => {
        const R = await import("./rapier.vendor.js")
        const exports = await instantiateWasm(RAPIER2D_MODULE, { "./rapier_wasm2d_bg.js": R.bg })
        R.bg.__wbg_set_wasm(exports)
        return R
    })().catch((e) => {
        // A failed load is retried on the next world rather than cached forever.
        loading = null
        throw e
    })
    return loading
}
