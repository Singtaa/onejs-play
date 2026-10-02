import { describe, it, expect, afterEach } from "vitest"
import { Image } from "../index"
import { setAssetBase } from "../asset"

/**
 * `<Image src>` takes a cart's file by its bare name, as useTexture, audio.load and
 * useModel do. onejs-react's own Image resolves a bare name against the runtime's
 * StreamingAssets, which on the site is the container's, not the cart's: the image
 * 404ed and the only way to show one was to know to wrap the name in assetUrl.
 */
const srcOf = (props: Record<string, unknown>) => (Image as any).render(props, null).props.src

describe("Image", () => {
    afterEach(() => setAssetBase(null))

    it("finds a cart's file by the name the sidebar shows", () => {
        setAssetBase("https://abc123.onejsusercontent.com/assets")
        expect(srcOf({ src: "coin.png" })).toBe("https://abc123.onejsusercontent.com/assets/coin.png")
        expect(srcOf({ src: "sprites/hero.png" })).toBe("https://abc123.onejsusercontent.com/assets/sprites/hero.png")
    })

    it("leaves a name that already resolves alone, assetUrl's included", () => {
        setAssetBase("https://abc123.onejsusercontent.com/assets")
        expect(srcOf({ src: "https://example.com/a.png" })).toBe("https://example.com/a.png")
        expect(srcOf({ src: "https://abc123.onejsusercontent.com/assets/coin.png" })).toBe("https://abc123.onejsusercontent.com/assets/coin.png")
    })

    it("passes no src through as none, for an Image given a texture instead", () => {
        expect(srcOf({ image: {} })).toBeUndefined()
    })
})
