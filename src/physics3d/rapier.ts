/**
 * Rapier, loaded once, from wherever this host keeps its module (src/wasm.ts).
 *
 * The glue is imported dynamically so that a game that never makes a world
 * never evaluates it: its top level builds a TextDecoder and a few dozen
 * FinalizationRegistries, and an IIFE bundle (the container's, an ejected
 * project's) keeps a dynamically imported module behind a lazy wrapper.
 */

import { instantiateWasm } from "../wasm"
import { RAPIER_VERSION, RAPIER_WASM_SHA256 } from "./rapier.version"

export type Rapier = typeof import("./rapier.vendor.js")

export const RAPIER_MODULE = { name: "rapier3d", version: RAPIER_VERSION, sha256: RAPIER_WASM_SHA256 } as const

let loading: Promise<Rapier> | null = null

/** Rapier, ready to use. Every caller shares one instance of the module. */
export function loadRapier(): Promise<Rapier> {
    loading ??= (async () => {
        const R = await import("./rapier.vendor.js")
        const exports = await instantiateWasm(RAPIER_MODULE, { "./rapier_wasm3d_bg.js": R.bg })
        R.bg.__wbg_set_wasm(exports)
        return R
    })().catch((e) => {
        // A failed load is retried on the next world rather than cached forever.
        loading = null
        throw e
    })
    return loading
}
