# ojplay

OJPlay from the terminal, and the container runtime its carts run on.
Published to npm as `ojplay` (until 1 Oct 2026, `onejs-play`, which stays frozen
at 0.8.9 for the OneJS projects that pin it; this repository keeps that name).
Installed once, `npm install -g ojplay`, it is a command: `ojplay add @handle/name`.
Games import the runtime as `oj` through an esbuild alias. The npm name `oj`
was already taken, and the alias is the same mechanism OneJS already uses to
dedupe React, so it ships in the scaffolded esbuild config and survives eject.

## The design rule

**oj is a strict subset of OneJS, never a variant.** Everything here also works
in a normal Unity OneJS project, so ejecting a game is: copy the file into a
scene folder, `npm i`, build. Zero diff.

Every proposed feature answers one question: does this also work in a real OneJS
project? If not, it is cut, or it degrades to a documented no-op after eject.

## What is here

| Module | Contents |
|---|---|
| `index.ts` | The game-facing surface, aliased to `oj` |
| `mount.ts` | `mount()`, `useStage()` and `useLateFrame()`, the late phase of the frame clock |
| `frame.ts` | `useFrame`, the per-frame clock a game runs on |
| `gesture.ts` | `useSwipe`, read off `input` once per frame |
| `stick.tsx` | `useStick`, `usePad`, `<Stick>`, `<Pad>`: thumb controls for phones, read off `input.touches` |
| `camera.ts` | `useOrbit` and `useFollowCamera`: a drag read off `input` inside a bound View, written to the scene's camera in the late phase, once a change |
| `stage.ts` | The stage (the window, in logical pixels) and Unity screen space into it |
| `asset.ts` | `assetUrl`, `assetInfo`, `setAssetMap`, `loadTexture`, `useTexture`, `loadFont`, `useFont`, `useFlipbook`, `loadSheet`: a game's own files |
| `preload.ts` | `preload`: a game's files loaded ahead of first use, with progress in bytes; `unload`: the pictures, models and fonts it no longer needs, freed |
| `audio.ts` | onejs-unity's `audio`, with `load` taking a bare file name, and `useSound` |
| `scores.ts` | `scores` and `useLeaderboard` |
| `room.ts` | `useRoom`: other people, over a relay |
| `wire.ts` | What each relay message does to a room's state (peers, host), kept testable apart from the socket |
| `physics/` | What 2D and 3D share: `core.ts` is the one world, body, character and shape implementation behind both, generic over a dimension adapter; `sight.ts` is `visibility`'s geometry across one plane; `use-stepped.ts` steps a world on the frame clock |
| `light/` | Baked light's plain parts, no engine (PlaySite docs/lightmapping.md): `record.ts` is what a saved light was baked for, its fingerprint and the first difference in the console line's words; `png.ts` reads and writes that record in the file's `tEXt` chunk; `probes.ts` places the probe grid and blends it for a moving actor (OneJS's ModelBridge blends the same way each frame, so `blend` is the reference its C# twin follows); `atlas.ts` packs each static actor's rectangle, lowering the detail to fit, and lays each model out once at its smallest actor's density; `unwrap.ts` cuts a model into xatlas charts and packs them at that density, giving the second UV set and each output vertex's source vertex; `bake.ts` is `scene.bake`'s half of a bake: it reads each static model's triangles from ModelBridge, unwraps and lays them out, and hands back each model's unwrap, every rectangle and the probe grid |
| `physics2d/` | `useWorld2D`, `createWorld2D`, `shape2D`: 2D physics over Rapier 2D, in stage pixels, y down. `world.ts` is the API, `elements.ts` moves the elements bodies carry (one `ElementPlacer` crossing per step) |
| `physics3d/` | `useWorld`, `createWorld`, `shape`: 3D physics over Rapier. `world.ts` is the API, `car.ts` is `world.car` over Rapier's ray-cast vehicle, `rapier.vendor.js` the generated glue, `gltf.ts` a .glb's triangles for mesh colliders |
| `nav/` | `world.nav()`: Recast navmeshes and Detour paths, built from a world's static bodies |
| `wasm.ts` | Where a WebAssembly engine comes from on each host: OneJS's native link, a module handed over, or StreamingAssets |
| `node.ts` | `ojplay/node`: hands every engine to Node, for a cart's own tests (`setupFiles: ["ojplay/node"]`) |
| `mathf.ts` | `Mathf`, Unity-shaped, implemented in JS |
| `vec.ts` | `Vector2`. No `Vector3`: a 3D position is a plain `[x, y, z]` |
| `models.ts` | `useScene`, `useModel`, `scene.mesh`, `scene.scatter`, `scene.texture`, `scene.sky`, `scene.bake`: `.glb` models, models made from arrays and scattered copies behind the panel, with a sun, shadows, lights and a sky, and the scene as a texture a program reads. `scene.bake` bakes what is spawned `static`, every static body's actor (the world tells the scene, through `physics3d/actors.ts`) and every scattered copy, and steps the bake each frame |
| `color.ts` | `Color`, parsing through onejs-react's `toRGBA` |
| `transform.ts` | onejs-react's `Transform2D`, with `point()` returning oj's `Vector2` |
| `random.ts` | `random`: a shared generator, and called with a seed, a seeded one; `rng.noise()`, a smooth field from onejs-unity's simplex seeded without drawing from the generator |
| `theme.ts` | The default look of the controls the runtime provides |
| `code.ts`, `code-view.tsx` | `tokenize` and `<Code>`: TypeScript highlighting for a game that shows source |
| `show.ts` | `show`: a value, a table or a graph beside the line that made it, in the OJPlay editor; a log line on change anywhere else |
| `container.ts` | The host-facing surface, `ojplay/container` |
| `runtime.ts` | Container-side: builds the `oj` object a game receives, and runs each frame in three phases: the frame (`useFrame`), the step (worlds), late (cameras). Given `pendingCompiles`, it holds every phase behind the cart's first screen until its programs have drawn once, at most `FIRST_DRAW_CAP` (2 s), then starts with a 1/60 frame |
| `play.ts` | Container-side: where the site is, and the token proving a real session |
| `sandbox.ts` | Container-side: keeps a game bundle off the runtime's globals |
| `input.ts` | Container-side: the input backend onejs-unity reads through, with the pointer lock's state (asked in a press's frame, else on the next press) |
| `adapter.ts` | Container-side: browser events into that backend, and the canvas's pointer lock (movement as delta while locked) |
| `standalone.ts` | Starting a runtime outside a container, which is what eject needs |
| `hostinput.ts` | Outside a container: the real InputBridge with pointer reads converted to stage pixels; the lock is Unity's Cursor, through onejs-unity |

Beside `src/`, two folders that are not the runtime:

| Folder | Contents |
|---|---|
| `build/` | `game.mjs`, the one builder every game is built with (the site on publish and on Run, `ojplay build`, the shipped-games script), and `externals.json`, the modules the container provides. The esbuild instance is a parameter, wasm in the Worker and native here. `show-sites.mjs` tags each call to oj's `show` with its line, for the site's builds only. |
| `cli/` | The `oj` command line, the package's `bin`. |
| `host/` | `boot.mjs`, the script that boots the container and hands it a game, inlined by the site's sandbox document and by the page `ojplay run` serves. One copy of the contract with `__ojPlay.load`; the two documents differ only in where the runtime is, how the bundle arrives and whom they tell. |

Everything above the `container.ts` line is reachable from a game. Everything
below it is the host's, and a game bundle cannot see it: `oj` is the package
root and `ojplay/container` is a separate entry point.

Value types are pure JavaScript, never bridged. That is faster than the real
thing (no reflection crossing, no handle-table entry) and it keeps the container
decoupled from Unity's API surface.

## Unity parity is verified, not assumed

`Mathf`, `Vector2` and `Color` were checked against the decompiled UnityEngine
assemblies for 6000.5.2f1 via `unity_reflection_decompile`, not written from
memory. That caught two real bugs that looked right and tested green:

- `Vector2.Angle` guards the product of squared magnitudes against `1e-30`
  **before** the square root. Guarding the root against `kEpsilon` instead is
  ten orders of magnitude too strict and returns 0 for two perfectly ordinary
  vectors of magnitude `1e-3`.
- `normalized` is written `!(m > kEpsilon)`, not `m <= kEpsilon`, which also
  sends NaN to zero rather than dividing by it and seeding NaN into every
  coordinate downstream.

Re-verify with the same tool when bumping Unity versions.

## The stage

The stage is the window, in logical pixels, and `useStage()` returns its
`{ width, height }`, re-rendering when it changes. There is no fixed logical
size and no fit: UI Toolkit is the renderer, so a game lays itself out against
the window and reflows, the way a page does. An `oj.json` `stage` block is no
longer read.

A game that wants a fixed board builds one in its own code: a fixed-size View
with `scale` set to fit the window, centred.

```tsx
const W = 960, H = 540

function useBoard() {
    const { width, height } = useStage()
    const scale = Math.min(width / W, height / H)
    const left = (width - W * scale) / 2, top = (height - H * scale) / 2
    return {
        scale,
        style: { position: "absolute", left: (width - W) / 2, top: (height - H) / 2, width: W, height: H, scale } as const,
        toBoard: (p: { x: number; y: number }) => ({ x: (p.x - left) / scale, y: (p.y - top) / scale }),
    }
}
```

UI Toolkit picks through the scale, so handlers on elements inside the board
need nothing. Anything reported in window pixels (`e.x`, `input.mouse.position`,
touch positions) goes through `toBoard`; `localX` and deltas divide by `scale`.
Measured in the real container at four window sizes, scales 0.41 to 1.33, with
every click landing in the right cell.

Logical pixels are CSS pixels: the container scales the panel by
devicePixelRatio, and nothing else. Fullscreen changes how many pixels there
are. The host page owns the Fullscreen API call so the user gesture and the
Permissions Policy stay on its side of the iframe boundary.

## Input

There is no `oj.input`. Games call **onejs-unity's `input`**, the same API a
normal OneJS project uses, so game code reads identically here and after eject.

```tsx
import { input } from "oj"

if (input.keyboard.wasKeyPressed("Space")) jump()
const p = input.mouse.position     // stage pixels, as a pointer event reports them
```

That module normally reads UnityEngine's InputBridge through `CS`, which the
container shadows. So `createContainerInput()` in `ojplay/container`
supplies the same methods from browser events, and the host installs it with
onejs-unity's `setInputBackend`. One API, one implementation, a swappable
source. Writing a second input API here would have been the maintenance
nightmare in miniature.

**Pointer events and `input` report the same numbers.**

| | Reports |
|---|---|
| `input.mouse.position`, `input.touches[n].position` | stage pixels |
| `onPointerDown` and friends: `x`, `y` | stage pixels |
| `onPointerDown` and friends: `localX`, `localY` | relative to the element the handler is on |

`localX` and `localY` are what a handler hit testing against its own box
wants; they come off the synthetic event's prototype in the OneJS bootstrap and
read `worldBound` on first use, so a handler that never asks pays nothing.
Before they existed, a handler typed as `any` accepted `localX` happily and got
`undefined`: Patience shipped with every card unclickable because of exactly
that. Its `ChangeEventData` sibling carries `value`, not `newValue`, which
broke every slider in Particle Lab the same way.

**A press on a button is not a game input.** `input.mouse.overUI` and
`touch.overUI` say whether a press began on UI that answers it: an element
with a click, pointer or change handler under the point, or above it in the
tree. The container asks the panel once per press (`src/over-ui.ts`, through
OneJS's `__eventAPI.listens`), so a stage-sized View around the HUD, which
answers nothing, does not count. A game that fires on `leftButton` checks
`!input.mouse.overUI`, and `useStick` and `usePad` leave a thumb that came down
on UI alone. Gunyard's Invite button fired the gun before this, and the cart
tested the button's rectangle twice to stop it. An element with the class
`oj-world` is the game's: a stage-sized View with a drag handler of its own
would otherwise make every press UI and leave a stick beside it dead, so the
walk passes over it, and the first press such a View answers unmarked says so
once.

Reading through `input` also gets touch for free, since the same code sees
`input.touches`. A swipe is `useSwipe(onSwipe)` from `gesture.ts`: it follows
one finger or a mouse drag through `input`, fires once per gesture past a
threshold, and ignores the mouse while a finger is down, because the container
reports a touch as the mouse too and listening to both fires everything twice.
Twos Company carried that state machine itself before it moved here.

**Hooks read the latest render.** `useFrame` and `fx.useAnimation` call
the callback from the most recent render on every frame, so a callback can
read state and props directly and the dependency list only says when to
resubscribe or restart the clock. The first version froze the first render's
closure for the life of the component, and every game with a slider ended up
mirroring its state into a ref to get around it.

**One frame clock.** `useFrame` is onejs-react's, so a cart and a OneJS app
share the hook. `createRuntime` installs the runtime as its clock with
`setFrameClock`, and `dispose` puts the default back, so frames stop when the
container stops calling `beginFrame` and a callback sees this frame's input
edges. `useDrawing(ref, draw, "frame")` repaints on the same clock.

**Breakpoints describe the stage.** `mount()` wraps the game in a
`ScreenProvider` sized from the stage, so `useBreakpoint` and friends work in a
game with no setup.

### A pointer used to be wrong after an eject

**Fixed. Kept here because the shape of the bug is the useful part.**

`createRuntime` installs the container's input backend, because that is what the
container needs, and `startStandalone` calls `createRuntime`. So an ejected game
got that backend with nothing feeding it: no adapter pushes browser events into
it in a Unity project, and there are no browser events to push. Every key read
as up, the mouse sat at the origin, no touch ever arrived. Not a wrong answer,
an answer that never changed. `standalone.ts` documented the opposite, which was
its intent and not its behaviour.

Installing nothing would have been half a fix. onejs-unity then falls through to
the real `InputBridge`, so input works, and reports Unity screen space:
**physical pixels, origin at the bottom left, y counting up**, against a game
laid out in logical pixels from the top left with y counting down. Two
differences at once, and the flipped axis reads as a haunting rather than a bug.

So `hostinput.ts` wraps the real bridge rather than replacing it. Keyboard,
gamepad and haptics pass straight through, because they were never in a
coordinate space; the pointer methods convert through `screenToStage`, and only
those. A delta converts separately from a position: a delta has no origin, and
running one through the position path adds the viewport height to every vertical
movement, which still looks like it works until something crosses the middle of
the screen.

The arithmetic is unit tested and does not need Unity. What still does is that
the bridge is reachable at all, which is the one thing those tests cannot prove.

**A project without the Input System has no bridge.** OneJS compiles
`InputBridge` only when the package is installed and its backend is on, and the
CS proxy answers `CS.OneJS.Input.InputBridge` either way, so the first read on a
missing one failed with `Type not found` on every frame. `bridgeFrom` asks
`System.Type.GetType` instead, which answers null without logging, and the game
then gets `IDLE_INPUT` (nothing pressed, pointer at the origin) and one warning
saying how to turn input on. Checked in a Unity project both ways: no warning
with the Input System, one warning and no error without it.

**Input actions are not covered.** A backend is not consulted for them, so an
ejected game using an action reaches the real bridge directly. Correct for
everything except a position read out of an action, which will be in screen
space. Narrow, and written down rather than papered over.

## A game's own files

Until recently a game was text and nothing else: no sprite, no sound, no font.
Now it can ship them, and `assetUrl` is the one function that knows where they
went.

```tsx
import { Image, useTexture, useSound } from "oj"

const glow = useTexture("glow.png")   // in a component: a Unity texture, or null
const pop = useSound("pop.wav")       // a sound, or null; unloaded with the component
<Image src="logo.png" />              // Image takes the bare name too
```

A bare file name, resolved differently on each side of an eject: on the site to
`/assets/<name>` on the game's own origin, and in a Unity project to the
project's `assets/` folder in the editor or `StreamingAssets/onejs/assets/` in a
build. The container passes its origin in as `assetBase` when it creates the
runtime; with none set, OneJS's own project convention applies, which is exactly
what an ejected copy needs.

**By hash, on the site.** A bundle PlaySite builds carries its files by name,
as `[sha256, bytes]` (`buildGame`'s `assets`, injected as `oj:files` ahead of
the game's own code), and hands them to `setAssetMap`. A name in that map
resolves to `<assetBase>/<sha256>/<name>`, a URL that names its bytes, so it
is cached for good and served without a lookup, and a branch's cart, a version and a
rollback each load their own commit's files. `assetInfo(name)` says a file's
size for a loading bar. With a `store` (`buildGame`'s option, passed on to
`setAssetMap`), a mapped name loads `<store>/<sha256><ext>` instead: PlaySite's
content-addressed store, keyed by the hash and the name's lowercased extension,
which stays in the URL because Unity's loaders pick a decoder by it. A new host
empties the map; a name it lacks, a bundle built without one and a container
from before it all resolve as above (PlaySite `docs/refs-and-assets.md`).

**Loading ahead.** Every loader fetches on first use. `preload(names,
onProgress)` asks early, for what a game needs before it starts: pictures and
models into the caches the loaders share, anything else fetched once so the
browser holds it. A name ending in `/` is every file of the build under that
folder, and progress is in bytes from the file map, so the total is known
before the first byte.

```tsx
await preload(["models/ship.glb", "music/"], (got, total) => setBar(got / total))
```

**Fonts.** `loadFont(name)` resolves to a font from one of the cart's
`.ttf` or `.otf` files, and `useFont(name)` returns it, or null while it
loads, as `loadTexture` and `useTexture` do. Apply one with `fontFamily`,
which is inherited, so a font on a container reaches every Text inside it.
The container fetches the bytes and builds a dynamic font from them (OneJS
`Network.LoadFontFromUrl`), one per file however many ask, so `preload` and
`unload` take fonts as they take pictures. A family's name is not a font: no
font is installed by name, and `fontFamily: "Arial"` says so once and draws
in the default face. `cli/fixtures/font` is a cart with its own font.

```tsx
const title = useFont("fonts/Display.ttf")
<View style={{ fontFamily: title }}><Text text="Level 1" /></View>
```

**Loading first.** oj.json's `preload` lists files the cart needs before its
first frame. The builder reads it (`PRELOAD_FIELD` in `build/game.mjs`, the one
place the name is spelled), opens its folders against the files the build
ships (the site's map, or `assetNames` from the cart's folder when ojplay
builds), warns about an entry that names nothing, and hands the files to
`setAssetMap` as `startup`. `mount` then shows a plain bar until they have
loaded (`LoadFirst` in `src/mount.ts`), once per host, so a hot reload's
remount goes straight to the cart.

**Letting go.** `unload(names)` takes the same names and frees what the
loaders hold: a picture's texture is destroyed, and a model is freed through
OneJS's `ModelBridge.Unload`, which refuses while a copy of it is still in the
world (said once, as a warning). A host without `Unload` keeps the model until
its scene goes, as before. Sounds free themselves with their component.

**Where the files go.** An asset's name is its path from the cart's root:
`pop.wav` beside `index.tsx`, or `sfx/pop.wav` in a folder of your own. Never in
a folder called `assets/`: `assetUrl` strips a leading `assets/` (the habit a
web developer arrives with), so the site stores such a file and never serves
it. Images are png or jpeg, and names are case-sensitive. `ojplay run` and `oj
test` serve `/assets/` by the same rule (`cli/assets.mjs`, a copy of the
site's `media.ts`), warn at start about any asset no request can reach, and
print why each refused request was refused. `fireworks` and `one-note` kept
their sounds in `assets/` and were silent locally and live until this (#3).

Explicit at the call site on purpose. Teaching every loader a hidden base would
mean a bare `"glow.png"` resolving through machinery a reader cannot see, and
two loaders that disagreed about it would be a bug with no visible cause.

`loadTexture`, `useTexture`, `useSound` and `audio.load` all take the bare
name. oj's `audio` (`audio.ts`) is onejs-unity's with `load` resolving a name
through `assetUrl`; a URL passes through untouched. `useSound` unloads its
sound with the component, a sound that arrives after the unmount included.

**Two things had to be fixed in the runtime before any of this worked**, and
both were invisible from the outside:

- onejs-react's image loader had no URL bypass, so a full URL was mangled into
  `{streamingAssets}/onejs/assets/https://...` and never fetched. onejs-unity's
  own resolver has always had that check; the copy in the reconciler did not.
  **Not a WebGL bug**, though it was found here: `https://...` is not a rooted
  path on any platform, so the same mangling happened in the editor and in a
  desktop build. It only went unnoticed because nothing had loaded a remote
  image before.
- On WebGL, `QuickJSUIBridge.Tick()` is never called, because the browser drives
  the JS scheduler instead. Settling completed C# Tasks lived in `Tick()`, so on
  WebGL **every** Task-returning API stayed pending forever: `audio.load` and
  `<Image src="http...">` never resolved and never rejected, in every web build,
  with nothing logged. It is settled from `TickSystems()` now, which is the one
  thing Update does still call.

### Big files leave git

A file of an image, sound, font or model type that is 1 MB or more is stored
outside git (the site's `docs/refs-and-assets.md`, Part 2). The commit holds
Git LFS's three line pointer, and the bytes go to the site's store, named by
their SHA-256 and served by Cloudflare's cache. Nothing changes in the game:
it still asks for the file by its name.

`ojplay init`, `new` and `clone` set it up in the clone itself, never in a
committed file: `filter.oj.process` and `filter.oj.required` in `.git/config`,
one `filter=oj` line per stored type in `.git/info/attributes`, and a
`pre-push` hook. `cli/store.mjs` is all of it:

- `git add` runs the clean filter: a stored file becomes its pointer, and its
  bytes go to `~/.onejs-play/store/`.
- `git push` runs the hook, which lists the pointers the push carries, asks the
  cart's LFS batch endpoint (`/c/<sid>.git/info/lfs`) which bytes the store
  lacks, sends those to the presigned URLs it answers with, and verifies each.
  A refusal (too big, over the account's allowance, taken down) stops the push
  with the site's sentence, so a pointer never lands without its bytes.
- A checkout runs the smudge filter: the real file comes back from the cache,
  or from the store through the same endpoint, checked against its hash. One
  that cannot be had stays a pointer, with a line saying so, so an offline
  clone still checks out.

git runs one filter process per command, over its long-running filter
protocol, rather than one node per file. What git runs is never handed off to
the cart's own ojplay, which may predate it. A file committed whole before
init is still in git, and init names it: the next commit of it stores it
outside. The rule is the site's, copied, and PlaySite's
`src/store-rule-parity.test.ts` holds the two to the same answers.

## 3D models

A game loads a `.glb` with `useModel`, gets a scene with `useScene`, and spawns
copies of the model into it. Every call is a handle into
`OneJS.Models.ModelBridge` (OneJS `Runtime/Models/`), which glTFast backs; the
game never touches a GameObject.

The rule for the API is that a game opts out, never in. A scene with no options
has a camera, a sun casting soft shadows, a hemisphere ambient, and models that
cast and receive shadows. `SCENE_DEFAULTS` is that list, and each option on
`useScene` and `spawn` turns one entry off or tunes it, named as three.js and
Unity name them. The user page is PlaySite's `docs/3d.md`.

A cart has one scene: a second `createScene` in the same runtime throws and
names the fix, while a scene left behind by an earlier runtime is disposed,
because the container tears a cart down before it disposes the runtime. Each
model file loads once per scene and is shared, frozen, by every spawn; a model
loaded for a scene that is gone refuses to spawn rather than spawn into the
next cart's world. Every actor's fade runs at its `speed`, and at 0 while
`scene.paused`, which is also what `ModelBridge.SetSpeed` applies to clips.

Three things that are not obvious from the code:

- **One shader in both hosts.** Every glTF material is built on OneJS's
  `ModelLit`, a URP PBR shader, by `ModelMaterialGenerator`. The site's
  container and a Unity project after `ojplay add` therefore draw the same
  pixels from the same file, which glTFast's own materials would not
  guarantee. The shader has a SubShader only where glTFast is installed, so a
  project without it builds nothing extra.
- **Play mode takes over, the preview does not.** In play mode and in players
  the bridge switches off the scene's screen cameras and suns and sets the
  ambient and fog, then restores all of it when the scene is disposed. In the
  edit-mode preview it only adds objects of its own and leaves the user's scene
  and `RenderSettings` alone, so the preview is lit by the scene's own sun.
- **A model made from arrays is still a model.** `scene.mesh` hands back what
  `spawn` takes, and `world.mesh` reads its last triangles through
  `arrayModels` (`physics3d/sources.ts`), not a file. The bridge checks the
  arrays in C#, where the loop is cheap on both engines, and answers what was
  wrong as text, which `scene.mesh` and `set` throw as an `[oj]` error. A typed
  array crosses as it is, so a `set` each frame copies nothing in JS. One that
  became a collider refuses `set`, since a collider is made once.
  `scene.mesh(data, { depthOnly: true })` asks `SetDepthOnly` before the
  first vertices, and throws where the host cannot (an older OneJS, or HDRP),
  since a depth-only fan drawn in colour would be seen.
- **A scatter has no actors.** `scene.scatter` sends every copy in one
  Float32Array, and the bridge draws them as instanced chunks with no
  GameObject, so copies cost a draw call a chunk rather than a GameObject
  each, and have nothing an actor has (collider, pick, animation).
- **`scene.texture` is lent, not owned.** It is onejs-react's `LentTexture`:
  each program or pass that reads it acquires it once and releases it when
  it stops, and the scene counts its own readers, so a release after the
  scene is disposed, or one too many, never takes a reader from the next
  scene. The bridge draws the scene into it only while one is counted.
- **The panel goes transparent while a scene is live.** `mount` reads its
  backdrop through `useBackdrop`, which is an external store rather than an
  effect, because a scene is created in a child's effect, which React runs
  before the stage's.

`ojplay add` of a cart with a `.glb` adds `com.unity.cloud.gltfast` to the
project's `Packages/manifest.json` (`ensureGltfast` in `cli/unity.mjs`), so the
project runs on its next open.

## 3D physics and paths

`useWorld` is Rapier (the deterministic build, pinned exactly) under oj's own
names: bodies, a character controller, queries, triggers, snapshots. The user
page is PlaySite's `docs/physics.md`; the design and its reasoning are
`PlaySite/docs/physics.md`. Rapier's name appears nowhere in the API, so the
engine stays oj's to change.

The engines are WebAssembly that oj loads lazily, the first time a cart makes a
world or a navmesh, or bakes light. `scripts/vendor-rapier.mjs`,
`scripts/vendor-recast.mjs` and `scripts/vendor-xatlas.mjs` write the glue
(with its `.wasm` import removed; xatlas-wasm carries its module inline, so
that script decodes it out), a version file naming the
module's sha256 and imports, and the module itself under `assets/@ojplay/wasm/`,
which every OneJS build copies to StreamingAssets as a package asset.
`src/wasm.ts` then picks the source per host, in this order:

1. `globalThis.__wasm`, OneJS's native link of the same module (QuickJS has no
   WebAssembly), used only when its sha256 matches;
2. a module handed over with `setWasmModule` (workerd cannot compile bytes;
   Node tests);
3. a fetch from `StreamingAssets/onejs/assets/@ojplay/wasm/<name>-<version>.wasm`.

Re-vendor after changing a pinned version, and tell whoever links the native
module: the import list is its contract. `rapier.test.ts` fails when the
vendored files and the installed package disagree, and when a new Rapier's
`World.step` does more than the pipeline call `world.ts` makes in its place.

Things that are not obvious from the code:

- **Queries see a body the frame it is made.** Rapier's query tree updates only
  in `step()`, so bodies created or teleported since are tested one by one
  (`fresh` in `world.ts`).
- **Characters move inside the step.** `walk` is a held velocity that each
  `step()` applies for exactly one step before the engine's, so a character
  covers the same ground at any frame rate.
- **A snapshot is more than Rapier's.** Rapier's bytes, then oj's own JSON per
  character (held walk, vertical speed, standing, shove), per car (held drive,
  steering, wheel spin, where it is parked) and per body that does not turn,
  then the engine part's length, so a rewind brings a jump back mid-air. A car
  rebuilds its vehicle controller on the restored world. ASCII by hand, since QuickJS
  has no `TextEncoder`.
- **`slide` keeps a walker per shape.** A sensor capsule in no collision group
  on a fixed body, which no query or contact sees; `restore` drops them with
  the orphans and they are made again when next asked for.
- **A kinematic body glides by a held velocity.** Writing `velocity` on one
  stores it, and each step moves its next position by it before the pipeline
  runs (`stepGlide`), so a lift needs one line; the snapshot keeps it. Static
  bodies throw on velocity, `push` and `addVelocity`, rather than ignore them.
- **A character hears both kinds of touch.** Its controller reports what it
  walks into; what a dynamic body runs into it with comes from the engine's
  contact events, deduplicated against the controller's through one set of
  touching handles, which the 5 cm check ends either way.
- **`walk` is along the ground.** The wish loses its component along up
  before it is applied, unless gravity is zero (a top-down world), where it
  walks every way.
- **`visibility` is one query and arithmetic.** The engine is asked once a
  look for the colliders in range, as `canSee` filters them. Each is cut by the
  plane the eye looks across, into convex outlines, segments and circles:
  a box, a hull, a capsule's middle, a cut mesh, a ball. A tilted capsule
  answers each ray itself. `physics/sight.ts` then casts in plain JS, a ray
  either side of each corner and tangent and where a part crosses the edge of
  range, and along round arcs to 5 mm. Rays find what is in their slice of
  the turn, nearest first, and each knows which part it stopped at, which is
  how `reaches` names the body under every corner of `outline` at no extra
  query (null past range). A static body's cut is kept until a body is
  placed by hand or the world restored. Tests sample 4000 points against
  `canSee` among every shape oj makes, in 2D and 3D. On Gunyard's yard (36
  boxes) a look takes 0.042 ms in Chrome and 0.17 ms on the 4x phone profile,
  within a fifth of the cart's own sight and a ninth of the ray fan it
  replaced; the one query is 0.008 ms of it.
- **A touch's `speed` is read from the solver.** By the time a step reports a
  touch the pair has stopped, so the speed is the normal impulse over the
  reduced mass, divided by one plus the bounce.
- **Actors follow in one crossing.** `syncActors` hands every moved body's
  placement to `ModelBridge.PlaceMany` as one `Float32Array`; an actor sits at
  its body's centre.
- **Between steps, actors are drawn ahead.** When frames come faster than
  steps (smoothed frame under 0.8 of a step), each frame draws every actor
  `t` of a step past its last one along its velocity, a character along the
  walk asked this frame (`leading`). It slides along what the engine says it
  touches, then one sweep stops it short of what it would reach; a sweep that
  meets something within a millimetre asks a contact query instead, since a
  sweep from a touching start gets neither its time nor its normal right.
  2.2 µs a moving body a frame on desktop Node, nothing under a millimetre
  ahead. Without `fast` the engine itself puts a 6 m/s ball 8 cm into a wall
  for a step; the drawing never goes deeper than it. `between` is the
  interpolating alternative, one call away.
- **A character rides what it stands on.** Only while something moves
  (`world.moving()`), a foot sphere swept down at the start of a step finds
  the body under it, before anything moves, and its motion over the step
  (kinematic: next pose; dynamic: velocity at the point) carries the
  character. Down is applied without the controller, which the body under it
  would otherwise stop; the rest goes through it, so walls still stop it.
- **A car is a driver.** `WorldCore` steps each driver after characters and
  before the pipeline. Rapier's ray-cast tyres creep down a slope braked or
  not, so a braked, stopped car is held after `updateVehicle` by its speed
  along its length toward where it stopped (`parked`), re-anchored when
  pushed more than 2 cm. Its wheels are placed from the chassis after the step.
  Wheel models given as `wheels` are carried: wherever the world draws the
  chassis (`WorldCore.drawn`), on a step or ahead of one, each wheel is put on
  it there, rolled on by its last step's spin rate, so it never trails the
  car. A chassis with wheel models and no model of its own is still drawn,
  as a placement with a null actor that is never handed to the scene. They go
  with the car, destroyed or rewound away, as its chassis model does.
- **Rotations are Unity's.** `rotation.ts` converts yaw, pitch and roll the way
  `Quaternion.Euler` does, and `gltf.ts` mirrors glTF's x as glTFast does, so
  a mesh collider lines up with the model drawn from the same file.
- **Deterministic everywhere.** `parity.mjs` holds the hash of a fixed scene;
  Node, Chrome, workerd and OneJS's native QuickJS link all produce it.
- **Recast's `detailSampleDist` is in cells.** Below about 0.9 the build reads
  out of bounds, so `nav.ts` leaves Recast's default.
- **2D nav is Recast on its side.** A floor quad over the static bodies'
  bounding box, every body stood up half a metre with its top facing down,
  walker height 1 and step 0; circles become 16 sides grown to stay outside
  the true circle. A world with gravity is refused.

`scripts/make-models.mjs` writes the examples' simple models (boxes and
cylinders in flat colours), so none of their `.glb` files lacks a source.

## Other people

`useRoom(name)` puts a game in a room with everybody else playing it.

```tsx
const room = useRoom("lobby", {
    onOpen: (myId, peers) => {},
    onJoin: (id, name, back) => {},   // back: the same player returning to its seat
    onLeave: (id) => {},
    onMessage: (from, data) => {},
})
room.send({ x, y })       // to everyone else
room.send({ x, y }, id)   // to one peer
room.id, room.peers, room.connected, room.isHost, room.hostId
room.name, room.nameOf(id)   // the signed-in handle, or a guest name like "Brisk Otter"
```

Quick play lets the site pick the room: `useRoom({ max: 12 }, handlers)` joins
the newest room of this cart with a seat, or starts one. `room.roomName` is the
room it chose; the host calls `room.setJoinable(false)` while a match is under
way so nobody is dropped into the middle of it, and `{ pool: "teams", max: 8 }`
keeps a mode's players together.

`room.inviteUrl` is a link to the cart's page that brings a friend into this
room (`?room=q.ffa.3`), while it has a seat and is joinable; otherwise they are
matched as anybody else. Runs from the editor get rooms of their own, so
testing a change never puts you in a match with the cart's players.

A dropped connection that comes back within a minute gets its own id and name
back, so a game keeps its score; `onJoin` says `back`. A page that is hidden (a
locked phone, a tab in the background) stops being host, so whatever the host
runs moves to somebody still playing.

**The site is a relay and runs no game logic**, because a game here is a
JavaScript bundle and half of it living on a server would end "fork this and
change it". The rule that makes a dumb relay safe is worth stating twice:

> Every client is the authority on itself and on nothing else.

You broadcast where you are; you decide when *you* died. A kill is not a message
anybody can send, so the worst a liar can do is refuse to die, which makes them
strange to watch and harms nobody else's game. Let the bigger player declare the
kill instead and you have handed every client the ability to eat anyone at any
distance.

Shared state that needs one owner (a food field, a round timer) goes to the
host, and the room decides who that is: `room.isHost`, `room.hostId`, and
`onHost` when it changes. It used to be "the lowest peer id present", evaluated
by each game, and that elected sockets whose browser had already gone: only the
relay knows who is still connected. The header of `room.ts` has the story.

Budgets: 24 peers a room, 8 KB a message, 60 messages a second a socket. Send
position at about 15 to 20 Hz and interpolate between updates rather than
sending every frame. A busy room gathers what it sends you into one frame every
33 ms; you still receive single messages, in order.

`examples/big-fish` is the reference, and its `ocean.ts` header is the longer
version of the argument above.

## Leaderboards

```tsx
const board = useLeaderboard({ limit: 6 })   // board.entries: {name, score, at}[]
if (scores.available) board.submit(points)   // never throws
```

Submitting needs a short-lived token the host mints when it serves the game's
document, checked against the game it was minted for. **That stops a stranger
with curl and nothing more.** A player can read the token out of their own page
and post whatever they like, and nothing short of running the game's rules on a
server would change that. These boards are for bragging, and the site says so
where people can read it rather than implying a rigour that is not there.

A run from the editor has a board of its own: what you score while testing
shows on that board and never on the cart's public one.

Guard the call so one run posts one score: a frame loop notices the end of a
game sixty times a second.

## Transforms

`Transform2D` is onejs-react's; oj's subclass only overrides `makePoint`, so
`point()` returns oj's `Vector2` instead of a CS one. Painter2D has no transform
stack, so coordinates are transformed as they are recorded. `t.path(painter)` wraps only the ops that take coordinates; colours,
widths, fill and stroke stay on the painter. Mirroring Painter's whole surface
would mean editing the transform every time Painter grows a feature.

`arc` is never silently wrong. Under translation, rotation and uniform scale it
is forwarded natively, so behaviour matches an untransformed arc exactly. Under
non-uniform scale, skew or reflection it is flattened into cubic beziers,
because a circle under those is an ellipse that Painter2D's `Arc` cannot
express. `arcTo` is deliberately absent rather than approximated: calling it is
a compile error, which beats a runtime surprise.

## What a game can reach, which takes two mechanisms

**Filtering the export surface.** Anything in onejs-react whose public API requires building or
receiving a C# object is left out of `oj` rather than shipped as a landmine.
(A game may still name C# itself; see below.)
onejs-react's `Transform2D` was the sharp one: its `point()` returns
`new CS.UnityEngine.Vector2`, so oj exports a subclass whose points are oj's
`Vector2`. The full list with reasons is the header comment in
`src/index.ts`, and `surface.test.ts` enforces it, so a future
`export * from "onejs-react"` fails the suite instead of silently reintroducing
the landmines.

**Shadowing the globals**, which is the half that is easy to forget. Filtering
exports does nothing about global scope: after the bootstrap runs, the bridge's
plumbing (`__cs`, `__releaseHandle`, `__registerCallback`), the filesystem
(`readTextFile`, `writeTextFile`, `deleteFile`) and the runtime's internals are
sitting on the embedding page's `globalThis`. So the container evaluates a
bundle through `evaluateBundle` in `sandbox.ts`, which runs it inside a function
whose parameters shadow them (`SHADOWED_GLOBALS`), plus every browser-only
global (`document`, `window`, `AudioContext`, `XMLHttpRequest`, ...), because a
game that reaches for one can never leave the web (`BROWSER_ONLY_GLOBALS`).

**`CS`, `useExtensions` and `$typeof` are deliberately not shadowed**: a game
may name C# directly, since oj cannot wrap the long tail of UnityEngine and the
BCL. The price is a promise: a published game is pinned to its runtime version,
so whatever `link.xml` preserves is that version's permanent API, and a runtime
version may only ever add to it (PlayRuntime/README.md,
`Tools/link-surface-check.mjs`).

That shadowing only works because **`oj` is an esbuild external the container
preloads**, not a dependency bundled into each game. The reconciler calls `CS`
at runtime, so if it shared a bundle with game code, any shadow that hid `CS`
from the game would break the reconciler too. Externals are a prerequisite, not
a size optimisation, though they also cut a game bundle from a couple of hundred
kilobytes to a handful and make the runtime version pin mean something.

`compileStyleSheet` is injected rather than shadowed, and that is not optional:
onejs-unity's uss-modules and tailwind plugins both emit a bare call to it into
every bundle that uses CSS Modules or Tailwind.

Both mechanisms are compatibility and ergonomics decisions, **not security
ones**, and the shadowing is a strong default rather than a jail: `globalThis.CS`
walks straight past it. The iframe sandbox and the CSP on the game origin are
what keep the platform safe. These keep it changeable, and a game that
deliberately tunnels to `globalThis.CS` is out of contract and free to break.

## Writing a game

```tsx
import { useState } from "react"
import { View, Text, mount, useFrame, input } from "oj"

function Game() {
    const [jumps, setJumps] = useState(0)
    useFrame(() => { if (input.keyboard.wasKeyPressed("Space")) setJumps(jumps + 1) }, [])
    return <View><Text>{`jumps: ${jumps}`}</Text></View>
}

mount(<Game />)
```

No build config and no root plumbing: `mount()` knows where to
render because the container told the runtime. `examples/` holds complete games written this
way, and they typecheck against `oj` exactly as a published game does:

| Example | Bundled | Exercises |
|---|---:|---|
| `starter` | 2.1 KB | What `/new` scaffolds: one screen, one loop, nothing else |
| `pendulum` | 1.8 KB | A frame loop, and dt as the whole reason it runs the same everywhere |
| `tally` | 3.0 KB | One reducer: every change is a named action, so undo is the log walked back |
| `one-note` | 2.8 KB | One clip, loaded once, played at five pitches |
| `first-shader` | 5.7 KB | A shader file (`ripple.sl`) and the one uniform a slider writes |
| `arcane-portal` | 11.9 KB | A shader written in Magerie, unchanged, with a colour and a speed the player drives |
| `wordie` | 82.6 KB | Turn-based input, CSS Modules, a seeded daily word |
| `falling-blocks` | 9.8 KB | Real-time gravity and key repeat off the frame delta |
| `twos-company` | 9.2 KB | USS transitions animating a board, stable ids across a move |
| `fireworks` | 3.7 KB | Particles, and sounds shipped as the game's own files |
| `space-junk` | 8.9 KB | `useDrawing` drawing a whole arcade game in one path, every frame |
| `murmuration` | 5.1 KB | A spatial grid, and a simulation that has to stay order-independent |
| `wayfinder` | 8.0 KB | Retained-mode elements where almost nothing changes per frame |
| `drop-everything` | 4.5 KB | The physics world, and a pool because bodies cannot be added |
| `particle-lab` | 11.4 KB | Sliders driving a real config, printed back out to paste |
| `solitaire` | 11.6 KB | Drag and drop, suits drawn as paths, no pointer handlers at all |
| `big-fish` | 8.3 KB | A room, a leaderboard, and a relay you cannot trust |
| `block-party` | 14.5 KB | The same well as falling-blocks, drawn as one path because a room holds 24 of them |
| `squiggle` | 12.2 KB | A field every client lays from one seed, so a join needs no handshake |
| `sumo` | 12.2 KB | A physics world and a room at once, and a shove nobody can be told they took |
| `quickdraw` | 10.0 KB | A reaction measured with no clock to share, and a board that sorts the wrong way |
| `fire` | 1.5 KB | Tinder: a fire from two noise fields, a mask and a ramp, in `fx` |
| `ember` | 10.8 KB | A fire written as a shader file, with the file on screen beside it |
| `tuner` | 9.0 KB | Three uniforms, the shader that reads them, and its TypeScript source side by side |
| `foobar` | 2.1 KB | A test bed for the asset path |

Every one typechecks against `oj` exactly as a published game does, the
logic in each is tested without a screen, and `npm test` also runs `ojplay test` on
every one in the real container (`cli/examples.e2e.test.ts`): its
`playtest.mjs` when it has one, otherwise a smoke run that boots it and fails on
a console error or a row that looks wrong. Three examples failed that for
months with nothing running them (#3).

The four after `starter` are deliberately the smallest thing that teaches one
idea, and nothing else: a frame loop, a reducer, a sound, a shader. They are
where to send somebody who has not written one of these before, and each is
short enough to read in full before the page finishes loading.

Four of them are worth reading for a decision rather than a mechanic.
`wayfinder` uses elements where the arcade games use a painter, because a search
changes four squares a frame and leaves a thousand alone. `drop-everything`
creates every body it will ever have up front, because a physics world cannot
grow. `solitaire` reads the pointer through `input` in a frame loop rather than
through React's pointer events, for the reason in the input section above, and
gets touch for free. `big-fish` is the one to read before writing anything
multiplayer.

**Input events queue to the frame boundary.** A browser delivers a keydown
whenever it likes, including between frames. Applying it on arrival stamps it
with the frame that is already ending, so game logic reads it as last frame's
press and `wasKeyPressed` is false. `beginFrame` drains the queue first, so a
frame sees exactly the events that arrived since the previous one.

**Before an example ships:**

1. `ojplay typecheck` passes.
2. A `playtest.mjs` drives every control and checks what it changes, not the
   text beside it (`examples/arcane-portal/playtest.mjs`).
3. `ojplay test playtest.mjs` passes. That also fails on a console error, on a
   centred row whose controls do not line up with their labels, and on a
   control within 8px of its neighbour. `npm test` runs it for every example.
4. A value that changes (a slider's readout, a score) sits in a fixed-width
   box, right-aligned with tabular digits, 12px from the control it reports,
   so it neither jitters nor touches the control (`examples/arcane-portal`).
5. Once it is live, `node Tools/playtest/rows.mjs <sid>` runs the same row
   checks on the published page.

## The command line

`ojplay` is this package's `bin`: `npm install -g ojplay` once, then `ojplay <command>`
anywhere. `npx ojplay <command>` needs no install, and is what agents are told.
Inside a cart with its own ojplay in `node_modules`, the global `ojplay` runs that
copy, so the version that builds the cart is the one it chose. A flag that
copy does not know (its own `args.mjs` is asked first) is refused before it
runs, naming its version and `npm install ojplay@latest`, rather than left to the
copy to judge a flag it has never heard of (learn Mac, 6 Nov 2026: `push
--unlisted` handed to a 0.14.0). Once a day at most, a global `ojplay` at a terminal says in one line when npm has a newer one.

A cart's repository is two files, `index.tsx` and `oj.json`, because the site
builds it and the editor's tree should be the cart and nothing else; what a
terminal needs is written by `init` and gitignored like `node_modules`:

```bash
ojplay add @singtaa/lightning   # use another cart: oj.json gets its newest version, .oj/carts its source and art
                             #   (in an empty folder, starts a cart that uses it; no account needed)
ojplay update          # the carts this one uses, to their newest in the same major (--major: newest of all)
ojplay remove @singtaa/lightning   # stop using it; names the files that still import it
ojplay init            # package.json, tsconfig.json, env.d.ts, ignore rules (.git/info/exclude in a clone); then npm install
ojplay init --unity    # in Assets/<Name>/~ of a Unity project: a JSRunner project and prefab, installed and built
ojplay build           # bundle the cart the way the site does; errors as file:line:col
ojplay build --unity --out <dir>   # for OneJS, a cart at a Unity project's root (--watch, --production)
ojplay typecheck       # tsc --noEmit
ojplay run             # the cart in the site's real container, in a local headless Chrome
ojplay test playtest.mjs   # run, then drive the cart from a script (no script: a smoke run)
ojplay status          # main's build, why the tip differs, and each cart with what it runs and who can play it (--json for scripts)
ojplay list            # every cart on the account, a repo's carts each on a line
ojplay login           # print a play.onejs.com link; after Allow there, this machine can push
ojplay logout          # forget that login, here and on the site
ojplay push            # push the branch you are on: every cart following it moves, a branch with none gets an Unlisted one; exit 1 if the tip did not build or nothing was committed
ojplay push --unlisted # a cart's first push: its first cart Unlisted rather than Public
ojplay new "Name"      # start a cart here: the starter in a new git repo, no account; its first push makes it on the site
ojplay clone @h/name   # clone a cart; git pull and push in it work with OJ_TOKEN or the login
ojplay runtime         # fetch the container into ~/.onejs-play (--runtime <version>)
```

**`new` starts a cart on this machine.** It writes the starter (the same
files the site's New makes, from `examples/starter` through
`build/starter.mjs`) into `./<name>`, makes it a git repository on `main`
with one commit, and sets `init`'s tooling up beside it, ignored. No account
and no network. The first `push` in a cart with no `origin` makes its repo on
the site, empty and public, under oj.json's `name` (logging in first when
there is no login), sets `origin` and pushes `main` with its upstream. With
`--private` it asks for a private repo instead, whose first cart is Private,
which the site makes only for an account with private repos and otherwise
refuses, making and pushing nothing; on a later push to a public repo,
`--private` pushes nothing and says so. With `--unlisted` the first cart is
Unlisted from the moment the repo is made, never in the site's list until its
owner makes it Public; on a later push to a repo whose main cart is Public,
`--unlisted` pushes nothing and says so. The
site makes it empty because its usual create commits the starter, which a
history begun here could never fast forward onto. A name the account already
has is refused there, with that cart's address, and nothing is made.

**`init --unity` makes a clone a JSRunner project in place.** Clone the cart
to `Assets/<Name>/~` in a Unity project that has OneJS (Unity ignores a folder
named `~`, which keeps the source and `node_modules` out of the import), then
run `ojplay init --unity` there. It writes JSRunner's own default files
into the clone, read from the OneJS the project installed rather than copied
into this package, points the build at the entry `oj.json` names, and puts a
PanelSettings and `<Name>.prefab` beside the clone. Every file it writes into
the clone goes in the repository's info/exclude, so `git status` still shows
the game and nothing else. Then it installs and builds. Dragging the prefab
into a scene runs the game, and JSRunner rebuilds on save from then on. A clone
added with `git submodule add` works the same way: its exclude file is asked
of git rather than assumed to be `.git/info/exclude`. The template table in
`cli/unity.mjs` mirrors `templateMapping` in OneJS's `JSRunner.cs`, and the
container's test holds the two together.
A template the installed OneJS does not ship is skipped, so an older OneJS
still works, and `CLAUDE.md` (the line `@AGENTS.md`) is written only where
there is an `AGENTS.md`, as JSRunner writes it.

The cart's files sit at their own names in the repository, and OneJS reads a
JSRunner project's files from `~/assets/`. So the build `init --unity` writes
carries `assetsPlugin()` (`ojplay/unity`), which copies every file the
site would serve into `assets/` before each build, keeping its folders. The
copies are excluded from git, the site refuses a top-level `assets` folder so
none of the cart's files can be in the way, and a copy is removed once its file
leaves the cart (only a copy the plugin wrote, never a file put there by hand).

**A cart at a Unity project's root needs nothing of Unity's inside it.** With a
OneJS whose JSRunner links carts by name, `ojplay add @handle/name` at a Unity
project's root puts the cart in `<Name>/` beside `Assets` (a submodule when the
project is a git repository and the cart is yours, its pinned build when it is
somebody else's), sets it up as any cart is set up (`ojplay init`, then `npm
install`), and writes `Assets/<Name>/` with a PanelSettings and a prefab whose
JSRunner names the cart. With an older OneJS it takes the cart into
`Assets/<Name>/~` as above. OneJS builds the cart with `ojplay build --unity
--out <dir>`, which writes `app.js.map.txt`, `app.sl.json` and `files.json`,
then `app.js.txt` last, and nothing inside the cart: the cart builds by the
site's rules from its own `node_modules`, and a prologue tells oj and the
loaders where its files are (the cart's folder in the editor, used carts under
`.oj/carts`; `StreamingAssets/onejs/carts/<folder>` in a player). The contract
is `Specs/ROOT_CARTS.md` §5.4a in the OneJS container, and changes there first.
`ojplay typecheck` says once when a cart names `CS`, Unity's C# API: such a cart
runs only on a Unity host.

**`ojplay run` runs what ships.** It fetches the container the site serves at
`/runtime/<version>/` (the pin from `/api/version`, or `--runtime`) into
`~/.onejs-play/runtime/<version>/` once, serves it with the cart's bundle and
assets from a local origin, and boots it in Chrome the way the sandbox
document does: `__ojPlay.load(source, manifest)`. A desktop build of the
container was considered and rejected: it would be a second runtime, on
QuickJS rather than V8, and the bugs that matter (the 1.0.12 Task that never
settled) were WebGL-only. Headless by default; `--headed --watch` opens a
window and swaps a fresh build in on every save without reloading the
runtime, which is the container's own hot path and takes about ten
milliseconds. The boot's `startGame` commits the new cart's first render
inside that call (`flushSync`), so the old picture stays until the new one
replaces it; the Play editor's Run swaps the same way. It exits 1 if the cart logged a console error, `Property not
found` included.

**`ojplay test` hands a script the running game.** The script's default export
gets a `Game`: `read()` (the text on screen, top to bottom), `find(text)` (where
it is, `{ x, y, width, height }`, once laid out), `click(x, y)`,
`drag()`, `move()` in stage pixels (page CSS pixels), `press("KeyA")`,
`hold("KeyA")` (returns a release function), `type("crane")`, `wait(ms)`,
`until(predicate)`, `stage()`, `eval(js)` in the page, `shot(file)`, `reload()`,
`rowProblems()`, `errors` and `console`. A thrown error fails the run, and so does a
console error or a row that looks wrong (`cli/rows.mjs`, measured from resolved
layout): in a centred row, a slider's track, a toggle's box or a text field's
input off the row's centre line; in any row, a control within 8px of its
neighbour, measured from a text's ink rather than its box. When the script throws,
a screenshot lands in `.oj/failed.png`; call `shot(file)` for one otherwise.
`examples/wordie/playtest.mjs` is the one to
copy from. With no script, `ojplay test` lets the cart run `--for` seconds
(default 2) and applies the same checks.

**A pressed key is its own press.** `press`, `hold` and `type` wait for the
container to run a frame after each key goes down and after it comes up. A
frame knows which keys went down since the last one but not in what order, so
two presses that share a frame reach a game's loop in whatever order it checks
them. A player never lands two keystrokes in one frame; a script can, and
right after start the container's first frame lasts seconds: Wordie's playtest
typed CRANE into it and submitted ACENR (#3). Keys go down the way a real
keystroke does, `keyDown` with its text (Enter types `\r`) or `rawKeyDown` when
it types nothing, and the page is the focused, visible tab: headless Chrome
otherwise opens it unfocused and hides it at the first key, and a hidden page
runs no frames. `cli/fixtures/keys` presses every named key straight after
start and requires each to arrive alone and in order.

What the harnesses in `Tools/playtest` learned applies here unchanged, and
their README's section on instruments that report clean answers while
measuring nothing is the thing to read before writing a check: count letters
rather than test membership, compare an identity or a movement rather than a
constant, and open the screenshot.

`cli/chrome.mjs` is also what the production harnesses in `Tools/playtest`
launch and speak to, so the launcher and the protocol client exist once.
Chrome is found in the usual places or named by `OJ_CHROME`, starts with a mock keychain and a basic password store so it never asks the OS for its cookie key (on macOS with no keychain under HOME that was a dialog on the person's screen, and `Page.navigate` waited on it), and is driven
over Node's built-in WebSocket, so `ojplay run` and `ojplay test` need Node 22 or
newer, and say so when started on older Node. The package declares no
`engines`: every new OneJS project installs it, and most never run those two. One container fills about four cores under the software rasteriser,
so run one per four cores, and one at a time on Windows, where two at once
ran past a 12 minute cap and four starved a four-core machine outright (key
presses wait for frames, so a slow machine only makes a run longer). The
first Chrome after a reboot can take half a minute to start; `oj` allows it
90 s. A CDP call that goes unanswered for 30 s fails as a hang, except a screenshot, which gets two minutes: a capture waits for the page to draw and costs about eleven of the cart's frames, which on `windows-latest`'s software renderer (no GPU, a 3x phone at 0.7 fps) came to 15 to 26 s. Ctrl-C during `ojplay test` closes its browser before it exits, and a run that fails at any step, Chrome's start and the first page load included, closes it and deletes the profile it made. `ojplay login` is login by link: the person opens the link it prints, signed in, and presses Allow, and the token (an agent login: create, edit, push and rebuild, main by fast forward only, 30 days) lands in `~/.onejs-play/token`, or `.oj/token` in the cart where home cannot be written, with git's credential helper for the site pointed at it. `--no-wait` prints the link and exits; `ojplay login --wait <code>` collects that one, and `--wait` alone collects the only one waiting. `OJ_TOKEN`, a token from the site's tokens page, is used instead when set, by ojplay and by git in a cart ojplay made or pushed first (`clone`, `new` once pushed, `add`): its config holds a helper that reads `OJ_TOKEN` or the login's file when git asks, never the token. `OJ_SITE`
points every command at another origin; `OJ_HOME` moves the cache. `push` and `status` find the cart from the clone's `origin`: a `/c/<sid>.git` URL names it (and an older `/g/<sid>.git` one), and the address bar's `/@handle/name.git` is looked up in the account's own carts, so that form needs the login.

## Testing

```bash
npm test          # vitest, including ojplay test over every example (needs Chrome and the network)
npm run test:unit # everything but the two *.e2e.test.ts files, which drive Chrome
npm run test:e2e  # just those two
npm run typecheck # tsc twice: strict, then strict off as the Play editor compiles oj (tsconfig.loose.json)
```

`npm test` runs `ojplay test` on every example and CLI fixture, in the CLI's own
headless Chrome against the runtime the site says is live (fetched once into
`~/.onejs-play`). One Chrome is started first, so a cold machine's slow first
start is not charged to a cart. Runs go one per four cores (one on a
four-core CI runner, always one on Windows; `OJ_SWEEP_LIMIT` overrides it), and
a run with no result after three minutes is interrupted and fails with what it
printed. The sweep ends by printing Chrome's start times (median, p90, worst,
against the limit) and the run lengths. About two and a half minutes on a
four-core runner, five on Windows; `npm run test:unit` skips it while iterating on something else.

CI runs `test:unit` and then `test:e2e` as two steps rather than `npm test`.
Run together, the e2e files' software-rendered Chrome starved the unit workers
on a Windows runner: a worker's report to vitest went unanswered for vitest's
60 s limit, and the run went red with every test passing.

An example written for the next runtime line, whose API the live runtime does
not have yet, says so in its oj.json: `"runtime": "1.2"` is the oldest line it
runs on (`cli/runtime-line.mjs`). Against an older live runtime the sweep skips
it, names it as waiting for that line, and counts the waits in its last line;
once the line is live it runs again with nothing to change. A sweep in which
every cart waited fails, since it compared nothing.

`pre-setup.ts` installs a permissive `CS` stub, because onejs-react's
`components.tsx` calls `useExtensions(CS.UnityEngine.ImageConversion)` at module
scope. The real container has QuickJSBootstrap installed long before a game
bundle is evaluated, which is also a constraint on the host's `setCode` hot
swap: the bootstrap globals have to survive the soft reset, not just the initial
load.

`color.test.ts` runs a cross-package parity check against onejs-react's
`toWire`, so `Color` and particles keep reading colours the same way.

## Gotchas

**Vectors are references, not structs.** `UnityEngine.Vector2` is a struct, so
`a = b` copies. These are JS classes, so `a = b` aliases and mutating one
mutates the other. Use `clone()` where C# would have copied for you.

**`Mathf` is faithful, including the surprising parts.** `Mathf.Sign(0)` is `1`,
not `0`. `Mathf.Round` is banker's rounding, so `Mathf.Round(0.5)` is `0` and
`Mathf.Round(2.5)` is `2`, unlike `Math.round`.

**The stage's y counts down, and the keyboard's axes count up.** Positions
(the mouse, touches, styles) are y-down screen space, while `wasd()`,
`arrows()` and `axis2D()` give y as +1 for up, as Unity does. Subtract the axis
to move up the screen: `y -= input.keyboard.wasd().y * speed * dt`.

**Key names are Unity's (`W`, `Space`, `LeftArrow`), and DOM `KeyboardEvent.code`
values (`KeyW`, `ArrowLeft`) work too**, on the site and in Unity. Both name the
physical key, so WASD stays the same three-key row on AZERTY. A name that is
neither warns once rather than staying silently up.

**`random` ranges are max-exclusive for both ints and floats**, unlike
`UnityEngine.Random`, which is exclusive for ints and inclusive for floats.

## Follow-ups

- Have onejs-react capture `CS` at module scope, so the container can `delete`
  the globals outright instead of only shadowing them.
- Gamepad, via a browser Gamepad API adapter pushing into `InputSink`.
- Axis smoothing, as an option on the axis binding rather than a second method.
- `oj.storage`. `oj.audio`, `assetUrl`, `useFrame` and the `oj` namespace object
  were on this list and are all shipped.
- Names on peers. A room reports numbers, and a game that wants "Sam" has to
  invent its own naming. Held back because a name people choose is a moderation
  surface, not because it is hard.
