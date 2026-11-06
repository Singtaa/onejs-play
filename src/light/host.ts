/**
 * Where a light file baked here goes besides the console: the host's answer to
 * it (docs/lightmapping.md §2). When `scene.bake(name)` bakes because the file
 * is missing, unreadable or out of date, it says so in one console line and
 * hands the host that line with the finished file's bytes. The Play editor
 * answers with Save, which writes the bytes under the name; `ojplay bake`
 * writes them itself. A host that installs nothing gets the line alone.
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
 * How a named bake ended: its file was current and is showing, it baked here
 * (after `baked` had the file), it failed and the console said why, or it
 * stopped unfinished because a later bake replaced it or the scene went.
 */
export type BakeEnd = { how: "current" } | { how: "baked" } | { how: "failed", why: string } | { how: "stopped" }

export interface LightHost {
    baked(light: BakedLight): void
    /**
     * Each named bake as it starts and as it ends, for a host that waits on
     * them, as `ojplay bake` does. A name baked again starts again.
     */
    begun?(name: string): void
    ended?(name: string, end: BakeEnd): void
}

let host: LightHost | null = null

/** Called by the host. Carts have no reason to touch this. */
export function setLightHost(next: LightHost | null): void {
    host = next
}

/** A named bake started. */
export function lightBegun(name: string): void {
    tell(() => host?.begun?.(name), name)
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
