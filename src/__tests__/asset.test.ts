import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { assetUrl, setAssetBase, getAssetBase } from "../asset"

/**
 * assetUrl is the one place that knows a game's files live somewhere different
 * on the site than they do in a Unity project. Both branches are covered here,
 * because the failure mode of getting either wrong is an image that silently
 * does not appear rather than anything that throws.
 */

const globals = globalThis as any

/** A CS stub shaped like the parts assetUrl actually reads. */
function unityHost(options: { editor: boolean; streaming?: string; dataPath?: string }) {
    const combine = (...parts: string[]) => parts.join("/")
    return {
        UnityEngine: {
            Application: {
                isEditor: options.editor,
                streamingAssetsPath: options.streaming ?? "/Player/Data/StreamingAssets",
                dataPath: options.dataPath ?? "/Project/Assets",
            },
        },
        System: {
            IO: {
                Path: {
                    Combine: combine,
                    GetDirectoryName: (p: string) => p.slice(0, p.lastIndexOf("/")),
                },
            },
        },
    }
}

describe("assetUrl", () => {
    const originalCS = globals.CS
    const originalWorkingDir = globals.__workingDir

    beforeEach(() => {
        setAssetBase(null)
        delete globals.CS
        delete globals.__workingDir
    })

    afterEach(() => {
        setAssetBase(null)
        globals.CS = originalCS
        globals.__workingDir = originalWorkingDir
    })

    describe("inside the container", () => {
        beforeEach(() => setAssetBase("https://abc123.onejsusercontent.com/assets"))

        it("joins the base and the name", () => {
            expect(assetUrl("glow.png")).toBe("https://abc123.onejsusercontent.com/assets/glow.png")
        })

        it("returns an absolute URL, which is what the image loader needs", () => {
            // A rooted path like /assets/glow.png reads as a file path to
            // System.IO and never reaches the network, so the base carrying an
            // origin is load-bearing rather than cosmetic.
            expect(assetUrl("glow.png")).toContain("://")
        })

        it("tolerates the two ways people write the name anyway", () => {
            expect(assetUrl("./glow.png")).toBe("https://abc123.onejsusercontent.com/assets/glow.png")
            expect(assetUrl("assets/glow.png")).toBe("https://abc123.onejsusercontent.com/assets/glow.png")
        })

        it("trims a trailing slash off the base rather than doubling it", () => {
            setAssetBase("https://abc123.onejsusercontent.com/assets/")
            expect(assetUrl("glow.png")).toBe("https://abc123.onejsusercontent.com/assets/glow.png")
        })
    })

    describe("in a Unity project", () => {
        it("resolves through the working directory in the editor", () => {
            globals.CS = unityHost({ editor: true })
            globals.__workingDir = "/Project/Assets/Scenes/Main/App"
            expect(assetUrl("glow.png")).toBe("/Project/Assets/Scenes/Main/App/assets/glow.png")
        })

        it("falls back to the App folder when no working directory is set", () => {
            globals.CS = unityHost({ editor: true, dataPath: "/Project/Assets" })
            expect(assetUrl("glow.png")).toBe("/Project/App/assets/glow.png")
        })

        it("resolves into StreamingAssets in a player", () => {
            globals.CS = unityHost({ editor: false, streaming: "/Player/Data/StreamingAssets" })
            expect(assetUrl("blip.wav")).toBe("/Player/Data/StreamingAssets/onejs/assets/blip.wav")
        })

        it("joins with slashes when StreamingAssets is a URL", () => {
            // Android hands back jar:file://...apk!/assets and WebGL an http
            // one. Path.Combine mangles both.
            globals.CS = unityHost({ editor: false, streaming: "jar:file:///data/app.apk!/assets" })
            expect(assetUrl("glow.png")).toBe("jar:file:///data/app.apk!/assets/onejs/assets/glow.png")
        })
    })

    describe("things that already resolve", () => {
        it("passes a remote URL through untouched", () => {
            setAssetBase("https://abc123.onejsusercontent.com/assets")
            expect(assetUrl("https://example.com/a.png")).toBe("https://example.com/a.png")
        })

        it("passes a rooted path through untouched", () => {
            setAssetBase("https://abc123.onejsusercontent.com/assets")
            expect(assetUrl("/tmp/a.png")).toBe("/tmp/a.png")
        })

        it("passes a Windows path through untouched", () => {
            expect(assetUrl("C:\\art\\a.png")).toBe("C:\\art\\a.png")
        })
    })

    it("returns something usable with no host at all", () => {
        expect(assetUrl("glow.png")).toBe("assets/glow.png")
    })

    it("refuses an empty name rather than producing a directory URL", () => {
        expect(() => assetUrl("")).toThrow(/file name/)
    })

    it("reports the base it was given", () => {
        setAssetBase("https://x/assets")
        expect(getAssetBase()).toBe("https://x/assets")
        setAssetBase(null)
        expect(getAssetBase()).toBeNull()
    })
})
