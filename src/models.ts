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
 * it, named as three.js and Unity name them, and each can change later through
 * the method of the same name: `scene.sun({ intensity: 0.3 })`.
 *
 * A cart has one scene at a time. Files resolve through assetUrl, so the name
 * means the same thing on the site and after `ojplay add`, and each file loads
 * once however many components ask for it. Everything is a handle into
 * OneJS.Models.ModelBridge, which glTFast backs; a host without glTFast gets an
 * error naming the package instead of a missing-type crash. Actors, lights and
 * loaded models die with the scene.
 */

import { useEffect, useState, useSyncExternalStore } from "react"
import { assetFile, assetInfo, assetUrl, loadAssetBytes, textureIdentity } from "./asset"
import { LENT_TEXTURE, toRGBA, type ColorInput, type LentTexture, type Texture } from "onejs-react"
import { getCurrentRuntime } from "./runtime"
import { setActorPlacer, stillActors } from "./physics3d/actors"
import { arrayModels, modelUrls } from "./physics3d/sources"
import { fromQuat, toQuat } from "./physics3d/rotation"
import type { BakeItem } from "./light/bake"
import type { BakeOptionValues } from "./light/record"
import { sceneBaker } from "./light/scene-bake"
import { sha256 } from "./light/sha256"

// Type-level redeclaration only, so dynamic host globals typecheck.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

export type Vec3 = [number, number, number]

/**
 * Which way something faces, in degrees: `yaw` turns it about the up axis,
 * `pitch` tips its front down, and `roll` tilts it about the way it faces.
 */
export interface Rotation {
    yaw: number
    pitch: number
    roll: number
}

/** A loaded .glb, ready to spawn. */
export interface Model {
    readonly id: number
    /** Animation clip names, as the file names them. */
    readonly clips: readonly string[]
    /** Height in the model's own units, before any spawn scale. */
    readonly height: number
}

/** A list of numbers: a typed array, which crosses to Unity as its bytes, or a plain array. */
export type Numbers = Float32Array | readonly number[]

/**
 * What `scene.mesh` makes a model from. Every list is flat: positions three
 * numbers a vertex, indices three a triangle. A triangle shows the side that
 * `cross(b - a, c - a)` points to, as Unity's own meshes and oj's physics do.
 */
export interface MeshData {
    /** x, y and z a vertex, in the model's own units. */
    positions: Numbers
    /** Three a triangle, each a vertex's place in `positions`. A Uint16Array is half the bytes. */
    indices: Uint32Array | Uint16Array | readonly number[]
    /** x, y and z a vertex. Computed from the triangles when left out, and again on every `set`. */
    normals?: Numbers
    /** sRGB from 0 to 1, three or four a vertex (r, g, b, and a), multiplied into the model's `color`. */
    colors?: Numbers
    /** u and v a vertex, which a `texture` or a `splat` is read at. */
    uvs?: Numbers
}

/**
 * How often a texture repeats across a uv of 0 to 1: one number for both
 * directions, or u and v apart. A 64 m chunk with uvs from 0 to 1 and a
 * tiling of 8 repeats it every 8 m.
 */
export type Tiling = number | readonly [u: number, v: number]

/**
 * Up to four textures painted together by weights a vertex: grass, dirt, rock
 * and sand blended across a terrain, the vertex grid saying how much of each
 * and the textures carrying the detail inside it.
 */
export interface MeshSplat {
    /**
     * One to four pictures from `loadTexture`, each with its height in alpha
     * if `heightBlend` is used. A layer given as `{ picture, triplanar }` is
     * projected from the sides instead of read at the uvs (see MeshSplatLayer).
     */
    layers: readonly (Texture | MeshSplatLayer)[]
    /** One a layer a vertex, in the layers' order. They need not sum to 1: the shader divides by their sum. */
    weights: Numbers
    /** How often the layers repeat across a uv of 0 to 1. 1 by default. */
    tiling?: Tiling
    /**
     * 0 (the default) mixes the layers by the weights alone. Above 0, a layer
     * shows where its height (the picture's alpha) plus its weight comes within
     * this much of the highest, so stones stand out of the grass round them:
     * the smaller, the crisper the edge. Up to 1.
     */
    heightBlend?: number
}

/**
 * A splat layer projected onto the ground from the sides, above and the
 * front in world space, rather than read at the mesh's uvs: for ground too
 * steep for uvs laid flat, which stretch a picture down a cliff. Rock, say:
 * `layers: [grass, dirt, { picture: rock, triplanar: 4 }]`.
 */
export interface MeshSplatLayer {
    /** A picture from `loadTexture`. */
    picture: Texture
    /**
     * Metres one repeat of the picture spans, on every face whatever its
     * slope. The splat's `tiling` does not apply to it. A triplanar layer
     * costs three reads of its picture where a layer at the uvs costs one.
     */
    triplanar: number
}

export interface MeshModelOptions extends MeshData {
    /** The whole model's colour, white by default. An alpha below 1 draws it see-through. */
    color?: ColorInput
    /** A picture from `loadTexture`, tiled across the uvs under the colours. Needs `uvs`. */
    texture?: Texture
    /** How often the texture repeats across a uv of 0 to 1. 1 by default. */
    tiling?: Tiling
    /** Up to four pictures painted by weights a vertex, in place of `texture`. Needs `uvs`. */
    splat?: MeshSplat
    /** A grid of how much of the sun reaches the ground, for shadows past the sun's own (see MeshShade). Needs `uvs`. */
    shade?: MeshShade
    /**
     * Cuts away every pixel whose alpha (the texture's, the colour's and the
     * vertex colours', multiplied) is below this, from 0 to 1: a leaf card is
     * a quad cut to a leaf's outline. Its shadow is cut the same. It draws
     * opaque, with no sorting, even where an alpha below 1 would draw it
     * see-through. Not with a splat, which has no alpha.
     */
    cutout?: number
    /**
     * Draws the back of every triangle too, and lights it with the normal as
     * given rather than turned round, so a foliage card whose normals bend out
     * from its crown looks the same from either side. Its shadow is cast by both.
     */
    twoSided?: boolean
    /**
     * How far each vertex sways in the scene's wind, one a vertex, in the
     * model's own units at a wind strength of 1: 0 at a trunk's foot, about
     * 0.3 at a crown's rim. Moved on the GPU, so a wood of scattered copies
     * sways for nothing on the CPU, each copy at its own phase. See `scene.wind`.
     */
    sway?: Numbers
}

/** How a mesh model draws, fixed when it is made. */
export interface MeshDrawOptions {
    /**
     * Writes depth and no colour: it hides what is behind it without being
     * seen, as a shadow cut out of the world does. Drawn before the opaque
     * models so its depth is down first, it casts no shadow, and its colour
     * and alpha draw nothing.
     */
    depthOnly?: boolean
}

/**
 * A `set`: new positions, and anything else that changes. Indices left out
 * stay as they were. Normals, colours, UVs and a splat's weights come with
 * every set that changes the number of vertices, if the model was made with
 * them; otherwise they may be left out and stay.
 */
export type MeshUpdate = MeshVertices | {
    /** A new shade alone, the vertices as they were: after the sun moves, or a chunk is rebaked. `null` takes it off. */
    shade: MeshShade | null
}

/** New vertices for a mesh, and what goes with them. */
type MeshVertices = Pick<MeshData, "positions"> & Partial<Omit<MeshData, "positions">> & {
    /** A splat's new weights, one a layer a vertex: a path worn into the grass. */
    weights?: Numbers
    /** New sway, one a vertex, for a model made with `sway`. */
    sway?: Numbers
    /** A new shade, or `null` to take it off. */
    shade?: MeshShade | null
}

/**
 * A grid of shade across a mesh: how much of the sun each sample blocks, for
 * ground past where the sun's realtime shadows reach. It dims the sun alone,
 * as a realtime shadow does, and a spot in both darkens once.
 *
 *     scene.mesh({ positions, indices, uvs, shade: { size: 65, values } })
 *
 * It is read across the mesh's uvs, before any tiling, so uvs from 0 to 1
 * spread the grid over the mesh. The samples sit on the grid's corners, as
 * vertices do: a chunk whose edge row equals its neighbour's shows no seam.
 * A 65 by 65 grid over a 64 m chunk is one sample a metre and 4 KB.
 */
export interface MeshShade {
    /** Samples along each side, or u and v apart. 2 to 1024. */
    size: number | readonly [u: number, v: number]
    /**
     * Row by row along u: 0 is full sun and 1 full shade, or 0 to 255 in a
     * Uint8Array, which crosses as it is.
     */
    values: Uint8Array | Numbers
}

/** A model made from arrays: spawned, scattered and made a collider like a loaded one. */
export interface MeshModel extends Model {
    /**
     * Redraws it, and every actor of it, with new vertices: a shadow or a trail
     * that changes each frame. Its buffers keep their room, so one that varies
     * between sizes stops allocating once it has seen the largest. A model that
     * became a physics collider keeps its shape and refuses.
     */
    set(data: MeshUpdate): void
    /** Frees it. One with a copy still in the world stays, and says so: destroy its actors first. */
    destroy(): void
}

/**
 * The scene as a texture, for a program to read: `textures={{ scene: scene.texture }}`.
 * While any program reads it, the scene draws only into it, and not to the screen.
 */
export type SceneTexture = LentTexture

/**
 * One copy in a scatter. y, yaw, pitch and roll (degrees, as an actor's
 * rotation is) and scale default to 0, 0, 0, 0 and 1.
 */
export interface ScatterCopy {
    x: number
    y?: number
    z: number
    yaw?: number
    /** Tips its front down: a rock settled into a slope. */
    pitch?: number
    /** Tilts it about the way it faces. */
    roll?: number
    scale?: number
    /** Multiplied into its colour, as vertex colours are: one shape a little darker, greener or redder than the next. */
    tint?: ColorInput
}

/** How a scatter's copies are given and drawn. */
export interface ScatterOptions {
    /**
     * Numbers a copy in a Float32Array: 5 (x, y, z, yaw, scale), the default,
     * or 10 (x, y, z, yaw, pitch, roll, scale, then r, g and b in sRGB from 0
     * to 1, a tint multiplied into its colour).
     */
    stride?: 5 | 10
    /** Metres from the camera to a copy's foot within which it is not drawn. 0 by default. */
    from?: number
    /** Metres from the camera past which a copy is not drawn. Infinity by default. */
    to?: number
    /**
     * Metres across which a copy dithers in or out, centred on `from` and on
     * `to`. A near mesh with `{ to: 140, fade: 12 }` and a far one with
     * `{ from: 140, fade: 12 }` share every pixel between them, so they swap
     * copy by copy with nothing drawn twice. 0 by default: a hard edge.
     */
    fade?: number
}

/**
 * The scene's wind, which moves every mesh made with `sway`. Each part left
 * out keeps what it was; a scene starts with a breeze along +x.
 */
export interface WindOptions {
    /** The way it blows over the ground, as x and z. Any length but 0. */
    direction?: readonly [x: number, z: number]
    /** How far it pushes: 1 moves a vertex by its sway, 0 stills everything. */
    strength?: number
    /** How much a slow swell passing along the wind adds and takes away, from 0 to 1. */
    gust?: number
}

/** Copies of a model that never move, from `scene.scatter`. */
export interface Scatter {
    readonly count: number
    destroy(): void
}

export interface SpawnOptions {
    position?: Vec3
    /** Which way it faces; any part left out is 0. */
    rotation?: Partial<Rotation>
    /** Shorthand for `rotation: { yaw }`. */
    yaw?: number
    /** 1 is the model's own size. */
    scale?: number
    /** How fast its clips and its dissolve play. 1 by default, 0 holds them. */
    speed?: number
    /** A clip to start looping straight away. */
    play?: string
    /** Whether it casts a shadow. On by default. */
    castShadows?: boolean
    /** Whether shadows fall on it. On by default. */
    receiveShadows?: boolean
    /**
     * Never moves: `scene.bake` bakes light into it, and its shadow and bounce
     * onto the rest. The actor of a physics body that is neither dynamic nor
     * kinematic is static without it. One moved anyway keeps its light until
     * the next bake.
     */
    static?: boolean
}

/**
 * How `scene.bake` bakes, each optional; with none, 2 bounces, 256 samples,
 * no extra occlusion and 24 texels a metre. A saved file is current only for
 * the options it was baked with.
 */
export type BakeOptions = Partial<BakeOptionValues>

/**
 * How a bake ended: `"loaded"` its named file was current and is showing,
 * `"baked"` it baked here, `"failed"` it could not, which the console says,
 * `"stopped"` a later bake, `scene.clearLight` or the scene going ended it
 * unfinished.
 */
export type BakeResult = "loaded" | "baked" | "failed" | "stopped"

/** A bake under way, from `scene.bake`. */
export interface Bake {
    /** From 0 to 1. */
    readonly progress: number
    /**
     * Resolves once the bake ends, to how it ended: once the light is
     * finished or loaded, and also when it fails or stops.
     *
     *     if (await light.done === "baked") console.log("lit")
     */
    readonly done: Promise<BakeResult>
}

export interface DissolveOptions {
    /** Where to fade to: 1 is gone, 0 is whole. 1 by default. */
    to?: number
    /** How long it takes. 0.8 by default. */
    seconds?: number
}

/** One copy of a model in the world. */
export interface Actor {
    readonly id: number
    readonly model: Model
    /** Where it stands. Assign a new one to move it; the array read back is frozen. */
    position: Vec3
    /** Which way it faces. Assign it to turn it; any part left out is 0. */
    get rotation(): Readonly<Rotation>
    set rotation(rotation: Partial<Rotation>)
    /** Shorthand for `rotation.yaw`: turning it this way keeps its pitch and roll. */
    yaw: number
    /** 1 is the model's own size. */
    scale: number
    /**
     * How fast its clips and its dissolve play: 1 as authored, 0.25 slow motion,
     * 0 held where they are. `scene.paused` holds every actor without changing this.
     */
    speed: number
    castShadows: boolean
    receiveShadows: boolean
    /** Plays a clip, crossfading over `fade` seconds (0.15 by default). Loops unless told not to. */
    play(clip: string, options?: { loop?: boolean, fade?: number }): void
    /**
     * Fades it out with a glowing edge, or back in with `{ to: 0 }`, resolving
     * when it gets there. A pause holds the fade and the promise waits for it.
     */
    dissolve(options?: DissolveOptions): Promise<void>
    /**
     * Where a point `lift` units above the actor is on screen, in window pixels
     * like a pointer event's x and y: put a label there with position absolute.
     * `lift` defaults to the top of the model at its current scale.
     * Null when it is behind the camera.
     */
    screenPoint(lift?: number): { x: number, y: number } | null
    destroy(): void
}

export interface PointLightOptions {
    position: Vec3
    /** White by default. */
    color?: ColorInput
    intensity?: number
    /** How far it reaches, in world units. */
    range?: number
}

/** A light shining in every direction from one point. */
export interface PointLight {
    readonly id: number
    position: Vec3
    color: ColorInput
    intensity: number
    range: number
    destroy(): void
}

export interface CameraOptions {
    position?: Vec3
    lookAt?: Vec3
    /** Vertical field of view, in degrees. */
    fov?: number
}

/** The sun: a directional light shining along `direction`, casting soft shadows unless `shadows` is false. */
export interface SunOptions {
    direction?: Vec3
    color?: ColorInput
    intensity?: number
    /**
     * `true` (the default) casts soft shadows to 50 m, `false` none, and an
     * object tunes them: a world seen from high up, or far across, wants them
     * to reach further than the default does.
     *
     *     scene.sun({ shadows: { distance: 150, cascades: 4 } })
     */
    shadows?: boolean | SunShadows
}

/**
 * How far and how sharp the sun's shadows are. Each one left out is what the
 * game's host ships: 50 m, 2 cascades, "high" and 2048 on play.onejs.com.
 *
 * Past `distance` the realtime shadows fade out; a mesh's `shade` carries
 * them on across the ground beyond.
 */
export interface SunShadows {
    /** Metres from the camera that realtime shadows reach, fading out over the last stretch. */
    distance?: number
    /** 1 to 4. More keeps shadows sharp near the camera across a long distance, at one more shadow pass each. */
    cascades?: 1 | 2 | 3 | 4
    /** `"hard"`, or how wide a soft edge is filtered: `"low"` (3x3), `"medium"` (5x5), `"high"` (7x7). */
    softness?: "hard" | "low" | "medium" | "high"
    /** The shadow map's size in pixels, shared by the cascades. */
    resolution?: 1024 | 2048 | 4096
}

/** Light from everywhere: `sky` from above fading to `ground` from below, like three.js's HemisphereLight. */
export interface AmbientOptions {
    sky?: ColorInput
    ground?: ColorInput
    intensity?: number
}

/**
 * A sky behind the world: a gradient from the horizon up to `top` and down to
 * `bottom`, the sun's disc where the scene's sun shines from, in its colour,
 * and stars. Every field defaults, so `scene.sky()` is a clear day.
 */
export interface SkyOptions {
    top?: ColorInput
    horizon?: ColorInput
    /** Below the horizon. The horizon's colour when left out. */
    bottom?: ColorInput
    /** The disc: `size` degrees across, with a glow reaching `glow` degrees out. `false` for none. */
    sun?: { size?: number, glow?: number } | false
    /** From 0, none, to 1. */
    stars?: number
}

/** Fog that thickens from `near` to `far`, in the sky's horizon colour or else the background's unless given one. */
export interface FogOptions {
    color?: ColorInput
    near?: number
    far?: number
}

export interface SceneOptions {
    camera?: CameraOptions
    /** `false` is a scene with no sun. */
    sun?: SunOptions | false
    ambient?: AmbientOptions
    /** The colour behind the world. */
    background?: ColorInput
    /** A sky behind the world instead of the background colour. */
    sky?: SkyOptions | false
    /** Off unless asked for. */
    fog?: FogOptions | false
    /** What moves a mesh made with `sway`: a breeze along +x unless given. */
    wind?: WindOptions
}

export interface Scene {
    spawn(model: Model, options?: SpawnOptions): Actor
    /**
     * A model made from arrays, such as a terrain from `rng.noise`, spawned
     * like a loaded one. It goes with the scene.
     *
     *     const land = scene.mesh({ positions, indices, color: "#6b8f4e" })
     *     scene.spawn(land)
     *
     * `{ depthOnly: true }` makes one that hides what is behind it and draws
     * nothing itself.
     */
    mesh(data: MeshModelOptions, options?: MeshDrawOptions): MeshModel
    /**
     * Copies of a model that never move: a forest, rocks, grass. Far cheaper
     * than spawning each, and with nothing an actor has: no collider, no pick,
     * no animation. `copies` is a list of `{ x, z }` (y, yaw, pitch, roll, scale
     * and tint too, if wanted), or a Float32Array of x, y, z, yaw and scale a
     * copy (ten numbers with `{ stride: 10 }`). A model with a skinned mesh is
     * refused, since its copies could never move.
     *
     *     const forest = scene.scatter(pine, trees)
     *     const near = scene.scatter(oak, oaks, { to: 140, fade: 12 })
     *     const far = scene.scatter(oakFar, oaks, { from: 140, fade: 12 })
     */
    scatter(model: Model, copies: readonly ScatterCopy[] | Float32Array, options?: ScatterOptions): Scatter
    /**
     * The scene drawn into a texture instead of the screen, for a program to
     * read: a colour grade, a blur, an outline over the whole world.
     *
     *     <ShaderProgram program={grade} textures={{ scene: scene.texture }}
     *         style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
     *
     * The first program that reads it points the camera at it, and the last to
     * stop gives the scene back to the screen, so it costs nothing until read.
     * While read, the scene is only where a program draws it. Each frame it is
     * drawn just before the programs are, so they read this frame's picture.
     */
    readonly texture: SceneTexture
    pointLight(options: PointLightOptions): PointLight
    /**
     * Bakes the light that bounces round the scene into its static actors and
     * scattered copies: the sky and the ground of the ambient, and the sun's
     * bounce, so a doorway darkens and a red wall tints the floor beside it.
     * Everything else takes that light where it stands, as it moves. The sun's
     * own light and shadows stay live.
     *
     *     scene.bake("room.light.png")
     *
     * The name is a path from the cart's root ending in `.light.png`.
     * Named, it loads that light file from the cart when it was baked for
     * this scene, and bakes here when the file is missing or out of date,
     * saying so on the console, where the editor offers to save it. With no
     * name it bakes here every time: the call for a level made at runtime.
     *
     * It bakes beside the game, a little each frame: moving things are lit
     * within a few frames, the static ones from a quick draft, then finished.
     * Bake again after changing what is static, the sun or the ambient: the
     * light showing stays until the new one is ready, unless what is static
     * changed.
     *
     *     scene.bake("yard.light.png", { bounces: 3, occlusion: 0.5 })
     *
     * - `bounces`: times light bounces before it stops, 0 to 8: 0 is the sky
     *   and the sun's light off the first thing it meets; more carries the
     *   sky's light on round corners and under cover, a little slower. 2.
     * - `samples`: paths a texel, 1 to 4096: more is smoother and slower. 256.
     * - `occlusion`: extra darkening in corners and where things touch, within
     *   a metre, 0 to 1. 0.
     * - `detail`: texels a metre. Kept by using more of the light's 4 pages,
     *   lowered past them, which the console says. 24.
     */
    bake(name?: string, options?: BakeOptions): Bake
    /** Bakes here every time, with these options. */
    bake(options: BakeOptions): Bake
    /** Takes the baked light away, stopping a bake under way: the scene keeps its ambient light. */
    clearLight(): void
    /** The actor under a point in window pixels (a pointer event's x and y), or null. */
    pick(x: number, y: number): Actor | null
    /** Moves the camera. Changes only what it names. */
    camera(options: CameraOptions): void
    /** Changes the sun, only what it names, or `false` to put it out. */
    sun(options: SunOptions | false): void
    /** Changes the ambient light, only what it names. */
    ambient(options: AmbientOptions): void
    /** Changes the colour behind the world, and the fog's unless the fog has its own. */
    background(color: ColorInput): void
    /** Changes the fog, only what it names, or `false` to clear it. */
    fog(options: FogOptions | false): void
    /**
     * Changes the wind, only what it names. A mesh made with `sway` moves in
     * it, leaning downwind and swinging about the lean.
     *
     *     scene.wind({ direction: [1, 0.4], strength: 1.5, gust: 0.5 })
     */
    wind(options: WindOptions): void
    /**
     * A sky behind the world, changing only what it names, or `false` for the
     * background colour again. `scene.sky()` is a clear day.
     *
     *     scene.sky({ top: "#0b1a3a", horizon: "#f4a261", sun: { size: 2 } })
     *
     * With fog, the horizon fades into the fog's colour, and fog given no
     * colour of its own takes the sky's horizon, so the ground and the sky meet.
     */
    sky(options?: SkyOptions | false): void
    /**
     * Holds every actor's clips and dissolves where they are, for a pause menu.
     * Each actor keeps its own `speed` for when the scene goes again. The camera
     * and lights are not touched.
     */
    paused: boolean
    /** The live actors, as a copy: destroying them while iterating it is fine. */
    readonly actors: readonly Actor[]
}

/** What a scene is when an option is left out. */
export const SCENE_DEFAULTS = deepFreeze({
    camera: { position: [0, 4, -8] as Vec3, lookAt: [0, 0, 0] as Vec3, fov: 50 },
    // Down and away from the default camera, a little from the left: shadows fall toward the
    // back right, where they read without hiding what cast them.
    sun: { direction: [-0.32, -0.77, 0.56] as Vec3, color: "#fff4d6", intensity: 1.2, shadows: true },
    ambient: { sky: "#b8c6d9", ground: "#4a443d", intensity: 0.9 },
    background: "#14181d",
    fog: { near: 10, far: 40 },
    wind: { direction: [1, 0] as [number, number], strength: 1, gust: 0.3 },
    sky: { top: "#2f6fd6", horizon: "#cfe6f7", sun: { size: 2, glow: 12 }, stars: 0 },
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

// the one live scene

/**
 * The scene that is live, and the runtime that made it. ModelBridge holds one
 * world, so a second scene would take over the first one's camera and lights,
 * and unmounting either would destroy everything both had made.
 */
let live: { dispose: () => void, runtime: unknown } | null = null
const backdropListeners = new Set<() => void>()
function setLive(next: typeof live) {
    live = next
    for (const l of backdropListeners) l()
}

/**
 * Bumped whenever a scene goes. ModelBridge destroys every loaded model with it, so a
 * Model from an earlier generation names nothing, and the load cache starts over.
 */
let generation = 0
const loads = new Map<string, Promise<Model>>()
const generationOf = new WeakMap<Model, number>()
// The name each file model was loaded by, as the cart gave it: what a light record calls it.
const modelNames = new WeakMap<Model, string>()
// What a scene.mesh model is made of now, as bytes: what a light record hashes for it.
const meshBytes = new WeakMap<Model, () => Uint8Array>()

/** The stage's backdrop colour, or transparent while a 3D scene is live behind the panel. */
export function useBackdrop(color: string): string {
    // An external store rather than state plus an effect: a scene is created in its own
    // component's effect, which React runs before the stage's (children first), so a
    // listener added in the stage's effect would miss the first scene entirely.
    const showing = useSyncExternalStore(subscribeBackdrop, () => live !== null)
    return showing ? "rgba(0, 0, 0, 0)" : color
}

function subscribeBackdrop(listener: () => void): () => void {
    backdropListeners.add(listener)
    return () => { backdropListeners.delete(listener) }
}

/**
 * What a physics world uses to move actors: each actor's cached position and
 * rotation updated here, and all of them moved in Unity with one crossing.
 * Keyed by actor, so only actors this module made are batched.
 */
const placed = new WeakMap<Actor, (position: Vec3, rotation: Readonly<Rotation> | null) => void>()

setActorPlacer((list) => {
    const b = bridge()
    const buffer = new Float32Array(list.length * 8)
    let n = 0
    for (const { actor, at, rotation } of list) {
        const set = placed.get(actor)
        if (set === undefined) {
            actor.position = at
            if (rotation !== null) actor.rotation = fromQuat(rotation)
            continue
        }
        const turned = rotation === null ? null : fromQuat(rotation)
        set(vec3(at), turned)
        const q = rotation ?? toQuat(actor.rotation)
        buffer.set([actor.id, at[0], at[1], at[2], q.x, q.y, q.z, q.w], n * 8)
        n++
    }
    if (n === 0) return
    if (typeof b.PlaceMany === "function") {
        b.PlaceMany(n * 8 === buffer.length ? buffer : buffer.slice(0, n * 8))
        return
    }
    // A OneJS from before PlaceMany: one actor at a time, the same result.
    for (let i = 0; i < n * 8; i += 8) {
        b.Move(buffer[i], buffer[i + 1], buffer[i + 2], buffer[i + 3])
        const r = fromQuat({ x: buffer[i + 4]!, y: buffer[i + 5]!, z: buffer[i + 6]!, w: buffer[i + 7]! })
        b.SetRotation(buffer[i], r.yaw, r.pitch, r.roll)
    }
})

function bridge(): any {
    const found = globalThis.CS?.OneJS?.Models?.ModelBridge
    if (found === undefined || found === null) {
        throw new Error("[oj] 3D models need glTFast: this host has no OneJS.Models.ModelBridge. In a Unity project, add com.unity.cloud.gltfast with the Package Manager.")
    }
    return found
}

/** A list of numbers as the Float32Array the bridge takes, `width` to an element. */
function floats(list: Numbers | undefined, what: string, width: number): Float32Array | null {
    if (list === undefined || list === null) return null
    const typed = list instanceof Float32Array ? list : Array.isArray(list) ? Float32Array.from(list) : null
    if (typed === null) throw new Error(`[oj] scene.mesh: ${what} is a ${Object.prototype.toString.call(list).slice(8, -1)}; give a Float32Array or an array of numbers`)
    if (typed.length % width !== 0) throw new Error(`[oj] scene.mesh: ${what} has ${typed.length} numbers, which is not ${width} a vertex`)
    return typed
}

/** What a mesh is drawn with besides its colours: one tiled texture, a splat, or neither. Checked before anything is made. */
interface MeshLook {
    texture: { texture: Texture, tiling: [number, number] } | null
    /** `triplanar` is each layer's metres a repeat, 0 for one read at the uvs. */
    splat: { layers: readonly Texture[], triplanar: readonly number[], tiling: [number, number], heightBlend: number } | null
    /** Its pictures, tiling and blend in words, for its light's fingerprint; "" with neither. */
    fingerprint: string
}

function meshLook(o: MeshModelOptions, draw: MeshDrawOptions, b: any): MeshLook {
    const none: MeshLook = { texture: null, splat: null, fingerprint: "" }
    if (o.texture === undefined && o.splat === undefined) {
        if (o.tiling !== undefined) throw new Error("[oj] scene.mesh: tiling repeats a texture, and this mesh has none. Give texture, or put tiling in the splat.")
        return none
    }
    if (o.texture !== undefined && o.splat !== undefined) throw new Error("[oj] scene.mesh: give texture or splat, not both. A splat's first layer is a texture of its own.")
    const which = o.texture !== undefined ? "texture" : "splat"
    if (o.uvs === undefined) throw new Error(`[oj] scene.mesh ${which}: a ${which} is read at the mesh's uvs, and it has none. Give uvs, two numbers a vertex.`)
    if (draw.depthOnly === true) throw new Error(`[oj] scene.mesh ${which}: a depthOnly mesh draws no colour, so it has nothing to show a ${which} on.`)
    if (o.texture !== undefined) {
        if (typeof b.SetMeshTexture !== "function") throw new Error("[oj] scene.mesh texture needs a newer OneJS: this host's ModelBridge cannot put a texture on a mesh (it came with runtime 1.6).")
        picture(o.texture, "scene.mesh texture")
        const tiling = tilingOf(o.tiling, "scene.mesh tiling")
        return { texture: { texture: o.texture, tiling }, splat: null, fingerprint: `texture ${identityOf(o.texture)} ${tiling.join(" ")}` }
    }
    if (typeof b.SetMeshSplat !== "function") throw new Error("[oj] scene.mesh splat needs a newer OneJS: this host's ModelBridge cannot paint a mesh (it came with runtime 1.6).")
    if (o.tiling !== undefined) throw new Error("[oj] scene.mesh: a splat's tiling goes inside it, splat: { layers, weights, tiling }.")
    const s = o.splat!
    if (s === null || typeof s !== "object") throw new Error("[oj] scene.mesh splat is { layers, weights }")
    if (!Array.isArray(s.layers) || s.layers.length < 1 || s.layers.length > 4) {
        throw new Error(`[oj] scene.mesh splat: layers are one to four pictures from loadTexture, and these are ${Array.isArray(s.layers) ? s.layers.length : typeof s.layers}`)
    }
    const layers: Texture[] = [], triplanar: number[] = []
    s.layers.forEach((layer, i) => {
        const what = `scene.mesh splat layer ${i}`
        // A picture is the host's object, whose proxy answers `in` from its own fields without asking C#.
        if (layer !== null && typeof layer === "object" && "picture" in layer) {
            const l = layer as MeshSplatLayer
            picture(l.picture, `${what} picture`)
            if (typeof l.triplanar !== "number" || !(l.triplanar > 0) || !Number.isFinite(l.triplanar)) {
                throw new Error(`[oj] ${what}: triplanar is ${l.triplanar}, the metres one repeat of its picture spans, above 0`)
            }
            layers.push(l.picture)
            triplanar.push(l.triplanar)
            return
        }
        picture(layer, what)
        layers.push(layer as Texture)
        triplanar.push(0)
    })
    if (triplanar.some((m) => m > 0) && typeof b.SetMeshSplatTriplanar !== "function") {
        throw new Error("[oj] scene.mesh splat triplanar needs a newer OneJS: this host's ModelBridge cannot project a layer (it came with runtime 1.6).")
    }
    if (s.weights === undefined) throw new Error(`[oj] scene.mesh splat: weights are required, ${s.layers.length} a vertex (one a layer)`)
    const heightBlend = s.heightBlend ?? 0
    if (typeof heightBlend !== "number" || !(heightBlend >= 0 && heightBlend <= 1)) throw new Error(`[oj] scene.mesh splat: heightBlend is ${heightBlend}, and runs from 0 (the weights alone) to 1`)
    const tiling = tilingOf(s.tiling, "scene.mesh splat tiling")
    return {
        texture: null,
        splat: { layers, triplanar, tiling, heightBlend },
        fingerprint: `splat ${layers.map(identityOf).join(" ")} ${tiling.join(" ")} ${heightBlend}` + (triplanar.some((m) => m > 0) ? ` triplanar ${triplanar.join(" ")}` : ""),
    }
}

const SOFTNESS = ["hard", "low", "medium", "high"] as const
const SUN_SHADOW_KEYS = new Set(["distance", "cascades", "softness", "resolution"])

/**
 * The sun's shadows as SetSunShadows takes them, each -1 for the host's own: metres,
 * cascades, softness 0 (hard) to 3 (high), and resolution. Null for no shadows.
 */
function sunShadowsOf(shadows: boolean | SunShadows | undefined, b: any): [number, number, number, number] | null {
    if (shadows === false) return null
    if (shadows === undefined || shadows === true) return [-1, -1, -1, -1]
    if (shadows === null || typeof shadows !== "object" || Array.isArray(shadows)) {
        throw new Error(`[oj] sun shadows is ${JSON.stringify(shadows)}: true, false, or { distance, cascades, softness, resolution }`)
    }
    for (const key of Object.keys(shadows)) {
        if (!SUN_SHADOW_KEYS.has(key)) throw new Error(`[oj] sun shadows has no option "${key}": it takes distance, cascades, softness and resolution`)
    }
    const { distance, cascades, softness, resolution } = shadows
    if (distance !== undefined && !(typeof distance === "number" && distance > 0 && Number.isFinite(distance))) {
        throw new Error(`[oj] sun shadows distance is ${distance}: metres above 0`)
    }
    if (cascades !== undefined && !(cascades === 1 || cascades === 2 || cascades === 3 || cascades === 4)) {
        throw new Error(`[oj] sun shadows cascades is ${cascades}: 1, 2, 3 or 4`)
    }
    const soft = softness === undefined ? -1 : SOFTNESS.indexOf(softness)
    if (softness !== undefined && soft < 0) throw new Error(`[oj] sun shadows softness is ${JSON.stringify(softness)}: "hard", "low", "medium" or "high"`)
    if (resolution !== undefined && !(resolution === 1024 || resolution === 2048 || resolution === 4096)) {
        throw new Error(`[oj] sun shadows resolution is ${resolution}: 1024, 2048 or 4096`)
    }
    const out: [number, number, number, number] = [distance ?? -1, cascades ?? -1, soft, resolution ?? -1]
    if (out.some((v) => v >= 0) && typeof b.SetSunShadows !== "function") {
        throw new Error("[oj] sun shadows distance, cascades, softness and resolution need a newer OneJS: this host's ModelBridge casts the sun's shadows as it ships them (they came with runtime 1.7).")
    }
    return out
}

/** A mesh's shade as SetMeshShade takes it: u and v samples, and a byte a sample, 255 full shade. */
function shadeOf(shade: MeshShade, what: string): [number, number, Uint8Array] {
    if (shade === null || typeof shade !== "object" || Array.isArray(shade)) throw new Error(`[oj] ${what} is { size, values }: samples a side, and how much of the sun each blocks`)
    const size = shade.size
    const [u, v] = typeof size === "number" ? [size, size] : Array.isArray(size) && size.length === 2 ? [size[0], size[1]] : [NaN, NaN]
    if (![u, v].every((n) => Number.isInteger(n) && n >= 2 && n <= 1024)) throw new Error(`[oj] ${what} size is ${JSON.stringify(size)}: 2 to 1024 samples a side, or [u, v]`)
    const values = shade.values
    const length = values?.length
    if (length !== u * v) throw new Error(`[oj] ${what}: a ${u} by ${v} shade has ${u * v} values, and this has ${length}`)
    if (values instanceof Uint8Array) return [u, v, values]
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        const x = values[i]
        if (!(x >= 0 && x <= 1)) throw new Error(`[oj] ${what} value ${i} is ${x}: 0 (full sun) to 1 (full shade)`)
        bytes[i] = Math.round(x * 255)
    }
    return [u, v, bytes]
}

function picture(texture: unknown, what: string): void {
    if (texture === null || typeof texture !== "object") throw new Error(`[oj] ${what} is a ${texture === null ? "null" : typeof texture}; give a picture from loadTexture`)
}

function tilingOf(tiling: Tiling | undefined, what: string): [number, number] {
    const t = tiling ?? 1
    const pair: [number, number] = typeof t === "number" ? [t, t] : Array.isArray(t) && t.length === 2 ? [t[0], t[1]] : [NaN, NaN]
    if (!pair.every((n) => typeof n === "number" && n > 0 && Number.isFinite(n))) throw new Error(`[oj] ${what} is ${JSON.stringify(tiling)}; give a number above 0, or [u, v]`)
    return pair
}

function identityOf(texture: Texture): string {
    return textureIdentity(texture) ?? "?"
}

function utf16(text: string): Uint16Array {
    const out = new Uint16Array(text.length)
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
    return out
}

function indexList(list: MeshData["indices"] | undefined): Uint32Array | Uint16Array | null {
    if (list === undefined || list === null) return null
    if (list instanceof Uint32Array || list instanceof Uint16Array) return list
    if (Array.isArray(list)) return Uint32Array.from(list)
    throw new Error(`[oj] scene.mesh: indices are a ${Object.prototype.toString.call(list).slice(8, -1)}; give a Uint32Array, a Uint16Array or an array of numbers`)
}

function rootElement(): any {
    return getCurrentRuntime()?.root ?? globalThis.__root
}

/** Said once: a host without AcquireSceneTexture. */
let saidNoSceneTexture = false
/** Said once: a host without SetSky. */
let saidNoSky = false

type SkyNow = { top: ColorInput, horizon: ColorInput, bottom?: ColorInput, sun: { size: number, glow: number } | false, stars: number }

/** `o` over `was` (or the defaults), every colour parsed so a typo throws before anything changes. */
function nextSky(was: SkyNow | null, o: SkyOptions, d: typeof SCENE_DEFAULTS): SkyNow {
    const base: SkyNow = was ?? { ...d.sky, sun: { ...d.sky.sun } }
    const sun = o.sun === undefined ? base.sun
        : o.sun === false ? false
        : { ...(base.sun || d.sky.sun), ...o.sun }
    const next: SkyNow = { ...base, ...o, sun, stars: o.stars ?? base.stars }
    rgb(next.top, "sky top")
    rgb(next.horizon, "sky horizon")
    if (next.bottom !== undefined) rgb(next.bottom, "sky bottom")
    return next
}

/** Any colour oj takes as the three sRGB floats the bridge takes. `what` names it in the error. */
function rgb(c: ColorInput, what = "colour"): [number, number, number] {
    const [r, g, b] = toRGBA(c, `[oj] scene ${what}`)
    return [r, g, b]
}

type WindNow = { direction: readonly [number, number], strength: number, gust: number }

/** The wind with `o`'s parts in place of `was`'s, refused before anything changes when it is no wind. */
function nextWind(was: WindNow, o: WindOptions | undefined): WindNow {
    const next = { ...was, ...o }
    const [x, z] = next.direction ?? [NaN, NaN]
    if (!Number.isFinite(x) || !Number.isFinite(z) || (x === 0 && z === 0)) throw new Error(`[oj] scene.wind: direction is [${next.direction}], and is the way it blows as [x, z], not both 0`)
    if (!(next.strength >= 0) || !Number.isFinite(next.strength)) throw new Error(`[oj] scene.wind: strength is ${next.strength}, and is 0 or more`)
    if (!(next.gust >= 0 && next.gust <= 1)) throw new Error(`[oj] scene.wind: gust is ${next.gust}, and runs from 0 to 1`)
    return { direction: [x, z], strength: next.strength, gust: next.gust }
}

/** A scatter's range as the bridge takes it, or null for none, checked before anything is made. */
function scatterRange(o: ScatterOptions): [from: number, to: number, fade: number] | null {
    const from = o.from ?? 0, to = o.to ?? Infinity, fade = o.fade ?? 0
    if (typeof from !== "number" || !(from >= 0) || !Number.isFinite(from)) throw new Error(`[oj] scene.scatter: from is ${from}, and is 0 or more metres`)
    if (typeof to !== "number" || !(to > from)) throw new Error(`[oj] scene.scatter: to is ${to}, and is further than from (${from})`)
    if (typeof fade !== "number" || !(fade >= 0) || !Number.isFinite(fade)) throw new Error(`[oj] scene.scatter: fade is ${fade}, and is 0 or more metres`)
    return from === 0 && to === Infinity ? null : [from, to, fade]
}

// models

/**
 * Loads one of this game's .glb files by name, or any URL. A file asked for again
 * while its scene lives shares the first load, so ten components each calling
 * `useModel("ghost.glb")` load it once.
 */
export function loadModel(name: string): Promise<Model> {
    const url = assetUrl(name)
    let loading = loads.get(url)
    if (loading === undefined) {
        const b = bridge()
        const born = generation
        loading = (async () => {
            const id: number = await b.Load(url)
            const clips = String(b.Clips(id)).split("\n").filter((c) => c !== "")
            const model: Model = Object.freeze({ id, clips: Object.freeze(clips), height: Number(b.Height(id)) })
            generationOf.set(model, born)
            modelUrls.set(model, url)
            modelNames.set(model, name)
            return model
        })()
        loads.set(url, loading)
        // Forgotten on failure, so a file added after the first ask still loads.
        const settled = loading
        settled.catch(() => { if (loads.get(url) === settled) loads.delete(url) })
    }
    return loading
}

/**
 * Lets go of a model loadModel holds, so its meshes and textures come back:
 * the next ask loads it again. One with a copy still in the world is kept,
 * since the copies share it, and says so: remove its last actor first. A
 * host whose bridge cannot free one model keeps it until the scene goes, as
 * every model did before.
 */
export async function forgetModel(name: string): Promise<void> {
    const url = assetUrl(name)
    const loading = loads.get(url)
    if (loading === undefined) return
    const model = await loading.catch(() => null)
    if (loads.get(url) !== loading) return
    if (model === null || generationOf.get(model) !== generation) {
        // Failed, or its scene already went and took it along.
        loads.delete(url)
        return
    }
    const b = bridge()
    if (typeof b.Unload !== "function") return
    if (b.Unload(model.id)) loads.delete(url)
    else console.warn(`[oj] ${name} is still in the scene, so it stays loaded. Unload it after its last copy is gone.`)
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
    let watching = true
    loadModel(name).then(
        (model) => { if (watching) loaded(model) },
        (error) => { if (watching) console.error(`[oj] could not load ${name}:`, error) },
    )
    return () => { watching = false }
}

// the scene

/**
 * Sets up the camera and lights, and owns everything spawned through it. Null on
 * the first render, a Scene from then on. Unmounting destroys every actor, light
 * and model, which is also what a hot reload does.
 *
 * Call it once, near the top of the cart, and pass the scene down: a second
 * live scene is an error.
 */
export function useScene(options: SceneOptions = {}): Scene | null {
    const [scene, setScene] = useState<Scene | null>(null)
    useEffect(() => {
        const created = createScene(options)
        setScene(created.scene)
        return created.dispose
        // Read once, on mount, like useWorld: a re-render must not rebuild the world.
        // The scene's methods change it later.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return scene
}

/** The scene without React: what useScene makes on mount and disposes on unmount. */
export function createScene(options: SceneOptions = {}): { scene: Scene, dispose: () => void } {
    const runtime = getCurrentRuntime()
    if (live !== null) {
        // A scene a previous cart left live (its teardown threw before reaching it) is
        // stale, not a second scene: clear it rather than refuse every later cart.
        if (live.runtime !== runtime) live.dispose()
        else throw new Error("[oj] a cart has one 3D scene at a time, and one is already live. Call useScene once, near the top of the cart, and pass the scene to whatever spawns into it.")
    }

    const b = bridge()
    const d = SCENE_DEFAULTS
    const actors: Actor[] = []
    // How fast each actor plays, and whether the scene holds them all.
    const speeds = new Map<number, number>()
    let paused = false
    const rateOf = (id: number) => paused ? 0 : speeds.get(id) ?? 1
    // A fade reports each value it reaches through `at`, so an interrupted one turns back
    // from where the actor is rather than from where it was going.
    const fades = new Map<number, { from: number, to: number, t: number, seconds: number, at: (v: number) => void, done: () => void }>()
    // What scene.bake bakes into: actors spawned static, every live scatter, and not what is drawn as depth alone.
    const statics = new Set<number>()
    const scatters = new Map<number, { model: Model, data: Float32Array, stride: 5 | 10 }>()
    const depthOnly = new WeakSet<Model>()

    // Every colour is parsed before anything is built, so a typo fails without a half-made scene.
    let backgroundColor = options.background ?? d.background
    let sunNow = options.sun === false ? null : { ...d.sun, ...options.sun }
    let ambientNow = { ...d.ambient, ...options.ambient }
    let fogNow = options.fog === undefined || options.fog === false ? null : { ...d.fog, ...options.fog }
    let skyNow = options.sky === undefined || options.sky === false ? null : nextSky(null, options.sky, d)
    let windNow = nextWind(d.wind, options.wind)
    // The wind's clock runs once the scene has a mesh that sways, and holds while it is paused.
    let swaying = false
    let windClock = 0
    rgb(backgroundColor, "background")
    if (sunNow !== null) {
        rgb(sunNow.color, "sun color")
        sunShadowsOf(sunNow.shadows, b)
    }
    rgb(ambientNow.sky, "ambient sky")
    rgb(ambientNow.ground, "ambient ground")
    if (fogNow?.color !== undefined) rgb(fogNow.color, "fog color")

    let cam = { position: vec3(d.camera.position), lookAt: vec3(d.camera.lookAt), fov: d.camera.fov as number }
    const camera = (c: CameraOptions) => {
        cam = {
            position: c.position ? vec3(c.position) : cam.position,
            lookAt: c.lookAt ? vec3(c.lookAt) : cam.lookAt,
            fov: c.fov ?? cam.fov,
        }
        b.SetCamera(...cam.position, ...cam.lookAt, cam.fov)
    }
    const applySun = () => {
        if (sunNow === null) {
            b.SetSun(false, 0, -1, 0, 1, 1, 1, 0, false)
            return
        }
        const shadows = sunShadowsOf(sunNow.shadows, b)
        b.SetSun(true, ...sunNow.direction, ...rgb(sunNow.color), sunNow.intensity, shadows !== null)
        // A host before runtime 1.7 casts them as it ships them, which is what -1 asks for.
        if (shadows === null || typeof b.SetSunShadows !== "function") return
        const problem = String(b.SetSunShadows(...shadows) ?? "")
        if (problem !== "") throw new Error(`[oj] sun shadows: ${problem}`)
    }
    const applyAmbient = () => b.SetAmbient(...rgb(ambientNow.sky), ...rgb(ambientNow.ground), ambientNow.intensity)
    const applyFog = () => {
        if (fogNow === null) b.SetFog(false, 0, 0, 0, 0, 0)
        else b.SetFog(true, ...rgb(fogNow.color ?? skyNow?.horizon ?? backgroundColor), fogNow.near, fogNow.far)
    }
    // An older host has no wind, and nothing that sways in it: only a cart that asked is told.
    const applyWind = (asked: boolean) => {
        if (typeof b.SetWind !== "function") {
            if (asked) console.warn("[oj] scene.wind needs a newer OneJS: this host's ModelBridge has no wind (it came with runtime 1.7), so nothing sways.")
            return
        }
        // nextWind refused all the bridge would, so what it answers is "".
        b.SetWind(windNow.direction[0], windNow.direction[1], windNow.strength, windNow.gust)
    }
    // Nothing is sent for a scene that never has a sky, so an older host hears nothing of it.
    let skySent = false
    const applySky = () => {
        if (skyNow === null && !skySent) return
        if (typeof b.SetSky !== "function") {
            if (!saidNoSky) console.warn("[oj] scene.sky needs a newer OneJS: this host's ModelBridge has no sky (it came after 3.9.18), so the scene keeps its background colour.")
            saidNoSky = true
            return
        }
        skySent = true
        if (skyNow === null) { b.SetSky(false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); return }
        const sun = skyNow.sun
        b.SetSky(true, ...rgb(skyNow.top), ...rgb(skyNow.horizon), ...rgb(skyNow.bottom ?? skyNow.horizon),
            sun ? sun.size : 0, sun ? sun.glow : 0, skyNow.stars)
    }

    b.BeginScene()
    camera(options.camera ?? {})
    applySun()
    applyAmbient()
    b.SetBackground(...rgb(backgroundColor))
    applyFog()
    applySky()
    applyWind(options.wind !== undefined)

    // Animation updates itself in play mode; the edit-mode preview has to step it.
    const preview = globalThis.__isPlaying === false
    const stopFrame = runtime?.onFrame((dt: number) => {
        if (preview && actors.length > 0) b.Step(dt)
        if (swaying) {
            if (!paused) windClock += dt
            b.SetWindClock(windClock)
        }
        for (const [id, f] of fades) {
            f.t = Math.min(f.seconds, f.t + dt * rateOf(id))
            const k = f.seconds > 0 ? f.t / f.seconds : 1
            const value = f.from + (f.to - f.from) * k
            b.SetDissolve(id, value)
            f.at(value)
            if (k >= 1) { fades.delete(id); f.done() }
        }
    })

    const spawn = (model: Model, o: SpawnOptions = {}): Actor => {
        if (generationOf.get(model) !== generation) {
            throw new Error("[oj] this model was loaded for a scene that is gone. Load it again with useModel once the scene is live, or keep useModel in the component that lives as long as the scene.")
        }
        let position = vec3(o.position ?? [0, 0, 0])
        let rotation: Readonly<Rotation> = Object.freeze({ yaw: o.rotation?.yaw ?? o.yaw ?? 0, pitch: o.rotation?.pitch ?? 0, roll: o.rotation?.roll ?? 0 })
        let scale = o.scale ?? 1
        let cast = o.castShadows ?? true
        let receive = o.receiveShadows ?? true
        let dissolved = 0
        const id: number = b.Spawn(model.id, ...position, rotation.yaw, scale, cast, receive)
        if (o.static === true) statics.add(id)
        if (rotation.pitch !== 0 || rotation.roll !== 0) b.SetRotation(id, rotation.yaw, rotation.pitch, rotation.roll)
        speeds.set(id, o.speed ?? 1)
        if (rateOf(id) !== 1) b.SetSpeed(id, rateOf(id))
        const turn = (next: Partial<Rotation>) => {
            rotation = Object.freeze({ yaw: next.yaw ?? 0, pitch: next.pitch ?? 0, roll: next.roll ?? 0 })
            b.SetRotation(id, rotation.yaw, rotation.pitch, rotation.roll)
        }
        const actor: Actor = {
            id, model,
            get position() { return position },
            set position(p: Vec3) { position = vec3(p); b.Move(id, position[0], position[1], position[2]) },
            get rotation(): Readonly<Rotation> { return rotation },
            set rotation(r: Partial<Rotation>) { turn(r) },
            get yaw() { return rotation.yaw },
            set yaw(y: number) { turn({ ...rotation, yaw: y }) },
            get scale() { return scale },
            set scale(s: number) { scale = s; b.SetScale(id, s) },
            get speed() { return speeds.get(id) ?? 1 },
            set speed(s: number) { speeds.set(id, s); b.SetSpeed(id, rateOf(id)) },
            get castShadows() { return cast },
            set castShadows(on: boolean) { cast = on; b.SetShadows(id, cast, receive) },
            get receiveShadows() { return receive },
            set receiveShadows(on: boolean) { receive = on; b.SetShadows(id, cast, receive) },
            play(clip, po = {}) {
                if (!b.Play(id, clip, po.loop ?? true, po.fade ?? 0.15)) {
                    console.warn(`[oj] ${clip} is not one of this model's clips: ${model.clips.join(", ")}`)
                }
            },
            dissolve({ to = 1, seconds = 0.8 }: DissolveOptions = {}) {
                return new Promise<void>((done) => {
                    fades.get(id)?.done()
                    fades.set(id, { from: dissolved, to, t: 0, seconds, at: (v) => { dissolved = v }, done })
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
                speeds.delete(id)
                statics.delete(id)
                const i = actors.indexOf(actor)
                if (i >= 0) actors.splice(i, 1)
                b.Destroy(id)
            },
        }
        placed.set(actor, (p, r) => {
            position = p
            if (r !== null) rotation = r
        })
        actors.push(actor)
        if (o.play) actor.play(o.play, { fade: 0 })
        return actor
    }

    const mesh = (o: MeshModelOptions, draw: MeshDrawOptions = {}): MeshModel => {
        if (typeof b.CreateMesh !== "function") {
            throw new Error("[oj] scene.mesh needs a newer OneJS: this host's ModelBridge cannot make a model from arrays (CreateMesh came after 3.9.18).")
        }
        if (draw.depthOnly === true && typeof b.SetDepthOnly !== "function") {
            throw new Error("[oj] scene.mesh depthOnly needs a newer OneJS: this host's ModelBridge cannot draw a mesh as depth alone (SetDepthOnly came after 3.9.18).")
        }
        const color = toRGBA(o.color ?? "#ffffff", "[oj] scene.mesh color")
        const look = meshLook(o, draw, b)
        if (o.cutout !== undefined) {
            if (typeof o.cutout !== "number" || !(o.cutout >= 0 && o.cutout <= 1)) throw new Error(`[oj] scene.mesh: cutout is ${o.cutout}, and runs from 0 to 1`)
            if (look.splat !== null) throw new Error("[oj] scene.mesh: a splat has no alpha to cut out. Give cutout with a texture or vertex colours.")
        }
        if (o.twoSided !== undefined && typeof o.twoSided !== "boolean") throw new Error(`[oj] scene.mesh: twoSided is ${o.twoSided}, and is true or false`)
        const shade = o.shade === undefined ? null : shadeOf(o.shade, "scene.mesh shade")
        if (shade !== null) {
            if (typeof b.SetMeshShade !== "function") throw new Error("[oj] scene.mesh shade needs a newer OneJS: this host's ModelBridge cannot shade a mesh (it came with runtime 1.7).")
            if (o.uvs === undefined) throw new Error("[oj] scene.mesh shade: a shade is read at the mesh's uvs, and it has none. Give uvs, two numbers a vertex.")
            if (draw.depthOnly === true) throw new Error("[oj] scene.mesh shade: a depthOnly mesh draws no colour, so it has nothing to show a shade on.")
        }
        const sways = o.sway !== undefined
        for (const [given, method, what] of [[o.cutout !== undefined, "SetMeshCutout", "cutout"], [o.twoSided === true, "SetMeshTwoSided", "twoSided"], [sways, "SetMeshSway", "sway"]] as const) {
            if (given && typeof b[method] !== "function") throw new Error(`[oj] scene.mesh ${what} needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.7).`)
        }
        // The streams a model is made with are its streams for good.
        const normals = o.normals !== undefined, colors = o.colors !== undefined, uvs = o.uvs !== undefined
        let latest: { positions: Float32Array, indices: Uint32Array | Uint16Array, colors: Float32Array | null, weights: Float32Array | null } | null = null
        const write = (d: MeshVertices, weights: Numbers | undefined, sway: Numbers | undefined, what: string) => {
            const positions = floats(d.positions, "positions", 3)
            if (positions === null) throw new Error(`[oj] ${what}: positions are required`)
            const indices = indexList(d.indices)
            const vertexColors = floats(d.colors, "colors", 1)
            if (weights !== undefined && look.splat === null) throw new Error(`[oj] ${what}: weights paint a splat, and this mesh was made without one`)
            const splatWeights = look.splat === null ? null : floats(weights, "weights", look.splat.layers.length)
            if (sway !== undefined && !sways) throw new Error(`[oj] ${what}: sway moves a mesh made with it, and this one was made without`)
            const swayed = sways ? floats(sway, "sway", 1) : null
            const streams = [id, positions, indices, floats(d.normals, "normals", 3), vertexColors, floats(d.uvs, "uvs", 2)]
            // Six arguments to a mesh without a splat or sway, as every OneJS before them takes.
            const problem = String(sways ? b.SetMesh(...streams, splatWeights, swayed) : look.splat === null ? b.SetMesh(...streams) : b.SetMesh(...streams, splatWeights))
            if (problem !== "") throw new Error(`[oj] ${what}: ${problem}`)
            latest = { positions, indices: indices ?? latest!.indices, colors: vertexColors ?? latest?.colors ?? null, weights: splatWeights ?? latest?.weights ?? null }
        }
        const id: number = b.CreateMesh(normals, colors, uvs, ...color)
        try {
            if (draw.depthOnly === true && !b.SetDepthOnly(id)) {
                throw new Error("[oj] scene.mesh depthOnly: this host draws models with a renderer that cannot write depth without colour (HDRP), so it would be seen.")
            }
            // Before the vertices: a splat adds its weights to them.
            if (look.splat !== null) {
                const l = look.splat.layers
                const problem = String(b.SetMeshSplat(id, l[0], l[1] ?? null, l[2] ?? null, l[3] ?? null, ...look.splat.tiling, look.splat.heightBlend))
                if (problem !== "") throw new Error(`[oj] scene.mesh splat: ${problem}`)
                const t = look.splat.triplanar
                if (t.some((m) => m > 0)) {
                    const projected = String(b.SetMeshSplatTriplanar(id, t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, t[3] ?? 0))
                    if (projected !== "") throw new Error(`[oj] scene.mesh splat triplanar: ${projected}`)
                }
            }
            if (look.texture !== null) {
                const problem = String(b.SetMeshTexture(id, look.texture.texture, ...look.texture.tiling))
                if (problem !== "") throw new Error(`[oj] scene.mesh texture: ${problem}`)
            }
            // After the splat, whose material they are set on, and before the vertices: sway adds a stream to them.
            const looks: [boolean, () => unknown, string][] = [
                [o.cutout !== undefined, () => b.SetMeshCutout(id, o.cutout), "cutout"],
                [o.twoSided === true, () => b.SetMeshTwoSided(id), "twoSided"],
                [sways, () => b.SetMeshSway(id), "sway"],
            ]
            for (const [given, apply, what] of looks) {
                if (!given) continue
                const problem = String(apply())
                if (problem !== "") throw new Error(`[oj] scene.mesh ${what}: ${problem}`)
            }
            if (shade !== null) {
                const problem = String(b.SetMeshShade(id, ...shade))
                if (problem !== "") throw new Error(`[oj] scene.mesh shade: ${problem}`)
            }
            write(o, o.splat?.weights, o.sway, "scene.mesh")
        } catch (e) {
            b.Unload(id)
            throw e
        }
        // A new shade from mesh.set, or none for null.
        const setShade = (next: MeshShade | null) => {
            if (typeof b.SetMeshShade !== "function") throw new Error("[oj] mesh.set shade needs a newer OneJS: this host's ModelBridge cannot shade a mesh (it came with runtime 1.7).")
            if (next !== null && !uvs) throw new Error("[oj] mesh.set shade: a shade is read at the mesh's uvs, and this mesh was made without. Make it with uvs.")
            const problem = String(next === null ? b.SetMeshShade(id, 0, 0, null) : b.SetMeshShade(id, ...shadeOf(next, "mesh.set shade")))
            if (problem !== "") throw new Error(`[oj] mesh.set shade: ${problem}`)
        }
        const made = {
            collider: false,
            triangles: () => ({
                vertices: latest!.positions.slice(),
                indices: latest!.indices instanceof Uint32Array ? latest!.indices.slice() : Uint32Array.from(latest!.indices),
            }),
        }
        const model: MeshModel = Object.freeze({
            id,
            clips: Object.freeze([]) as readonly string[],
            get height() { return Number(b.Height(id)) },
            set(d: MeshUpdate) {
                if (generationOf.get(model) !== generation) throw new Error("[oj] this mesh was made for a scene that is gone. Make it again with scene.mesh once the scene is live.")
                if (d.shade !== undefined) setShade(d.shade)
                if (!("positions" in d) && d.shade !== undefined) return
                if (made.collider) throw new Error("[oj] this mesh is a physics collider, which keeps the shape it was made with. Draw what moves with a second scene.mesh, and leave the collider as it is.")
                const v = d as MeshVertices
                write(v, v.weights, v.sway, "mesh.set")
                // Its unwrap was of the old triangles; OneJS drew it unbaked as it took the new ones.
                baker.forget(model)
            },
            destroy() {
                if (generationOf.get(model) !== generation) return
                if (!b.Unload(id)) console.warn("[oj] this mesh is still in the scene, so it stays. Destroy its actors first.")
            },
        })
        generationOf.set(model, generation)
        arrayModels.set(model, made)
        meshBytes.set(model, () => {
            // Its colour, then its streams, each after its length: what its light depends on. A
            // textured or painted mesh adds what it was painted with, since the bake bounces it.
            const parts: ArrayBufferView[] = [new Float32Array(color), latest!.positions, latest!.indices, latest!.colors ?? new Float32Array(0)]
            if (look.fingerprint !== "") parts.push(utf16(look.fingerprint), latest!.weights ?? new Float32Array(0))
            const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.byteLength, 0))
            const view = new DataView(out.buffer)
            let at = 0
            for (const p of parts) {
                view.setUint32(at, p.byteLength, true)
                out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at + 4)
                at += 4 + p.byteLength
            }
            return out
        })
        if (draw.depthOnly === true) depthOnly.add(model)
        if (sways) swaying = true
        return model
    }

    const scatter = (model: Model, copies: readonly ScatterCopy[] | Float32Array, options: ScatterOptions = {}): Scatter => {
        if (generationOf.get(model) !== generation) {
            throw new Error("[oj] scene.scatter: this model was made for a scene that is gone. Load it again once the scene is live.")
        }
        if (typeof b.Scatter !== "function") {
            throw new Error("[oj] scene.scatter needs a newer OneJS: this host's ModelBridge has no Scatter (it came after 3.9.18).")
        }
        if (options.stride !== undefined && options.stride !== 5 && options.stride !== 10) throw new Error(`[oj] scene.scatter: stride is ${options.stride}, and is 5 (x, y, z, yaw, scale) or 10 (x, y, z, yaw, pitch, roll, scale, r, g, b)`)
        const range = scatterRange(options)
        let data: Float32Array
        let stride: 5 | 10
        if (copies instanceof Float32Array) {
            stride = options.stride ?? 5
            if (copies.length % stride !== 0) {
                throw new Error(stride === 5
                    ? `[oj] scene.scatter: a Float32Array of copies is five numbers a copy (x, y, z, yaw, scale), and this one has ${copies.length}. Ten a copy, with pitch, roll and a tint, take { stride: 10 }.`
                    : `[oj] scene.scatter: with { stride: 10 } a copy is ten numbers (x, y, z, yaw, pitch, roll, scale, r, g, b), and this Float32Array has ${copies.length}`)
            }
            data = copies
        } else if (Array.isArray(copies)) {
            // Ten a copy when any copy is tilted or tinted, so a list of { x, z } crosses as it always did.
            stride = options.stride ?? (copies.some((c) => c?.pitch !== undefined || c?.roll !== undefined || c?.tint !== undefined) ? 10 : 5)
            data = new Float32Array(copies.length * stride)
            for (let i = 0, at = 0; i < copies.length; i++, at += stride) {
                const c = copies[i]!
                if (typeof c?.x !== "number" || typeof c?.z !== "number") throw new Error(`[oj] scene.scatter: copy ${i} needs an x and a z`)
                data[at] = c.x
                data[at + 1] = c.y ?? 0
                data[at + 2] = c.z
                data[at + 3] = c.yaw ?? 0
                if (stride === 5) {
                    data[at + 4] = c.scale ?? 1
                    continue
                }
                data[at + 4] = c.pitch ?? 0
                data[at + 5] = c.roll ?? 0
                data[at + 6] = c.scale ?? 1
                const [r, g, bl] = c.tint === undefined ? [1, 1, 1] : rgb(c.tint, `scatter copy ${i} tint`)
                data[at + 7] = r
                data[at + 8] = g
                data[at + 9] = bl
            }
        } else {
            throw new Error("[oj] scene.scatter: copies are a list of { x, z } or a Float32Array, five numbers a copy")
        }
        if ((stride === 10 || range !== null) && typeof b.ScatterWith !== "function") {
            throw new Error(`[oj] scene.scatter ${stride === 10 ? "pitch, roll and tint" : "from, to and fade"} need a newer OneJS: this host's ModelBridge has no ScatterWith (it came with runtime 1.7).`)
        }
        const id: number = stride === 5 && range === null ? b.Scatter(model.id, data) : b.ScatterWith(model.id, data, stride, ...(range ?? [0, Infinity, 0]))
        if (id === 0) throw new Error("[oj] scene.scatter: this model has a skinned mesh, and scattered copies never move. Spawn it instead.")
        const born = generation
        let alive = true
        // Kept as given: the copies are baked from these numbers, so a cart reusing its array cannot move them.
        scatters.set(id, { model, data: data.slice(), stride })
        return Object.freeze({
            count: data.length / stride,
            destroy() {
                if (!alive || born !== generation) return
                alive = false
                scatters.delete(id)
                b.DestroyScatter(id)
            },
        })
    }

    // Readers this scene counted, so a release after the scene is gone, or one
    // too many, never takes a reader from the next scene.
    let readers = 0
    const texture: SceneTexture = Object.freeze({
        [LENT_TEXTURE]: true as const,
        acquire() {
            if (disposed) return null
            if (typeof b.AcquireSceneTexture !== "function") {
                if (!saidNoSceneTexture) console.warn("[oj] scene.texture needs a newer OneJS: this host's ModelBridge cannot draw the scene into a texture (it came after 3.9.18), so the program reads nothing.")
                saidNoSceneTexture = true
                return null
            }
            readers++
            return b.AcquireSceneTexture()
        },
        release() {
            if (disposed || readers === 0) return
            readers--
            b.ReleaseSceneTexture()
        },
    })

    const pointLight = (o: PointLightOptions): PointLight => {
        let position = vec3(o.position)
        let color = o.color ?? d.pointLight.color
        let intensity = o.intensity ?? d.pointLight.intensity
        let range = o.range ?? d.pointLight.range
        const id: number = b.AddPointLight(...position, ...rgb(color, "point light color"), intensity, range)
        const retune = () => b.SetLight(id, ...rgb(color), intensity, range)
        return {
            id,
            get position() { return position },
            set position(p: Vec3) { position = vec3(p); b.PlaceLight(id, ...position) },
            get color() { return color },
            set color(c: ColorInput) { rgb(c, "point light color"); color = c; retune() },
            get intensity() { return intensity },
            set intensity(i: number) { intensity = i; retune() },
            get range() { return range },
            set range(r: number) { range = r; retune() },
            destroy() { b.DestroyLight(id) },
        }
    }

    /**
     * Every frame until stopped: the runtime's frames, or the host's own
     * outside a container. The callback gets the real interval that ended
     * with the frame, in ms, or null where there is none yet.
     */
    const everyFrame = (callback: (intervalMs: number | null) => void): (() => void) => {
        if (runtime) return runtime.onFrame((_dt, realDt) => callback(realDt * 1000))
        let on = true
        let last: number | null = null
        const loop = (now: number) => {
            if (!on) return
            callback(last === null ? null : now - last)
            last = now
            if (on) globalThis.requestAnimationFrame(loop)
        }
        globalThis.requestAnimationFrame(loop)
        return () => { on = false }
    }

    const bakeItems = (): BakeItem[] => {
        const still = stillActors()
        const items: BakeItem[] = []
        for (const a of actors) {
            if ((statics.has(a.id) || still.has(a)) && !depthOnly.has(a.model)) {
                items.push({ model: a.model, position: a.position, rotation: a.rotation, scale: a.scale, actor: a.id })
            }
        }
        for (const [id, s] of scatters) {
            if (depthOnly.has(s.model)) continue
            const d = s.data, tilted = s.stride === 10
            for (let i = 0, at = 0; at < d.length; i++, at += s.stride) {
                const rotation = { yaw: d[at + 3]!, pitch: tilted ? d[at + 4]! : 0, roll: tilted ? d[at + 5]! : 0 }
                items.push({ model: s.model, position: [d[at]!, d[at + 1]!, d[at + 2]!], rotation, scale: d[at + (tilted ? 6 : 4)]!, copy: [id, i] })
            }
        }
        return items
    }

    // A file model's hash, read once a scene where the build's file map does not carry it.
    const fileShas = new Map<Model, Promise<string>>()
    const identify = async (model: Model): Promise<{ name: string, sha: string }> => {
        const name = modelNames.get(model)
        if (name === undefined) return { name: "scene.mesh", sha: await sha256(meshBytes.get(model)?.() ?? new Uint8Array(0), b) }
        const mapped = assetInfo(name)?.sha256
        if (mapped !== undefined) return { name, sha: mapped }
        let sha = fileShas.get(model)
        if (sha === undefined) {
            // On disk, OneJS hashes the file where it is; elsewhere its bytes come to the host's digest.
            const file = assetFile(name)
            sha = file !== null && typeof b.FileSha256 === "function"
                ? Promise.resolve().then(() => String(b.FileSha256(file)))
                : loadAssetBytes(name).then((bytes) => sha256(bytes, b))
            fileShas.set(model, sha)
        }
        return { name, sha: await sha }
    }

    const baker = sceneBaker({
        bridge: b,
        items: bakeItems,
        identify,
        lights: () => ({
            sun: sunNow === null ? null : { direction: sunNow.direction, color: rgb(sunNow.color), intensity: sunNow.intensity },
            ambient: { sky: scaled(ambientNow.sky), ground: scaled(ambientNow.ground) },
        }),
        everyFrame,
        disposed: () => disposed,
    })
    const scaled = (c: ColorInput) => rgb(c).map((x) => x * ambientNow.intensity) as [number, number, number]

    const scene: Scene = {
        spawn,
        mesh,
        scatter,
        texture,
        pointLight,
        bake: baker.bake,
        clearLight: baker.clearLight,
        pick(x, y) {
            const id = b.Pick(rootElement(), x, y)
            return actors.find((a) => a.id === id) ?? null
        },
        camera,
        sun(o) {
            const next = o === false ? null : { ...(sunNow ?? d.sun), ...o }
            if (next !== null) {
                rgb(next.color, "sun color")
                sunShadowsOf(next.shadows, b)
            }
            sunNow = next
            applySun()
        },
        ambient(o) {
            const next = { ...ambientNow, ...o }
            rgb(next.sky, "ambient sky")
            rgb(next.ground, "ambient ground")
            ambientNow = next
            applyAmbient()
        },
        background(color) {
            const parsed = rgb(color, "background")
            backgroundColor = color
            b.SetBackground(...parsed)
            // Fog with no colour of its own is the background's, so it follows.
            if (fogNow !== null && fogNow.color === undefined) applyFog()
        },
        fog(o) {
            const next = o === false ? null : { ...(fogNow ?? d.fog), ...o }
            if (next?.color !== undefined) rgb(next.color, "fog color")
            fogNow = next
            applyFog()
        },
        wind(o) {
            windNow = nextWind(windNow, o)
            applyWind(true)
        },
        sky(o = {}) {
            skyNow = o === false ? null : nextSky(skyNow, o, d)
            applySky()
            // Fog with no colour of its own is the sky's horizon, so it follows.
            if (fogNow !== null && fogNow.color === undefined) applyFog()
        },
        get paused() { return paused },
        set paused(on: boolean) {
            if (on === paused) return
            paused = on
            for (const a of actors) b.SetSpeed(a.id, rateOf(a.id))
        },
        // A copy, so `for (const a of scene.actors) a.destroy()` reaches every actor.
        get actors() { return actors.slice() },
    }
    let disposed = false
    const dispose = () => {
        if (disposed) return
        disposed = true
        stopFrame?.()
        baker.dispose()
        for (const f of fades.values()) f.done()
        fades.clear()
        actors.length = 0
        speeds.clear()
        generation++
        loads.clear()
        b.DisposeAll()
        if (live?.dispose === dispose) setLive(null)
    }
    setLive({ dispose, runtime })
    return { scene, dispose }
}
