/**
 * Where the WebAssembly modules oj ships come from, on every host.
 *
 * oj's engines (Rapier for physics, Recast for navigation) are WebAssembly,
 * and each host gets a module its own way:
 *
 * 1. **OneJS outside the browser** (QuickJS, which has no WebAssembly) links
 *    the same module natively and registers `globalThis.__wasm`. Asked first,
 *    and only used when it says it has this exact module.
 * 2. **A host that hands one over**, with setWasmModule: a room script on
 *    workerd, which cannot compile from bytes, and Node tests.
 * 3. **Otherwise it is fetched** from StreamingAssets,
 *    `onejs/assets/@ojplay/wasm/<name>-<version>.wasm`. ojplay ships each module
 *    under `assets/@ojplay/`, OneJS's convention for a package's assets, so every
 *    OneJS build copies it there: the Play container's, and an ejected game's
 *    WebGL build. A new version is a new address, so a cache can never hand an
 *    old module to new glue.
 *
 * Each module is named with its sha256, and a native module whose hash is not
 * the one this glue was generated against is refused by name, never run.
 */

// Type-level redeclaration only, so dynamic host globals typecheck.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

/** One module oj ships, as its generated version file describes it. */
export interface WasmModuleInfo {
    /** "rapier3d", "recast". Also the native library's name after `onejs_`. */
    name: string
    version: string
    sha256: string
}

/** What a module exports: its functions, and its memory. */
export type WasmExports = Record<string, unknown> & { memory: { buffer: ArrayBuffer } }

/** The import object, module name to functions, as `WebAssembly.instantiate` takes it. */
export type WasmImports = Record<string, Record<string, unknown>>

/**
 * What OneJS registers as `globalThis.__wasm` when it links modules natively.
 * Synchronous, since nothing is fetched or compiled.
 */
export interface NativeWasmHost {
    has(name: string, sha256: string): boolean
    instantiate(name: string, sha256: string, imports: WasmImports): WasmExports
}

const handed = new Map<string, unknown>()
let base: string | null = null

/**
 * Hands oj a compiled module, for a host that cannot fetch or compile one:
 * workerd refuses `WebAssembly.instantiate` on bytes, so a room script imports
 * the `.wasm` as a module and passes it here before creating a world.
 */
export function setWasmModule(name: string, module: unknown): void {
    handed.set(name, module)
}

/** Where to fetch modules from, without a trailing slash. Left unset, StreamingAssets decides. */
export function setWasmBase(url: string | null): void {
    base = url
}

/** The address a module is fetched from on this host, or null when there is nowhere to fetch it. */
export function wasmUrl(info: WasmModuleInfo): string | null {
    const file = `${info.name}-${info.version}.wasm`
    if (base !== null) return `${base}/${file}`
    const streaming = typeof globalThis.__streamingAssetsPath === "string" ? globalThis.__streamingAssetsPath as string : null
    if (streaming === null || !streaming.includes("://")) return null
    return `${streaming}/onejs/assets/@ojplay/wasm/${file}`
}

/** Instantiates one of oj's modules from wherever this host keeps it. */
export async function instantiateWasm(info: WasmModuleInfo, imports: WasmImports): Promise<WasmExports> {
    const native = globalThis.__wasm as NativeWasmHost | undefined
    if (native !== undefined && native.has(info.name, info.sha256)) {
        return native.instantiate(info.name, info.sha256, imports)
    }

    const WA = globalThis.WebAssembly
    if (WA === undefined) {
        throw new Error(
            `[oj] ${info.name} ${info.version} needs WebAssembly, which this JavaScript engine does not have, and ` +
            `OneJS has no native ${info.name} linked with sha256 ${info.sha256}` +
            (native === undefined ? "." : ` (it has a different build of it).`),
        )
    }

    const module = handed.get(info.name)
    if (module !== undefined) return (await WA.instantiate(module, imports)).exports

    const url = wasmUrl(info)
    if (url === null) {
        throw new Error(`[oj] nowhere to load ${info.name} ${info.version} from: no native module, none handed over with setWasmModule, and no StreamingAssets URL`)
    }
    // fetch through globalThis: a OneJS app typechecks with no DOM library, and every host here has one.
    const response = await globalThis.fetch(url)
    if (!response.ok) throw new Error(`[oj] ${info.name} ${info.version}: ${url} answered ${response.status}`)
    const { instance } = await WA.instantiate(await response.arrayBuffer(), imports)
    return instance.exports
}
