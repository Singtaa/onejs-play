/**
 * Keeping a game bundle away from the runtime's globals.
 *
 * WHY THIS EXISTS
 * Filtering oj's export surface does nothing about the global scope. After the
 * OneJS bootstrap runs on WebGL it has put roughly 35 names on the embedding
 * page's globalThis, CS and useExtensions among them, plus a filesystem surface
 * (readTextFile, writeTextFile, deleteFile, listFiles). A game never has to
 * import anything: it types CS.UnityEngine.Application and it works. Measured on
 * a real build, see Tools/container-spike.
 *
 * So the container evaluates a bundle inside a function whose parameters shadow
 * every one of those names, rather than in global scope.
 *
 * THIS ONLY WORKS IF THE RUNTIME IS NOT IN THE GAME'S BUNDLE
 * onejs-react's reconciler calls CS at runtime. If it is bundled together with
 * game code they share one scope, and any shadow that hides CS from the game
 * also breaks the reconciler. So oj has to be an esbuild external that the
 * container preloads, with the bundle referencing it. That is a prerequisite for
 * shadowing, not a size optimisation, though it also drops a game bundle from
 * a couple of hundred kilobytes to a handful and makes the runtime version pin
 * mean something: the reconciler stops being baked into each game.
 *
 * WHAT THIS IS AND IS NOT
 * A strong default, not a jail. Parameter shadowing hides a bare `CS`, which
 * covers every accidental use and all ordinary code, but `globalThis.CS` walks
 * straight past it. Closing that needs the properties actually deleted, which
 * needs onejs-react to capture its CS reference at module scope first (see the
 * follow-up in the README). That is fine: the boundary that keeps the platform
 * safe is the iframe origin and the CSP. This one keeps the platform
 * changeable, and a game that deliberately tunnels to globalThis.CS is out of
 * contract and free to break.
 */

/**
 * Globals the OneJS runtime installs that a game must not see.
 *
 * Taken from a real WebGL build rather than guessed. Re-run
 * Tools/container-spike after a OneJS bump: anything new the bootstrap starts
 * exporting has to land here or it is reachable from game code.
 */
/**
 * Globals that exist only because the container happens to run in a browser.
 *
 * THIS IS THE PORTABILITY CONTRACT, AND IT IS THE POINT OF THE PLATFORM
 *
 * A OneJS app runs on the browser's engine under WebGL and on QuickJS
 * everywhere else. Anything in this list exists in the first case and not the
 * second, so a game that reaches for one is a game that can never leave the
 * web. On WebGL the container shares the page's global scope, so without this
 * they are all simply there, one identifier away, and the failure shows up as
 * a ReferenceError on a platform the author was not testing.
 *
 * Shadowing turns that into something better than an error: the name becomes
 * undefined, so `typeof window === "undefined"` is true and a bundled library
 * feature-detecting its environment takes its non-browser path by itself.
 *
 * The list is derived, not guessed. QuickJSBootstrap.js.txt installs fetch,
 * Headers, Response, AbortController, localStorage, sessionStorage,
 * performance, requestAnimationFrame, the timers, queueMicrotask, URL,
 * URLSearchParams, btoa, atob and WebSocket on every platform. Those are
 * portable and deliberately absent below. Everything here is what the
 * bootstrap does not provide.
 */
export const BROWSER_ONLY_GLOBALS: readonly string[] = [
    // The DOM and the page. None of it exists outside a browser, and a game
    // rendering through UI Toolkit has no use for it in the first place.
    "document", "window", "self", "parent", "top", "frames", "location",
    "history", "screen", "navigator", "devicePixelRatio",
    "matchMedia", "getComputedStyle", "customElements",

    // Page-level event plumbing. Also how a game would reach the host page:
    // a top-level addEventListener shadows the page's own EventTarget method.
    "addEventListener", "removeEventListener", "dispatchEvent", "postMessage",

    // Modal dialogs. Browser-only, and they block every further event the
    // page would deliver, which wedges the container rather than the game.
    "alert", "confirm", "prompt", "open", "close", "print",

    // WebAudio. The reason oj.audio exists: sound is a real need with no
    // portable browser answer, so it gets a seam instead of this.
    "AudioContext", "webkitAudioContext", "Audio",

    // Networking that is not fetch. fetch and WebSocket are provided
    // everywhere; these two are not.
    "XMLHttpRequest", "EventSource",

    // Threads and browser storage with no native counterpart.
    "Worker", "SharedWorker", "indexedDB", "caches", "crypto",

    // DOM-flavoured constructors. A game needing bytes has fetch and
    // Uint8Array; these carry browser semantics that do not travel.
    "Image", "Blob", "File", "FileReader", "FormData", "Notification",
]

export const SHADOWED_GLOBALS: readonly string[] = [
    // C# access
    "CS", "useExtensions", "__cs", "__cs_invoke", "__csHelpers",
    "__registerCallback", "__unregisterCallback", "__releaseHandle",
    "releaseObject", "$typeof",

    // filesystem
    "readTextFile", "writeTextFile", "fileExists", "directoryExists",
    "deleteFile", "listFiles", "loadResourceAsync",

    // stylesheet loading by path (compileStyleSheet is injected, not shadowed)
    "loadStyleSheet", "removeStyleSheet", "clearStyleSheets",

    // runtime internals
    "__root", "__bridge", "__eventAPI", "__dispatchEvent", "__dispatchEventFast",
    "__tick", "__startWebGLTick", "__stopWebGLTick", "__teardownTimers",
    "__onTeardown", "__runTeardown", "__resolveTask", "__rejectTask",
    "__onejsNativeTimers", "__wsContextId", "__workingDir", "__isPlaying",

    // host paths
    "__persistentDataPath", "__streamingAssetsPath", "__dataPath",
    "__temporaryCachePath",

    // debug and cartridge surfaces
    "__dumpUI", "__findByClass", "__findByType", "__cartRegistry", "__cart",

    // Unity host machinery
    "createUnityInstance", "unityFramework", "Module", "webgpuVersion",

    // platform defines
    "UNITY_EDITOR", "UNITY_WEBGL", "UNITY_STANDALONE",
    "UNITY_STANDALONE_OSX", "UNITY_STANDALONE_WIN", "UNITY_STANDALONE_LINUX",

    ...BROWSER_ONLY_GLOBALS,
]

/**
 * Globals that generated bundle code legitimately calls, so they are injected
 * with their real values instead of shadowed.
 *
 * `compileStyleSheet` is the whole list and it is not optional: onejs-unity's
 * uss-modules and tailwind plugins both emit a bare call to it into every
 * bundle that uses CSS Modules or Tailwind. Shadowing it would break two
 * headline features. It takes a CSS string rather than a path, so it does not
 * hand a game the filesystem.
 */
export const INJECTED_GLOBALS: readonly string[] = ["compileStyleSheet"]

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export interface EvaluateBundleOptions {
    /** The preloaded runtime, bound to the bundle's `oj` external. */
    oj: unknown
    /**
     * Modules the container provides, keyed by import specifier.
     *
     * A bundle cannot reach these through `require`: esbuild's IIFE output
     * defines its own `__require` that throws, and it cannot be replaced from
     * outside. So the build rewrites each external into a tiny module reading
     * `__ojExternals`, which is injected here rather than left on globalThis
     * where game code could reach past it.
     *
     * `oj` is added automatically. React belongs here too, because it lives in
     * the runtime rather than in any game bundle.
     */
    externals?: Record<string, unknown>
    /** Real values for INJECTED_GLOBALS, looked up on the host scope if omitted. */
    injected?: Record<string, unknown>
    /** Extra names to shadow, for anything a newer bootstrap adds. */
    shadow?: readonly string[]
    /** Where to read injected values from. Defaults to globalThis. */
    scope?: Record<string, unknown>
}

/**
 * Evaluates an IIFE bundle with the runtime's globals shadowed, returning its
 * `__exports`.
 *
 * The body runs in strict mode, which also means an undeclared assignment
 * throws instead of silently creating a global. That matters for hot swap: it
 * leaves `globalThis.foo = ...` as the only way a bundle can leave residue
 * behind, which snapshotGlobals and removeAddedGlobals then clean up.
 */
export function evaluateBundle(code: string, options: EvaluateBundleOptions): unknown {
    const scope = options.scope ?? (globalThis as unknown as Record<string, unknown>)

    const injectedNames = INJECTED_GLOBALS.filter((name) => IDENTIFIER.test(name))
    const injectedValues = injectedNames.map((name) =>
        options.injected && name in options.injected ? options.injected[name] : scope[name],
    )

    const seen = new Set<string>(["oj", "__ojExternals", ...injectedNames])
    const shadowNames: string[] = []
    for (const name of [...SHADOWED_GLOBALS, ...(options.shadow ?? [])]) {
        // A non-identifier cannot be a parameter, and a duplicate parameter is a
        // SyntaxError in strict mode, so both are dropped rather than thrown on.
        if (!IDENTIFIER.test(name) || seen.has(name)) continue
        seen.add(name)
        shadowNames.push(name)
    }

    const externals = { oj: options.oj, ...(options.externals ?? {}) }
    const params = [...shadowNames, ...injectedNames, "oj", "__ojExternals"]
    const body = `"use strict";\n${code}\n;return typeof __exports !== "undefined" ? __exports : undefined;`

    const factory = new Function(...params, body)
    return factory(...shadowNames.map(() => undefined), ...injectedValues, options.oj, externals)
}

/** The set of global names present right now. */
export function snapshotGlobals(scope: object = globalThis): Set<string> {
    return new Set(Object.keys(scope))
}

/**
 * Deletes globals added since a snapshot, and reports what went.
 *
 * A bundle that writes `globalThis.state = ...` leaves it behind when the next
 * bundle is swapped in, which was measured on a real build. Strict mode stops
 * the accidental version of this; the deliberate version needs sweeping.
 */
export function removeAddedGlobals(snapshot: Set<string>, scope: object = globalThis): string[] {
    const removed: string[] = []
    for (const key of Object.keys(scope)) {
        if (snapshot.has(key)) continue
        try {
            delete (scope as Record<string, unknown>)[key]
            removed.push(key)
        } catch {
            // Non-configurable, so it stays. Reporting only what actually went
            // keeps the caller from believing the scope is cleaner than it is.
        }
    }
    return removed
}
