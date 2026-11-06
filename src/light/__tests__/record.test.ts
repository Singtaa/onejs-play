import { BAKER_VERSION, bakedHereLine, difference, matches, recordOf, type LightInputs, type StaticActor } from "../record"

const actor = (model: string, x: number, over: Partial<StaticActor> = {}): StaticActor => ({
    model, sha: `sha-${model}`, position: [x, 0, 0], rotation: { yaw: 0, pitch: 0, roll: 0 }, scale: 1, ...over,
})
const scene = (actors: StaticActor[], over: Partial<LightInputs> = {}): LightInputs => ({
    actors, sun: { direction: [0.3, -0.8, 0.5], color: [1, 0.95, 0.9], intensity: 1 },
    ambient: { sky: [0.6, 0.7, 0.9], ground: [0.3, 0.25, 0.2] }, detail: 24, quality: 256, ...over,
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
        expect(difference(saved, recordOf(scene(yard, { detail: 12 })))).toBe("its detail or quality changed")
        expect(difference({ ...saved, baker: BAKER_VERSION - 1 }, recordOf(scene(yard)))).toBe("the baker has changed since it was saved")
        // An actor's change is named before the sun's.
        expect(difference(saved, recordOf(scene([...yard, actor("crate.glb", 2)], { sun: null })))).toBe("crate.glb at [2, 0, 0] is not in it")
    })

    it("fingerprints every input, so a file that differs only in the sun, the ambient or an option does not match", () => {
        const saved = recordOf(scene(yard))
        for (const over of [
            { sun: { direction: [0, -1, 0] as [number, number, number], color: [1, 1, 1] as [number, number, number], intensity: 1 } },
            { sun: null }, { ambient: { sky: [1, 1, 1] as [number, number, number], ground: [0, 0, 0] as [number, number, number] } },
            { detail: 12 }, { quality: 64 },
        ]) expect(matches(saved, recordOf(scene(yard, over)))).toBe(false)
    })

    it("never calls two different scenes the same", () => {
        const seen = new Set<string>()
        for (let i = 0; i < 2000; i++) seen.add(recordOf(scene([actor("crate.glb", i / 10)])).fingerprint)
        expect(seen.size).toBe(2000)
    })

    it("says the console line for a missing file and for a stale one", () => {
        expect(bakedHereLine("yard.light.png", null)).toBe("[oj] yard.light.png is not in the cart yet: baked here.")
        expect(bakedHereLine("yard.light.png", "models/yard.glb changed")).toBe("[oj] yard.light.png was baked for a different scene (models/yard.glb changed): baked here instead.")
    })
})
