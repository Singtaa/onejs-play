import { useEffect, useRef } from "react"
import { mount, useScene, useModel, useFrame, loadModel, loadTexture, tex, type Actor, type Model, type Texture, type Vec3 } from "oj"
import { PIECES } from "./pieces"

// Worn gear on a body (scripts/make-gear.mjs writes the files): body.glb, one skinned mesh of
// 1,600 triangles with its own 256 px picture; six small pieces, each its own model; the same
// body with the six as parts of its file; and paint.png, a layer to paint over its picture.
//
// globalThis.gear.checks() reads back what tex makes of a loaded picture and of the body's own,
// alone and composed, for gear.playtest.mjs to hold against the files' bytes. set() dresses a
// crowd one of five ways, and frames() and read() give back what a frame cost, for a measure.
declare const CS: any

const MAIN = "CPU Main Thread Frame Time"

type Mode =
    /** As the file has them. */
    | "plain"
    /** Each wearing a picture of its own: the body's, with the paint layer in a hue of its own over it. */
    | "pictures"
    /** Each with the six pieces, each its own model, hung on joints. */
    | "pieces"
    /** Both. */
    | "both"
    /** The body with the six pieces as parts of its file, all shown. */
    | "parts"
    /** The same file with the six parts hidden. */
    | "hidden"

interface Setup {
    count: number
    mode: Mode
    /** "play" loops Walk; "hold" plays it at speed 0. */
    clips: "play" | "hold"
}

/** The texels at `samples`, each [x, y], of a picture's stored bytes. */
function texels(bytes: Uint8Array, width: number, samples: [number, number][]): number[][] {
    return samples.map(([x, y]) => Array.from(bytes.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)))
}

const GAP = 1.0
const EYE: Vec3 = [0, 4.5, -5]

/** A block of `count` before the camera, eight across. */
function home(i: number): Vec3 {
    const wide = 8
    return [(i % wide - (wide - 1) / 2) * GAP, 0, 1.5 + Math.floor(i / wide) * GAP * 1.2]
}

function Gear() {
    const scene = useScene({ camera: { position: EYE, lookAt: [0, 0.6, 4], fov: 60 } })
    const body = useModel("body.glb")
    const dressed = useModel("body.dressed.glb")
    const state = useRef({ actors: [] as Actor[], frames: [] as number[], main: [] as number[], last: 0 })

    useEffect(() => {
        if (!scene || !body || !dressed) return
        const s = state.current
        const recorders: Record<string, any> = {}
        let pieces: Model[] | null = null
        let paint: Texture | null = null
        // The looks, made once and kept across sets: the same body and layer each time.
        const looks: Texture[] = []
        const look = async (k: number) => {
            paint ??= await loadTexture("paint.png")
            while (looks.length <= k) {
                const layer = tex.image(paint).hslAdjust((looks.length * 9) % 360 - 180)
                const picture = tex.composite(tex.image(body.texture!), layer)
                looks.push(await picture.ready({ cache: false }))
            }
            return looks[k]!
        }
        const api = {
            async set(setup: Setup) {
                for (const a of s.actors) a.destroy()
                s.actors = []
                pieces ??= await Promise.all(PIECES.map((p) => loadModel(`${p.name}.glb`)))
                const wear = setup.mode === "pictures" || setup.mode === "both"
                const hang = setup.mode === "pieces" || setup.mode === "both"
                const pictures = wear ? await Promise.all(Array.from({ length: setup.count }, (_, i) => look(i))) : []
                for (let i = 0; i < setup.count; i++) {
                    const parted = setup.mode === "parts" || setup.mode === "hidden"
                    const actor = scene.spawn(parted ? dressed : body, {
                        position: home(i), yaw: 180,
                        texture: wear ? pictures[i] : undefined,
                        hide: setup.mode === "hidden" ? PIECES.map((p) => p.name) : undefined,
                    })
                    actor.play("Walk")
                    if (setup.clips === "hold") actor.speed = 0
                    s.actors.push(actor)
                    if (hang) {
                        PIECES.forEach((p, k) => {
                            const piece = scene.spawn(pieces![k]!)
                            piece.attachTo(actor, p.joint, { position: p.at })
                            s.actors.push(piece)
                        })
                    }
                }
                s.frames = []
                s.main = []
                return s.actors.length
            },
            /** The frames since the last call: their count, mean and median in ms, and the main thread's mean. -1 where nothing was read. */
            frames() {
                const f = s.frames.slice().sort((a, b) => a - b)
                const main = s.main
                s.frames = []
                s.main = []
                const mean = (a: number[]) => a.length === 0 ? -1 : a.reduce((x, y) => x + y, 0) / a.length
                return { count: f.length, mean: mean(f), median: f.length === 0 ? -1 : f[f.length >> 1], main: mean(main), mainCount: main.length }
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
             * What tex makes of the body's own picture, of paint.png, and of the paint composed over
             * the body, as stored bytes at `samples` (gear.playtest.mjs's); whether one texture handed in twice is one
             * picture; and the model lists the gear is hung by.
             */
            async checks(samples: [number, number][]) {
                const own = body.texture
                if (own === null) return { own: null }
                paint ??= await loadTexture("paint.png")
                const base = tex.image(own)
                const layer = tex.image(paint)
                const composed = tex.composite(base, layer)
                return {
                    own: { width: (own as any).width, height: (own as any).height },
                    body: texels(await base.pixels(), base.width, samples),
                    paint: texels(await layer.pixels(), layer.width, samples),
                    composed: texels(await composed.pixels(), composed.width, samples),
                    samePicture: tex.composite(tex.image(own), tex.image(paint)).texture({ cache: false }) === composed.texture({ cache: false }),
                    joints: body.joints,
                    parts: dressed.parts,
                    dressedTexture: dressed.texture !== null,
                }
            },
        }
        api.record("Internal", MAIN)
        ;(globalThis as any).gear = api
        return () => {
            for (const a of s.actors) a.destroy()
        }
    }, [scene, body, dressed])

    useFrame(() => {
        const s = state.current
        const now = performance.now()
        if (s.last > 0) s.frames.push(now - s.last)
        s.last = now
        const main = (globalThis as any).gear?.read(MAIN) ?? -1
        if (main >= 0) s.main.push(main / 1e6)
    })
    return null
}

mount(<Gear />)
