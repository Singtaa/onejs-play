/**
 * Where a game's own files live, on both sides of an eject.
 *
 * A game that ships a sprite or a sound has to name it, and the name has to
 * mean the same thing in two places that store files completely differently:
 *
 *   on the site, under `/assets/` on the game's own origin, fetched over HTTP;
 *   in a Unity project, under the project's `assets/` folder in the editor and
 *   inside `StreamingAssets/onejs/assets/` in a build.
 *
 * `assetUrl` is the one function that knows which. A game writes the bare file
 * name and gets back something the loaders can actually fetch:
 *
 *     <Image src={assetUrl("glow.png")} />
 *     const blip = await audio.load(assetUrl("blip.wav"))
 *
 * Explicit at the call site on purpose. The alternative was to teach every
 * loader a hidden base, which would mean a bare "glow.png" resolving through
 * machinery a reader cannot see, and two loaders that disagreed about it would
 * be a bug with no visible cause. One call, greppable, same source everywhere.
 */

import { useEffect, useState } from "react"
import { loadImageAsync } from "onejs-unity/assets"

declare const globalThis: any

/**
 * The container's base, set by the host. Null outside one, which is what
 * selects the Unity convention below.
 */
let base: string | null = null

/** Called by the host. Games have no reason to touch this. */
export function setAssetBase(next: string | null): void {
    base = next === null ? null : next.replace(/\/+$/, "")
}

export function getAssetBase(): string | null {
    return base
}

/** Already fetchable as written: a full URL, or a rooted path in a project. */
function isResolved(name: string): boolean {
    return name.includes("://") || name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)
}

/**
 * The address of one of this game's files.
 *
 * Names are bare: "glow.png", not "assets/glow.png" and not a path. Anything
 * that already resolves (a full URL, or an absolute path in a Unity project) is
 * handed back untouched, so passing a remote image through this is harmless.
 */
export function assetUrl(name: string): string {
    if (typeof name !== "string" || name === "") {
        throw new Error("[oj] assetUrl needs a file name")
    }
    if (isResolved(name)) return name

    // Leading "./" and "assets/" are what a web habit produces, and both mean
    // the thing this function is already about. Accepting them costs one line
    // and removes a class of "why is my sprite missing".
    const clean = name.replace(/^\.\//, "").replace(/^assets\//, "")

    if (base !== null) return `${base}/${clean}`

    // No container, so this is a real Unity project and OneJS's own convention
    // applies. Editor and player put the same file in different places, which
    // is why this cannot be a constant.
    const CS = globalThis.CS
    if (CS?.UnityEngine?.Application === undefined) {
        // No host at all: a unit test, or a component rendered outside OneJS.
        // A relative path is the least surprising thing to hand back.
        return `assets/${clean}`
    }
    const Path = CS.System.IO.Path
    if (CS.UnityEngine.Application.isEditor === true) {
        const workingDir = typeof globalThis.__workingDir === "string"
            ? globalThis.__workingDir
            : Path.Combine(Path.GetDirectoryName(CS.UnityEngine.Application.dataPath), "App")
        return Path.Combine(workingDir, "assets", clean)
    }
    const streaming: string = CS.UnityEngine.Application.streamingAssetsPath
    // On Android streamingAssetsPath is a jar:file:// URL and on WebGL an
    // http one, neither of which Path.Combine can join correctly.
    if (streaming.includes("://")) return `${streaming}/onejs/assets/${clean}`
    return Path.Combine(streaming, "onejs", "assets", clean)
}


/**
 * Loads one of this game's images, as something the runtime can draw.
 *
 * What comes back is a Unity texture, and it is deliberately opaque: a game
 * holds it and hands it to whatever wants a sprite, without ever calling
 * anything on it. That is what the particle system's `texture` field takes.
 *
 *     const glow = await loadTexture("glow.png")
 *     useParticles(ref, { emitters: [{ texture: glow, ... }] })
 *
 * A bare name, resolved the same way everywhere. SVG works too, and comes back
 * as a VectorImage rather than a texture.
 */
export async function loadTexture(name: string): Promise<unknown> {
    return loadImageAsync(assetUrl(name))
}

/**
 * The hook form, for the common case of a component that needs a sprite.
 *
 * Null until it arrives, so a caller renders nothing (or a placeholder) for the
 * frame or two the fetch takes. Loading is not cancelled on unmount, because
 * the underlying loader caches by URL and a second mount would otherwise pay
 * for the same bytes again; the result is simply dropped.
 */
export function useTexture(name: string): unknown | null {
    const [texture, setTexture] = useState<unknown | null>(null)

    useEffect(() => {
        let live = true
        setTexture(null)
        loadTexture(name).then(
            (loaded) => { if (live) setTexture(loaded) },
            (error) => console.error(`[oj] could not load ${name}:`, error),
        )
        return () => { live = false }
    }, [name])

    return texture
}
