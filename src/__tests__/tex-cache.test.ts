import { describe, it, expect } from "vitest"
import { tex } from "../tex"
import { TexCache, cacheKey, type CacheBackend } from "../tex/cache"
import { TEX_KERNELS } from "../tex/kernels"

/** A backend in memory, as IndexedDB or the player's folder would hold it, that a second TexCache can open again. */
function memory(): CacheBackend & { entries: Map<string, string>, failing: boolean } {
    const entries = new Map<string, string>()
    const b = {
        entries,
        failing: false,
        async get(name: string) { if (b.failing) throw new Error("quota"); return entries.get(name) },
        async put(name: string, value: string) { if (b.failing) throw new Error("quota"); entries.set(name, value) },
        async delete(name: string) { entries.delete(name) },
        async clear() { entries.clear() },
    }
    return b
}

const picture = (fill: string, chars: number) => fill.repeat(chars)

describe("tex cache key", () => {
    it("is the recipe, however it was spelt", () => {
        const { noise, blur } = tex.canvas(64, { tile: true })
        const a = noise("perlin", 7).warp(noise("perlin", 11), 18)
        expect(cacheKey(blur(a, 3).node)).toBe(cacheKey(a.blur({ radius: 3 }).node))
    })

    it("changes with one seed, one size, one tiling or the kernels' version", () => {
        const n = tex.canvas(64, { tile: true }).noise("perlin", 7).blur(2)
        const key = cacheKey(n.node)!
        expect(cacheKey(tex.canvas(64, { tile: true }).noise("perlin", 8).blur(2).node)).not.toBe(key)
        expect(cacheKey(tex.canvas(65, { tile: true }).noise("perlin", 7).blur(2).node)).not.toBe(key)
        expect(cacheKey(tex.canvas(64).noise("perlin", 7).blur(2).node)).not.toBe(key)
        expect(cacheKey(n.node, TEX_KERNELS + 1)).not.toBe(key)
    })

    it("is none for a graph reading tex.pixels, whose bytes are not in its id", () => {
        // A fake host: tex.pixels uploads at once.
        ;(globalThis as any).CS = fakeUnity()
        const p = tex.pixels(1, 1, [0, 0, 0, 255])
        expect(cacheKey(p.node)).toBeUndefined()
        expect(cacheKey(p.blur(1).node)).toBeUndefined()
        expect(cacheKey(tex.canvas(1).noise(3).blend(p).node)).toBeUndefined()
    })
})

describe("tex cache", () => {
    it("never serves an old picture for a changed recipe or a newer kernel", async () => {
        const backend = memory()
        const grass = tex.canvas(64, { tile: true }).noise("perlin", 7).blur(2)
        const reseeded = tex.canvas(64, { tile: true }).noise("perlin", 8).blur(2)
        const old = new TexCache(backend)
        await old.put(cacheKey(grass.node, TEX_KERNELS)!, "drawn by this runtime")

        // The next load, by the same runtime: the same recipe hits, a changed one misses.
        const next = new TexCache(backend)
        expect(await next.get(cacheKey(grass.node, TEX_KERNELS)!)).toBe("drawn by this runtime")
        expect(await next.get(cacheKey(reseeded.node, TEX_KERNELS)!)).toBeUndefined()

        // A runtime whose kernels draw other pixels asks with another key, and misses.
        expect(await next.get(cacheKey(grass.node, TEX_KERNELS + 1)!)).toBeUndefined()
    })

    it("drops the least recently used past its cap", async () => {
        const backend = memory()
        const cache = new TexCache(backend, { cap: 100 })
        await cache.put("a", picture("a", 40))
        await cache.put("b", picture("b", 40))
        // A hit makes "a" the newest, so "b" is the one a third picture pushes out.
        expect(await cache.get("a")).toBe(picture("a", 40))
        await cache.put("c", picture("c", 40))
        expect(await cache.get("b")).toBeUndefined()
        expect(await cache.get("a")).toBe(picture("a", 40))
        expect(await cache.get("c")).toBe(picture("c", 40))
        expect(cache.size).toBe(80)
        expect([...backend.entries.values()]).not.toContain(picture("b", 40))
    })

    it("keeps its order and its total across a reload", async () => {
        const backend = memory()
        const first = new TexCache(backend, { cap: 100 })
        await first.put("a", picture("a", 40))
        await first.put("b", picture("b", 40))
        await first.get("a")
        const second = new TexCache(backend, { cap: 100 })
        await second.put("c", picture("c", 40))
        expect(second.size).toBe(80)
        expect(await second.get("b")).toBeUndefined()
        expect(await second.get("a")).toBe(picture("a", 40))
    })

    it("stores nothing bigger than the cap, and replaces a key in place", async () => {
        const backend = memory()
        const cache = new TexCache(backend, { cap: 100 })
        await cache.put("a", picture("a", 40))
        await cache.put("huge", picture("h", 101))
        expect(await cache.get("huge")).toBeUndefined()
        expect(await cache.get("a")).toBe(picture("a", 40))
        await cache.put("a", picture("A", 60))
        expect(cache.size).toBe(60)
    })

    it("clears every picture and its index", async () => {
        const backend = memory()
        const cache = new TexCache(backend)
        await cache.put("a", "x")
        await cache.clear()
        expect(cache.size).toBe(0)
        expect(backend.entries.size).toBe(0)
        expect(await new TexCache(backend).get("a")).toBeUndefined()
    })

    it("treats a storage that fails as an empty one, and never throws", async () => {
        const backend = memory()
        const cache = new TexCache(backend)
        backend.failing = true
        await expect(cache.put("a", "x")).resolves.toBeUndefined()
        await expect(cache.get("a")).resolves.toBeUndefined()
        backend.failing = false
        await cache.put("b", "y")
        expect(await cache.get("b")).toBe("y")
    })

    it("forgets an index entry whose picture has gone", async () => {
        const backend = memory()
        const cache = new TexCache(backend, { cap: 100 })
        await cache.put("a", picture("a", 40))
        // The browser evicted the record but kept the index, or the reverse.
        for (const [name, value] of backend.entries) if (value === picture("a", 40)) backend.entries.delete(name)
        expect(await cache.get("a")).toBeUndefined()
        expect(cache.size).toBe(0)
    })
})

function fakeUnity() {
    class Texture2D { filterMode = 0; wrapMode = 0; LoadRawTextureData() {} Apply() {} }
    return {
        UnityEngine: {
            Texture2D, TextureFormat: { RGBA32: 4 }, FilterMode: { Bilinear: 1 },
            TextureWrapMode: { Repeat: 0, Clamp: 1 }, Object: { Destroy() {} },
        },
    }
}
