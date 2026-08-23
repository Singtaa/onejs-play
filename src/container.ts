/**
 * The host-facing half of onejs-play.
 *
 * Nothing here is game API. The container imports this to stand a game up:
 * shadow the runtime's globals, evaluate the bundle, and feed input. Games
 * import "oj" (the package root) and never see any of it, which is the same
 * split react and react-dom draw.
 *
 *     import { evaluateBundle, createContainerInput } from "onejs-play/container"
 *     import { setInputBackend } from "onejs-unity/input"
 */

export { evaluateBundle, snapshotGlobals, removeAddedGlobals, SHADOWED_GLOBALS, INJECTED_GLOBALS } from "./sandbox"
export type { EvaluateBundleOptions } from "./sandbox"

export { createRuntime, getCurrentRuntime } from "./runtime"
export { setAssetBase, getAssetBase } from "./asset"
export { resetTheme, THEME_USS } from "./theme"
export { setPlayContext, getPlayContext } from "./play"
export type { PlayContext } from "./play"
export type { OjRuntime, ContainerRuntime, RuntimeOptions, TimeState } from "./runtime"

export { createContainerInput } from "./input"
export type { ContainerInput, InputSink } from "./input"

export { createDomInputAdapter, hasDom } from "./adapter"
export type { DomInputOptions } from "./adapter"
