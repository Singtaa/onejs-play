/**
 * 3D models from a game's own .glb files, with no C# in the game.
 *
 *     const scene = useScene()
 *     const ghost = useModel("ghost.glb")
 *     useEffect(() => {
 *         if (scene && ghost) scene.spawn(ghost, { play: "ghost_idle" })
 *     }, [scene, ghost])
 *
 * A scene with no options already looks right: a camera looking at the origin, a
 * sun that casts soft shadows, light from the sky and the ground, and models
 * that cast and receive shadows. Every option turns one of those off or tunes
 * it, named as three.js and Unity name them.
 *
 * Files resolve through assetUrl, so the name means the same thing on the site and
 * after `ojplay add`. Everything is a handle into OneJS.Models.ModelBridge, which
 * glTFast backs; a host without glTFast gets an error naming the package instead
 * of a missing-type crash. Actors and lights die with the scene that made them.
 */

import { useEffect, useState, useSyncExternalStore } from "react"
import { assetUrl } from "./asset"
import { Color } from "./color"
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
    /** Whether it casts a shadow. On by default. */
    castShadows?: boolean
    /** Whether shadows fall on it. On by default. */
    receiveShadows?: boolean
}

/** One copy of a model in the world. */
export interface Actor {
    readonly id: number
    readonly model: Model
    /** Where it stands. Assign a new one to move it; the array read back is frozen. */
    position: Vec3
    /** Which way it faces, in degrees about the up axis. */
    yaw: number
    castShadows: boolean
    receiveShadows: boolean
    /** Plays a clip, crossfading over `fade` seconds (0.15 by default). Loops unless told not to. */
    play(clip: string, options?: { loop?: boolean, fade?: number }): void
    /** Dissolves to `amount` (1 is gone) over `seconds`, resolving when it gets there. */
    dissolve(amount: number, seconds?: number): Promise<void>
    /**
     * Where a point `lift` units above the actor is on screen, in window pixels
     * like a pointer event's x and y: put a label there with position absolute.
     * `lift` defaults to the top of the model at the scale it was spawned at.
     * Null when it is behind the camera.
     */
    screenPoint(lift?: number): { x: number, y: number } | null
    destroy(): void
}

export interface PointLightOptions {
    position: Vec3
    /** Hex, like every colour in oj. White by default. */
    color?: string
    intensity?: number
    /** How far it reaches, in world units. */
    range?: number
}

/** A light shining in every direction from one point. */
export interface PointLight {
    readonly id: number
    position: Vec3
    color: string
    intensity: number
    range: number
    destroy(): void
}

export interface SceneOptions {
    camera?: { position?: Vec3, lookAt?: Vec3, fov?: number }
    /**
     * The sun: a directional light shining along `direction`, casting soft
     * shadows unless `shadows` is false. `false` is a scene with no sun.
     */
    sun?: { direction?: Vec3, color?: string, intensity?: number, shadows?: boolean } | false
    /** Light from everywhere: `sky` from above fading to `ground` from below, like three.js's HemisphereLight. */
    ambient?: { sky?: string, ground?: string, intensity?: number }
    /** The colour behind the world. */
    background?: string
    /** Fog that thickens from `near` to `far`, in the background colour unless given one. Off unless asked for. */
    fog?: { color?: string, near?: number, far?: number }
}

export interface Scene {
    spawn(model: Model, options?: SpawnOptions): Actor
    pointLight(options: PointLightOptions): PointLight
    /** The actor under a point in window pixels (a pointer event's x and y), or null. */
    pick(x: number, y: number): Actor | null
    camera(options: NonNullable<SceneOptions["camera"]>): void
    /** The live actors, as a copy: destroying them while iterating it is fine. */
    readonly actors: readonly Actor[]
}

/** What a scene is when an option is left out. */
export const SCENE_DEFAULTS = deepFreeze({
    camera: { position: [0, 4, -8] as Vec3, lookAt: [0, 0, 0] as Vec3, fov: 50 },
    // Down and away from the default camera, a little from the left: shadows fall toward the
    // back right, where they read without hiding what cast them.
    sun: { direction: [-0.32, -0.77, 0.56] as Vec3, color: "#fff4d6", intensity: 1.2 },
    ambient: { sky: "#b8c6d9", ground: "#4a443d", intensity: 0.9 },
    background: "#14181d",
    fog: { near: 10, far: 40 },
    pointLight: { color: "#ffffff", intensity: 1, range: 10 },
})

// Frozen because the container's oj outlives one cart: a cart that wrote to a default
// would otherwise change the scene every later cart gets.
function deepFreeze<T extends object>(value: T): T {
    for (const v of Object.values(value)) if (typeof v === "object" && v !== null) deepFreeze(v)
    return Object.freeze(value)
}

/**
 * A position as a handle keeps it: a copy, frozen, so `actor.position[1] += 5` cannot
 * change what the getter reports without moving the actor. The setter is the one way to move.
 */
function vec3(p: Readonly<Vec3>): Vec3 {
    return Object.freeze([p[0], p[1], p[2]]) as unknown as Vec3
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

/** A hex colour as the three sRGB floats the bridge takes. */
function rgb(hex: string): [number, number, number] {
    const c = Color.FromHex(hex)
    return [c.r, c.g, c.b]
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
    useEffect(() => watchModel(name, setModel), [name])
    return model
}

/**
 * useModel's effect: loads the file and hands it over unless stopped first. A
 * stopped load stays quiet when it fails, since pressing Play or a hot reload
 * disposes the scene mid-load and the bridge then cancels it.
 */
export function watchModel(name: string, loaded: (model: Model) => void): () => void {
    let live = true
    loadModel(name).then(
        (model) => { if (live) loaded(model) },
        (error) => { if (live) console.error(`[oj] could not load ${name}:`, error) },
    )
    return () => { live = false }
}

/**
 * Sets up the camera and lights, and owns everything spawned through it. Null on
 * the first render, a Scene from then on. Unmounting destroys every actor, light
 * and model, which is also what a hot reload does.
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

/** The scene without React: what useScene makes on mount and disposes on unmount. */
export function createScene(options: SceneOptions = {}): { scene: Scene, dispose: () => void } {
    const b = bridge()
    const d = SCENE_DEFAULTS
    const actors: Actor[] = []
    // A fade reports each value it reaches through `at`, so an interrupted one turns back
    // from where the actor is rather than from where it was going.
    const fades = new Map<number, { from: number, to: number, t: number, seconds: number, at: (v: number) => void, done: () => void }>()

    // Every colour is parsed before anything is built, so a typo fails without a half-made scene.
    const background = options.background ?? d.background
    const backgroundRgb = rgb(background)
    const sun = options.sun === false ? null : { ...d.sun, shadows: true, ...options.sun }
    const sunRgb = rgb(sun?.color ?? d.sun.color)
    const ambient = { ...d.ambient, ...options.ambient }
    const skyRgb = rgb(ambient.sky), groundRgb = rgb(ambient.ground)
    const fog = options.fog === undefined ? null : { ...d.fog, ...options.fog }
    const fogRgb = fog === null ? null : rgb(fog.color ?? background)

    // Each call changes only what it names: `camera({ fov: 30 })` keeps the position.
    let cam = { position: vec3(d.camera.position), lookAt: vec3(d.camera.lookAt), fov: d.camera.fov }
    const camera = (c: NonNullable<SceneOptions["camera"]>) => {
        cam = {
            position: c.position ? vec3(c.position) : cam.position,
            lookAt: c.lookAt ? vec3(c.lookAt) : cam.lookAt,
            fov: c.fov ?? cam.fov,
        }
        b.SetCamera(...cam.position, ...cam.lookAt, cam.fov)
    }

    b.BeginScene()
    camera(options.camera ?? {})
    if (sun === null) b.SetSun(false, 0, -1, 0, 1, 1, 1, 0, false)
    else b.SetSun(true, ...sun.direction, ...sunRgb, sun.intensity, sun.shadows)
    b.SetAmbient(...skyRgb, ...groundRgb, ambient.intensity)
    b.SetBackground(...backgroundRgb)
    if (fog === null || fogRgb === null) b.SetFog(false, 0, 0, 0, 0, 0)
    else b.SetFog(true, ...fogRgb, fog.near, fog.far)
    setLiveScenes(liveScenes + 1)

    // Animation updates itself in play mode; the edit-mode preview has to step it.
    const preview = globalThis.__isPlaying === false
    const stopFrame = getCurrentRuntime()?.onFrame((dt: number) => {
        if (preview && actors.length > 0) b.Step(dt)
        for (const [id, f] of fades) {
            f.t = Math.min(f.seconds, f.t + dt)
            const k = f.seconds > 0 ? f.t / f.seconds : 1
            const value = f.from + (f.to - f.from) * k
            b.SetDissolve(id, value)
            f.at(value)
            if (k >= 1) { fades.delete(id); f.done() }
        }
    })

    const spawn = (model: Model, o: SpawnOptions = {}): Actor => {
        let position = vec3(o.position ?? [0, 0, 0])
        let yaw = o.yaw ?? 0
        const scale = o.scale ?? 1
        let cast = o.castShadows ?? true
        let receive = o.receiveShadows ?? true
        let dissolved = 0
        const id: number = b.Spawn(model.id, ...position, yaw, scale, cast, receive)
        const actor: Actor = {
            id, model,
            get position() { return position },
            set position(p: Vec3) { position = vec3(p); b.Place(id, position[0], position[1], position[2], yaw) },
            get yaw() { return yaw },
            set yaw(y: number) { yaw = y; b.Place(id, position[0], position[1], position[2], y) },
            get castShadows() { return cast },
            set castShadows(on: boolean) { cast = on; b.SetShadows(id, cast, receive) },
            get receiveShadows() { return receive },
            set receiveShadows(on: boolean) { receive = on; b.SetShadows(id, cast, receive) },
            play(clip, po = {}) {
                if (!b.Play(id, clip, po.loop ?? true, po.fade ?? 0.15)) {
                    console.warn(`[oj] ${clip} is not one of this model's clips: ${model.clips.join(", ")}`)
                }
            },
            dissolve(amount, seconds = 0.8) {
                return new Promise<void>((done) => {
                    fades.get(id)?.done()
                    fades.set(id, { from: dissolved, to: amount, t: 0, seconds, at: (v) => { dissolved = v }, done })
                })
            },
            screenPoint(lift = model.height * scale) {
                const p = b.PanelPoint(rootElement(), id, lift)
                const x = p.x ?? p[0], y = p.y ?? p[1]
                return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
            },
            destroy() {
                fades.get(id)?.done()
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

    const pointLight = (o: PointLightOptions): PointLight => {
        let position = vec3(o.position)
        let color = o.color ?? d.pointLight.color
        let intensity = o.intensity ?? d.pointLight.intensity
        let range = o.range ?? d.pointLight.range
        const id: number = b.AddPointLight(...position, ...rgb(color), intensity, range)
        const retune = () => b.SetLight(id, ...rgb(color), intensity, range)
        return {
            id,
            get position() { return position },
            set position(p: Vec3) { position = vec3(p); b.PlaceLight(id, ...position) },
            get color() { return color },
            set color(c: string) { color = c; retune() },
            get intensity() { return intensity },
            set intensity(i: number) { intensity = i; retune() },
            get range() { return range },
            set range(r: number) { range = r; retune() },
            destroy() { b.DestroyLight(id) },
        }
    }

    const scene: Scene = {
        spawn,
        pointLight,
        pick(x, y) {
            const id = b.Pick(rootElement(), x, y)
            return actors.find((a) => a.id === id) ?? null
        },
        camera,
        // A copy, so `for (const a of scene.actors) a.destroy()` reaches every actor.
        get actors() { return actors.slice() },
    }
    let disposed = false
    return {
        scene,
        dispose() {
            if (disposed) return
            disposed = true
            stopFrame?.()
            setLiveScenes(liveScenes - 1)
            for (const f of fades.values()) f.done()
            fades.clear()
            actors.length = 0
            b.DisposeAll()
        },
    }
}
