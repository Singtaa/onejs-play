import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * What `.texture()` makes, and `tex.forget` gives back, on a fake host. A
 * look composed at run time (a dressed character's outfit) is one kept
 * texture; tex.pixels' bytes are a texture only while a draw reads them; a
 * forgotten texture is released once, after its bake is done with it, and
 * never drawn into after.
 */
const upload = vi.hoisted(() => ({ made: [] as { bytes: ArrayLike<number> | Float32Array, destroyed: boolean }[] }))
vi.mock("../tex/upload", () => {
    const make = (_w: number, _h: number, bytes: ArrayLike<number>) => {
        const t = { bytes, destroyed: false }
        upload.made.push(t)
        return t
    }
    return {
        uploadRGBA: make,
        uploadRGBAFloat: make,
        destroyTexture: (t: { destroyed: boolean }) => { t.destroyed = true },
    }
})
const passes = vi.hoisted(() => ({ read: [] as unknown[], compileFrames: 0 }))
vi.mock("onejs-react", () => ({
    createPass: (_program: unknown, { textures }: { textures: Record<string, unknown> }) => {
        passes.read.push(...Object.values(textures))
        let frames = passes.compileFrames
        return { draw: () => frames-- <= 0, compiled: true, texture: "output", dispose: () => {} }
    },
}))

interface Kept { w: number, h: number, fills: number, released: number }

function host() {
    const kept: Kept[] = []
    const KeptTexture = {
        Create: (w: number, h: number) => { const t = { w, h, fills: 0, released: 0 }; kept.push(t); return t },
        Fill: (_output: unknown, into: Kept) => { into.fills++ },
        Release: (t: Kept) => { t.released++ },
    }
    ;(globalThis as any).CS = { OneJS: { ShaderFX: { KeptTexture } } }
    return kept
}

async function load() {
    vi.resetModules()
    const kept = host()
    return { tex: (await import("../tex")).tex, kept }
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const look = (tex: Awaited<ReturnType<typeof load>>["tex"], value = 200) => tex.pixels(4, 2, new Uint8Array(32).fill(value))

describe("tex.forget", () => {
    beforeEach(() => {
        upload.made.length = 0
        passes.read.length = 0
        passes.compileFrames = 0
        ;(globalThis as any).requestAnimationFrame = (f: () => void) => setTimeout(f, 0)
    })

    it("makes no texture for tex.pixels until a draw reads it, and frees that one with the draw", async () => {
        const { tex } = await load()
        const bytes = new Uint8Array(32).fill(9)
        const image = tex.pixels(4, 2, bytes)
        bytes.fill(1)
        expect(upload.made).toHaveLength(0)
        await image.ready({ cache: false })
        expect(upload.made).toHaveLength(1)
        // The bytes as they were when the picture was made, uploaded for the draw and destroyed after it.
        expect([upload.made[0]!.bytes[0], upload.made[0]!.destroyed]).toEqual([9, true])
        expect(passes.read).toContain(upload.made[0])
    })

    it("releases a baked texture once, and the same graph asked again bakes a new one", async () => {
        const { tex, kept } = await load()
        const image = look(tex)
        const first = await image.ready()
        await settle()
        expect(image.texture()).toBe(first)

        expect(tex.forget(first)).toBe(true)
        await settle()
        expect(kept[0]!.released).toBe(1)
        expect(tex.forget(first)).toBe(false)
        await settle()
        expect(kept[0]!.released).toBe(1)

        const second = await image.ready()
        expect(second).not.toBe(first)
        expect([kept.length, kept[1]!.fills, kept[1]!.released]).toEqual([2, 1, 0])
    })

    it("gives back every look a crowd went through", async () => {
        const { tex, kept } = await load()
        const looks = await Promise.all(Array.from({ length: 300 }, (_, i) => look(tex, i % 256).ready()))
        await settle()
        expect(upload.made.every((t) => t.destroyed)).toBe(true)
        for (const t of looks) expect(tex.forget(t)).toBe(true)
        await settle()
        expect(kept.filter((t) => t.released !== 1)).toEqual([])
    })

    it("does not draw into a texture forgotten while its bake runs, and releases it when the bake is done", async () => {
        const { tex, kept } = await load()
        passes.compileFrames = 3
        const image = look(tex)
        const texture = image.texture()
        expect(tex.forget(texture)).toBe(true)
        // Not yet: the bake still holds it.
        expect(kept[0]!.released).toBe(0)
        await settle()
        expect([kept[0]!.fills, kept[0]!.released]).toEqual([0, 1])
        expect(upload.made.every((t) => t.destroyed)).toBe(true)
    })

    it("refuses what tex did not make, and never throws when the host cannot release", async () => {
        const { tex, kept } = await load()
        expect(tex.forget({} as never)).toBe(false)
        const t = await look(tex).ready()
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        ;(globalThis as any).CS.OneJS.ShaderFX.KeptTexture.Release = () => { throw new Error("gone") }
        expect(tex.forget(t)).toBe(true)
        await settle()
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not released \(gone\)/))
        expect(kept[0]!.released).toBe(0)
        warn.mockRestore()
    })
})
