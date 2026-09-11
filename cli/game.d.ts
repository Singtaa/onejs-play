/** A file in a game folder: its path relative to the root, forward slashes, and its text. */
export interface GameFile {
    name: string
    text: string
}

/**
 * What the site builds, as a pattern over file names.
 *
 * The same set as ALLOWED in the site's limits, and held level with it by a
 * test there: a published npm package cannot import the Worker's source, so
 * there are two copies, and drift means a game that builds from a clone is
 * refused on publish with nothing useful said about why.
 */
export const SOURCE: RegExp

/** Every source file under a game folder, sorted, excluding dot folders and node_modules. */
export function readTree(root: string): GameFile[]

/** A game's oj.json, parsed, or an empty object. Throws if it is not JSON. */
export function manifestOf(files: GameFile[]): Record<string, unknown>

/** The file a game builds from: the manifest's entry, or index.tsx. */
export function entryOf(files: GameFile[], manifest?: Record<string, unknown>): string

/** The stage a game declares, with the defaults filled in. */
export function stageOf(manifest: Record<string, unknown>): { size: [number, number]; fit: string }

/** Builds a game folder with the same builder the site runs on publish. */
export function build(root: string, options?: { entry?: string }): Promise<{
    code: string
    slManifest: { version: number; programs: unknown[] } | null
    warnings: string[]
    entry: string
    files: GameFile[]
    manifest: Record<string, unknown>
}>

/** `tsc --noEmit` from the game's own install. Returns the exit code. */
export function typecheck(root: string): number
