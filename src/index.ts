/**
 * oj: the container runtime for OneJS Play.
 *
 * Published to npm as "onejs-play" and imported as "oj" through an esbuild
 * alias, the same mechanism OneJS already uses to dedupe React. The alias ships
 * in the scaffolded esbuild config, so it survives eject.
 *
 * THE DESIGN RULE
 * oj is a strict subset of OneJS, never a variant. Everything here also works
 * in a normal Unity OneJS project, so ejecting a game is: copy the file into a
 * scene folder, npm i, build. If a feature cannot work both places it is cut,
 * or it degrades to a documented no-op after eject.
 *
 * WHAT IS DELIBERATELY NOT RE-EXPORTED FROM onejs-react
 * A container game is not meant to reach CS.*, so anything whose public API
 * requires building or receiving a C# object is left out rather than shipped as
 * a runtime landmine:
 *
 *   Vector2, Color                 type aliases to CS types. oj shadows both
 *                                  with real JS classes (see vec.ts, color.ts).
 *   Angle, ArcDirection,
 *   Painter2D,
 *   MeshGenerationContext          raw painter interop types. Use the batched
 *                                  Painter, which takes plain numbers.
 *   useVectorContent               the raw painter path. onejs-react's
 *                                  Transform2D belongs here too: its point()
 *                                  returns new CS.UnityEngine.Vector2 and would
 *                                  throw. oj exports its own JS-only
 *                                  Transform2D under the same name instead.
 *   registerElement,
 *   createComponent                register arbitrary C# types as elements.
 *   useFrameSync, useEventSync,
 *   useThrottledSync, toArray      C# interop hooks. There is no C# to sync to.
 *   toWire, unmountAll,
 *   getDebugInfo                   internal surfaces, not game API.
 *
 * Container-side machinery (the global shadowing, the input backend) lives in
 * onejs-play/container, not here. A game never imports it.
 *
 * Filtering this list is necessary and nowhere near sufficient. The OneJS
 * bootstrap puts CS, useExtensions and about 35 other names straight onto the
 * embedding page's globalThis, so a game reaches them without importing
 * anything at all. sandbox.ts is the half that deals with those, and the
 * container has to use it; measured numbers are in Tools/container-spike.
 *
 * Both halves are compatibility and ergonomics decisions, not security ones.
 * The iframe sandbox and the CSP on the game origin are what keep the platform
 * safe. These keep it changeable.
 */

// MARK: stage

export {
    normalizeStage,
    computeStageLayout,
    toStage,
    fromStage,
    DEFAULT_STAGE_WIDTH,
    DEFAULT_STAGE_HEIGHT,
} from "./stage"
export type { StageFit, StageInput, StageConfig, StageLayout, StageRect } from "./stage"

// MARK: entry point and frame clock

export { mount, useStage } from "./mount"
export { useFrame } from "./frame"

// MARK: transforms

export { Transform2D, TransformedPath } from "./transform"
export type { PathSink } from "./transform"

// MARK: input
//
// onejs-unity's input module, unchanged. A container game and a normal OneJS
// project call the same API; only the backend behind it differs. See
// onejs-unity/input/backend.ts and ./input.ts.

export { input, resolveKeyName, keyNameFromDomCode } from "onejs-unity/input"

// Sound, over Unity's AudioSource rather than WebAudio. WebAudio exists only in
// a browser, so a game built on it could never leave the web, which is why the
// container shadows it. Same API and same behaviour on every platform.
export { audio } from "onejs-unity/audio"
export type { Sound, Voice, PlayOptions } from "onejs-unity/audio"

// 2D physics. The simulation and the writing of positions onto elements both
// happen in C#, so a hundred bodies cost JavaScript nothing per frame.
export { usePhysics, createPhysicsWorld } from "./physics"
export type { PhysicsWorld, WorldConfig, BodyConfig, BodyShape, BodyType, Contact } from "./physics"
export type { Keyboard, Mouse, Gamepad, Touch } from "onejs-unity/input"

// MARK: math

// MARK: a game's own files

export { assetUrl, loadTexture, useTexture, useFlipbook, loadSheet } from "./asset"
export type { UvRect } from "./asset"

/**
 * The texture pipeline: build and process images on the GPU.
 *
 *     import { fx } from "oj"
 *     const flame = fx.useAnimatedTexture(512, 512, (t) => ...)
 *
 * A namespace rather than loose exports, because fx has a useTexture of its own
 * and oj already exports one that loads a game asset. Two hooks with one name,
 * doing unrelated things, is worse than one extra word at the call site.
 *
 * Everything in here is fragment blits, so it works in the browser. The compute
 * shader path it deliberately avoids does not exist on WebGL at all.
 */
export * as fx from "onejs-unity/fx"

// MARK: the site behind the game

export { scores, useLeaderboard } from "./scores"
export type { ScoreEntry, ScoreWindow, TopOptions, SubmitOptions, Leaderboard } from "./scores"

export { useRoom, validRoomName } from "./room"
export type { Room, RoomOptions, RoomMessage } from "./room"

export { isOnline } from "./play"

export { Mathf } from "./mathf"
export { Vector2 } from "./vec"
export { Color } from "./color"
export { random } from "./random"
export type { Rng } from "./random"

// MARK: components

export {
    View,
    Text,
    Label,
    Button,
    TextField,
    Toggle,
    Slider,
    ScrollView,
    Image,
    ListView,
    TreeView,
    FrostedGlass,
    clearImageCache,
} from "onejs-react"

// MARK: rendering

export { render, unmount, createPortal, flushSync, batchedUpdates } from "onejs-react"
export { Portal } from "onejs-react"
export type { PortalProps } from "onejs-react"
export { ErrorBoundary, formatError } from "onejs-react"
export type { ErrorBoundaryProps } from "onejs-react"

// MARK: responsive

export {
    ScreenProvider,
    useBreakpoint,
    useScreenSize,
    useResponsive,
    useMediaQuery,
    BREAKPOINTS,
} from "onejs-react"
export type { ScreenContextValue, ScreenProviderProps, BreakpointName } from "onejs-react"

// MARK: vector drawing (batched only; the raw painter path needs CS.*)

export { Painter, batchedVisualContent, useBatchedVectorContent } from "onejs-react"

// MARK: particles

export { createParticles, useParticles } from "onejs-react"
export type {
    ParticlesConfig,
    EmitterConfig,
    EmitterShape,
    ParticlesHandle,
    EmitterHandle,
    BurstOptions,
    ParticleRange,
    ParticleColor,
    AttractConfig,
    AttractEase,
    EdgeMode,
    SheetConfig,
} from "onejs-react"

// MARK: shader effects

export { ShaderEffect, TextureFX, Flame, TextureFXBuilder, buildTextureFX, MAX_TEXTUREFX_LAYERS } from "onejs-react"
export type {
    FlameProps,
    TextureFXProps,
    ShaderEffectProps,
    TextureFXBuild,
    LayerHandle,
    NoiseOptions,
    ShapeOptions,
    BlendMode,
    ShapeKind,
} from "onejs-react"

// MARK: types

export type {
    ViewStyle,
    PointerEventData,
    MouseEventData,
    WheelEventData,
    KeyEventData,
    ChangeEventData,
    FocusEventData,
    DragEventData,
    GeometryEventData,
    NavigationEventData,
    NavigationDirection,
    TransitionEventData,
    PointerEventHandler,
    MouseEventHandler,
    WheelEventHandler,
    KeyEventHandler,
    ChangeEventHandler,
    FocusEventHandler,
    DragEventHandler,
    GeometryEventHandler,
    NavigationEventHandler,
    TransitionEventHandler,
    BaseProps,
    ViewProps,
    TextProps,
    LabelProps,
    ButtonProps,
    TextFieldProps,
    ToggleProps,
    SliderProps,
    ScrollViewProps,
    ImageProps,
    ListViewProps,
    TreeViewProps,
    TreeViewItem,
    FrostedGlassProps,
    RenderContainer,
    VisualElement,
    TextElement,
    LabelElement,
    ButtonElement,
    TextFieldElement,
    ToggleElement,
    SliderElement,
    ScrollViewElement,
    ImageElement,
    FrostedGlassElement,
} from "onejs-react"
