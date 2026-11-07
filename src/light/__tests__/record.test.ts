import { BAKE_DEFAULTS } from "../bake"
import { BAKER_VERSION, bakedHereLine, difference, layoutOf, matches, OLDER, parseSaved, recordOf, sameLayout, type BakeOptionValues, type LightInputs, type SavedLight, type StaticActor } from "../record"

const actor = (model: string, x: number, over: Partial<StaticActor> = {}): StaticActor => ({
    model, sha: `sha-${model}`, position: [x, 0, 0], rotation: { yaw: 0, pitch: 0, roll: 0 }, scale: 1, ...over,
})
const scene = (actors: StaticActor[], over: Partial<LightInputs> = {}, options: Partial<BakeOptionValues> = {}): LightInputs => ({
    actors, sun: { direction: [0.3, -0.8, 0.5], color: [1, 0.95, 0.9], intensity: 1 },
    ambient: { sky: [0.6, 0.7, 0.9], ground: [0.3, 0.25, 0.2] }, options: { ...BAKE_DEFAULTS, ...options }, ...over,
})
const yard = [actor("models/yard.glb", 0), actor("wall.glb", 5), actor("wall.glb", -5)]

describe("a light record", () => {
    it("is the same scene whatever order the actors were spawned in, and under float noise", () => {
        const a = recordOf(scene(yard))
        const b = recordOf(scene([yard[2]!, yard[0]!, actor("wall.glb", 5 + 3e-5)]))
        expect(b.fingerprint).toBe(a.fingerprint)
        expect(matches(a, b)).toBe(true)
        expect(difference(a, b)).toBe(null)
    })

    it("names a model whose file changed, where it stands unchanged", () => {
        const now = recordOf(scene([actor("models/yard.glb", 0, { sha: "new" }), yard[1]!, yard[2]!]))
        expect(matches(recordOf(scene(yard)), now)).toBe(false)
        expect(difference(recordOf(scene(yard)), now)).toBe("models/yard.glb changed")
    })

    it("names an actor added, moved, turned or gone", () => {
        const saved = recordOf(scene(yard))
        expect(difference(saved, recordOf(scene([...yard, actor("crate.glb", 2)])))).toBe("crate.glb at [2, 0, 0] is not in it")
        expect(difference(saved, recordOf(scene([yard[0]!, yard[1]!, actor("wall.glb", -6)])))).toBe("wall.glb moved from [-5, 0, 0] to [-6, 0, 0]")
        expect(difference(saved, recordOf(scene([yard[0]!, yard[1]!, actor("wall.glb", -5, { rotation: { yaw: 90, pitch: 0, roll: 0 } })])))).toBe("wall.glb at [-5, 0, 0] turned or was scaled")
        expect(difference(saved, recordOf(scene([yard[0]!, yard[1]!])))).toBe("wall.glb at [-5, 0, 0] is no longer there")
    })

    it("names the sun, the ambient, the options and the baker, after the actors", () => {
        const saved = recordOf(scene(yard))
        expect(difference(saved, recordOf(scene(yard, { sun: { direction: [0, -1, 0], color: [1, 1, 1], intensity: 1 } })))).toBe("the sun changed")
        expect(difference(saved, recordOf(scene(yard, { sun: null })))).toBe("the sun is out")
        expect(difference(saved, recordOf(scene(yard, { ambient: { sky: [1, 1, 1], ground: [0, 0, 0] } })))).toBe("the ambient light changed")
        expect(difference(saved, recordOf(scene(yard, {}, { bounces: 3 })))).toBe("its bounces changed from 2 to 3")
        expect(difference(saved, recordOf(scene(yard, {}, { samples: 64 })))).toBe("its samples changed from 256 to 64")
        expect(difference(saved, recordOf(scene(yard, {}, { occlusion: 0.5 })))).toBe("its occlusion changed from 0 to 0.5")
        expect(difference(saved, recordOf(scene(yard, {}, { detail: 12 })))).toBe("its detail changed from 24 to 12")
        expect(difference({ ...saved, baker: BAKER_VERSION - 1 }, recordOf(scene(yard)))).toBe("the baker has changed since it was saved")
        // An actor's change is named before the sun's.
        expect(difference(saved, recordOf(scene([...yard, actor("crate.glb", 2)], { sun: null })))).toBe("crate.glb at [2, 0, 0] is not in it")
    })

    it("fingerprints every input, so a file that differs only in the sun, the ambient or an option does not match", () => {
        const saved = recordOf(scene(yard))
        for (const over of [
            { sun: { direction: [0, -1, 0] as [number, number, number], color: [1, 1, 1] as [number, number, number], intensity: 1 } },
            { sun: null }, { ambient: { sky: [1, 1, 1] as [number, number, number], ground: [0, 0, 0] as [number, number, number] } },
        ]) expect(matches(saved, recordOf(scene(yard, over)))).toBe(false)
        for (const options of [{ bounces: 0 }, { samples: 255 }, { occlusion: 0.01 }, { detail: 23.9 }]) {
            expect(matches(saved, recordOf(scene(yard, {}, options))), JSON.stringify(options)).toBe(false)
        }
        // The record keeps them where the console and a reader of the file find them.
        expect(recordOf(scene(yard, {}, { bounces: 3, occlusion: 0.5 }))).toMatchObject({ v: 2, bounces: 3, samples: 256, occlusion: 0.5, detail: 24 })
    })

    it("never calls two different scenes the same", () => {
        const seen = new Set<string>()
        for (let i = 0; i < 2000; i++) seen.add(recordOf(scene([actor("crate.glb", i / 10)])).fingerprint)
        expect(seen.size).toBe(2000)
    })

    it("says the console line for a missing file, an unreadable one and a stale one", () => {
        expect(bakedHereLine("yard.light.png", { why: "missing" })).toBe("[oj] yard.light.png is not in the cart yet: baked here.")
        expect(bakedHereLine("yard.light.png", { why: "unreadable", detail: "it holds no light record" })).toBe("[oj] yard.light.png is not a light file oj can read (it holds no light record): baked here instead.")
        expect(bakedHereLine("yard.light.png", { why: "stale", detail: "models/yard.glb changed" })).toBe("[oj] yard.light.png was baked for a different scene (models/yard.glb changed): baked here instead.")
        expect(bakedHereLine("yard.light.png", { why: "unreadable", detail: OLDER })).toBe("[oj] yard.light.png was saved by an older oj: baked here instead.")
    })

    it("says on the same line when the detail asked did not fit the pages", () => {
        const lowered = { asked: 24, baked: 3.1, pages: 4 }
        expect(bakedHereLine("yard.light.png", { why: "missing" }, lowered)).toBe("[oj] yard.light.png is not in the cart yet: baked here, at 3.1 texels a metre, as 24 does not fit 4 pages.")
        expect(bakedHereLine("yard.light.png", { why: "again" }, lowered)).toBe("[oj] yard.light.png baked again here, at 3.1 texels a metre, as 24 does not fit 4 pages.")
    })
})

describe("a saved light", () => {
    const layout = layoutOf(64, 32, 24, [-1, -1, -1, 1, 9, 6, 9], [[0, 0, 10, 10], [12, 0, 10, 10]])
    const saved: SavedLight = { ...recordOf(scene(yard)), layout }

    it("reads back from its text as it was written", () => {
        expect(parseSaved(JSON.stringify(saved))).toEqual(saved)
    })

    it("says why a text is not a record this baker wrote", () => {
        expect(parseSaved(null)).toBe("it holds no light record")
        expect(parseSaved("{")).toBe("its light record is not JSON")
        expect(parseSaved(JSON.stringify({ ...saved, v: 3 }))).toMatch(/version/)
        // Before the options: out of date, not unreadable.
        expect(parseSaved(JSON.stringify({ v: 1, baker: 1, fingerprint: "0", actors: [], sun: null, ambient: [0, 0, 0, 0, 0, 0], detail: 24, quality: 256, layout }))).toBe(OLDER)
        for (const k of ["bounces", "samples", "occlusion", "detail"]) {
            const { [k as keyof SavedLight]: _, ...without } = saved
            expect(parseSaved(JSON.stringify(without)), k).toBe("its light record is missing a field")
        }
        const { layout: _, ...bare } = saved
        expect(parseSaved(JSON.stringify(bare))).toBe("its light record is missing a field")
        expect(parseSaved(JSON.stringify({ ...saved, layout: { ...layout, grid: [0, 0, 0, 1] } }))).toBe("its light record is missing a field")
        expect(parseSaved(JSON.stringify({ ...saved, actors: [["wall.glb", "sha", 0, 0, 0, 0, 0, "0", 1]] }))).toBe("its light record is missing a field")
    })

    it("lays out the same only with the same atlas, grid and every rectangle in its place", () => {
        expect(sameLayout(layout, layoutOf(64, 32, 24, [-1, -1, -1, 1, 9, 6, 9], [[0, 0, 10, 10], [12, 0, 10, 10]]))).toBe(true)
        expect(sameLayout(layout, layoutOf(64, 32, 24, [-1, -1, -1, 1, 9, 6, 9], [[12, 0, 10, 10], [0, 0, 10, 10]]))).toBe(false)
        expect(sameLayout(layout, layoutOf(128, 32, 24, [-1, -1, -1, 1, 9, 6, 9], [[0, 0, 10, 10], [12, 0, 10, 10]]))).toBe(false)
        expect(sameLayout(layout, layoutOf(64, 32, 24, [-1, -1, -1, 1.5, 9, 6, 9], [[0, 0, 10, 10], [12, 0, 10, 10]]))).toBe(false)
    })

    it("keeps a one-page layout as it was before pages, and tells pages apart", () => {
        const grid = [-1, -1, -1, 1, 9, 6, 9]
        const rects = [[0, 0, 10, 10], [12, 0, 10, 10]]
        // Hashed exactly as before pages (its rectangles' hash then), so a one-page layout never changes with them.
        expect(layout.rects).toBe("542147686b8753de")
        expect(layoutOf(64, 32, 24, grid, rects, 1)).toEqual(layout)
        expect(layout).not.toHaveProperty("pages")
        // The rectangles are the sheet's, so the same ones on 2 pages are hashed alike, and the pages tell the layouts apart.
        const paged = layoutOf(64, 32, 24, grid, rects, 2)
        expect(paged.pages).toBe(2)
        expect(paged.rects).toBe(layout.rects)
        expect(sameLayout(layout, paged)).toBe(false)
        expect(sameLayout(paged, layoutOf(64, 32, 24, grid, rects, 4))).toBe(false)
        expect(parseSaved(JSON.stringify({ ...saved, layout: paged }))).toEqual({ ...saved, layout: paged })
        expect(parseSaved(JSON.stringify({ ...saved, layout: { ...layout, pages: 3 } }))).toBe("its light record is missing a field")
        expect(parseSaved(JSON.stringify({ ...saved, layout: { ...layout, pages: 1 } }))).toBe("its light record is missing a field")
    })
})
