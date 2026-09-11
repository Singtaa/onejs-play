/** A file in the tree: a path relative to the game root, forward slashes, and its text. */
export interface GameFile {
    name: string
    text: string
}

/** One shader program, as the entry an editor turns into a compiled `.shader`. */
export interface ShaderManifestEntry {
    hash: string
    hlsl: string
    uniforms: string[]
}

export interface ShaderManifest {
    version: 1
    programs: ShaderManifestEntry[]
}

export interface GameBuild {
    /** The bundle: an IIFE named __exports, minified. */
    code: string
    /**
     * The game's `.sl` programs, for an eject to place beside the bundle.
     *
     * Named for the language rather than called `manifest`, which in this
     * package already means a game's own `oj.json`.
     *
     * Null only when the plugin never ran. A game with no `.sl` file gets an
     * empty manifest, which the eject leaves out.
     */
    slManifest: ShaderManifest | null
    warnings: string[]
}

/** Modules the container provides, which a game imports and never bundles. */
export const EXTERNALS: string[]

/** Resolves "." and ".." inside a POSIX path. */
export function normalize(path: string): string

/**
 * Builds a game from a tree with an initialised esbuild (wasm or native).
 * Rejects with esbuild's error: `errors[]` carry `text` and a `location`.
 */
export function buildGame(
    esbuild: { build(options: unknown): Promise<{ outputFiles?: Array<{ text: string }>; warnings: Array<{ text: string }> }> },
    files: GameFile[],
    entry: string,
    options?: {
        externals?: string[]
        /**
         * `absWorkingDir` for esbuild. Defaults to "/", which the wasm build
         * accepts everywhere; a native binary on Windows refuses it, so a
         * caller using one passes the filesystem root instead. Never used to
         * reach a real file: the tree is virtual.
         */
        workingDir?: string
        /**
         * `{ parse, encode, manifest }` from `onejs-unity/sl`, for a host that
         * cannot evaluate the JavaScript it builds. A Cloudflare Worker is one.
         * Omit it in Node and the plugin compiles the parser itself.
         */
        slCompiler?: unknown
    },
): Promise<GameBuild>

/** esbuild's failure as `file:line:column: text` lines. */
export function formatBuildErrors(error: unknown): string[]
