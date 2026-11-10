import check, { LAWS, fogged as underFog, share } from "./ground-fog.playtest.mjs"

const CLEAR = [139, 137, 128]
type Law = keyof typeof LAWS

/** What a ground draws under each law: its share, unless `draw` says otherwise. */
const lawful = (law: Law, view: "down" | "slant") => underFog(CLEAR, share(law, view)).map(Math.round)

/**
 * A game whose screenshots' middle pixel is `pixels[kind near|far]` for the quads, and for the
 * ground `ground(law, view)`, or the unfogged CLEAR with no fog, as the playtest asks for them,
 * each screenshot `page` in size.
 */
function fake(pixels: Record<string, number[]>, ground: (law: Law, view: "down" | "slant", kind: string) => number[] = lawful, page = [240, 135]) {
    let shown = ""
    let view: "down" | "slant" = "down"
    let law: Law | null = null
    const lawOf = (o: any): Law => (Object.keys(LAWS) as Law[]).find((l) => JSON.stringify({ ...LAWS.linear, ...LAWS[l] }) === JSON.stringify(o))!
    return {
        browser: { send: async () => ({ data: "" }) },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code.includes("typeof globalThis.groundFog")) return "object"
            const show = /show\("(\w+)", (true|false|"ground")\)/.exec(code)
            if (show) { shown = `${show[1]} ${show[2] === "true" ? "far" : show[2] === "false" ? "near" : "ground"}`; return undefined }
            if (code.includes("__fogShown")) return shown.replace(" far", "true").replace(" near", "false").replace(" ground", "ground")
            const looks = /view\("(\w+)"\)/.exec(code)
            if (looks) { view = looks[1] as "down" | "slant"; return undefined }
            const fog = /groundFog\.fog\((.*)\)$/.exec(code)
            if (fog) { law = fog[1] === "false" ? null : lawOf(JSON.parse(fog[1])); return undefined }
            if (code.includes("getImageData")) {
                // The screenshot's size, then its middle pixel, as the playtest's page decodes it.
                if (!shown.endsWith("ground")) return JSON.stringify([...page, ...pixels[shown]])
                return JSON.stringify([...page, ...(law === null ? CLEAR : ground(law, view, shown.split(" ")[0]))])
            }
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

const near = [139, 137, 128], fogged = [207, 99, 92]
const all = (far: number[], splatFar = far, triplanarFar = far) => ({
    "plain near": near, "plain far": far,
    "texture near": near, "texture far": far,
    "splat near": near, "splat far": splatFar,
    "triplanar near": near, "triplanar far": triplanarFar,
})

describe("the ground-fog playtest", () => {
    it("passes when plain, texture, splat and triplanar fog alike", async () => {
        await expect(check(fake(all(fogged)))).resolves.toBeUndefined()
    })

    it("fails when the page kept oj test's size, where a software runner draws it too slowly", async () => {
        await expect(check(fake(all(fogged), lawful, [960, 540]))).rejects.toThrow(/the page is 960 by 540, not the 240 by 135/)
    })

    it("fails when the splat stays unfogged, as runtime 1.6's first builds drew it", async () => {
        await expect(check(fake(all(fogged, near)))).rejects.toThrow(/splat far is 139, 137, 128 where plain is 207, 99, 92/)
    })

    it("fails when a triplanar layer alone stays unfogged", async () => {
        await expect(check(fake(all(fogged, fogged, near)))).rejects.toThrow(/triplanar far is 139, 137, 128 where plain is 207, 99, 92/)
    })

    it("fails when fog moved nothing, rather than passing on three equal unfogged quads", async () => {
        await expect(check(fake(all(near)))).rejects.toThrow(/nothing was measured/)
    })

    it("fails when a law draws as no fog, as exp2 did in a container that kept linear variants alone", async () => {
        const ground = (law: Law, view: "down" | "slant") => law === "exp2" ? CLEAR : lawful(law, view)
        await expect(check(fake(all(fogged), ground))).rejects.toThrow(/plain down exp2 is 139, 137, 128 where a share of 0.086 is/)
    })

    it("fails when height fog draws as the same density everywhere, on GroundLit alone", async () => {
        const ground = (law: Law, view: "down" | "slant", kind: string) =>
            kind === "splat" && law === "exp2 height" ? lawful("exp2", view) : lawful(law, view)
        await expect(check(fake(all(fogged), ground))).rejects.toThrow(/splat slant exp2 height is .* where a share of 0.802/)
    })
})
