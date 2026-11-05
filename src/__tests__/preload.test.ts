import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * preload asks early for files a game will need, through the loaders' own
 * caches, and says how far it has got in bytes from the build's file map
 * (PlaySite docs/refs-and-assets.md).
 */
const asked: string[] = []
vi.mock("onejs-unity/assets", () => ({
    loadImageAsync: async (url: string) => { asked.push(`image ${url}`); return { url } },
    loadTextAsync: async (url: string) => { asked.push(`text ${url}`); return "" },
}))
vi.mock("../models", () => ({
    loadModel: async (name: string) => { asked.push(`model ${name}`); return { id: 1 } },
}))

const { setAssetBase, setAssetMap, loadTexture } = await import("../asset")
const { preload, preloadNames } = await import("../preload")

const h = (c: string) => c.repeat(64)

describe("preload", () => {
    beforeEach(() => {
        asked.length = 0
        setAssetBase("https://abc.onejsusercontent.com/assets")
        setAssetMap({
            "glow.png": [h("a"), 100], "models/ship.glb": [h("b"), 1000],
            "music/theme.ogg": [h("c"), 400], "music/win.wav": [h("d"), 500],
        })
    })

    it("opens a folder into the build's files under it", () => {
        expect(preloadNames(["music/", "glow.png", "glow.png"]).sort()).toEqual(["glow.png", "music/theme.ogg", "music/win.wav"])
    })

    it("loads each file the way first use would, and counts bytes up to a total known at the start", async () => {
        const seen: Array<[number, number]> = []
        await preload(["glow.png", "models/ship.glb", "music/"], (got, total) => seen.push([got, total]))
        expect(seen[0]).toEqual([0, 2000])
        expect(seen.at(-1)).toEqual([2000, 2000])
        expect(seen).toHaveLength(5)
        expect(asked.sort()).toEqual([
            `image https://abc.onejsusercontent.com/assets/${h("a")}/glow.png`,
            "model models/ship.glb",
            `text https://abc.onejsusercontent.com/assets/${h("c")}/music/theme.ogg`,
            `text https://abc.onejsusercontent.com/assets/${h("d")}/music/win.wav`,
        ])
        // The picture is in the texture cache: asking for it again fetches nothing.
        asked.length = 0
        await loadTexture("glow.png")
        expect(asked).toEqual([])
    })
})
