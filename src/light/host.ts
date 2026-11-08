/**
 * Where a light file baked here goes besides the console: the host's answer to
 * it (docs/lightmapping.md §2). When `scene.bake(name)` bakes because the file
 * is missing, unreadable or out of date, it says so in one console line and
 * hands the host that line with the finished file's bytes. The Play editor
 * answers with Save, which writes the bytes under the name; `ojplay bake`
 * writes them itself. A host that installs nothing gets the line alone. The
 * editor's Bake again asks the other way, through `bakeAgain`.
 */

/** A named bake that ran here, finished. */
export interface BakedLight {
    /** The name the cart gave `scene.bake`, from the cart's root. */
    readonly name: string
    /** The console line that said so, word for word. */
    readonly line: string
    /** The light file, ready to write under `name`. */
    readonly bytes: Uint8Array
}

/**
 * How a named bake ended, in the words `done` resolves to: its file was
 * current and is showing (`loaded`), it baked here (after `baked` had the
 * file), it failed and the console said why, or it stopped unfinished
 * because a later bake replaced it, `scene.clearLight` took it, or the scene
 * went. Runtimes before 1.4.1 said `current` for `loaded`.
 */
export type BakeEnd = { how: "loaded" } | { how: "baked" } | { how: "failed", why: string } | { how: "stopped" }

export interface LightHost {
    baked(light: BakedLight): void
    /**
     * Each named bake as it starts and as it ends, for a host that waits on
     * them, as `ojplay bake` does. A name baked again starts again.
     */
    begun?(name: string): void
    ended?(name: string, end: BakeEnd): void
    /**
     * A named bake's progress, 0 to below 1, at most every
     * `PROGRESS_EVERY_MS` and whenever its page changes. Its end is `ended`.
     */
    progress?(name: string, fraction: number): void
    /** The scene that offered to bake `name` again went: `bakeAgain(name)` is false from now. */
    withdrawn?(name: string): void
}

/** The least time between two `progress` calls for one bake, in ms. */
export const PROGRESS_EVERY_MS = 250

let host: LightHost | null = null

/** Called by the host. Carts have no reason to touch this. */
export function setLightHost(next: LightHost | null): void {
    host = next
}

// Each named bake a live scene would make again, by name: the scene that baked a name last answers for it.
const offers = new Map<string, () => void>()

/** A scene that baked `name` offers to bake it again; the function returned withdraws the offer. */
export function offerAgain(name: string, again: () => void): () => void {
    offers.set(name, again)
    return () => {
        if (offers.get(name) !== again) return
        offers.delete(name)
        tell(() => host?.withdrawn?.(name), name)
    }
}

/**
 * Called by the host: bakes `name` again in the scene running now, whatever
 * its saved file says, and hands the host the new file through `baked`, as a
 * bake here does. False when no scene running now bakes that name.
 */
export function bakeAgain(name: string): boolean {
    const again = offers.get(name)
    if (again === undefined) return false
    again()
    return true
}

/** A named bake started. */
export function lightBegun(name: string): void {
    tell(() => host?.begun?.(name), name)
}

/** A named bake's progress. */
export function lightProgress(name: string, fraction: number): void {
    tell(() => host?.progress?.(name, fraction), name)
}

/** A named bake ended. */
export function lightEnded(name: string, end: BakeEnd): void {
    tell(() => host?.ended?.(name, end), name)
}

/** Says the line, then hands the host the file. A host that throws costs the cart nothing. */
export function lightBakedHere(light: BakedLight): void {
    console.warn(light.line)
    tell(() => host?.baked(light), light.name)
}

function tell(call: () => void, name: string): void {
    try {
        call()
    } catch (e) {
        console.warn(`[oj] the host could not take ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
}
