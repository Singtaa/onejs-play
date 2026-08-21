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
| `input.ts` | Polled keyboard and pointer state |
| `random.ts` | Seeded generators for daily challenges, replays, reproducible bugs |
| `index.ts` | The filtered public surface |

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

The core has no platform in it. Events arrive through `InputSink`, which an
adapter fills: UI Toolkit key events in the container, browser events on WebGL,
a recorded script in a headless agent run. Adding a platform means writing an
adapter, never editing `input.ts`, which is also why the whole thing tests in
Node.

`createInput` returns one object viewed three ways: `Input` is what a game
polls, `InputSink` is what an adapter pushes into, `InputSystem` adds the
per-frame driving. There is no wrapper and no runtime isolation between the read
and write halves, because a sandboxed single-player game faking its own input
is not a threat worth an indirection layer.

Edges are frame numbers rather than booleans cleared each frame. That gets the
awkward cases right: a key pressed and released inside one frame reports both
`pressed` and `released`, and OS auto-repeat does not re-fire `pressed`.

`blur()` releases everything held. Without it, alt-tabbing while holding a key
leaves it held forever, because the matching keyup goes to whatever took focus.

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

## What is deliberately not re-exported from onejs-react

Container games cannot reach `CS.*`, so anything whose public API requires
building or receiving a C# object is left out rather than shipped as a runtime
landmine. onejs-react's `Transform2D` is the sharp one: its `point()` returns
`new CS.UnityEngine.Vector2` and would throw here, so oj exports its own JS
version under the same name.

The full list, with reasons, is the header comment in `src/index.ts`.
`surface.test.ts` enforces it, so a future `export * from "onejs-react"` fails
the suite instead of silently reintroducing the landmines.

Every exclusion is a compatibility and ergonomics decision, **not a security
one**. The iframe sandbox and the CSP on the game origin are what keep the
platform safe. This list is what keeps it changeable.

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

- Export `parseColor` from onejs-react and have `Color.FromHex` use it, so the
  two parsers become one.
- Gamepad, via a browser Gamepad API adapter pushing into `InputSink`.
- Axis smoothing, as an option on the axis binding rather than a second method.
- `oj.audio`, `oj.storage`, `oj.assets`, `useFrame`, and the `oj` namespace
  object: these need the container runtime, which does not exist yet.
