/**
 * Loading a game's files ahead of their first use, with progress.
 *
 * Every loader already fetches lazily, on the first ask. `preload` asks
 * early, for the files a game knows it will need before it can start (a
 * level's models, its music), so the first frame that uses them does not
 * wait. Pictures and models land in the same caches the loaders share, so a
 * later `useTexture` or `useModel` of the same name is instant; anything
 * else is fetched once so the browser holds it.
 *
 *     await preload(["models/ship.glb", "music/"], (got, total) => setBar(got / total))
 *
 * A name ending in "/" means every file of this build under that folder.
 * Progress is in bytes, from the build's own file map (assetInfo), so the
 * total is known before the first byte arrives; a file the map does not size
 * counts as nothing. (PlaySite docs/refs-and-assets.md.)
 */

import { loadTextAsync } from "onejs-unity/assets"
import { assetInfo, assetNames, assetUrl, forgetTexture, loadTexture } from "./asset"
import { forgetModel, loadModel } from "./models"

const IMAGE = /\.(png|jpe?g|svg)$/i
const MODEL = /\.glb$/i

/** Each name, with a folder ("music/") opened into the build's files under it. */
export function preloadNames(names: readonly string[]): string[] {
    const out = new Set<string>()
    const all = assetNames()
    for (const name of names) {
        if (name.endsWith("/")) for (const file of all) { if (file.startsWith(name)) out.add(file) }
        else out.add(name)
    }
    return [...out]
}

export async function preload(names: readonly string[], onProgress?: (got: number, total: number) => void): Promise<void> {
    const files = preloadNames(names)
    const size = (name: string) => assetInfo(name)?.bytes ?? 0
    const total = files.reduce((n, f) => n + size(f), 0)
    let got = 0
    onProgress?.(0, total)
    await Promise.all(files.map(async (name) => {
        if (IMAGE.test(name)) await loadTexture(name)
        else if (MODEL.test(name)) await loadModel(name)
        else await loadTextAsync(assetUrl(name))
        got += size(name)
        onProgress?.(got, total)
    }))
}

/**
 * Lets go of files the game no longer needs, so their memory comes back:
 * pictures and models the loaders hold are freed, and the next use loads them
 * again. Takes the same names as preload, folders included:
 *
 *     unload(["levels/1/"])
 *
 * Unload what nothing shows any more: a picture still on screen goes blank,
 * and a model with a copy still in the scene stays loaded (and says so).
 * Sounds free themselves when their component goes, and other files are only
 * the browser's cache, so neither needs this.
 */
export async function unload(names: readonly string[]): Promise<void> {
    await Promise.all(preloadNames(names).map(async (name) => {
        if (IMAGE.test(name)) await forgetTexture(name)
        else if (MODEL.test(name)) await forgetModel(name)
    }))
}
