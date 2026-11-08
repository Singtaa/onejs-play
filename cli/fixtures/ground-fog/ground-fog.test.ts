import check from "./ground-fog.playtest.mjs"

/** A game whose screenshots' middle pixel is `pixels[kind near|far]`, as the playtest asks for them. */
function fake(pixels: Record<string, number[]>) {
    let shown = ""
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.groundFog")) return "object"
            const show = /show\("(\w+)", (true|false)\)/.exec(code)
            if (show) { shown = `${show[1]} ${show[2] === "true" ? "far" : "near"}`; return undefined }
            if (code.includes("__fogShown")) return shown.replace(" far", "true").replace(" near", "false")
            if (code.includes("getImageData")) return JSON.stringify(pixels[shown])
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

const near = [139, 137, 128], fogged = [207, 99, 92]
const all = (far: number[], splatFar = far) => ({
    "plain near": near, "plain far": far,
    "texture near": near, "texture far": far,
    "splat near": near, "splat far": splatFar,
})

describe("the ground-fog playtest", () => {
    it("passes when plain, texture and splat fog alike", async () => {
        await expect(check(fake(all(fogged)))).resolves.toBeUndefined()
    })

    it("fails when the splat stays unfogged, as runtime 1.6's first builds drew it", async () => {
        await expect(check(fake(all(fogged, near)))).rejects.toThrow(/splat far is 139, 137, 128 where plain is 207, 99, 92/)
    })

    it("fails when fog moved nothing, rather than passing on three equal unfogged quads", async () => {
        await expect(check(fake(all(near)))).rejects.toThrow(/nothing was measured/)
    })
})
