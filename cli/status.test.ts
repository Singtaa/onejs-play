import { describe, it, expect } from "vitest"
import { describeStatus } from "./site.mjs"

/**
 * `ojplay status` printed the site's raw JSON. It now says it in sentences, and
 * `--json` keeps the object for a script.
 */
const base = { url: "https://play.onejs.com/@me/tuner", public: true }

describe("ojplay status, read aloud", () => {
    it("says when the tip of main is what runs", () => {
        expect(describeStatus({ ...base, head: "3f2a91c0aa", live: "3f2a91c0aa", buildError: null })).toEqual([
            "https://play.onejs.com/@me/tuner (public)",
            "live: 3f2a91c, the tip of main",
        ])
    })

    it("says why the tip is not what runs", () => {
        expect(describeStatus({ ...base, public: false, head: "4b1c0de111", live: "3f2a91c0aa", buildError: "index.tsx:3:9: Expected \";\"" })).toEqual([
            "https://play.onejs.com/@me/tuner (private)",
            "live: 3f2a91c",
            "tip of main: 4b1c0de did not build:",
            "  index.tsx:3:9: Expected \";\"",
        ])
    })

    it("says when a newer tip is still building, and when nothing has built yet", () => {
        expect(describeStatus({ ...base, head: "4b1c0de111", live: "3f2a91c0aa", buildError: null })[2]).toBe("tip of main: 4b1c0de is still building")
        expect(describeStatus({ ...base, head: "4b1c0de111", live: null, buildError: null })[1]).toBe("live: nothing yet")
    })
})
