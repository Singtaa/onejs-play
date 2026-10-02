/**
 * 3D models from a game's own .glb files, with no C# in the game.
 *
 *     const scene = useScene({ camera: { position: [0, 9, -11], lookAt: [0, 0, 0] } })
 *     const ghost = useModel("ghost.glb")
 *     useEffect(() => {
 *         if (!scene || !ghost) return
 *         const g = scene.spawn(ghost, { position: [0, 0, 0], play: "ghost_idle" })
 *     }, [scene, ghost])
 *
 * Files resolve through assetUrl, so the name means the same thing on the site and
 * after `ojplay add`. Everything is a handle into OneJS.Models.ModelBridge, which
 * glTFast backs; a host without glTFast gets an error naming the package instead
 * of a missing-type crash. Actors die with the scene that spawned them.
 */

import { useEffect, useState, useSyncExternalStore } from "react"
import { assetUrl } from "./asset"
import { getCurrentRuntime } from "./runtime"

// Type-level redeclaration only, so dynamic host globals typecheck.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

export type Vec3 = [number, number, number]

/** A loaded .glb, ready to spawn. */
export interface Model {
    readonly id: number
    /** Animation clip names, as the file names them. */
    readonly clips: readonly string[]
    /** Height in the model's own units, before any spawn scale. */
    readonly height: number
}

export interface SpawnOptions {
    position?: Vec3
    /** Degrees around the vertical axis. */
    yaw?: number
    scale?: number
    /** A clip to start looping straight away. */
    play?: string
}

/** One copy of a model in the world. */
export interface Actor {
    readonly id: number
    readonly model: Model
    position: Vec3
    yaw: number
    /** Plays a clip, crossfading over `fade` seconds (0.15 by default). Loops unless told not to. */
    play(clip: string, options?: { loop?: boolean, fade?: number }): void
    /** Dissolves to `amount` (1 is gone) over `seconds`, resolving when it gets there. */
    dissolve(amount: number, seconds?: number): Promise<void>
    /**
     * Where a point `lift` units above the actor is on screen, in the root's
     * coordinates: put a label there with position absolute. Null when it is
     * behind the camera.
     */
    screenPoint(lift?: number): { x: number, y: number } | null
    destroy(): void
}

export interface SceneOptions {
    camera?: { position: Vec3, lookAt?: Vec3, fov?: number }
    /** The direction the light shines along, its intensity, and a flat ambient level. */
    light?: { direction?: Vec3, intensity?: number, ambient?: number }
    /** The colour behind the world, as three 0 to 1 channels. */
    background?: Vec3
}

export interface Scene {
    spawn(model: Model, options?: SpawnOptions): Actor
    /** The actor under a point in the root's coordinates (a pointer event's x and y), or null. */
    pick(x: number, y: number): Actor | null
    camera(options: NonNullable<SceneOptions["camera"]>): void
    readonly actors: readonly Actor[]
}

// How many scenes are live, and who wants to know: the stage's backdrop hides while any is.
let liveScenes = 0
const backdropListeners = new Set<() => void>()
function setLiveScenes(n: number) {
    liveScenes = n
    for (const l of backdropListeners) l()
}

/** The stage's backdrop colour, or transparent while a 3D scene is live behind the panel. */
export function useBackdrop(color: string): string {
    // An external store rather than state plus an effect: a scene is created in its own
    // component's effect, which React runs before the stage's (children first), so a
    // listener added in the stage's effect would miss the first scene entirely.
    const live = useSyncExternalStore(subscribeBackdrop, () => liveScenes > 0)
    return live ? "rgba(0, 0, 0, 0)" : color
}

function subscribeBackdrop(listener: () => void): () => void {
    backdropListeners.add(listener)
    return () => { backdropListeners.delete(listener) }
}

function bridge(): any {
    const found = globalThis.CS?.OneJS?.Models?.ModelBridge
    if (found === undefined || found === null) {
        throw new Error("[oj] 3D models need glTFast: this host has no OneJS.Models.ModelBridge. In a Unity project, add com.unity.cloud.gltfast with the Package Manager.")
    }
    return found
}

function rootElement(): any {
    return getCurrentRuntime()?.root ?? globalThis.__root
}

/** Loads one of this game's .glb files by name, or any URL. */
export async function loadModel(name: string): Promise<Model> {
    const b = bridge()
    const id: number = await b.Load(assetUrl(name))
    const clips = String(b.Clips(id)).split("\n").filter((c) => c !== "")
    return { id, clips, height: Number(b.Height(id)) }
}

/** The hook form: null until the file has loaded. */
export function useModel(name: string): Model | null {
    const [model, setModel] = useState<Model | null>(null)
    useEffect(() => {
        let live = true
        loadModel(name).then(
            (loaded) => { if (live) setModel(loaded) },
            (error) => console.error(`[oj] could not load ${name}:`, error),
        )
        return () => { live = false }
    }, [name])
    return model
}

/**
 * Sets up the camera and light, and owns everything spawned through it. Null on
 * the first render, a Scene from then on. Unmounting destroys every actor and
 * model, which is also what a hot reload does.
 */
export function useScene(options: SceneOptions = {}): Scene | null {
    const [scene, setScene] = useState<Scene | null>(null)
    useEffect(() => {
        const created = createScene(options)
        setScene(created.scene)
        return created.dispose
        // Read once, on mount, like usePhysics: a re-render must not rebuild the world.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return scene
}

function createScene(options: SceneOptions): { scene: Scene, dispose: () => void } {
    const b = bridge()
    const actors: Actor[] = []
    const fades = new Map<number, { from: number, to: number, t: number, seconds: number, done: () => void }>()

    const camera = (c: NonNullable<SceneOptions["camera"]>) => {
        const look = c.lookAt ?? [0, 0, 0]
        b.SetCamera(c.position[0], c.position[1], c.position[2], look[0], look[1], look[2], c.fov ?? 0)
    }
    if (options.camera) camera(options.camera)
    const light = options.light ?? {}
    const dir = light.direction ?? [-0.4, -1, 0.35]
    b.SetLight(dir[0], dir[1], dir[2], light.intensity ?? 1.1, light.ambient ?? 0.45)
    const bg = options.background ?? [0.078, 0.094, 0.114]
    b.SetBackground(bg[0], bg[1], bg[2])
    setLiveScenes(liveScenes + 1)

    // Animation updates itself in play mode; the edit-mode preview has to step it.
    const preview = globalThis.__isPlaying === false
    const stopFrame = getCurrentRuntime()?.onFrame((dt: number) => {
        if (preview && actors.length > 0) b.Step(dt)
        for (const [id, f] of fades) {
            f.t = Math.min(f.seconds, f.t + dt)
            const k = f.seconds > 0 ? f.t / f.seconds : 1
            b.SetDissolve(id, f.from + (f.to - f.from) * k)
            if (k >= 1) { fades.delete(id); f.done() }
        }
    })

    const spawn = (model: Model, o: SpawnOptions = {}): Actor => {
        let position: Vec3 = o.position ?? [0, 0, 0]
        let yaw = o.yaw ?? 0
        let dissolved = 0
        const id: number = b.Spawn(model.id, position[0], position[1], position[2], yaw, o.scale ?? 1)
        const actor: Actor = {
            id, model,
            get position() { return position },
            set position(p: Vec3) { position = p; b.Place(id, p[0], p[1], p[2], yaw) },
            get yaw() { return yaw },
            set yaw(y: number) { yaw = y; b.Place(id, position[0], position[1], position[2], y) },
            play(clip, po = {}) {
                if (!b.Play(id, clip, po.loop ?? true, po.fade ?? 0.15)) {
                    console.warn(`[oj] ${clip} is not one of this model's clips: ${model.clips.join(", ")}`)
                }
            },
            dissolve(amount, seconds = 0.8) {
                return new Promise<void>((done) => {
                    fades.get(id)?.done()
                    fades.set(id, { from: dissolved, to: amount, t: 0, seconds, done: () => { dissolved = amount; done() } })
                })
            },
            screenPoint(lift = model.height) {
                const p = b.PanelPoint(rootElement(), id, lift)
                const x = p.x ?? p[0], y = p.y ?? p[1]
                return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
            },
            destroy() {
                fades.delete(id)
                const i = actors.indexOf(actor)
                if (i >= 0) actors.splice(i, 1)
                b.Destroy(id)
            },
        }
        actors.push(actor)
        if (o.play) actor.play(o.play, { fade: 0 })
        return actor
    }

    const scene: Scene = {
        spawn,
        pick(x, y) {
            const id = b.Pick(rootElement(), x, y)
            return actors.find((a) => a.id === id) ?? null
        },
        camera,
        get actors() { return actors },
    }
    return {
        scene,
        dispose() {
            stopFrame?.()
            setLiveScenes(liveScenes - 1)
            fades.clear()
            actors.length = 0
            b.DisposeAll()
        },
    }
}
