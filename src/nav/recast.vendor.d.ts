// Types for recast.vendor.js: the packages' own, plus the Emscripten factory.
export * from "@recast-navigation/core"
export { generateSoloNavMesh } from "@recast-navigation/generators"

/** The Emscripten module factory, given an instantiateWasm hook so it never fetches. */
export declare function recastFactory(options: {
    instantiateWasm(imports: Record<string, Record<string, unknown>>, receive: (instance: { exports: unknown }) => void): object
}): Promise<unknown>
