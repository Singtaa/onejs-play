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
    /**
     * The source map, as JSON text, only when `sourcemap` was asked for.
     * Its `sources` are the cart's file names ("lib/rules.ts"), a used cart's
     * under its key folder; no `sourcesContent`. The code carries no
     * sourceMappingURL comment either way.
     */
    map?: string
}

/** Modules the container provides, which a game imports and never bundles. */
export const EXTERNALS: string[]

/** One used cart, as the caller fetched it from its kept build. */
export interface UsedCart {
    /** Its oj.json `exports`: the file `import ... from "@handle/name"` reads. */
    exports: string | null
    /** Its oj.json `entry`: what `import "@handle/name"` runs when it has no `exports`. index.tsx when absent. */
    entry?: string | null
    /** Its own oj.json dependencies, address to key. */
    uses: Record<string, string>
    /** Entries in its dependencies that are not a cart pin, address to the sentence why. */
    skipped?: Record<string, string>
    /** Its source files, names relative to its root. */
    files: GameFile[]
}

/** The carts a cart uses, transitively: its own `uses`, and every key's files. */
export interface UsedCarts {
    uses: Record<string, string>
    /** Entries in the cart's dependencies that are not a cart pin, address to the sentence why. */
    skipped?: Record<string, string>
    carts: Record<string, UsedCart>
}

/** oj.json's dependencies split into cart pins and skipped entries (`problems` are the warnings). */
export function cartPins(deps: unknown): {
    pins: Array<[string, string]>
    skipped: Record<string, string>
    problems: string[]
}

/** `@singtaa/lightning@1.2.0`, or `@koma/rain@3f2a91c07b44` for a `#` commit pin. */
export function cartKey(address: string, pin: string): string

/** What is wrong with one dependency, as a sentence with the fix, or null. */
export function pinProblem(address: string, pin: unknown): string | null

/** "@singtaa/lightning 1.2.0", or "@koma/rain #3f2a91c07b44". */
export function cartLabel(key: string): string

/** The names a used cart's scoped oj reads inside its own folder. */
export const SCOPED: string[]

/** The source of the scoped oj a used cart gets for "oj". */
export function scopedOj(key: string): string

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
         * `{ parse, compile, manifest }` from `onejs-unity/sl`, for a host that
         * cannot evaluate the JavaScript it builds. A Cloudflare Worker is one.
         * Omit it in Node and the plugin compiles the parser itself.
         */
        slCompiler?: unknown
        /** The carts this one uses (PlaySite docs/carts.md §3). None when omitted. */
        carts?: UsedCarts
        /** Also return a source map (`map`). Off by default; the code is the same either way. */
        sourcemap?: boolean
    },
): Promise<GameBuild>

/** esbuild's failure as `file:line:column: text` lines. */
export function formatBuildErrors(error: unknown): string[]
