import { describe, it, expect } from "vitest"
import { containerBoot } from "ojplay/host/boot"

/**
 * startGame in the container page, RUN rather than read.
 *
 * A swap into a running container clears the stage and mounts the next cart in
 * one load() call. React renders that mount concurrently, so without a flush a
 * first render that yields leaves Unity a frame of the empty stage between the
 * old picture and the new one. These pull startGame out of the generated
 * script and run it against a fake container, which is the only form that
 * proves the flush wraps the load rather than sitting somewhere near it.
 */
const script = containerBoot({
    runtime: "/runtime/x", manifest: { name: "Pop" }, bundle: "function bundle(){}", report: "function report(){}",
})

interface Started { start: (source: string) => number; loaded: () => string | null }

function startGameWith(globalThisShim: object): Started {
    const at = script.indexOf("function startGame(source)")
    expect(at, "startGame is gone from host/boot.mjs").toBeGreaterThan(-1)
    const body = script.slice(at, script.indexOf("\n}\n", at) + 2)
    return new Function("globalThis", "manifest", `let loadedSource = null\n${body}
        return { start: startGame, loaded: () => loadedSource }`)(globalThisShim, { name: "Pop" }) as Started
}

describe("startGame", () => {
    it("loads inside flushSync, so the cart has committed when it returns", () => {
        const order: string[] = []
        const started = startGameWith({
            __ojApi: { flushSync: (fn: () => number) => { order.push("flush in"); const ms = fn(); order.push("flush out"); return ms } },
            __ojPlay: { load: (source: string, manifest: { name: string }) => { order.push(`load ${source} ${manifest.name}`); return 4 } },
        })
        expect(started.start("cart")).toBe(4)
        expect(order).toEqual(["flush in", "load cart Pop", "flush out"])
        expect(started.loaded()).toBe("cart")
    })

    it("loads directly on a container with no flushSync", () => {
        const loads: string[] = []
        const started = startGameWith({ __ojApi: {}, __ojPlay: { load: (source: string) => { loads.push(source); return 2 } } })
        expect(started.start("cart")).toBe(2)
        expect(loads).toEqual(["cart"])
    })

    it("keeps the last source that started, not one that failed", () => {
        let ms = 3
        const started = startGameWith({ __ojPlay: { load: () => ms } })
        started.start("good")
        ms = -1
        expect(started.start("broken")).toBe(-1)
        expect(started.loaded()).toBe("good")
    })
})
