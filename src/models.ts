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
    /**
     * Metres from the camera past which the layers are read blurrier, until a
     * repeat far off draws its picture's mean colour rather than its motif in a
     * grid across a far slope: two mips coarser each time the distance doubles.
     * 60 by default; 0 keeps every layer's detail however far. No extra reads.
     */
    fadeDistance?: number
    /**
     * How much the ground's brightness varies across the world, either way, in
     * patches about 40 m and 160 m across, so a stretch of ground is not one even
     * shade repeat after repeat. 0.15 by default, 0 for none, up to 1. No extra reads.
     */
    variation?: number
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
     *
     * Or a tree's sway in layers, each one a vertex (`SwayLayers`): the trunk
     * bends, a limb swings, and a leaf flutters, each on its own beat. From
     * runtime 1.8.
     */
    sway?: Numbers | SwayLayers
    /**
     * How rough its surface is, from 0 to 1: 1 by default, which spreads the
     * sun's highlight too wide to see. Water or a wet road is about 0.15, a
     * worn metal 0.4. A see-through mesh's highlight is scaled by its alpha.
     * Settable after, as `mesh.roughness`.
     */
    roughness?: number
    /**
     * How metallic it is, from 0 to 1: 0 by default. A metal takes its colour
     * from what it reflects rather than from the light it scatters, so a
     * metallic mesh is darker than a plain one under the same sun. Settable
     * after, as `mesh.metallic`.
     */
    metallic?: number
    /**
     * How far the sun's light reaches round past where the surface turns away
     * from it, from 0 to 1: 0 by default, a hard shadow line. A leaf, moss or
     * skin lets light in past it, so a crown's cards turned from the sun stay
     * lit; about 0.5 for leaves. The sun only. Not with a splat. URP only.
     * Settable after, as `mesh.wrap`.
     */
    wrap?: number
    /**
     * How much of the sun shows through from behind, toward the eye, tinted by
     * the surface's colour, from 0 to 1: 0 by default. A leaf seen against the
     * sun glows; give it with `twoSided` and `cutout` for leaf cards. The sun
     * only. Not with a splat. URP only. Settable after, as `mesh.backLight`.
     */
    backLight?: number
    /**
     * The colour the sun shows through in, over the surface's own: white by
     * default. A yellow green such as `"#e6ff33"` is a leaf's. Settable after,
     * as `mesh.backLightColor`.
     */
    backLightColor?: ColorInput
    /**
     * How tightly the back light gathers round the line to the sun, from 1
     * to 16: 4 by default, a broad glow; 8 a tight one. Settable after, as
     * `mesh.backLightFocus`.
     */
    backLightFocus?: number
    /**
     * `[start, end]`: dithers a face away as it turns edge on to the eye, by
     * how squarely the triangle itself meets it (0 edge on, 1 face on), whole
     * above `end` and gone below `start`. A crown of leaf cards then shows no
     * dark lines where cards turn side on: about `[0.15, 0.35]`. By the
     * triangles, not the normals given. In the camera's view, not the
     * shadow's. Not with a splat. URP only. Settable after, as `mesh.edgeFade`,
     * and `[0, 0]` takes it off.
     */
    edgeFade?: [number, number]
    /**
     * Metres over which a see-through mesh fades out where the world behind it
     * comes near: a lake's shore fades per pixel instead of ending on the
     * triangle where the water meets the beach, and mist thins where it lies
     * on a field. Only on a mesh whose `color` has an alpha below 1, and not
     * with a cutout or depthOnly. URP only.
     */
    soften?: number
    /**
     * The colour a see-through mesh takes, alpha and all, where it is deep:
     * from its own colour at the surface to this one `metres` in (95% there),
     * along each pixel's ray, so a grazing look through shallow water counts
     * the long path it is. Lit like the rest of the mesh. Same limits as `soften`.
     */
    deepColor?: { color: ColorInput, metres: number }
    /** A picture that bends the light across the mesh: ripples, a road's grain, lava's crust. Needs `uvs`. URP only. */
    normalMap?: MeshNormalMap
}

/**
 * A normal map, from `loadTexture` or `tex`'s `normalMap()`, read as the data
 * it is. `scene.mesh({ ...plane, uvs, roughness: 0.15, normalMap: { picture:
 * waves, tiling: 0.25, scale: 0.6, flow: [0.03, 0.01] } })` is water. The
 * picture should tile seamlessly, since it repeats.
 */
export interface MeshNormalMap {
    picture: Texture
    /** How often it repeats across a uv of 0 to 1, its own, not the texture's. 1 by default. */
    tiling?: Tiling
    /** How far it bends the light, glTF's normal scale: 0 flat, 1 as drawn. 1 by default. */
    scale?: number
    /**
     * `[u, v]` uvs a second it slides by the scene's clock, before its tiling:
     * with uvs in metres, metres a second. Stands still while the scene is
     * paused. `[0, 0]` by default.
     */
    flow?: [number, number]
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
export type MeshUpdate = Pick<MeshData, "positions"> & Partial<Omit<MeshData, "positions">> & {
    /** A splat's new weights, one a layer a vertex: a path worn into the grass. */
    weights?: Numbers
    /** New sway, one a vertex, for a model made with `sway`, in the form it was made with. */
    sway?: Numbers | SwayLayers
}

/**
 * A tree's sway in layers, each one a vertex in the model's own units at a
 * wind strength of 1, and each 0 where it is left out. `scene.mesh({ ...tree,
 * sway: { trunk, limb, leaf, phase } })`.
 */
export interface SwayLayers {
    /**
     * How far the trunk bends it downwind: 0 at the foot, growing up the
     * trunk. A bent trunk keeps its length, so its crown sinks a little as it
     * leans, and a gust is a patch blowing across the ground, not one swell.
     */
    trunk?: Numbers
    /** How far a limb swings it, at a quicker beat than the trunk: 0 where a limb meets the trunk, more toward its tip. */
    limb?: Numbers
    /** How far a leaf flutters it along its normal, quicker still: a card's outer corners, with its stem at 0. */
    leaf?: Numbers
    /**
     * Its limb's place in the limb's beat, in turns, 0 to 1, held to 256ths
     * of a turn: the same number over one limb's wood and every card hung on
     * it moves them together, and a different one sets the next limb out of
     * step. Give a card the trunk and limb of the wood where it hangs, and
     * its root moves as that wood does.
     */
    phase?: Numbers
    /**
     * Its card's place in the leaf's beat, in turns, 0 to 1: the same number
     * over one card's corners flutters it whole, and a different one on the
     * next card sets it apart. 0 on wood.
     */
    leafPhase?: Numbers
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
    /**
     * Its colour, as given at creation until set: every actor and scattered
     * copy of it changes at once, for nothing a frame. An alpha that crosses 1
     * moves it between opaque and see-through; a cutout or depthOnly mesh
     * draws as it did. A baked light keeps the colour it was baked with.
     */
    color: ColorInput
    /** Its roughness, from 0 to 1, as `scene.mesh` took it. Every copy changes at once. */
    roughness: number
    /** Its metallic, from 0 to 1, as `scene.mesh` took it. Every copy changes at once. */
    metallic: number
    /** How far the sun's light wraps round it, from 0 to 1, as `scene.mesh` took it. Every copy changes at once. */
    wrap: number
    /** How much of the sun shows through it from behind, from 0 to 1, as `scene.mesh` took it. Every copy changes at once. */
    backLight: number
    /** The colour the sun shows through in, as `scene.mesh` took it. */
    backLightColor: ColorInput
    /** How tightly the back light gathers, from 1 to 16, as `scene.mesh` took it. */
    backLightFocus: number
    /** Where its faces fade as they turn edge on, `[0, 0]` for not at all. */
    edgeFade: [number, number]
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
    /** Whether the copies cast shadows. On by default; a far scatter past the shadows' reach gains nothing by casting. */
    castShadows?: boolean
    /** Whether shadows fall on the copies. On by default. */
    receiveShadows?: boolean
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
    /** Whether the copies cast shadows. Settable. */
    castShadows: boolean
    /** Whether shadows fall on the copies. Settable. */
    receiveShadows: boolean
    /**
     * False skips every draw of the copies, shadows included, until it is set
     * true again: a batch out of view or range is hidden for nothing and
     * shown again without being made again. True by default.
     */
    visible: boolean
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

/**
 * What shiny surfaces reflect. `"sky"`: a mesh or a model with a low `roughness` shows the
 * scene's sky, its gradient, the sun's glow and the fog's haze the way it faces, a mirror sharply
 * and a rough surface barely. `false`, the default, keeps the look every scene had before: one
 * flat colour, the ambient's average, in every direction. `"world"`, the world around a surface,
 * is not built yet.
 */
export type Reflections = "sky" | false

/**
 * Fog over the world, in the sky's horizon colour or else the background's unless given one.
 * It starts `near` metres from the camera in every mode.
 */
export interface FogOptions {
    color?: ColorInput
    near?: number
    /** Where linear fog is whole. Exp and exp2 have no end, and keep it for a return to linear. */
    far?: number
    /**
     * `"linear"`, the default, ramps from `near` to `far`. `"exp"` and `"exp2"` thicken without
     * end by `density` along each pixel's ray, exp2 holding the near ground clearer and closing
     * in harder: the share of fog `d` metres past `near` is `1 - exp(-density * d)`, squared
     * inside the exponent for exp2.
     */
    mode?: "linear" | "exp" | "exp2"
    /** Exp and exp2, a metre. Unless given, what makes the fog 95% whole at `far`, as linear is whole there. */
    density?: number
    /**
     * Exp and exp2 only: height fog, thick in valleys and thin on the ridges and in the sky
     * above them, `false` for none. Its density is `density` at `base` metres up and falls by
     * e every `thickness` metres above (rises below), and the sky takes the haze along each
     * ray to infinity, so the land and the sky meet in one colour.
     */
    height?: FogHeight | false
}

/** Where height fog's density is `density` (`base`, metres up), and the metres it takes to fall by e. */
export interface FogHeight {
    base?: number
    thickness?: number
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
    /** What shiny surfaces reflect: `false`, the ambient's flat colour, unless given `"sky"`. */
    reflections?: Reflections
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
     * What shiny surfaces reflect. `"sky"` shows the scene's sky in them while it has one;
     * `false`, the default, is the ambient's flat colour, as scenes had before runtime 1.8.
     *
     *     scene.reflections = "sky"
     */
    reflections: Reflections
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
    fog: { near: 10, far: 40, mode: "linear" as const },
    wind: { direction: [1, 0] as [number, number], strength: 1, gust: 0.3 },
    sky: { top: "#2f6fd6", horizon: "#cfe6f7", sun: { size: 2, glow: 12 }, stars: 0 },
    reflections: false as Reflections,
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
    splat: { layers: readonly Texture[], triplanar: readonly number[], tiling: [number, number], heightBlend: number, far: { fadeDistance: number, variation: number } | null } | null
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
    const fadeDistance = s.fadeDistance ?? FAR_DEFAULTS.fadeDistance
    if (typeof fadeDistance !== "number" || !(fadeDistance >= 0) || !Number.isFinite(fadeDistance)) {
        throw new Error(`[oj] scene.mesh splat: fadeDistance is ${fadeDistance}, the metres from the camera past which the layers blur, or 0 for none`)
    }
    const variation = s.variation ?? FAR_DEFAULTS.variation
    if (typeof variation !== "number" || !(variation >= 0 && variation <= 1)) throw new Error(`[oj] scene.mesh splat: variation is ${variation}, and runs from 0 (an even shade) to 1`)
    // A OneJS from before them draws the ground as it always has, unless the cart asked for them by name.
    const canFar = typeof b.SetMeshSplatFar === "function"
    if (!canFar && (s.fadeDistance !== undefined || s.variation !== undefined)) {
        throw new Error("[oj] scene.mesh splat fadeDistance and variation need a newer OneJS: this host's ModelBridge cannot fade a splat (it came with runtime 1.8).")
    }
    return {
        texture: null,
        splat: { layers, triplanar, tiling, heightBlend, far: canFar ? { fadeDistance, variation } : null },
        fingerprint: `splat ${layers.map(identityOf).join(" ")} ${tiling.join(" ")} ${heightBlend}` + (triplanar.some((m) => m > 0) ? ` triplanar ${triplanar.join(" ")}` : ""),
    }
}

/** What a splat's `fadeDistance` and `variation` are when a cart leaves them out. */
const FAR_DEFAULTS = { fadeDistance: 60, variation: 0.15 }

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
/** Said once: a host without SetSkyReflect. */
let saidNoSkyReflect = false

/** `v` if the bridge can draw it; it throws for anything else, before anything changes. */
function checkReflections(v: unknown): Reflections {
    if (v === "sky" || v === false) return v
    if (v === "world") throw new Error("[oj] scene.reflections \"world\" is not available yet: only \"sky\" is, from runtime 1.8.")
    throw new Error(`[oj] scene.reflections takes "sky" or false, not ${JSON.stringify(v)}.`)
}

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

/** What a height fog's parts are when left out: the sea's level, and e every 50 m. */
const FOG_HEIGHT = { base: 0, thickness: 50 }

type FogNow = {
    color?: ColorInput
    near: number
    far: number
    mode: "linear" | "exp" | "exp2"
    density?: number
    height: { base: number, thickness: number } | null
}

/** The fog with `o`'s parts in place of `was`'s, refused before anything changes when it cannot be drawn. */
function nextFog(was: FogNow | null, o: FogOptions, d: typeof SCENE_DEFAULTS): FogNow {
    const base: FogNow = was ?? { near: d.fog.near, far: d.fog.far, mode: d.fog.mode, height: null }
    const height = o.height === undefined ? base.height
        : o.height === false ? null
        : { ...(base.height ?? FOG_HEIGHT), ...o.height }
    const next: FogNow = { ...base, ...o, height }
    if (next.color !== undefined) rgb(next.color, "fog color")
    if (next.mode !== "linear" && next.mode !== "exp" && next.mode !== "exp2") throw new Error(`[oj] scene.fog: mode is ${JSON.stringify(next.mode)}: "linear", "exp" or "exp2"`)
    if (next.density !== undefined && (!(next.density >= 0) || !Number.isFinite(next.density))) throw new Error(`[oj] scene.fog: density is ${next.density}: a metre, 0 or more`)
    if (height !== null) {
        if (next.mode === "linear") throw new Error(`[oj] scene.fog: height needs mode "exp" or "exp2": a linear ramp has no density to thin with height`)
        if (!Number.isFinite(height.base)) throw new Error(`[oj] scene.fog: height base is ${height.base}: metres up`)
        if (!(height.thickness > 0) || !Number.isFinite(height.thickness)) throw new Error(`[oj] scene.fog: height thickness is ${height.thickness}: metres for the density to fall by e, above 0`)
    }
    return next
}

/** The fog's density, or the one that makes it 95% whole at `far`: e^-3 left, from `near`. */
function fogDensity(f: FogNow): number {
    if (f.density !== undefined) return f.density
    const span = Math.max(f.far - f.near, 1e-3)
    return (f.mode === "exp2" ? Math.sqrt(3) : 3) / span
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
    let fogNow = options.fog === undefined || options.fog === false ? null : nextFog(null, options.fog, d)
    let skyNow = options.sky === undefined || options.sky === false ? null : nextSky(null, options.sky, d)
    let reflectionsNow = options.reflections === undefined ? d.reflections : checkReflections(options.reflections)
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
    // An older host draws linear fog alone: only a cart that asked for more is told, once.
    let saidNoFogLaw = false
    const applyFog = () => {
        if (fogNow === null) {
            b.SetFog(false, 0, 0, 0, 0, 0)
            return
        }
        b.SetFog(true, ...rgb(fogNow.color ?? skyNow?.horizon ?? backgroundColor), fogNow.near, fogNow.far)
        if (typeof b.SetFogLaw !== "function") {
            if ((fogNow.mode !== "linear" || fogNow.height !== null) && !saidNoFogLaw) {
                saidNoFogLaw = true
                console.warn("[oj] scene.fog mode and height need a newer OneJS: this host's ModelBridge draws linear fog alone (they came with runtime 1.8), so the fog ramps from near to far.")
            }
            return
        }
        const h = fogNow.height
        const problem = String(b.SetFogLaw(fogNow.mode, fogDensity(fogNow), h?.base ?? 0, h?.thickness ?? 0) ?? "")
        if (problem !== "") throw new Error(`[oj] scene.fog: ${problem}`)
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
    let reflectSent = false
    const applySky = () => {
        if (skyNow === null && !skySent) return
        if (typeof b.SetSky !== "function") {
            if (!saidNoSky) console.warn("[oj] scene.sky needs a newer OneJS: this host's ModelBridge has no sky (it came after 3.9.18), so the scene keeps its background colour.")
            saidNoSky = true
            return
        }
        skySent = true
        // The bridge stops reflecting with the sky, so nothing is owed after a sky(false).
        if (skyNow === null) { b.SetSky(false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); reflectSent = false; return }
        const sun = skyNow.sun
        b.SetSky(true, ...rgb(skyNow.top), ...rgb(skyNow.horizon), ...rgb(skyNow.bottom ?? skyNow.horizon),
            sun ? sun.size : 0, sun ? sun.glow : 0, skyNow.stars)
        applyReflections()
    }
    // Nothing is sent for a scene never asked to reflect, so its calls are a 1.7 scene's, and
    // nothing while it has no sky: the bridge reflects only the sky it draws.
    const applyReflections = () => {
        if (skyNow === null || !skySent) return
        const on = reflectionsNow === "sky"
        if (!on && !reflectSent) return
        if (typeof b.SetSkyReflect !== "function") {
            if (!saidNoSkyReflect) console.warn("[oj] scene.reflections needs a newer OneJS: this host's ModelBridge has no sky reflections (they came with runtime 1.8), so shiny surfaces keep their flat look.")
            saidNoSkyReflect = true
            return
        }
        b.SetSkyReflect(on)
        reflectSent = on
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
        for (const what of ["roughness", "metallic"] as const) {
            const v = o[what]
            if (v === undefined) continue
            if (typeof v !== "number" || !(v >= 0 && v <= 1)) throw new Error(`[oj] scene.mesh: ${what} is ${v}, and runs from 0 to 1`)
            if (typeof b.SetMeshSurface !== "function") throw new Error(`[oj] scene.mesh ${what} needs a newer OneJS: this host's ModelBridge cannot set it (it came with runtime 1.8).`)
        }
        for (const what of ["wrap", "backLight", "backLightColor", "backLightFocus", "edgeFade"] as const) {
            if (o[what] === undefined) continue
            if (what === "wrap" || what === "backLight") unitRange(o[what], `scene.mesh: ${what}`)
            if (what === "backLightFocus") powerRange(o[what], "scene.mesh: backLightFocus")
            if (what === "edgeFade") edgeRange(o[what], "scene.mesh: edgeFade")
            if (o.splat !== undefined) throw new Error(`[oj] scene.mesh: a splat is lit by its vertex normals, and takes no ${what}`)
            const method = what === "edgeFade" ? "SetMeshEdgeFade" : "SetMeshLeafLight"
            if (typeof b[method] !== "function") throw new Error(`[oj] scene.mesh ${what} needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.8).`)
        }
        const fades = o.soften !== undefined || o.deepColor !== undefined
        let fade: [number, number, number, number, number, number] | null = null
        if (fades) {
            const what = o.soften !== undefined ? "soften" : "deepColor"
            const why = `[oj] scene.mesh: ${what} fades a see-through mesh by what is behind it, and`
            if (o.soften !== undefined && (typeof o.soften !== "number" || !(o.soften >= 0) || o.soften === Infinity)) throw new Error(`[oj] scene.mesh: soften is ${o.soften}, and is metres from 0`)
            const deep = o.deepColor
            if (deep !== undefined && (typeof deep?.metres !== "number" || !(deep.metres > 0) || deep.metres === Infinity)) throw new Error(`[oj] scene.mesh: deepColor's metres is ${deep?.metres}, and is metres above 0`)
            const deepRGBA = deep === undefined ? [0, 0, 0, 0] : toRGBA(deep.color, "[oj] scene.mesh deepColor color")
            if (!(color[3]! < 1)) throw new Error(`${why} this one draws opaque (its color's alpha is 1). Give its color an alpha below 1.`)
            if (o.cutout !== undefined) throw new Error(`${why} a cutout draws it opaque`)
            if (draw.depthOnly === true) throw new Error(`${why} a depthOnly mesh draws no colour`)
            if (typeof b.SetMeshDepthFade !== "function") throw new Error(`[oj] scene.mesh ${what} needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.8).`)
            fade = [o.soften ?? 0, deepRGBA[0]!, deepRGBA[1]!, deepRGBA[2]!, deepRGBA[3]!, deep?.metres ?? 0]
        }
        let normalMap: [Texture, number, number, number, number, number] | null = null
        if (o.normalMap !== undefined) {
            const n = o.normalMap
            const what = "[oj] scene.mesh normalMap"
            picture(n?.picture, "scene.mesh normalMap picture")
            if (o.uvs === undefined) throw new Error(`${what}: a normal map is read at the mesh's uvs, and it has none. Give uvs, two numbers a vertex.`)
            if (o.splat !== undefined) throw new Error(`${what}: a splat is lit by its vertex normals, and takes no normal map`)
            const tiling = tilingOf(n.tiling, "scene.mesh normalMap tiling")
            const scale = n.scale ?? 1
            if (typeof scale !== "number" || !Number.isFinite(scale)) throw new Error(`${what}: scale is ${scale}, and is a number`)
            const flow = n.flow ?? [0, 0]
            if (!Array.isArray(flow) || flow.length !== 2 || !flow.every((f) => typeof f === "number" && Number.isFinite(f))) throw new Error(`${what}: flow is [u, v], uvs a second`)
            if (typeof b.SetMeshNormalMap !== "function") throw new Error(`${what} needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.8).`)
            normalMap = [n.picture, tiling[0], tiling[1], scale, flow[0], flow[1]]
        }
        // Today's values unless given: a rough non-metal.
        let roughness = o.roughness ?? 1, metallic = o.metallic ?? 0
        let colorGiven: ColorInput = o.color ?? "#ffffff"
        const surfaceGiven = o.roughness !== undefined || o.metallic !== undefined
        // The leaf light as the bridge takes it: wrap, backLight, its focus, and its colour's sRGB.
        let leaf = { wrap: o.wrap ?? 0, backLight: o.backLight ?? 0, focus: o.backLightFocus ?? 4, color: o.backLightColor ?? ("#ffffff" as ColorInput) }
        const leafArgs = (l: typeof leaf, what: string) => [l.wrap, l.backLight, l.focus, ...toRGBA(l.color, `[oj] ${what}`).slice(0, 3)] as [number, number, number, number, number, number]
        leafArgs(leaf, "scene.mesh backLightColor")
        const leafGiven = leaf.wrap > 0 || leaf.backLight > 0
        let edgeFade: [number, number] = o.edgeFade === undefined ? [0, 0] : [o.edgeFade[0], o.edgeFade[1]]
        const edgeGiven = edgeFade[1] > 0
        const madeMetallic = metallic
        if (o.cutout !== undefined) {
            if (typeof o.cutout !== "number" || !(o.cutout >= 0 && o.cutout <= 1)) throw new Error(`[oj] scene.mesh: cutout is ${o.cutout}, and runs from 0 to 1`)
            if (look.splat !== null) throw new Error("[oj] scene.mesh: a splat has no alpha to cut out. Give cutout with a texture or vertex colours.")
        }
        if (o.twoSided !== undefined && typeof o.twoSided !== "boolean") throw new Error(`[oj] scene.mesh: twoSided is ${o.twoSided}, and is true or false`)
        const sways = o.sway !== undefined
        const swayLayers = sways && isSwayLayers(o.sway)
        for (const [given, method, what] of [[o.cutout !== undefined, "SetMeshCutout", "cutout"], [o.twoSided === true, "SetMeshTwoSided", "twoSided"], [sways, "SetMeshSway", "sway"]] as const) {
            if (given && typeof b[method] !== "function") throw new Error(`[oj] scene.mesh ${what} needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.7).`)
        }
        if (swayLayers && typeof b.SetMeshSwayLayers !== "function") throw new Error("[oj] scene.mesh sway in layers needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.8). Give sway as one number a vertex.")
        // The streams a model is made with are its streams for good.
        const normals = o.normals !== undefined, colors = o.colors !== undefined, uvs = o.uvs !== undefined
        let latest: { positions: Float32Array, indices: Uint32Array | Uint16Array, colors: Float32Array | null, weights: Float32Array | null } | null = null
        const write = (d: MeshUpdate, weights: Numbers | undefined, sway: Numbers | SwayLayers | undefined, what: string) => {
            const positions = floats(d.positions, "positions", 3)
            if (positions === null) throw new Error(`[oj] ${what}: positions are required`)
            const indices = indexList(d.indices)
            const vertexColors = floats(d.colors, "colors", 1)
            if (weights !== undefined && look.splat === null) throw new Error(`[oj] ${what}: weights paint a splat, and this mesh was made without one`)
            const splatWeights = look.splat === null ? null : floats(weights, "weights", look.splat.layers.length)
            if (sway !== undefined && !sways) throw new Error(`[oj] ${what}: sway moves a mesh made with it, and this one was made without`)
            if (sway !== undefined && isSwayLayers(sway) !== swayLayers) throw new Error(`[oj] ${what}: this mesh was made with sway ${swayLayers ? "in layers" : "as one number a vertex"}, and takes it that way`)
            const swayed = !sways || sway === undefined ? null : swayLayers ? layered(sway as SwayLayers, positions.length / 3, what) : floats(sway as Numbers, "sway", 1)
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
                const far = look.splat.far
                if (far !== null) {
                    const faded = String(b.SetMeshSplatFar(id, far.fadeDistance, far.variation))
                    if (faded !== "") throw new Error(`[oj] scene.mesh splat: ${faded}`)
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
                [sways, () => swayLayers ? b.SetMeshSwayLayers(id) : b.SetMeshSway(id), "sway"],
                [surfaceGiven, () => b.SetMeshSurface(id, roughness, metallic), o.roughness !== undefined ? "roughness" : "metallic"],
                [fade !== null, () => b.SetMeshDepthFade(id, ...fade!), o.soften !== undefined ? "soften" : "deepColor"],
                [leafGiven, () => b.SetMeshLeafLight(id, ...leafArgs(leaf, "scene.mesh backLightColor")), o.wrap !== undefined ? "wrap" : "backLight"],
                [edgeGiven, () => b.SetMeshEdgeFade(id, ...edgeFade), "edgeFade"],
                [normalMap !== null, () => b.SetMeshNormalMap(id, ...normalMap!), "normalMap"],
            ]
            for (const [given, apply, what] of looks) {
                if (!given) continue
                const problem = String(apply())
                if (problem !== "") throw new Error(`[oj] scene.mesh ${what}: ${problem}`)
            }
            write(o, o.splat?.weights, o.sway, "scene.mesh")
        } catch (e) {
            b.Unload(id)
            throw e
        }
        const made = {
            collider: false,
            triangles: () => ({
                vertices: latest!.positions.slice(),
                indices: latest!.indices instanceof Uint32Array ? latest!.indices.slice() : Uint32Array.from(latest!.indices),
            }),
        }
        const live = () => {
            if (generationOf.get(model) !== generation) throw new Error("[oj] this mesh was made for a scene that is gone. Make it again with scene.mesh once the scene is live.")
        }
        // A surface value after creation: checked, sent, and kept only once the bridge took it.
        const surface = (what: "roughness" | "metallic", v: number) => {
            live()
            if (typeof v !== "number" || !(v >= 0 && v <= 1)) throw new Error(`[oj] mesh.${what} is ${v}, and runs from 0 to 1`)
            if (typeof b.SetMeshSurface !== "function") throw new Error(`[oj] mesh.${what} needs a newer OneJS: this host's ModelBridge cannot set it (it came with runtime 1.8).`)
            const next = what === "roughness" ? [v, metallic] : [roughness, v]
            const problem = String(b.SetMeshSurface(id, next[0], next[1]))
            if (problem !== "") throw new Error(`[oj] mesh.${what}: ${problem}`)
            ;[roughness, metallic] = next as [number, number]
        }
        // The leaf light after creation, as the surface: checked, sent, and kept only once the bridge took it.
        const leafLight = <K extends keyof typeof leaf>(what: K, name: string, v: (typeof leaf)[K]) => {
            live()
            if (name === "wrap" || name === "backLight") unitRange(v, `mesh.${name}`)
            if (name === "backLightFocus") powerRange(v, "mesh.backLightFocus")
            if (look.splat !== null) throw new Error(`[oj] mesh.${name}: a splat is lit by its vertex normals, and takes no ${name}`)
            if (typeof b.SetMeshLeafLight !== "function") throw new Error(`[oj] mesh.${name} needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.8).`)
            const next = { ...leaf, [what]: v }
            const problem = String(b.SetMeshLeafLight(id, ...leafArgs(next, `mesh.${name}`)))
            if (problem !== "") throw new Error(`[oj] mesh.${name}: ${problem}`)
            leaf = next
        }
        const model: MeshModel = Object.freeze({
            id,
            clips: Object.freeze([]) as readonly string[],
            get height() { return Number(b.Height(id)) },
            get color() { return colorGiven },
            set color(c: ColorInput) {
                live()
                const rgba = toRGBA(c, "[oj] mesh.color")
                if (typeof b.SetMeshColor !== "function") throw new Error("[oj] mesh.color needs a newer OneJS: this host's ModelBridge cannot change a mesh's colour (it came with runtime 1.8).")
                const problem = String(b.SetMeshColor(id, ...rgba))
                if (problem !== "") throw new Error(`[oj] mesh.color: ${problem}`)
                colorGiven = c
            },
            get roughness() { return roughness },
            set roughness(v: number) { surface("roughness", v) },
            get metallic() { return metallic },
            set metallic(v: number) { surface("metallic", v) },
            get wrap() { return leaf.wrap },
            set wrap(v: number) { leafLight("wrap", "wrap", v) },
            get backLight() { return leaf.backLight },
            set backLight(v: number) { leafLight("backLight", "backLight", v) },
            get backLightColor() { return leaf.color },
            set backLightColor(c: ColorInput) { leafLight("color", "backLightColor", c) },
            get backLightFocus() { return leaf.focus },
            set backLightFocus(v: number) { leafLight("focus", "backLightFocus", v) },
            get edgeFade() { return [edgeFade[0], edgeFade[1]] as [number, number] },
            set edgeFade(v: [number, number]) {
                live()
                edgeRange(v, "mesh.edgeFade")
                if (look.splat !== null) throw new Error("[oj] mesh.edgeFade: a splat is lit by its vertex normals, and takes no edgeFade")
                if (typeof b.SetMeshEdgeFade !== "function") throw new Error("[oj] mesh.edgeFade needs a newer OneJS: this host's ModelBridge cannot draw it (it came with runtime 1.8).")
                const problem = String(b.SetMeshEdgeFade(id, v[0], v[1]))
                if (problem !== "") throw new Error(`[oj] mesh.edgeFade: ${problem}`)
                edgeFade = [v[0], v[1]]
            },
            set(d: MeshUpdate) {
                live()
                if (made.collider) throw new Error("[oj] this mesh is a physics collider, which keeps the shape it was made with. Draw what moves with a second scene.mesh, and leave the collider as it is.")
                write(d, d.weights, d.sway, "mesh.set")
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
            // The bake reads a metal's metallic; a mesh made without one keeps a 1.7 mesh's bytes.
            if (madeMetallic !== 0) parts.push(new Float32Array([madeMetallic]))
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
        // The wind's clock is the scene's: a flowing normal map slides by it as a sway moves by it.
        if (sways || (normalMap !== null && (normalMap[4] !== 0 || normalMap[5] !== 0))) swaying = true
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
        let cast = options.castShadows ?? true
        let receive = options.receiveShadows ?? true
        let visible = true
        const live = () => alive && born === generation
        // Asked first and kept after, so a host that refuses leaves the scatter as it was.
        const shadows = (c: boolean, r: boolean) => {
            if (typeof b.SetScatterShadows !== "function") throw new Error("[oj] scatter castShadows and receiveShadows need a newer OneJS: this host's ModelBridge cannot turn a scatter's shadows off (they came with runtime 1.8).")
            b.SetScatterShadows(id, c, r)
            cast = c
            receive = r
        }
        // Kept as given: the copies are baked from these numbers, so a cart reusing its array cannot move them.
        scatters.set(id, { model, data: data.slice(), stride })
        if (!cast || !receive) {
            try {
                shadows(cast, receive)
            } catch (e) {
                b.DestroyScatter(id)
                scatters.delete(id)
                throw e
            }
        }
        return Object.freeze({
            count: data.length / stride,
            get castShadows() { return cast },
            set castShadows(on: boolean) {
                if (live() && on !== cast) shadows(on, receive)
            },
            get receiveShadows() { return receive },
            set receiveShadows(on: boolean) {
                if (live() && on !== receive) shadows(cast, on)
            },
            get visible() { return visible },
            set visible(on: boolean) {
                if (!live() || on === visible) return
                if (typeof b.SetScatterVisible !== "function") throw new Error("[oj] scatter.visible needs a newer OneJS: this host's ModelBridge cannot hide a scatter (it came with runtime 1.8).")
                visible = on
                b.SetScatterVisible(id, visible)
            },
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
            fogNow = o === false ? null : nextFog(fogNow, o, d)
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
        get reflections() { return reflectionsNow },
        set reflections(v: Reflections) {
            reflectionsNow = checkReflections(v)
            applyReflections()
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

// The leaf light's and edge fade's ranges, as ModelBridge refuses them, said in the cart's words.
function unitRange(v: unknown, what: string) {
    if (typeof v !== "number" || !(v >= 0 && v <= 1)) throw new Error(`[oj] ${what} is ${v}, and runs from 0 to 1`)
}
function powerRange(v: unknown, what: string) {
    if (typeof v !== "number" || !(v >= 1 && v <= 16)) throw new Error(`[oj] ${what} is ${v}, and runs from 1 to 16`)
}
function edgeRange(v: unknown, what: string) {
    const ok = Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")
        && ((v[0] === 0 && v[1] === 0) || (v[0] >= 0 && v[1] > v[0] && v[1] <= 1))
    if (!ok) throw new Error(`[oj] ${what} is ${JSON.stringify(v)}, and is [start, end] with 0 <= start < end <= 1, or [0, 0] for none`)
}

// Sway in layers, as against one number a vertex.
function isSwayLayers(sway: unknown): sway is SwayLayers {
    return typeof sway === "object" && sway !== null && !Array.isArray(sway) && !ArrayBuffer.isView(sway)
}

// A layered sway as ModelBridge takes it: trunk, limb, leaf and both phases, four a vertex, 0
// for a layer left out. The phases share the fourth: the limb's in 256ths of a turn as its whole
// part, the card's as its fraction (ModelWind.hlsl's ModelSwayedLayered).
function layered(sway: SwayLayers, count: number, what: string): Float32Array {
    const names = ["trunk", "limb", "leaf", "phase", "leafPhase"] as const
    for (const k of Object.keys(sway)) {
        if (!(names as readonly string[]).includes(k)) throw new Error(`[oj] ${what}: sway has ${k}, and its layers are trunk, limb, leaf, phase and leafPhase`)
    }
    const layers = names.map((k) => floats(sway[k], `sway.${k}`, 1))
    if (layers.every((l) => l === null)) throw new Error(`[oj] ${what}: sway in layers names none; give trunk, limb, leaf, phase or leafPhase, one a vertex`)
    layers.forEach((l, i) => {
        if (l !== null && l.length !== count) throw new Error(`[oj] ${what}: sway.${names[i]} has ${l.length} numbers for ${count} vertices`)
    })
    const [trunk, limb, leaf, phase, leafPhase] = layers
    const turn = (x: number) => x - Math.floor(x)
    const out = new Float32Array(count * 4)
    for (let v = 0; v < count; v++) {
        out[v * 4] = trunk ? trunk[v]! : 0
        out[v * 4 + 1] = limb ? limb[v]! : 0
        out[v * 4 + 2] = leaf ? leaf[v]! : 0
        const limbTurns = phase ? Math.round(turn(phase[v]!) * 256) % 256 : 0
        out[v * 4 + 3] = limbTurns + (leafPhase ? Math.min(turn(leafPhase[v]!), 0.999) : 0)
    }
    return out
}
