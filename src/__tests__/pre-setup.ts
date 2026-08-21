/**
 * Globals that must exist before any module is imported.
 *
 * onejs-react's components.tsx calls useExtensions(CS.UnityEngine.ImageConversion)
 * at module scope, so importing oj's index touches CS before a single test runs.
 * In the real container QuickJSBootstrap installs these long before a game
 * bundle is evaluated; here a permissive stub is enough.
 *
 * Deliberately not a copy of onejs-react's mocks.ts. These tests assert on the
 * shape of oj's own surface, not on Unity behaviour, and reaching into another
 * package's test fixtures would couple the two suites together for no gain.
 */

/** A value that survives any property access, call, or construction. */
function stub(): any {
    const target: any = function () {}
    return new Proxy(target, {
        get(_t, prop) {
            if (typeof prop === "symbol") return undefined
            if (prop === "toString") return () => "[CS stub]"
            return stub()
        },
        apply: () => stub(),
        construct: () => stub(),
    })
}

;(globalThis as any).useExtensions = () => {}
;(globalThis as any).CS = stub()
