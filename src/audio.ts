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

export const audio = {
    ...unityAudio,
    /** Loads one of this game's sounds by name, or any URL. */
    load(name: string): Promise<Sound> {
        return unityAudio.load(assetUrl(name))
    },
}
