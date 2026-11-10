import { describe, it, expect, vi } from "vitest"
import check from "./scene-depth.playtest.mjs"

type Half = { green: number, red: number }
type Seen = { left: Half, right: Half }

const GREEN: Half = { green: 1, red: 0 }
const RED: Half = { green: 0, red: 1 }
const BLACK: Half = { green: 0, red: 0 }

/** A game whose screenshot shares are what `read` gives for the mode last set. */
function fake(read: (mode: { withScene: boolean, off: number }) => Seen) {
    let mode = { withScene: false, off: 0 }
    return {
        browser: { send: async () => ({ data: "AAAA" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.sceneDepth")) return "object"
            if (code.includes("getContext(\"webgpu\")")) return "webgl2"
            const m = code.match(/sceneDepth\.mode\((.*)\)$/)
            if (m) { mode = JSON.parse(m[1]); return undefined }
            if (code.includes("base64,")) return JSON.stringify(read(mode))
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

const right = (mode: { off: number }): Seen => ({ left: mode.off === 0 ? GREEN : RED, right: GREEN })

describe("the scene-depth playtest", () => {
    vi.spyOn(console, "log").mockImplementation(() => {})

    it("passes a depth that is right alone and beside scene.texture, and turns red when the wall is expected elsewhere", async () => {
        await expect(check(fake(right) as any)).resolves.toBeUndefined()
    })

    it("fails a depth that reads the eye's z rather than the distance along each ray", async () => {
        // Right only near the middle: about a third of the wall's pixels.
        const z = (mode: { off: number }): Seen => ({ left: mode.off === 0 ? { green: 0.3, red: 0.7 } : RED, right: GREEN })
        await expect(check(fake(z) as any)).rejects.toThrow("not the distance along each ray")
    })

    it("fails a sky that does not read the far distance", async () => {
        await expect(check(fake((m) => ({ ...right(m), right: RED })) as any)).rejects.toThrow("not the far distance")
    })

    it("fails a depth that is right alone and wrong beside scene.texture", async () => {
        const beside = (m: { withScene: boolean, off: number }): Seen => m.withScene ? { left: RED, right: RED } : right(m)
        await expect(check(fake(beside) as any)).rejects.toThrow("beside scene.texture")
    })

    it("fails a check that stays green whatever the wall, which could not tell a wrong depth", async () => {
        await expect(check(fake(() => ({ left: GREEN, right: GREEN })) as any)).rejects.toThrow("cannot tell a wrong depth")
    })

    it("fails a black screen rather than measuring nothing", async () => {
        await expect(check(fake(() => ({ left: BLACK, right: BLACK })) as any)).rejects.toThrow("scene depth")
    })
})
