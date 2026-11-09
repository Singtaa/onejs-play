import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `.texture()` through the cache, on a fake host: a miss draws and keeps the
 * picture, the next load (a fresh module, as a reloaded cart is) reads it back
 * into its kept texture without drawing, and `cache: false`, a changed recipe
 * or a OneJS without `KeptTexture.Upload` draws. The host's storage is the
 * player's folder, faked as a map of files.
 */
const draws = vi.hoisted(() => ({ count: 0 }))
vi.mock("../tex/engine", () => ({
    plan: () => [],
    draw: async (_plans: unknown, finish: (output: unknown) => unknown) => {
        draws.count++
        return finish(`drawn #${draws.count}`)
    },
}))

const files = new Map<string, string>()

function host({ upload = true } = {}) {
    const KeptTexture: Record<string, unknown> = {
        Create: (w: number, h: number) => ({ w, h, bytes: "" }),
        Fill: (output: string, into: { bytes: string }) => { into.bytes = output },
        StoredBytes: (read: { rt: { bytes: string } }) => read.rt.bytes,
    }
    if (upload) KeptTexture.Upload = (bytes: string, into: { bytes: string }) => { into.bytes = bytes; return true }
    const dir = (p: string) => [...files.keys()].some((k) => k.startsWith(`${p}/`))
    return {
        OneJS: { ShaderFX: { KeptTexture }, Lighting: { TextureRead: { Start: (rt: unknown) => ({ Done: true, Error: null, rt }) } } },
        UnityEngine: { Application: { persistentDataPath: "/data" } },
        System: { IO: {
            File: {
                Exists: (p: string) => files.has(p), ReadAllText: (p: string) => files.get(p),
                WriteAllText: (p: string, v: string) => { files.set(p, v) }, Delete: (p: string) => { files.delete(p) },
            },
            Directory: {
                Exists: dir, CreateDirectory: () => {},
                Delete: (p: string) => { for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k) },
            },
        } },
    }
}

/** A fresh tex, as a cart loading again gets. */
async function load(options = {}) {
    vi.resetModules()
    ;(globalThis as any).CS = host(options)
    return (await import("../tex")).tex
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const grass = (tex: Awaited<ReturnType<typeof load>>, seed = 7) => tex.canvas(64, { tile: true }).noise("perlin", seed).blur(2)

describe("tex .texture() across loads", () => {
    beforeEach(() => { files.clear(); draws.count = 0 })

    it("draws once, then reads the picture back on the next load", async () => {
        let tex = await load()
        const first = await grass(tex).ready() as unknown as { bytes: string }
        await settle()
        expect([draws.count, first.bytes]).toEqual([1, "drawn #1"])
        expect([...files.keys()].some((k) => k.startsWith("/data/oj-tex-cache/"))).toBe(true)

        tex = await load()
        const second = await grass(tex).ready() as unknown as { bytes: string }
        expect([draws.count, second.bytes]).toEqual([1, "drawn #1"])

        // A changed recipe is drawn, not served the old picture.
        tex = await load()
        expect((await grass(tex, 8).ready() as unknown as { bytes: string }).bytes).toBe("drawn #2")
    })

    it("draws every load with cache: false, and after tex.cache.clear()", async () => {
        let tex = await load()
        await grass(tex).ready({ cache: false })
        await settle()
        tex = await load()
        await grass(tex).ready({ cache: false })
        expect(draws.count).toBe(2)

        await grass(await load()).ready()
        await settle()
        tex = await load()
        await tex.cache.clear()
        await grass(tex).ready()
        expect(draws.count).toBe(4)
    })

    it("keeps nothing on a OneJS without KeptTexture.Upload", async () => {
        let tex = await load({ upload: false })
        await grass(tex).ready()
        await settle()
        expect(files.size).toBe(0)
        tex = await load({ upload: false })
        await grass(tex).ready()
        expect(draws.count).toBe(2)
        await expect(tex.cache.clear()).resolves.toBeUndefined()
    })
})
