import { useEffect, useRef } from "react"
import { mount, useScene, useModel, useFrame, type Actor, type Vec3 } from "oj"

// A crowd of skinned people (person.glb: 1,600 triangles, 20 joints, ten clips), set from a
// playtest through globalThis.crowd, which also reads the frame time back. `seen` of the `count`
// stand in a block the camera looks at and the rest stand behind the camera, so a crowd nobody
// sees can be timed against one everybody does. crowd.playtest.mjs holds an unseen crowd's cost
// to a fraction of what it is with each mesh made to update off screen again, which is what
// every skinned actor did before runtime 1.9.
declare const CS: any
declare const $typeof: (type: unknown) => unknown

const MAIN = "CPU Main Thread Frame Time"

interface Setup {
    count: number
    /** How many stand before the camera; the rest stand behind it. */
    seen: number
    /** "play" loops Walk, "hold" plays it at speed 0, "none" never plays a clip. */
    clips: "play" | "hold" | "none"
    /** Whether the cart walks each one 3 m to and fro from its script. */
    move: boolean
    shadows: boolean
    /**
     * "tint" gives each a tint of its own, "paint" four colours of its own through the mask
     * (trunk, legs, arms, head). Left out, each is as the file has it.
     */
    colors?: "tint" | "paint"
    /**
     * Each is person.parts.glb, the same body as four skinned meshes playing person.glb's clips,
     * with this many of the four hidden (0 to 3).
     */
    parts?: number
    /** Each one before the camera carries a quarter-size person on its head. */
    hats?: boolean
    /** Each wears one of this many pictures of its own (`texture`), in turn. Left out, its model's. */
    pictures?: number
}

// Sixteen colours, taken four apart for a person's four, so neighbours differ in every part.
const PALETTE = ["#7a4b2a", "#2f4f6f", "#3b2a1a", "#e0b090", "#a03020", "#40603a", "#c8a040", "#8a5a44",
    "#584a78", "#b06a50", "#2a5a5a", "#d0c0a0", "#703040", "#506080", "#906020", "#c09078"]
const shade = (i: number, k: number) => PALETTE[(i * 5 + k * 4) % PALETTE.length]

const GAP = 1.2
const EYE: Vec3 = [0, 14, -6]

function home(i: number, setup: Setup): Vec3 {
    const before = i < setup.seen
    const n = before ? setup.seen : setup.count - setup.seen
    const k = before ? i : i - setup.seen
    const wide = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)))
    const x = (k % wide - (wide - 1) / 2) * GAP
    const row = Math.floor(k / wide)
    // Before the camera the block starts 6 m ahead of it; behind, 12 m back.
    return before ? [x, 0, 4 + row * GAP] : [x, 0, -18 - row * GAP]
}

function Crowd() {
    const scene = useScene({ camera: { position: EYE, lookAt: [0, 0, 10], fov: 60 } })
    const person = useModel("person.glb")
    const painted = useModel("person.glb", { colorMask: "person.mask.png" })
    const parted = useModel("person.parts.glb", { clips: person })
    const state = useRef({ actors: [] as Actor[], setup: null as Setup | null, t: 0, frames: [] as number[], main: [] as number[], last: 0, readBack: null as null | "asked" | object })

    useEffect(() => {
        if (!scene || !person || !painted || !parted) return
        const s = state.current
        const recorders: Record<string, any> = {}
        // Pictures made in Unity, one solid colour each from the palette, kept across sets.
        const looks: any[] = []
        const look = (k: number) => {
            while (looks.length <= k) {
                const t = new CS.UnityEngine.Texture2D(4, 4)
                const hex = PALETTE[looks.length % PALETTE.length]
                const [r, g, bl] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
                const colour = new CS.UnityEngine.Color(r, g, bl, 1)
                for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) t.SetPixel(x, y, colour)
                t.Apply()
                looks.push(t)
            }
            return looks[k]
        }
        const api = {
            set(setup: Setup) {
                for (const a of s.actors) a.destroy()
                s.actors = []
                s.setup = setup
                scene.sun({ shadows: setup.shadows })
                for (let i = 0; i < setup.count; i++) {
                    const actor = setup.parts !== undefined
                        ? scene.spawn(parted, { position: home(i, setup), yaw: 180, hide: parted.parts.slice(1, 1 + setup.parts) })
                        : setup.colors === "paint"
                        ? scene.spawn(painted, { position: home(i, setup), yaw: 180, colors: [0, 1, 2, 3].map((k) => shade(i, k)) })
                        : scene.spawn(person, { position: home(i, setup), yaw: 180, tint: setup.colors === "tint" ? shade(i, 0) : undefined, texture: setup.pictures ? look(i % setup.pictures) : undefined })
                    if (setup.clips !== "none") actor.play("Walk")
                    if (setup.clips === "hold") actor.speed = 0
                    s.actors.push(actor)
                    if (setup.hats && i < setup.seen) scene.spawn(person, { scale: 0.25 }).attachTo(actor, "head", { position: [0, 0.25, 0] })
                }
                s.frames = []
                s.main = []
                return s.actors.length
            },
            /**
             * The frames since the last call: how many, the mean and the median of the time from
             * one to the next in ms, and `main`, the mean of what Unity's main thread spent in a
             * frame, which a screen's refresh does not round up. -1 where nothing was read.
             */
            frames() {
                const f = s.frames.slice().sort((a, b) => a - b)
                const main = s.main
                s.frames = []
                s.main = []
                const mean = (a: number[]) => a.length === 0 ? -1 : a.reduce((x, y) => x + y, 0) / a.length
                return { count: f.length, mean: mean(f), median: f.length === 0 ? -1 : f[f.length >> 1], main: mean(main), mainCount: main.length }
            },
            /**
             * Makes every skinned mesh in the world update while off screen, as each did before
             * runtime 1.9, and says how many it changed. The next `set` makes new ones.
             */
            updateOffscreen() {
                // The active ones: a model's template is inactive, and stays as it was loaded.
                const all = CS.UnityEngine.Object.FindObjectsByType($typeof(CS.UnityEngine.SkinnedMeshRenderer), CS.UnityEngine.FindObjectsSortMode.None)
                for (let i = 0; i < all.Length; i++) all[i].updateWhenOffscreen = true
                return all.Length
            },
            /** Starts one of Unity's counters by its category and name; `read` gives its last value, -1 when it has none. */
            record(category: string, name: string) {
                const P = CS.Unity.Profiling
                recorders[name] = P.ProfilerRecorder.StartNew(P.ProfilerCategory[category], name, 1, P.ProfilerRecorderOptions.Default)
                return recorders[name].Valid === true
            },
            read(name: string) {
                const r = recorders[name]
                return r && r.Valid === true ? Number(r.LastValue) : -1
            },
            /**
             * Asks the next frame to move the first person 3 m aside and, in that same frame, read
             * where Unity says it is: its screen point before and after, and what is picked at
             * each. `readBack` is null until that frame has run.
             */
            askReadBack() { s.readBack = "asked" },
            get readBack() { return typeof s.readBack === "object" ? s.readBack : null },
            /**
             * What only a real container can say of a part, a joint and another model's clips: a
             * four-part person 6 m ahead playing a clip that is person.glb's, a small one put on
             * its head and taken off again, and a part hidden. Says where the small one was while
             * on the head, where in the world it was left, and what the two models list.
             */
            seams() {
                // At rest first, where the head's place is known; then in Walk's first pose, where
                // a hat on the bare joint marks the head and one 0.25 m over it has to stay that far.
                const body = scene.spawn(parted, { position: [0, 0, 6] })
                const hat = scene.spawn(person, { scale: 0.25 })
                hat.attachTo(body, "head", { position: [0, 0.25, 0] })
                const on = hat.position
                hat.detach()
                const off = hat.position
                body.play("Walk")
                const head = scene.spawn(person, { scale: 0.25 })
                const over = scene.spawn(person, { scale: 0.25 })
                head.attachTo(body, "head")
                over.attachTo(body, "head", { position: [0, 0.25, 0] })
                head.detach()
                over.detach()
                const walking = { head: head.position, off: over.position }
                body.hide("legs")
                const out = { parts: parted.parts, joints: parted.joints.length, clips: parted.clips.length, own: person.parts, on, off, scale: hat.scale, walking }
                for (const a of [hat, head, over, body]) a.destroy()
                return out
            },
            clips: person.clips,
        }
        api.record("Internal", MAIN)
        ;(globalThis as any).crowd = api
        return () => {
            for (const a of s.actors) a.destroy()
            for (const t of looks) CS.UnityEngine.Object.Destroy(t)
        }
    }, [scene, person, painted, parted])

    useFrame((dt) => {
        const s = state.current
        const now = performance.now()
        if (s.last > 0) s.frames.push(now - s.last)
        s.last = now
        const main = (globalThis as any).crowd?.read(MAIN) ?? -1
        if (main >= 0) s.main.push(main / 1e6)
        if (s.readBack === "asked" && s.actors.length > 0) {
            const who = s.actors[0]
            const lift = person.height / 2
            const before = who.screenPoint(lift)
            const [x, y, z] = who.position
            who.position = [x + 3, y, z]
            const after = who.screenPoint(lift)
            s.readBack = {
                before, after,
                pickedAfter: after !== null && scene?.pick(after.x, after.y) === who,
                pickedBefore: before !== null && scene?.pick(before.x, before.y) === who,
            }
        }
        if (!s.setup || !s.setup.move) return
        s.t += dt
        for (let i = 0; i < s.actors.length; i++) {
            const at = home(i, s.setup)
            s.actors[i].position = [at[0] + Math.sin(s.t * 0.8 + i) * 1.5, 0, at[2]]
        }
    })
    return null
}

mount(<Crowd />)
