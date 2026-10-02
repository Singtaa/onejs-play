# oj API review, cart side (2 Oct 2026)

What a cart sees: everything `oj` exports, the 3D API from 214c897, the `.sl` and `fx` surface, `oj.json`, and the `ojplay` command line. It was read against six measures: ergonomics and readability, defaults, robustness, performance, future proofing and consistency. The OneJS side (onejs-react, onejs-unity, the C# runtime) is reviewed separately in the container's `Specs/API_REVIEW_ONEJS.md`. Findings that live there are listed at the end and were handed over.

**State of the fixes.** The non-breaking fixes are merged to onejs-play `main` (4ac9fe9) and the PlaySite docs fixes to the container's `main`. Nothing is released, cut or deployed. A cart on play.onejs.com gets the code fixes only after an npm release and a Play runtime cut, and a Unity project gets them only after an npm release. The docs changes describe today's behaviour, so they are safe to deploy before either.

Severity: **high** means a learner following the docs hits it and nothing explains why; **medium** means wrong or wasteful in a way a user will meet; **low** is polish. Effort: small is under an hour, medium is a day, large is more.

## The learner test

Three carts were written from play.onejs.com/docs and agents.md alone, with ojplay 0.9.9 against runtime 1.0.53. Each was typechecked with `npx ojplay typecheck` and run with `npx ojplay test`.

| Cart | Uses | Result |
|---|---|---|
| Clicker | View, Text, Button, Image, useState, useFrame, useStage, audio.load | Passed after one fix: `<Image src="coin.png">` 404ed |
| Glow | a `.sl` plasma with a Slider driving a uniform, `fx.canvas` with `useAnimatedTexture`, `useParticles` bursts | Passed first time |
| Haunt | useScene, useModel, spawn, pick, a `screenPoint` label, pointLight, yaw in useFrame | Passed first time |

The 3D and shader surfaces are the strongest part of oj: every guess made from their pages typechecked and ran. The weak spots were all at the edges: loading files, the first example on each page, and key names.

Wrong guesses and lines that read badly aloud, each pointing at the finding that covers it:

1. `<Image src="coin.png">` 404s on the site, while useTexture, audio.load and useModel take the bare name (F1).
2. The first example on Writing a Cart, and the one in agents.md, fail `npx ojplay typecheck`, the check agents.md says to run before pushing (F3).
3. Shipping Files opens with a top level `await audio.load(...)`, which the build refuses (F3).
4. Shipping Files passes `texture: glow` to useParticles while `glow` is still null; the particles never get it (F4).
5. Effects names the particle handle `fx`, shadowing the `fx` namespace on the same page (F4).
6. Elements and Styling says Button "Takes `text`"; children work too (F3).
7. `useTexture(name)` loads a file while `fx.useTexture(build, deps)` builds one, and `fx.useAnimatedTexture(canvas, build)` takes its arguments in the other order (P4).
8. `ojplay init` in an empty folder says "now: npm install, then npx ojplay run", which cannot run there (F2).
9. `boo.dissolve(1, 1.2)` does not say what 1 and 1.2 are (P2); a label at `screenPoint()` starts at the point rather than centring on it (L6).
10. One space has three names: "window pixels", "panel space" and "the root's coordinates" (F3).

## Top ten

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | high | `<Image src>` does not take a cart's file by name on the site | Fixed, F1 |
| 2 | high | `ojplay test --headed play.mjs` drops the script and prints "passed"; `push --help` pushes | Fixed, F2 |
| 3 | high | The docs' first examples fail typecheck, and Shipping Files' first snippet fails the build | Docs fixed, F3 |
| 4 | high | A particle texture that loads after mount never reaches the particles | Docs fixed; code handed over, F4 |
| 5 | high | Docs teach `"KeyA"`, which never fires; DOM spellings stop working after eject | Fixed, F5 |
| 6 | medium | 3D handles: live `scene.actors`, mutable positions, `camera()` resetting, `dissolve` jumping or hanging | Fixed, F6 |
| 7 | medium | ModelBridge has one global scene; a second useScene, or unmounting either, breaks both | Proposal, P1 |
| 8 | medium | oj's `audio` froze its voice counts at import and needed an audio bridge just to import | Fixed, F7 |
| 9 | high | Mouse, drag and transition props typecheck and never fire | Handed over, O2 |
| 10 | medium | Shipping Files promises a texture cache that did not exist | Fixed, F9 |

## Fixed tonight

Each is red first: a test that failed on the old code, committed with the fix.

### F1. `<Image src>` takes a cart's file by name (high)

`onejs-react/src/components.tsx:61` resolves a bare name against the runtime's own StreamingAssets. In a Unity project that is where the cart's files are; on the site it is the container's. So the same `src` drew in Unity and 404ed on the site, with an error naming `StreamingAssets/onejs/assets/coin.png`, a path the learner never wrote. Every other loader in oj (useTexture, loadTexture, audio.load, useModel) already resolved through `assetUrl`.

```tsx
// before: <Image src={assetUrl("coin.png")} /> was the only form that worked everywhere
// after (src/image.tsx): oj's Image runs src through assetUrl first
export const Image = forwardRef<ImageElement, ImageProps>(({ src, ...rest }, ref) => (
    <BaseImage ref={ref} src={src ? assetUrl(src) : src} {...rest} />
))
```

Not breaking: a URL, a rooted path and assetUrl's own result pass through unchanged. Commit b7782a8. Effort small. Once the runtime is cut, Shipping Files can show `<Image src="logo.png" />` and drop `assetUrl` from its first snippet.

### F2. A strict command line (high)

`cli/oj.mjs` gave every `--flag` the word after it. So `ojplay test --headed play.mjs` parsed as `{ headed: "play.mjs" }`, ran the two second smoke test and printed "passed", with exit 0. `<command> --help` ran the command (`init --help` wrote four files, `push --help` pushed). A misspelled flag was dropped without a word. A bare `--out` wrote a file named `true`, and `--runtime ../../x` made a folder outside `~/.onejs-play`.

`cli/args.mjs` now declares every flag as a switch, a value, or an optional value:

```
$ ojplay test --hedaed
[ojplay] unknown flag --hedaed (did you mean --headed?)
$ ojplay bulid
[ojplay] unknown command bulid (did you mean build?). ojplay help lists them.
$ ojplay run --window 1280
[ojplay] --window is width,height in pixels, like --window 960,540
```

`--help` and `-h` print help before anything runs, `-v` prints the version, a missing test script is reported before Chrome starts, and `init` in a folder with no cart says how to get one. Not breaking: everything refused was already wrong. Commit 962f28c. Effort small.

### F3. Docs that disagreed with the code (high)

All in `PlaySite/content`, all true of what ships today:

| Where | Was | Now |
|---|---|---|
| writing-a-cart.md:19, agents.md:110, elements-and-styling.md:131 | `useRef(null)` then `ref.current.style.left = x`, which fails `ojplay typecheck` ("possibly null") | `useRef<VisualElement>(null)` and `if (ref.current)` |
| files.md:15, agents.md:132 | `const pop = await audio.load("pop.wav")`; esbuild refuses top level await in the cart's iife bundle | `audio.load("pop.wav").then((pop) => pop.play())` |
| elements-and-styling.md:27 | Button "Takes `text`" | "its label as `text` or as children" |
| elements-and-styling.md:143, 3d.md:90 | "panel space", "the root's coordinates" | "window pixels", the term every other page uses |
| 3d.md:75 | `await boo.dissolve(1, 1.2) // fade it out` | says 1 is fully dissolved and 1.2 is seconds |
| writing-a-cart.md:87, agents.md:126 | keys are DOM codes, `"KeyA"` | Unity names, which work on both sides today; the y direction of `wasd()` stated |

The onejs-play README had the same top level await and key name text, and a gotcha about an `axis("vertical")` that does not exist and a y direction that is the opposite of the code's (8ef8c41).

### F4. A particle texture that arrives late (high, docs half)

`onejs-react/src/particles.ts:485` reads its config once, on mount (`deps = []`). Shipping Files' example passes `texture: useTexture("glow.png")`, which is null on that first render, so the particles draw the plain dot forever, silently. Tonight the docs pass `[glow]` as deps and say why. The code fix (re-apply emitter textures in place through `SetEmitterTexture` when they change) is onejs-react's and was handed over (O1). Effects also called the particle handle `fx`, shadowing the namespace; it is `sparks` now.

### F5. Key names both ways (high)

The docs said key names are DOM `KeyboardEvent.code` values. In the container `isKeyDown("KeyW")` was false forever while `"W"` worked, and a typo like `"Spcae"` was silent. After eject the DOM spellings (`"ArrowUp"`) went to InputBridge, which warned and answered `Key.None`, so a cart lost its arrow keys in Unity. Both backends now resolve through `keyNameFromDomCode` (`src/input.ts:416`, `src/hostinput.ts`), and an unknown name warns once. The container's backend also gained the haptics and gamepad methods an ejected cart's has, so `pauseHaptics()` no longer throws on the site. Commit 5a8126e. Not breaking. Effort small.

### F6. 3D handles that behave like the JavaScript they read as (medium)

All in `src/models.ts`, plain bugs, left otherwise to the 3D design:

| Was | Now |
|---|---|
| `for (const a of scene.actors) a.destroy()` left half of them: the getter returned the live array | a copy |
| `boo.position[1] += 5` changed what the getter reported without moving the actor; the next `yaw =` teleported it | positions are frozen copies; assign a new one to move |
| `scene.camera({ fov: 30 })` reset the position and target to the defaults | changes only what it names |
| `dissolve(0)` during `dissolve(1, 1)` jumped to 0.9 | turns back from where it is |
| `await boo.dissolve(1)` hung forever if the actor was destroyed or the scene went | settles |
| `screenPoint()` ignored the spawn scale, putting a label inside a scaled model | lifts by `height * scale` |
| `SCENE_DEFAULTS` was writable, and the container's oj outlives a cart | frozen |

Commit 640b00d. Not breaking. Effort small.

### F7. Live audio counts (medium)

`src/audio.ts` built `audio` as `{ ...unityAudio, load }`. The spread read the `voices` and `activeVoices` getters once at import, so they never changed again, and a host without an audio bridge threw from `import "oj"`. It is now built on onejs-unity's object with `load` overridden. Commit 0d98de2. Not breaking. Effort small.

### F8. Vector2 takes any point (medium)

`Vector2.Distance(p, input.mouse.position)` and `p.add(rng.direction())` failed strict typecheck with "Type 'Vector2' is missing ... from type 'Vector2'", because onejs-unity's input names its `{ x, y }` Vector2 too. Every parameter is now `Vec2Like = Readonly<{ x: number, y: number }>`, and the statics no longer call methods a plain point lacks. `Vector2.up` and `down` say which way they point on screen. Commit 3ab7a54. Not breaking: types only widen.

### F9. The texture cache the docs promise (medium)

Shipping Files says textures are cached by URL. Nothing cached them: each `useTexture` mount fetched and decoded a new texture. `loadTexture` now keeps one load per URL for the life of a host, forgets a failed one, and starts over when the host changes, which is every Run. Commit 9f2e549. Not breaking.

### F10. Smaller

- `scores.submit(NaN)` was refused only online, so the bug reached nobody until the cart was live (5cae477).
- `src/index.ts` exports grouped under their headings; "MARK: math" was empty (e85f1c1).

## Proposals for Sai

Each one renames, removes, changes a signature or is a design call. There are no real users yet; nothing below touches a published cart found in the repo unless it says so.

### P1. One scene, owned (medium, design)

`src/models.ts:265` calls `BeginScene`, and dispose calls `DisposeAll`. ModelBridge (`Runtime/Models/ModelBridge.cs`) holds one global scene. So a second `useScene` silently takes over the first one's camera and lights, and unmounting either destroys every actor, light and model, leaving the other holding dead handles. A `Model` from `useModel` that outlives its scene (`{playing && <World/>}`) keeps a dead id, and `spawn` throws C#'s `no model 7`.

```tsx
// option A: refuse it, and say so
createScene() // [oj] one useScene at a time: unmount the other before making another
// option B: models belong to the scene, so they cannot outlive it
const scene = useScene()
const ghost = scene?.useModel("ghost.glb")   // or useModel reading the scene from context
```

A is not breaking for anything that works today. B changes how `useModel` is called. Either way `loadModel` should share one load per file per scene (`src/models.ts:190`; today each `useModel("ghost.glb")` makes a new GltfImport). Touches: 3d.md, the Ghost Hunt plan. Effort small (A) or medium (B). Owner: whoever owns the 3D design.

### P2. `dissolve` with named arguments (low, breaking)

`boo.dissolve(1, 1.2)` reads as two magic numbers.

```tsx
// before
await boo.dissolve(1, 1.2)
// after
await boo.dissolve({ to: 1, seconds: 1.2 })   // or boo.fadeOut(1.2) and boo.fadeIn(0.5)
```

Touches 3d.md and any 3D cart. Effort small. Shipping it before 3D carts exist is cheaper than after.

### P3. Room to grow in 3D (low, additive)

Actors turn only about y, have no `scale` after spawn, and a scene's sun, ambient, background and fog are read once, so a day and night cycle means remounting the world.

```tsx
boo.rotation = { yaw: 90, pitch: 0, roll: 0 }   // yaw stays as a shorthand
boo.scale = 1.4
scene.sun = { intensity: 0.3 }
scene.background = "#000814"
```

Not breaking. Needs small ModelBridge additions (`SetScale`, setters per option). Effort medium.

### P4. One name per idea in `fx` (medium, breaking)

`useTexture("glow.png")` loads a file and `fx.useTexture(build, deps)` builds one. `fx.useAnimatedTexture(canvas, build)` puts the canvas first and the build second, and `fx.useTexture` has no canvas at all.

```tsx
// before
const still = fx.useTexture(() => canvas.noise(n), [])
const moving = fx.useAnimatedTexture(canvas, (t) => canvas.noise({ ...n, seed: t }))
// after: the same shape, named for what it makes
const still = fx.useImage(canvas, () => canvas.noise(n), [])
const moving = fx.useAnimation(canvas, (t) => canvas.noise({ ...n, seed: t }))
```

Keep the old names as deprecated aliases for a release. Touches effects.md, the fire example and onejs-unity/fx. Effort small. The OneJS side owns the module, so this is a joint call.

### P5. Trim names a cart cannot use (low, breaking)

| Export | Why it goes |
|---|---|
| `render`, `unmount` (`src/index.ts:199`) | `mount` is the entry point, and a cart cannot reach the root they need |
| `encode`, `Encoded`, `EncodedProgram` | old names for `compile` and `CompiledProgram`; no example or doc uses them |
| `manifest` (`src/index.ts:162`) | an editor tool needing `node:fs`; it also collides with "the cart manifest", oj.json |
| `Compiled` | a second name for what `CompiledProgram` is |
| `MouseEventData`, `DragEventData`, `TransitionEventData` and their handlers | events nothing dispatches (O2) |
| `NoiseOptions`, `BlendMode` from TextureFX | `fx.NoiseOptions` and `fx.BlendMode` are different types with the same names; rename these `TextureFXNoise`, `TextureFXBlend` |

Touches nothing found in the repo's examples or docs. Effort small.

### P6. Friendlier names for drawing (low, additive)

`batchedVisualContent` and `useBatchedVectorContent` say Visual in one and Vector in the other, and "batched" means nothing in oj, which has no unbatched path.

```tsx
<View onGenerateVisualContent={drawing((p) => p.circle(50, 50, 40).fill())} />
useDrawing(ref, (p) => ..., [deps])
```

Add as aliases and teach those; keep the OneJS names working. Effort small.

### P7. `random` callable both ways (low, additive)

`random` is only a factory (`src/random.ts:86`), so `random.int(0, 10)`, the Unity habit, is "not a function".

```tsx
export const random = Object.assign(createRng, createRng())
random.int(0, 10)          // a shared generator
random("seed").int(0, 10)  // a seeded one, as today
```

Not breaking. Effort small. A design call because it makes `random` two things.

### P8. `useSound` (low, additive)

`useTexture` and `useModel` hide loading and unloading; sound has no hook, so `examples/one-note/index.tsx:25` repeats eight lines of effect, cleanup and unload.

```tsx
const pop = useSound("pop.wav")   // null until loaded, unloaded on unmount
<Button text="Pop" onClick={() => pop?.play()} />
```

Not breaking. Effort small.

### P9. `ojplay status` readable by default (low, breaking for parsers)

`status` prints raw JSON (`cli/oj.mjs:272`) while `list` prints lines and offers `--json`.

```
$ ojplay status
head 3f2a91c, live 3f2a91c, built OK, https://play.onejs.com/@me/tuner
$ ojplay status --json
{ ... as today ... }
```

Touches agents.md, which tells agents to read the JSON. Effort small.

### P10. Pausing a model (medium, additive)

From magerie-one-004's Ghost Hunt dry run, passed on by OneJSv3Container a2. A cold agent built a pause menu that stopped the roam, the radar and catching, but the ghosts' idle clip kept swaying behind "Paused" and a running dissolve carried on. In its words: "The engine has no way to pause a model's animation."

```tsx
// A: per actor, like Unity's Animator.speed and three.js's timeScale. 0 freezes clip and dissolve.
useEffect(() => { for (const g of ghosts) g.actor.speed = paused ? 0 : 1 }, [paused])
// B: one switch per scene, with nothing to forget for an actor spawned while paused
useEffect(() => { if (scene) scene.paused = paused }, [scene, paused])
```

Recommended: both, with `paused` applied on top of each actor's `speed` so unpausing restores it, and a pending `dissolve` resolving later by the time spent paused rather than rejecting. The dissolve half is JavaScript: the fade loop in `src/models.ts` advances by `dt` and would scale it. The clip half needs a ModelBridge call that sets the Animation state speed, so it ships with a runtime cut. Not breaking. Effort small to medium. OneJSv3Container a2 offers to build it once the shape is chosen.

## Found, not fixed tonight

Non-breaking, and left either for time or because the right fix needs its owner.

| Severity | Where | Finding | Proposed change | Effort |
|---|---|---|---|---|
| medium | `cli/carts.mjs:135` | An oj.json without `entry` is not a cart to the CLI, though the site defaults it to index.tsx; `add`, `update` and `remove` then refuse each other in a loop | treat oj.json plus a root index as a cart, after the Unity checks | small |
| medium | `cli/game.mjs:59` | `ojplay build` passes carts a push refuses: no root index.tsx, oj.json an array, `entry: "style.css"` | share the site's `entryOf` rules and extend the parity test | small |
| medium | PlaySite `routes/publish.ts:409` | Unknown or misspelled oj.json fields (`"contols"`, `"stage"`) warn only in the browser editor, not on push or build | print `metaWarnings` and unknown keys from `ojplay build` and the push output | medium |
| medium | `cli/site.mjs:50` | A network failure prints "fetch failed"; `run` and `test` need the site even with the runtime cached | one helper with a sentence, and fall back to the cached runtime | small |
| medium | `src/physics.ts:10` | The example in the hover text passes `element: ballRef.current`, null at render, so the body never moves its element | accept a ref as well as an element | small |
| medium | `src/room.ts:296` | Switching rooms keeps the old room's peers and id until the new welcome | reset to the empty room in the cleanup | small |
| low | `src/models.ts:307` | Methods on a destroyed actor are silent, or warn about the wrong thing | warn once that the actor is destroyed | small |
| low | `src/asset.ts:64` | `assetUrl("/glow.png")`, the web habit, counts as resolved and fails on the site | strip a leading slash when a container base is set | small |
| low | `src/standalone.ts:94` | An ejected cart polls about six C# crossings a frame for the viewport, and the input proxy allocates a closure per lookup | listen for GeometryChanged; cache the proxy functions | medium |
| low | `src/code.ts:72` | `/*/` closes a comment, CRLF leaves a stray `\r` token, and `Code` retokenizes every render | match `*/` from after the opener, split on `\r?\n`, `useMemo` | small |
| low | package.json | No `engines`; the CLI needs Node 22 and crashes unclearly before 20.11 | `"engines": { "node": ">=22" }` and a first line check | trivial |
| low | 3d.md:90 | A label at `screenPoint()` starts at the point; centring it is left to the reader | show `translate: "-50% -100%"` in the example | trivial |

## Handed to the OneJS side

These live in onejs-react or onejs-unity and were sent to the OneJS review with file and line.

- **O1** (high) `useParticles` never applies a texture that arrives after mount (`particles.ts:485`).
- **O2** (high) `onMouseDown`, `onDrag*`, `onTransitionEnd`, `onInput`, `onContextClick` and `onTooltip` typecheck on every element and never fire (`types.ts:479`).
- **O3** (medium) An inline array uniform resends every uniform on every render (`host-config.ts:1724`).
- **O4** (medium) The `uniforms` type takes only a number or four numbers, though the runtime pads and `.sl` defaults are hex (`types.ts:1085`).
- **O5** (medium) Each `createParticles` leaves a teardown closure behind (`particles.ts:466`).
- **O6** (medium) `fx.image.load` reads Resources, so a cart cannot start an fx chain from its own file (`FxBridge.cs:103`).
- **O7** (low) `encode` and `Encoded` lack `@deprecated`; `resolveKeyName("KeyW")` is null; a throwing `useAnimatedTexture` build logs every frame; the unknown uniform warning names `sl.uniform` to a `.sl` author.

## oj and OneJS names side by side

| oj | OneJS | Note |
|---|---|---|
| `mount(el)` | `render(el, __root)` | oj exports both (P5) |
| `useFrame((dt) => ...)` | `requestAnimationFrame`; `useFrameSync` (not in oj) | |
| `useStage()` | `useScreenSize()` | both exported, both `{ width, height }` |
| `Transform2D` | onejs-react `Transform2D` | same name; oj's returns oj Vector2s and chains |
| `Vector2` (class) | onejs-react `Vector2` (a CS alias), onejs-unity/input `Vector2` (an interface) | three types, one name; F8 makes them interchangeable as arguments |
| `Color` (class) | onejs-react `Color` (a CS alias) | style colours take hex strings, not `Color` |
| `batchedVisualContent`, `useBatchedVectorContent` | `useVectorContent` (raw, not in oj) | P6 |
| `audio.load(name)` | onejs-unity `audio.load(url)` | oj resolves names |
| `useTexture(name)` | none | clashes with `fx.useTexture` (P4) |
| `compile`, `encode` | onejs-sl `compile` | P5 |
| `Mathf`, `random` | `UnityEngine.Mathf`, `UnityEngine.Random` | `random` ranges exclude the max for floats too, unlike Unity |
| `useScene`, `useModel` | ModelBridge | oj only |
