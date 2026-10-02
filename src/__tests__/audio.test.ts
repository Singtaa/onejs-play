import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * audio.load in a Unity project, where assetUrl hands back a file path.
 *
 * The bridge loads through UnityWebRequest, which reads a bare path as a URL
 * with no scheme and asks https://localhost for it: in a built player every
 * one of a cart's sounds failed with "Cannot connect to destination host"
 * (Ghost Hunt dry run, 1 Oct 2026), and the game played silent. So a path is
 * handed over as a file URL, and anything that already is a URL is not touched.
 */
const loaded: string[] = []
vi.mock("onejs-unity/audio", () => ({
    audio: { load: async (url: string) => { loaded.push(url); return { url } } },
}))

const { audio } = await import("../audio")
const { setAssetBase } = await import("../asset")
const globals = globalThis as any

function unityPlayer(streaming: string, separator = "/") {
    return {
        UnityEngine: { Application: { isEditor: false, streamingAssetsPath: streaming, dataPath: "" } },
        System: { IO: { Path: { Combine: (...parts: string[]) => parts.join(separator), GetDirectoryName: (p: string) => p } } },
    }
}

describe("audio.load", () => {
    const originalCS = globals.CS

    beforeEach(() => { loaded.length = 0; setAssetBase(null); delete globals.CS })
    afterEach(() => { setAssetBase(null); globals.CS = originalCS })

    it("hands the site's URL over as it is", async () => {
        setAssetBase("https://abc123.onejsusercontent.com/assets")
        await audio.load("catch.wav")
        expect(loaded).toEqual(["https://abc123.onejsusercontent.com/assets/catch.wav"])
    })

    it("makes a player's file path a file URL", async () => {
        globals.CS = unityPlayer("/Games/Ghost Hunt.app/Contents/Resources/Data/StreamingAssets")
        await audio.load("catch.wav")
        expect(loaded).toEqual(["file:///Games/Ghost%20Hunt.app/Contents/Resources/Data/StreamingAssets/onejs/assets/catch.wav"])
    })

    it("makes a Windows path a file URL with forward slashes", async () => {
        globals.CS = unityPlayer("C:\\Games\\GhostHunt_Data\\StreamingAssets", "\\")
        await audio.load("sfx/catch.wav")
        expect(loaded).toEqual(["file:///C:/Games/GhostHunt_Data/StreamingAssets/onejs/assets/sfx/catch.wav"])
    })

    it("leaves Android's jar URL alone", async () => {
        globals.CS = unityPlayer("jar:file:///data/app/base.apk!/assets")
        await audio.load("catch.wav")
        expect(loaded).toEqual(["jar:file:///data/app/base.apk!/assets/onejs/assets/catch.wav"])
    })

    it("passes a URL a cart wrote itself straight through", async () => {
        await audio.load("https://example.com/a.ogg")
        expect(loaded).toEqual(["https://example.com/a.ogg"])
    })
})
