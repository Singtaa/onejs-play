import { describe, it, expect, beforeEach } from "vitest"
import { containerBoot } from "onejs-play/host/boot"

/**
 * The audio deferral in the container page, RUN rather than read.
 *
 * Unity's framework polls audioContext.resume() every 400ms until it succeeds,
 * and Chrome prints an autoplay warning for every attempt made before the page
 * has user activation. That was 47 to 60 identical lines per sketch load on the
 * live site and almost everything left in the console.
 *
 * The rule lives only inside a template string, so reading it as text would
 * pass on a version that throws in a browser. This pulls the IIFE out of the
 * generated script and runs it against a fake AudioContext and a fake event
 * target, which is the only form that proves anything.
 */
const script = containerBoot({
    runtime: "/runtime/x", manifest: {}, bundle: "function bundle(){}", report: "function report(){}",
})

interface Harness {
    Ctx: new () => FakeCtx
    resumed: FakeCtx[]
    fire: (type: string) => void
    listeners: Map<string, Set<() => void>>
}
interface FakeCtx { state: string; resume(): Promise<void> }

function run(): Harness {
    const at = script.indexOf(";(function deferAudioUntilGesture()")
    expect(at, "deferAudioUntilGesture is gone from host/boot.mjs").toBeGreaterThan(-1)
    const body = script.slice(at, script.indexOf("\n})()", at) + "\n})()".length)

    const resumed: FakeCtx[] = []
    class Ctx implements FakeCtx {
        state = "suspended"
        resume(): Promise<void> { resumed.push(this); this.state = "running"; return Promise.resolve() }
    }
    const listeners = new Map<string, Set<() => void>>()
    const globalThisShim = { AudioContext: Ctx, webkitAudioContext: undefined }
    const addEventListener = (type: string, fn: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
    }
    const removeEventListener = (type: string, fn: () => void) => { listeners.get(type)?.delete(fn) }

    new Function("globalThis", "addEventListener", "removeEventListener", body)(
        globalThisShim, addEventListener, removeEventListener)

    return {
        Ctx: Ctx as unknown as new () => FakeCtx, resumed, listeners,
        fire: (type: string) => { for (const fn of [...(listeners.get(type) ?? [])]) fn() },
    }
}

describe("the container page's audio deferral", () => {
    let h: Harness
    beforeEach(() => { h = run() })

    /** The whole point: no real resume, so the browser prints nothing. */
    it("does not touch the real resume before a gesture", async () => {
        const ctx = new h.Ctx()
        await ctx.resume()
        await ctx.resume()
        expect(h.resumed).toEqual([])
        // And it stays suspended, so Unity's own poll keeps ticking rather
        // than concluding it succeeded.
        expect(ctx.state).toBe("suspended")
    })

    /**
     * Resolved, not rejected. Unity attaches a .catch that logs "Could not
     * resume audio context", so a rejection would swap a browser warning for
     * one of ours and fix nothing.
     */
    it("resolves rather than rejecting", async () => {
        const ctx = new h.Ctx()
        await expect(ctx.resume()).resolves.toBeUndefined()
    })

    it("resumes every waiting context on the first gesture", () => {
        const a = new h.Ctx(); const b = new h.Ctx()
        a.resume(); b.resume()
        expect(h.resumed).toEqual([])
        h.fire("pointerdown")
        expect(h.resumed).toHaveLength(2)
        expect(a.state).toBe("running")
        expect(b.state).toBe("running")
    })

    /** After a gesture the patch is off the prototype entirely. */
    it("takes itself off once it has fired", async () => {
        h.fire("keydown")
        const ctx = new h.Ctx()
        await ctx.resume()
        expect(h.resumed).toContain(ctx)
        for (const type of ["pointerdown", "mousedown", "touchstart", "keydown"]) {
            expect(h.listeners.get(type)?.size ?? 0, type).toBe(0)
        }
    })

    /** Any of the four counts, because a touch screen sends no mousedown. */
    it("wakes on a touch as well as a click", () => {
        const ctx = new h.Ctx()
        ctx.resume()
        h.fire("touchstart")
        expect(h.resumed).toHaveLength(1)
    })

    /** A second gesture must not resume twice or throw. */
    it("is idempotent across repeated gestures", () => {
        const ctx = new h.Ctx()
        ctx.resume()
        h.fire("pointerdown")
        h.fire("pointerdown")
        h.fire("keydown")
        expect(h.resumed).toHaveLength(1)
    })
})
