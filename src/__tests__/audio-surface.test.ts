import { describe, it, expect, vi } from "vitest"

/**
 * oj's audio is onejs-unity's with `load` taking a cart's file names. Copying the
 * object with a spread read its getters once, at import: `voices` and
 * `activeVoices` froze at whatever the bridge said then, and a host with no
 * audio bridge threw from `import "oj"` in a cart that never made a sound.
 */
let active = 0
let reads = 0
vi.mock("onejs-unity/audio", () => ({
    audio: {
        load: async (url: string) => ({ url }),
        stopAll() {},
        get voices() { reads++; return 8 },
        get activeVoices() { reads++; return active },
    },
}))

const { audio } = await import("../audio")

describe("oj's audio", () => {
    it("asks the bridge nothing until a cart does", () => {
        expect(reads).toBe(0)
    })

    it("reads the live voice count each time", () => {
        active = 3
        expect(audio.activeVoices).toBe(3)
        active = 1
        expect(audio.activeVoices).toBe(1)
    })

    it("keeps the rest of onejs-unity's audio", () => {
        expect(typeof audio.stopAll).toBe("function")
        expect(audio.voices).toBe(8)
    })
})
