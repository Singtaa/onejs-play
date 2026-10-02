/**
 * Sound, with a game's own files by name.
 *
 * onejs-unity's `audio.load` takes a URL. Here it also takes a bare file name,
 * resolved through `assetUrl` the same way `useTexture("glow.png")` is, so the
 * two loaders read alike: `audio.load("pop.wav")`. A full URL still passes
 * straight through, since `assetUrl` hands anything that already resolves back
 * untouched. Everything else is onejs-unity's audio, unchanged.
 */

import { audio as unityAudio, type Sound } from "onejs-unity/audio"
import { assetUrl } from "./asset"

/**
 * What the bridge's UnityWebRequest can fetch.
 *
 * In a Unity project assetUrl resolves to a file path, which the image loader
 * reads from disk. UnityWebRequest instead reads a path with no scheme as an
 * address and asks https://localhost for it, so in a built player every sound
 * failed with "Cannot connect to destination host" and the game played silent
 * (the Ghost Hunt dry run, 1 Oct 2026). A path becomes a file URL; a URL,
 * Android's jar:file:// included, is already one.
 */
export function loadableUrl(resolved: string): string {
    if (resolved.includes("://")) return resolved
    if (resolved.startsWith("/")) return "file://" + encodeURI(resolved)
    if (/^[A-Za-z]:[\\/]/.test(resolved)) return "file:///" + encodeURI(resolved.replace(/\\/g, "/"))
    return resolved
}

export const audio = {
    ...unityAudio,
    /** Loads one of this game's sounds by name, or any URL. */
    load(name: string): Promise<Sound> {
        return unityAudio.load(loadableUrl(assetUrl(name)))
    },
}
