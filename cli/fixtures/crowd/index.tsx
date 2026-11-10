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
}

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
    const state = useRef({ actors: [] as Actor[], setup: null as Setup | null, t: 0, frames: [] as number[], main: [] as number[], last: 0 })

    useEffect(() => {
        if (!scene || !person) return
        const s = state.current
        const recorders: Record<string, any> = {}
        const api = {
            set(setup: Setup) {
                for (const a of s.actors) a.destroy()
                s.actors = []
                s.setup = setup
                scene.sun({ shadows: setup.shadows })
                for (let i = 0; i < setup.count; i++) {
                    const actor = scene.spawn(person, { position: home(i, setup), yaw: 180 })
                    if (setup.clips !== "none") actor.play("Walk")
                    if (setup.clips === "hold") actor.speed = 0
                    s.actors.push(actor)
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
            clips: person.clips,
        }
        api.record("Internal", MAIN)
        ;(globalThis as any).crowd = api
        return () => { for (const a of s.actors) a.destroy() }
    }, [scene, person])

    useFrame((dt) => {
        const s = state.current
        const now = performance.now()
        if (s.last > 0) s.frames.push(now - s.last)
        s.last = now
        const main = (globalThis as any).crowd?.read(MAIN) ?? -1
        if (main >= 0) s.main.push(main / 1e6)
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
