# onejs-play

The container runtime for OJPlay. Published to npm as `onejs-play`, imported
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
| `index.ts` | The game-facing surface, aliased to `oj` |
| `mount.ts` | `mount()` and `useStage()` |
| `frame.ts` | `useFrame`, the per-frame clock a game runs on |
| `gesture.ts` | `useSwipe`, read off `input` once per frame |
| `stage.ts` | The stage (the window, in logical pixels) and Unity screen space into it |
| `asset.ts` | `assetUrl`, `loadTexture`, `useTexture`, `useFlipbook`, `loadSheet`: a game's own files |
| `audio.ts` | onejs-unity's `audio`, with `load` taking a bare file name |
| `scores.ts` | `scores` and `useLeaderboard` |
| `room.ts` | `useRoom`: other people, over a relay |
| `wire.ts` | What each relay message does to a room's state (peers, host), kept testable apart from the socket |
| `physics.ts` | `usePhysics`, with the per-frame pumping done |
| `mathf.ts` | `Mathf`, Unity-shaped, implemented in JS |
| `vec.ts` | `Vector2`. No `Vector3`: the container is 2D only |
| `color.ts` | `Color`, hex parsing shared in behaviour with the particle wire schema |
| `transform.ts` | `Transform2D` and the transformed path wrapper for the batched painter |
| `random.ts` | Seeded generators for daily challenges, replays, reproducible bugs |
| `theme.ts` | The default look of the controls the runtime provides |
| `code.ts`, `code-view.tsx` | `tokenize` and `<Code>`: TypeScript highlighting for a game that shows source |
| `container.ts` | The host-facing surface, `onejs-play/container` |
| `runtime.ts` | Container-side: builds the `oj` object a game receives |
| `play.ts` | Container-side: where the site is, and the token proving a real session |
| `sandbox.ts` | Container-side: keeps a game bundle off the runtime's globals |
| `input.ts` | Container-side: the input backend onejs-unity reads through |
| `adapter.ts` | Container-side: browser events into that backend |
| `standalone.ts` | Starting a runtime outside a container, which is what eject needs |
| `hostinput.ts` | Outside a container: the real InputBridge with pointer reads converted to stage pixels |

Beside `src/`, two folders that are not the runtime:

| Folder | Contents |
|---|---|
| `build/` | `game.mjs`, the one builder every game is built with (the site on publish and on Run, `oj build`, the shipped-games script), and `externals.json`, the modules the container provides. The esbuild instance is a parameter, wasm in the Worker and native here. |
| `cli/` | The `oj` command line, the package's `bin`. |
| `host/` | `boot.mjs`, the script that boots the container and hands it a game, inlined by the site's sandbox document and by the page `oj run` serves. One copy of the contract with `__ojPlay.load`; the two documents differ only in where the runtime is, how the bundle arrives and whom they tell. |

Everything above the `container.ts` line is reachable from a game. Everything
below it is the host's, and a game bundle cannot see it: `oj` is the package
root and `onejs-play/container` is a separate entry point.

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
container shadows. So `createContainerInput()` in `onejs-play/container`
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

Reading through `input` also gets touch for free, since the same code sees
`input.touches`. A swipe is `useSwipe(onSwipe)` from `gesture.ts`: it follows
one finger or a mouse drag through `input`, fires once per gesture past a
threshold, and ignores the mouse while a finger is down, because the container
reports a touch as the mouse too and listening to both fires everything twice.
Twos Company carried that state machine itself before it moved here.

**Hooks read the latest render.** `useFrame` and `fx.useAnimatedTexture` call
the callback from the most recent render on every frame, so a callback can
read state and props directly and the dependency list only says when to
resubscribe or restart the clock. The first version froze the first render's
closure for the life of the component, and every game with a slider ended up
mirroring its state into a ref to get around it.

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
import { assetUrl, useTexture, audio } from "oj"

const glow = useTexture("glow.png")            // a Unity texture, or null
const pop = await audio.load("pop.wav")
```

A bare file name, resolved differently on each side of an eject: on the site to
`/assets/<name>` on the game's own origin, and in a Unity project to the
project's `assets/` folder in the editor or `StreamingAssets/onejs/assets/` in a
build. The container passes its origin in as `assetBase` when it creates the
runtime; with none set, OneJS's own project convention applies, which is exactly
what an ejected copy needs.

**Where the files go.** An asset's name is its path from the sketch's root:
`pop.wav` beside `index.tsx`, or `sfx/pop.wav` in a folder of your own. Never in
a folder called `assets/`: `assetUrl` strips a leading `assets/` (the habit a
web developer arrives with), so the site stores such a file and never serves
it. Images are png or jpeg, and names are case-sensitive. `oj run` and `oj
test` serve `/assets/` by the same rule (`cli/assets.mjs`, a copy of the
site's `media.ts`), warn at start about any asset no request can reach, and
print why each refused request was refused. `fireworks` and `one-note` kept
their sounds in `assets/` and were silent locally and live until this (#3).

Explicit at the call site on purpose. Teaching every loader a hidden base would
mean a bare `"glow.png"` resolving through machinery a reader cannot see, and
two loaders that disagreed about it would be a bug with no visible cause.

`loadTexture`, `useTexture` and `audio.load` all take the bare name. oj's
`audio` (`audio.ts`) is onejs-unity's with `load` resolving a name through
`assetUrl`; a URL passes through untouched.

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

## Other people

`useRoom(name)` puts a game in a room with everybody else playing it.

```tsx
const room = useRoom("lobby", {
    onOpen: (myId, peers) => {},
    onJoin: (id) => {},
    onLeave: (id) => {},
    onMessage: (from, data) => {},
})
room.send({ x, y })       // to everyone else
room.send({ x, y }, id)   // to one peer
room.id, room.peers, room.connected, room.isHost, room.hostId
```

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
position at about 15 Hz and interpolate between updates rather than sending
every frame.

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

Guard the call so one run posts one score: a frame loop notices the end of a
game sixty times a second.

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

## What a game can reach, which takes two mechanisms

**Filtering the export surface.** Anything in onejs-react whose public API requires building or
receiving a C# object is left out of `oj` rather than shipped as a landmine.
(A game may still name C# itself; see below.)
onejs-react's `Transform2D` is the sharp one: its `point()` returns
`new CS.UnityEngine.Vector2` and would throw here, so oj exports its own JS
version under the same name. The full list with reasons is the header comment in
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
| `space-junk` | 8.9 KB | The batched painter drawing a whole arcade game in one path |
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
logic in each is tested without a screen, and `npm test` also runs `oj test` on
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

1. `oj typecheck` passes.
2. A `playtest.mjs` drives every control and checks what it changes, not the
   text beside it (`examples/arcane-portal/playtest.mjs`).
3. `oj test playtest.mjs` passes. That also fails on a console error, on a
   centred row whose controls do not line up with their labels, and on a
   control within 8px of its neighbour. `npm test` runs it for every example.
4. A value that changes (a slider's readout, a score) sits in a fixed-width
   box, right-aligned with tabular digits, 12px from the control it reports,
   so it neither jitters nor touches the control (`examples/arcane-portal`).
5. Once it is live, `node Tools/playtest/rows.mjs <sid>` runs the same row
   checks on the published page.

## The command line

`oj` is this package's `bin`. A game's repository is two files, `index.tsx`
and `oj.json`, because the site builds it and the editor's tree should be the
game and nothing else; what a terminal needs is written by `init` and
gitignored like `node_modules`:

```bash
npx onejs-play init   # package.json, tsconfig.json, env.d.ts, ignore rules (.git/info/exclude in a clone); then npm install
npx onejs-play init --unity   # in Assets/<Name>/~ of a Unity project: a JSRunner project and prefab, installed and built
oj build            # bundle the game the way the site does; errors as file:line:col
oj typecheck        # tsc --noEmit
oj run              # the game in the site's real container, in a local headless Chrome
oj test playtest.mjs   # run, then drive the game from a script (no script: a smoke run)
oj status           # what the site is running: head, live, buildError
oj login            # print a play.onejs.com link; after Allow there, this machine can push
oj logout           # forget that login, here and on the site
oj push             # git push, then exit 1 if the tip did not build
oj new "Name"       # create a game on the site and clone it
oj runtime          # fetch the container into ~/.onejs-play (--runtime <version>)
```

**`init --unity` makes a clone a JSRunner project in place.** Clone the game
to `Assets/<Name>/~` in a Unity project that has OneJS (Unity ignores a folder
named `~`, which keeps the source and `node_modules` out of the import), then
run `npx onejs-play init --unity` there. It writes JSRunner's own default files
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

The game's files sit at their own names in the repository, and OneJS reads a
JSRunner project's files from `~/assets/`. So the build `init --unity` writes
carries `assetsPlugin()` (`onejs-play/unity`), which copies every file the
site would serve into `assets/` before each build, keeping its folders. The
copies are excluded from git, the site refuses a top-level `assets` folder so
none of the game's files can be in the way, and a copy is removed once its file
leaves the game (only a copy the plugin wrote, never a file put there by hand).

**`oj run` runs what ships.** It fetches the container the site serves at
`/runtime/<version>/` (the pin from `/api/version`, or `--runtime`) into
`~/.onejs-play/runtime/<version>/` once, serves it with the game's bundle and
assets from a local origin, and boots it in Chrome the way the sandbox
document does: `__ojPlay.load(source, manifest)`. A desktop build of the
container was considered and rejected: it would be a second runtime, on
QuickJS rather than V8, and the bugs that matter (the 1.0.12 Task that never
settled) were WebGL-only. Headless by default; `--headed --watch` opens a
window and swaps a fresh build in on every save without reloading the
runtime, which is the container's own hot path and takes about ten
milliseconds. It exits 1 if the sketch logged a console error, `Property not
found` included.

**`oj test` hands a script the running game.** The script's default export
gets a `Game`: `read()` (the text on screen, top to bottom), `click(x, y)`,
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
copy from. With no script, `oj test` lets the sketch run `--for` seconds
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
Chrome is found in the usual places or named by `OJ_CHROME`, and is driven
over Node's built-in WebSocket, so `oj run` and `oj test` need Node 22 or
newer. One container fills about four cores under the software rasteriser,
so run one per four cores, and one at a time on Windows, where two at once
ran past a 12 minute cap and four starved a four-core machine outright (key
presses wait for frames, so a slow machine only makes a run longer). The
first Chrome after a reboot can take half a minute to start; `oj` allows it
90 s. Ctrl-C during `oj test` closes its browser before it exits. `oj login` is login by link: the person opens the link it prints, signed in, and presses Allow, and the token (an agent login: create, edit, push and rebuild, main by fast forward only, 30 days) lands in `~/.onejs-play/token`, or `.oj/token` in the sketch where home cannot be written, with git's credential helper for the site pointed at it. `--no-wait` prints the link and exits; `oj login --wait` collects. `OJ_TOKEN`, a token from the site's tokens page, is used instead when set. `OJ_SITE`
points every command at another origin; `OJ_HOME` moves the cache.

## Testing

```bash
npm test          # vitest, including oj test over every example (needs Chrome and the network)
npm run typecheck # tsc --noEmit
```

`npm test` runs `oj test` on every example and CLI fixture, in the CLI's own
headless Chrome against the runtime the site says is live (fetched once into
`~/.onejs-play`). One Chrome is started first, so a cold machine's slow first
start is not charged to a sketch. Runs go one per four cores (one on a
four-core CI runner, always one on Windows; `OJ_SWEEP_LIMIT` overrides it), and
a run with no result after three minutes is interrupted and fails with what it
printed. The sweep ends by printing Chrome's start times (median, p90, worst,
against the limit) and the run lengths. About two and a half minutes on a
four-core runner, five on Windows; `npx vitest run --exclude
cli/examples.e2e.test.ts` skips it while iterating on something else.

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

**`random` ranges are max-exclusive for both ints and floats**, unlike
`UnityEngine.Random`, which is exclusive for ints and inclusive for floats.

## Follow-ups

- Have onejs-react capture `CS` at module scope, so the container can `delete`
  the globals outright instead of only shadowing them.
- Export `parseColor` from onejs-react and have `Color.FromHex` use it, so the
  two parsers become one.
- Gamepad, via a browser Gamepad API adapter pushing into `InputSink`.
- Axis smoothing, as an option on the axis binding rather than a second method.
- `oj.storage`. `oj.audio`, `assetUrl`, `useFrame` and the `oj` namespace object
  were on this list and are all shipped.
- Names on peers. A room reports numbers, and a game that wants "Sam" has to
  invent its own naming. Held back because a name people choose is a moderation
  surface, not because it is hard.
