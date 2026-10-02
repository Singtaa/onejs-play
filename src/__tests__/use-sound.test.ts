import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * useSound(file): a sound by name, loaded with the component and unloaded with
 * it, so a cart never writes the effect, the cleanup and the unload by hand.
 * watchSound is its effect, driven here directly as watchModel is for useModel.
 */
const unloaded: string[] = []
const pending: Array<() => void> = []
vi.mock("onejs-unity/audio", () => ({
    audio: {
        load: (url: string) => new Promise((resolve, reject) => {
            if (url.endsWith("missing.wav")) return reject(new Error("no such file"))
            pending.push(() => resolve({ url, play: () => {}, unload: () => { unloaded.push(url) } }))
        }),
    },
}))

const { watchSound } = await import("../audio")
const { setAssetBase } = await import("../asset")
const settle = async () => { for (const r of pending.splice(0)) r(); await new Promise((r) => setTimeout(r, 0)) }

describe("useSound's effect", () => {
    beforeEach(() => { unloaded.length = 0; setAssetBase("https://x.test/assets") })

    it("hands over the sound, and unloads it when the component goes", async () => {
        const got = vi.fn()
        const stop = watchSound("pop.wav", got)
        await settle()
        expect(got).toHaveBeenCalledOnce()
        expect(got.mock.calls[0][0].url).toBe("https://x.test/assets/pop.wav")
        stop()
        expect(unloaded).toEqual(["https://x.test/assets/pop.wav"])
    })

    it("unloads a sound that arrives after the component has gone, and hands it to nobody", async () => {
        const got = vi.fn()
        const stop = watchSound("late.wav", got)
        stop()
        await settle()
        expect(got).not.toHaveBeenCalled()
        expect(unloaded).toEqual(["https://x.test/assets/late.wav"])
    })

    it("says which file failed while the component is there", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        watchSound("missing.wav", () => {})
        await settle()
        expect(String(error.mock.calls[0][0])).toMatch(/could not load missing\.wav/)
        error.mockRestore()
    })
})
