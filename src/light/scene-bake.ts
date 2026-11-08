/**
 * `scene.bake` and `scene.clearLight` for one scene (docs/lightmapping.md §6):
 * the light folder's one entry. models.ts hands it the scene's few reads (what
 * is static, the sun and the ambient, how a model is named, a frame clock) and
 * the bridge, and gets back the two calls a cart makes.
 *
 * A bake reads what is static, records it when it is named, reads the named
 * file, lays the light out (bake.ts), and then either shows the file or starts
 * the bridge's bake and steps it each frame within the tile budget
 * (budget.ts), telling the host (host.ts) as it begins, moves and ends.
 */

import type { Bake, BakeOptions, BakeResult, Model } from "../models"
import { assetShipped, loadAssetBytes } from "../asset"
import { AUTO_DETAIL, DETAIL_FLOOR, MAX_PAGES } from "./atlas"
import { bakeOptions, beginBake, ChartCache, FILE_READ_FRAMES, lightFile, loadLight, planLight, readSaved, recordItems, whyBakeHere, type BakeItem, type SavedFile } from "./bake"
import { tileBudget } from "./budget"
import { lightBakedHere, lightBegun, lightEnded, lightProgress, offerAgain, PROGRESS_EVERY_MS, type BakeEnd } from "./host"
import { bakedHereLine, loweredWords, type BakedHere, type BakeOptionValues, type LightInputs, type LightRecord, type Lowered } from "./record"

/** What a scene gives its baker. */
export interface SceneReads {
    /** OneJS's ModelBridge. */
    bridge: any
    /** The static actors and scattered copies now. */
    items(): BakeItem[]
    /** A model's name in the cart and its bytes' hash, for the record. */
    identify(model: Model): Promise<{ name: string, sha: string }>
    /** The sun and the ambient now, as the record keeps them. */
    lights(): Omit<LightInputs, "actors" | "options">
    /** Calls back every frame with its real interval in ms (null for the first) until the function returned is called. */
    everyFrame(callback: (intervalMs: number | null) => void): () => void
    /** Whether the scene has gone. */
    disposed(): boolean
}

export interface SceneBaker {
    /** `scene.bake`, its arguments as a cart gives them. */
    bake(first?: string | BakeOptions, options?: BakeOptions): Bake
    /** `scene.clearLight`. */
    clearLight(): void
    /** A mesh model given new triangles: its charts were of the old ones. */
    forget(model: Model): void
    /** The scene went: stops a bake under way and withdraws its offers. */
    dispose(): void
}

/** The value BakeResult gives each end the host hears. */
const RESULT: Record<BakeEnd["how"], BakeResult> = { loaded: "loaded", baked: "baked", failed: "failed", stopped: "stopped" }

/** StepBake's answer when the bake failed on the bridge (BakeProblem says why); any other below 0 is a bake a later one or ClearLight took. */
const STEP_FAILED = -2

/** Said once: a host without BeginBake. */
let saidNoBake = false

/**
 * Why `name` cannot be a light file's name, or null when it can: a path from
 * the cart's root, as it is written, ending in `.light.png`. Checked at the
 * call, since every later check (the runtime's, the editor's, the server's,
 * `ojplay bake`'s) runs after the bake, and a name such as a texture's would
 * pass them and be overwritten on Save.
 */
export function lightNameProblem(name: string): string | null {
    if (!name.endsWith(".light.png") || name === ".light.png") return "a light file's name ends in .light.png, like \"room.light.png\""
    if (name.startsWith("./") || name.startsWith("assets/")) return `name it from the cart's root as it is, "${name.replace(/^\.\//, "").replace(/^assets\//, "")}"`
    if (name.startsWith("/") || name.includes("\\") || name.includes(":")) return "a light file's name is a path in the cart, like \"levels/room.light.png\""
    if (name.split("/").some((part) => part === "" || part === "." || part === "..")) return "a light file's name is a path in the cart with no empty, . or .. part"
    return null
}

export function sceneBaker(scene: SceneReads): SceneBaker {
    const b = scene.bridge
    const charts = new ChartCache()
    let baking: { stop: (end?: BakeEnd) => void } | null = null
    // Each name this scene baked, offered to the host's bakeAgain until the scene goes.
    const offered = new Map<string, () => void>()

    // A named light file's bytes, or null when the cart does not have it.
    const readNamed = async (name: string): Promise<SavedFile> => {
        if (assetShipped(name) === false) return readSaved(null)
        return readSaved(await loadAssetBytes(name).catch(() => null))
    }

    // `again`: the host's Bake again, which bakes past a saved file, current or not.
    const bake = (name: string | undefined, given: BakeOptionValues, again = false): Bake => {
        baking?.stop()
        if (name !== undefined) offered.set(name, offerAgain(name, () => { if (!scene.disposed()) bake(name, given, true) }))
        let progress = 0
        let finish!: (result: BakeResult) => void
        const done = new Promise<BakeResult>((resolve) => { finish = resolve })
        const handle: Bake = Object.freeze({ get progress() { return progress }, done })
        if (name !== undefined) lightBegun(name)
        if (typeof b.BeginBake !== "function") {
            if (!saidNoBake) console.warn("[oj] scene.bake needs a newer OneJS: this host's ModelBridge cannot bake light, so the scene keeps its ambient light.")
            saidNoBake = true
            progress = 1
            if (name !== undefined) lightEnded(name, { how: "failed", why: "this host's ModelBridge cannot bake light" })
            finish("failed")
            return handle
        }
        let stopped = false
        let stopFrame: (() => void) | null = null
        const me = {
            // With no end, it was stopped from outside: a later bake, clearLight, or the scene going.
            stop(end: BakeEnd = { how: "stopped" }) {
                if (stopped) return
                stopped = true
                stopFrame?.()
                if (baking === me) baking = null
                if (name !== undefined) lightEnded(name, end)
                finish(RESULT[end.how])
            },
        }
        baking = me
        const live = () => !stopped && !scene.disposed()
        const give = (why: string) => {
            // As the line says: a bake this one replaced, still on the bridge with its draft showing, or a
            // model already given its new unwrap against the old light's rectangles, would say otherwise.
            if (typeof b.ClearLight === "function") b.ClearLight()
            console.warn(`[oj] scene.bake: ${why}. The scene keeps its ambient light.`)
            progress = 1
            me.stop({ how: "failed", why })
        }
        const run = async () => {
            let items = scene.items()
            let record: LightRecord | null = null
            let file: SavedFile = readSaved(null)
            if (name !== undefined && items.length > 0) {
                const [recorded, found] = await Promise.all([
                    recordItems(items, scene.identify, { ...scene.lights(), options: given }),
                    again ? readSaved(null) : readNamed(name),
                ])
                if (!live()) return
                record = recorded.record
                items = recorded.items
                file = found
            }
            const plan = await planLight(b, items, charts, live, given.detail)
            if (plan === null || !live()) return
            if (typeof plan === "string") return give(plan)
            // A detail chosen from the scene's size is lowered only past its floor, which is then what was asked.
            const asked = given.detail === AUTO_DETAIL ? DETAIL_FLOOR : given.detail
            const lowered: Lowered | undefined = plan.detail < asked ? { asked, baked: plan.detail, pages: MAX_PAGES } : undefined
            let here: BakedHere | null = null
            if (name !== undefined) {
                here = again ? { why: "again" } : whyBakeHere(file, record!, plan)
                if (here === null && file.found === "saved") {
                    const why = loadLight(b, plan, file.png)
                    if (why === "") {
                        progress = 1
                        return me.stop({ how: "loaded" })
                    }
                    here = { why: "unreadable", detail: why }
                }
            }
            const why = beginBake(b, plan, given)
            if (why !== "") return give(why)
            // A named bake says it on its own line, once the light is ready to save.
            if (name === undefined && lowered !== undefined) console.log(`[oj] scene.bake: baked ${loweredWords(lowered)}.`)
            let fileFrames = 0
            const budget = tileBudget()
            let phase = 0
            let page = 0
            // Time since the host last heard this bake's progress.
            let sinceTold = 0
            stopFrame = scene.everyFrame((intervalMs) => {
                // Probes and the lightmap's tiles cost the GPU differently, and the frame between, the one the probes
                // land in, or one finishing a page, is neither's. Asked before the interval is read, as a phase or a
                // page can change inside a step.
                const now = Number(b.BakePhase()), onPage = Number(b.BakePage())
                const turned = onPage !== page
                if (now !== phase || turned) budget.newPhase()
                phase = now
                page = onPage
                const p = Number(b.StepBake(budget.frame(intervalMs)))
                if (p === STEP_FAILED) return give(typeof b.BakeProblem === "function" ? String(b.BakeProblem()) : "the bake stopped on the GPU")
                // Below 0 otherwise: the bridge's bake went, cleared by a later one or by the scene.
                if (p < 0) return me.stop()
                progress = p
                if (p < 1) {
                    sinceTold += intervalMs ?? 0
                    if (name !== undefined && (turned || sinceTold >= PROGRESS_EVERY_MS)) {
                        sinceTold = 0
                        lightProgress(name, p)
                    }
                    return
                }
                if (here === null) return me.stop({ how: "baked" })
                const bytes = lightFile(b, { ...record!, layout: plan.layout })
                // The lightmap's read can land a few frames after the bake finishes.
                if (bytes === null && ++fileFrames < FILE_READ_FRAMES) return
                if (bytes === null) {
                    // Lit, so not give's line: the light is showing, only the file is missing.
                    const why = "its light is showing, but could not be read back as a file to save"
                    console.warn(`[oj] scene.bake: ${name} ${why}.`)
                    return me.stop({ how: "failed", why })
                }
                lightBakedHere({ name: name!, line: bakedHereLine(name!, here, lowered), bytes })
                me.stop({ how: "baked" })
            })
        }
        run().catch((e: unknown) => {
            if (live()) give(e instanceof Error ? e.message.replace(/^\[oj\] (scene\.bake: )?/, "") : String(e))
        })
        return handle
    }

    return {
        // Not the host's `again`: a cart that wants a fresh bake every time names no file.
        bake(first, options) {
            const unnamed = () => new Error("[oj] scene.bake: name the light file from the cart's root, like \"room.light.png\", or give no name to bake on the device every time")
            // typeof "object" first: a "string" test keeps an options object, whose fields are all optional.
            if (typeof first === "object") {
                if (first === null) throw unnamed()
                if (options !== undefined) throw new Error("[oj] scene.bake: its options come once, after the name when there is one")
                return bake(undefined, bakeOptions(first))
            }
            if (first !== undefined && (typeof first !== "string" || first === "")) throw unnamed()
            if (first !== undefined) {
                const problem = lightNameProblem(first)
                if (problem !== null) throw new Error(`[oj] scene.bake("${first}"): ${problem}`)
            }
            return bake(first, bakeOptions(options))
        },
        clearLight() {
            baking?.stop()
            if (typeof b.ClearLight === "function") b.ClearLight()
        },
        forget(model) {
            charts.forget(model)
        },
        dispose() {
            baking?.stop()
            for (const withdraw of offered.values()) withdraw()
            offered.clear()
            charts.dispose()
        },
    }
}
