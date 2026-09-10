/** A file in the tree: a path relative to the game root, forward slashes, and its text. */
export interface GameFile {
    name: string
    text: string
}

export interface GameBuild {
    /** The bundle: an IIFE named __exports, minified. */
    code: string
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
    options?: { externals?: string[] },
): Promise<GameBuild>

/** esbuild's failure as `file:line:column: text` lines. */
export function formatBuildErrors(error: unknown): string[]
