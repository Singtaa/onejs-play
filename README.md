# onejs-play

The container runtime for OneJS Play. Published to npm as `onejs-play`, imported
by games as `oj` through an esbuild alias. The npm name `oj` was already taken,
and the alias is the same mechanism OneJS already uses to dedupe React, so it
ships in the scaffolded esbuild config and survives eject.

## The design rule

**oj is a strict subset of OneJS, never a variant.** Everything here also works
in a normal Unity OneJS project, so ejecting a game is: copy the file into a
scene folder, `npm i`, build. Zero diff.

Every proposed feature answers one question: does this also work in a real OneJS
project? If not, it is cut, or it degrades to a documented no-op after eject.

## What is here

| Module | Contents |
|---|---|
| `stage.ts` | Logical coordinate space and how it maps to the viewport |
| `mathf.ts` | `Mathf`, Unity-shaped, implemented in JS |
| `vec.ts` | `Vector2`. No `Vector3`: the container is 2D only |
| `color.ts` | `Color`, hex parsing shared in behaviour with the particle wire schema |
| `transform.ts` | `Transform2D` and the transformed path wrapper for the batched painter |
| `input.ts` | Container-side: the input backend onejs-unity reads through |
| `sandbox.ts` | Container-side: keeps a game bundle off the runtime's globals |
| `random.ts` | Seeded generators for daily challenges, replays, reproducible bugs |
| `runtime.ts` | Container-side: builds the `oj` object a game receives |
| `mount.ts` | `mount()` and `useStage()` |
| `index.ts` | The game-facing surface, aliased to `oj` |
| `container.ts` | The host-facing surface, `onejs-play/container` |

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

960x540 letterboxed is the default, not a constraint. A game picks its own
logical size and its own fit:

| `fit` | Behaviour |
|---|---|
| `letterbox` | Preserve aspect, bars fill the remainder. Default. |
| `cover` | Preserve aspect, crop the overflow. |
| `stretch` | Ignore aspect, fill exactly. |
| `fluid` | No fixed stage. `oj.stage` tracks the viewport in logical pixels. |

`fluid` matters more than it looks. UI Toolkit is the renderer, so many games in
this lane are responsive apps (cards, incrementals, builders) that want to
reflow rather than scale.

Fullscreen is orthogonal. It changes how many pixels are available; the fit
still applies. The host page owns the Fullscreen API call so the user gesture
and the Permissions Policy stay on its side of the iframe boundary.

Pointer positions are always reported in logical units. `toStage` is that
conversion, and `input` applies it.

## Input

There is no `oj.input`. Games call **onejs-unity's `input`**, the same API a
normal OneJS project uses, so game code reads identically here and after eject.

```tsx
import { input } from "oj"

if (input.keyboard.wasKeyPressed("Space")) jump()
const p = input.mouse.position     // logical stage units
```

That module normally reads UnityEngine's InputBridge through `CS`, which the
container shadows. So `createContainerInput()` in `onejs-play/container`
supplies the same methods from browser events, and the host installs it with
onejs-unity's `setInputBackend`. One API, one implementation, a swappable
source. Writing a second input API here would have been the maintenance
nightmare in miniature.

**Read the pointer through `input`, not through React's pointer events.** The
two do not report the same numbers, and nothing warns you:

| | Reports |
|---|---|
| `input.mouse.position`, `input.touches[n].position` | logical stage units |
| `onPointerDown` and friends | **panel** pixels |

A letterboxed stage offsets one from the other, so hit testing against a layout
written in stage units silently misses by the size of the bars. React's events
also carry `x` and `y` rather than the `localX` and `localY` a web habit
reaches for, and a handler typed as `any` accepts both happily: Patience shipped
with every card unclickable because of exactly that pair of mistakes. Its
`ChangeEventData` sibling carries `value`, not `newValue`, which broke every
slider in Particle Lab the same way.

Reading through `input` also gets touch for free, since the same code sees
`input.touches`.

Edges are frame numbers rather than booleans cleared each frame. That gets the
awkward cases right: a key pressed and released inside one frame reports both
`wasKeyPressed` and `wasKeyReleased`, and OS auto-repeat does not re-fire
pressed. `blur()` releases everything held, without which alt-tabbing while
holding a key leaves it held forever.

The sink speaks DOM and the backend speaks Unity, translating once on
ingestion. Two places that bite: DOM `KeyboardEvent.code` maps onto Unity key
names (`ArrowLeft` to `LeftArrow`), and DOM `MouseEvent.button` disagrees with
Unity's mask about middle and right, so passing the index straight through would
silently swap them.

## A game's own files

Until recently a game was text and nothing else: no sprite, no sound, no font.
Now it can ship them, and `assetUrl` is the one function that knows where they
went.

```tsx
import { assetUrl, useTexture, audio } from "oj"

const glow = useTexture("glow.png")            // a Unity texture, or null
const pop = await audio.load(assetUrl("pop.wav"))
```

A bare file name, resolved differently on each side of an eject: on the site to
`/assets/<name>` on the game's own origin, and in a Unity project to the
project's `assets/` folder in the editor or `StreamingAssets/onejs/assets/` in a
build. The container passes its origin in as `assetBase` when it creates the
runtime; with none set, OneJS's own project convention applies, which is exactly
what an ejected copy needs.

Explicit at the call site on purpose. Teaching every loader a hidden base would
mean a bare `"glow.png"` resolving through machinery a reader cannot see, and
two loaders that disagreed about it would be a bug with no visible cause.

`loadTexture` and `useTexture` take the bare name, matching onejs-unity's
`loadImageAsync`. `audio.load` takes a URL, because it is onejs-unity's function
passed through unchanged rather than a variant of it, so it gets `assetUrl(...)`
at the call site.

**Two things had to be fixed in the runtime before any of this worked**, and
both were invisible from the outside:

- onejs-react's image loader had no URL bypass, so a full URL was mangled into
  `{streamingAssets}/onejs/assets/https://...` and never fetched. onejs-unity's
  own resolver has always had that check; the copy in the reconciler did not.
- On WebGL, `QuickJSUIBridge.Tick()` is never called, because the browser drives
  the JS scheduler instead. Settling completed C# Tasks lived in `Tick()`, so on
  WebGL **every** Task-returning API stayed pending forever: `audio.load` and
  `<Image src="http...">` never resolved and never rejected, in every web build,
  with nothing logged. It is settled from `TickSystems()` now, which is the one
  thing Update does still call.

## Transforms

Painter2D has no transform stack, so coordinates are transformed as they are
recorded. `t.path(painter)` wraps only the ops that take coordinates; colours,
widths, fill and stroke stay on the painter. Mirroring Painter's whole surface
would mean editing `transform.ts` every time Painter grows a feature.

`arc` is never silently wrong. Under translation, rotation and uniform scale it
is forwarded natively, so behaviour matches an untransformed arc exactly. Under
non-uniform scale, skew or reflection it is flattened into cubic beziers,
because a circle under those is an ellipse that Painter2D's `Arc` cannot
express. `arcTo` is deliberately absent rather than approximated: calling it is
a compile error, which beats a runtime surprise.

## Keeping games off `CS.*`, which takes two mechanisms

**Filtering the export surface.** Anything whose public API requires building or
receiving a C# object is left out rather than shipped as a runtime landmine.
onejs-react's `Transform2D` is the sharp one: its `point()` returns
`new CS.UnityEngine.Vector2` and would throw here, so oj exports its own JS
version under the same name. The full list with reasons is the header comment in
`src/index.ts`, and `surface.test.ts` enforces it, so a future
`export * from "onejs-react"` fails the suite instead of silently reintroducing
the landmines.

**Shadowing the globals**, which is the half that is easy to forget and was
missing from an earlier version of this README. Filtering exports does nothing
about global scope: after the bootstrap runs, `CS`, `useExtensions`,
`readTextFile`, `writeTextFile`, `deleteFile` and about 30 more are sitting on
the embedding page's `globalThis`. A game imports nothing, types
`CS.UnityEngine.Application`, and it works. So the container evaluates a bundle
through `evaluateBundle` in `sandbox.ts`, which runs it inside a function whose
parameters shadow all of them. Verified against a real WebGL build: 55 of the 56
listed names are actually present on the page, and none leak through.

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
import { View, Text, mount, useFrame, input } from "oj"

function Game() {
    useFrame(() => { if (input.keyboard.wasKeyPressed("Space")) jump() }, [])
    return <View><Text>hello</Text></View>
}

mount(<Game />)
```

No `CS.*`, no build config, and no root plumbing: `mount()` knows where to
render because the container told the runtime. `examples/` holds complete games written this
way, and they typecheck against `oj` exactly as a published game does:

| Example | Bundled | Exercises |
|---|---:|---|
| `starter` | 1.9 KB | What `/new` scaffolds: one screen, one loop, nothing else |
| `vowel-play` | 82.9 KB | Turn-based input, CSS Modules, a seeded daily word |
| `well-stacked` | 9.2 KB | Real-time gravity and key repeat off the frame delta |
| `twos-company` | 10.6 KB | USS transitions animating a board, stable ids across a move |
| `fireworks` | 3.8 KB | Particles, and the only game that ships assets |
| `space-junk` | 7.7 KB | The batched painter drawing a whole arcade game in one path |
| `murmuration` | 5.1 KB | A spatial grid, and a simulation that has to stay order-independent |
| `wayfinder` | 6.7 KB | Retained-mode elements where almost nothing changes per frame |
| `drop-everything` | 4.2 KB | The physics world, and a pool because bodies cannot be added |
| `particle-lab` | 7.6 KB | Sliders driving a real config, printed back out to paste |
| `patience` | 10.9 KB | Drag and drop, one pointer handler, suits drawn as paths |

Every one typechecks against `oj` exactly as a published game does, and the
logic in each is tested without a screen: `npm test` covers the rules of the
games, not their pixels.

Three of them are worth reading for a decision rather than a mechanic.
`wayfinder` uses elements where the arcade games use a painter, because a search
changes four squares a frame and leaves a thousand alone. `drop-everything`
creates every body it will ever have up front, because a physics world cannot
grow. `patience` puts three pointer handlers on the board instead of a hundred
and fifty six on the cards, because every handler costs a slot in the native
callback table.

**Input events queue to the frame boundary.** A browser delivers a keydown
whenever it likes, including between frames. Applying it on arrival stamps it
with the frame that is already ending, so game logic reads it as last frame's
press and `wasKeyPressed` is false. `beginFrame` drains the queue first, so a
frame sees exactly the events that arrived since the previous one.

## Testing

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
```

`pre-setup.ts` installs a permissive `CS` stub, because onejs-react's
`components.tsx` calls `useExtensions(CS.UnityEngine.ImageConversion)` at module
scope. The real container has QuickJSBootstrap installed long before a game
bundle is evaluated, which is also a constraint on the host's `setCode` hot
swap: the bootstrap globals have to survive the soft reset, not just the initial
load.

`color.test.ts` runs a real cross-package parity check against onejs-react's
`toWire`, so the two hex parsers cannot drift.

## Gotchas

**Vectors are references, not structs.** `UnityEngine.Vector2` is a struct, so
`a = b` copies. These are JS classes, so `a = b` aliases and mutating one
mutates the other. Use `clone()` where C# would have copied for you.

**`Mathf` is faithful, including the surprising parts.** `Mathf.Sign(0)` is `1`,
not `0`. `Mathf.Round` is banker's rounding, so `Mathf.Round(0.5)` is `0` and
`Mathf.Round(2.5)` is `2`, unlike `Math.round`.

**Positive vertical is DOWN**, unlike `UnityEngine.Input`. The stage is a y-down
screen space, so `y += axis("vertical") * speed` has to move the way the player
pressed.

**Key names are DOM `KeyboardEvent.code` values**, not Unity `KeyCode`. They are
layout-independent, so WASD stays the same physical three-key row on AZERTY.

**Cropping is decided in pixel space against a tolerance.** Float error in
`(viewport - size * scale)` makes an exactly-fitting letterbox look a hair
cropped, which would make `visible.x > 0` true for every game. See
`visibleAxis` in `stage.ts`.

**`random` ranges are max-exclusive for both ints and floats**, unlike
`UnityEngine.Random`, which is exclusive for ints and inclusive for floats.

## Follow-ups

- Have onejs-react capture `CS` at module scope, so the container can `delete`
  the globals outright instead of only shadowing them.
- Export `parseColor` from onejs-react and have `Color.FromHex` use it, so the
  two parsers become one.
- Gamepad, via a browser Gamepad API adapter pushing into `InputSink`.
- Axis smoothing, as an option on the axis binding rather than a second method.
- `oj.audio`, `oj.storage`, `oj.assets`, `useFrame`, and the `oj` namespace
  object: these need the container runtime, which does not exist yet.
