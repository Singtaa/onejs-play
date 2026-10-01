import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { contentTypeOf, isUploadableAsset, resolveAsset, unservableAssets, validAssetName } from "./assets.mjs"
import { serve } from "./local.mjs"

/**
 * The site's asset rule, as `oj run` applies it (#3). The name cases are the
 * site's own (PlaySite/src/media.ts): what a push stores and the origin
 * serves, so a cart that loads a sound here loads it live.
 */

function cart(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-assets-"))
    for (const [name, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
        fs.writeFileSync(path.join(dir, name), text)
    }
    return dir
}

describe("the site's asset name rule", () => {
    it("serves a cart's sounds, images and fonts by their path from its root", () => {
        for (const name of ["pop.wav", "art/bg.png", "a/b/c/d/e/f.ogg", "fonts/Inter-Bold.woff2", ".oj/covers/1.jpg"]) {
            expect(validAssetName(name), name).toBe(true)
        }
    })

    it("never serves the assets/ folder, which the runtime strips from every name", () => {
        expect(validAssetName("assets/pop.wav")).toBe(false)
        // Only as the first segment: a deeper folder of that name is a folder.
        expect(validAssetName("sfx/assets/pop.wav")).toBe(true)
    })

    it("refuses what a key must never be", () => {
        for (const name of ["../pop.wav", "a/../pop.wav", "/pop.wav", "a//pop.wav", ".hidden/pop.wav", "x/.oj/pop.wav",
            "a..b.wav", "a b.wav", "a/b/c/d/e/f/g.wav", `${"a".repeat(117)}.wav`, "index.tsx", "logo.svg", "clip.mp4"]) {
            expect(validAssetName(name), name).toBe(false)
        }
    })

    it("stores png and jpeg images only, and every sound and font", () => {
        expect(isUploadableAsset("a.png")).toBe(true)
        expect(isUploadableAsset("a.JPG")).toBe(true)
        expect(isUploadableAsset("a.webp")).toBe(false)
        expect(isUploadableAsset("a.gif")).toBe(false)
        expect(isUploadableAsset("a.mp3")).toBe(true)
        expect(isUploadableAsset("a.otf")).toBe(true)
        expect(contentTypeOf("a.wav")).toBe("audio/wav")
    })
})

describe("resolving /assets/<name> in a cart folder", () => {
    const root = cart({
        "pop.wav": "RIFF", "art/bg.png": "png", "assets/boom.wav": "RIFF", "Loud.wav": "RIFF", "old.webp": "webp",
    })

    it("finds a file by its exact path from the root", () => {
        expect(resolveAsset(root, "pop.wav").file).toBe(path.join(root, "pop.wav"))
        expect(resolveAsset(root, "art/bg.png").file).toBe(path.join(root, "art", "bg.png"))
    })

    it("does not find a file kept under assets/, and says where it is and what to do", () => {
        const byStripped = resolveAsset(root, "boom.wav")
        expect(byStripped.file).toBeUndefined()
        expect(byStripped.reason).toMatch(/one at assets\/boom\.wav.*move it up to boom\.wav/)
        expect(resolveAsset(root, "assets/boom.wav").reason).toMatch(/never serves a file inside an assets\/ folder/)
    })

    it("matches names case-sensitively, as the site's keys do, on any disk", () => {
        expect(resolveAsset(root, "Loud.wav").file).toBeDefined()
        expect(resolveAsset(root, "loud.wav").file).toBeUndefined()
    })

    it("refuses an image the site would not store", () => {
        expect(resolveAsset(root, "old.webp").reason).toMatch(/png or jpg/)
    })

    it("lists every asset file no request can reach", () => {
        const problems = unservableAssets(root)
        expect(problems).toHaveLength(2)
        expect(problems.join("\n")).toMatch(/assets\/boom\.wav/)
        expect(problems.join("\n")).toMatch(/old\.webp/)
        expect(unservableAssets(cart({ "pop.wav": "RIFF", "index.tsx": "" }))).toEqual([])
    })
})

describe("the local origin's /assets/", () => {
    it("serves by the rule, with the site's content type, and reports each refusal", async () => {
        const root = cart({ "pop.wav": "RIFF", "assets/boom.wav": "RIFF", "index.tsx": "secret" })
        const refused: string[] = []
        const server = await serve({ runtime: root, root, manifest: { name: "t" }, bundle: () => "", refused: (r: string) => refused.push(r) })
        try {
            const ok = await fetch(`${server.url}assets/pop.wav`)
            expect(ok.status).toBe(200)
            expect(ok.headers.get("content-type")).toBe("audio/wav")
            expect(await ok.text()).toBe("RIFF")
            // Before #3 all three of these were served: any file, by any path.
            for (const name of ["boom.wav", "assets/boom.wav", "index.tsx"]) {
                expect((await fetch(`${server.url}assets/${name}`)).status, name).toBe(404)
            }
            expect(refused).toHaveLength(3)
        } finally {
            server.close()
        }
    })
})
