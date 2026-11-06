// Types for rapier.vendor.js: the package's own, plus the glue the module imports.
export * from "@dimforge/rapier3d-deterministic"

/** The wasm-bindgen glue: the module's imports, and where it is told the module's exports. */
export declare const bg: Record<string, unknown> & { __wbg_set_wasm(exports: unknown): void }
