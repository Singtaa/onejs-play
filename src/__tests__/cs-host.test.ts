import { afterEach, describe, expect, it } from "vitest"
import { csHas, csMissing } from "../cs-host"
import { fakeCS, HOSTS } from "./fake-cs"

afterEach(() => { delete (globalThis as any).CS })

describe("csHas", () => {
    it("finds a type by a static value it answers", () => {
        ;(globalThis as any).CS = fakeCS({ "OneJS.Physics2DBridge": { LiveWorldCount: 0 } })
        expect(csHas("OneJS.Physics2DBridge", () => (globalThis as any).CS.OneJS.Physics2DBridge.LiveWorldCount)).toBe(true)
    })

    it("does not take a path proxy for a value, which is what a missing name reads as", () => {
        ;(globalThis as any).CS = fakeCS({})
        const read = () => (globalThis as any).CS.OneJS.Physics2DBridge.LiveWorldCount
        expect(typeof read()).toBe("function")
        expect(csHas("OneJS.Physics2DBridge", read)).toBe(false)
    })

    it.each(HOSTS)("is false for a member the type lacks, which reads as a %s", (host) => {
        ;(globalThis as any).CS = fakeCS({ "OneJS.Physics2DBridge": {} }, { host })
        expect(csHas("OneJS.Physics2DBridge", () => (globalThis as any).CS.OneJS.Physics2DBridge.LiveWorldCount)).toBe(false)
    })

    it("takes QuickJS's not-found for the type as missing, and lets any other throw through", () => {
        ;(globalThis as any).CS = fakeCS({ "OneJS.Audio.AudioBridge": { IsPlaying: () => { throw new Error("index out of range") } } })
        expect(csHas("OneJS.Audio.AudioGone", () => (globalThis as any).CS.OneJS.Audio.AudioGone.IsPlaying(0))).toBe(false)
        expect(() => csHas("OneJS.Audio.AudioBridge", () => (globalThis as any).CS.OneJS.Audio.AudioBridge.IsPlaying(0))).toThrow("index out of range")
    })

    it("is false with no CS at all", () => {
        expect(csHas("OneJS.Physics2DBridge", () => 0)).toBe(false)
    })
})

describe("csMissing", () => {
    it("names the type or a method of it, and no type that only starts with its name", () => {
        expect(csMissing(new Error("[QuickJS] Type not found: OneJS.Audio.AudioBridge"), "OneJS.Audio.AudioBridge")).toBe(true)
        expect(csMissing(new Error("[QuickJS] Method not found: OneJS.Audio.AudioBridge.Play"), "OneJS.Audio.AudioBridge")).toBe(true)
        expect(csMissing(new Error("[QuickJS] Type not found: OneJS.Audio.AudioBridgeX"), "OneJS.Audio.AudioBridge")).toBe(false)
        expect(csMissing(new Error("[QuickJS] Method not found: OneJS.Audio.Other.Play"), "OneJS.Audio.AudioBridge")).toBe(false)
        expect(csMissing(new Error("NullReferenceException"), "OneJS.Audio.AudioBridge")).toBe(false)
    })

    it.each(HOSTS)("takes the call of a member the type lacks for missing, when told the member, where it reads as a %s", (host) => {
        ;(globalThis as any).CS = fakeCS({ "OneJS.Network": { Here: () => { throw new TypeError("not a function") } } }, { host })
        let thrown: unknown
        try { (globalThis as any).CS.OneJS.Network.LoadFontFromUrl("x") } catch (e) { thrown = e }
        expect(csMissing(thrown, "OneJS.Network", "LoadFontFromUrl")).toBe(true)
        // A TypeError from a member that is there is its own fault, not a missing one.
        let own: unknown
        try { (globalThis as any).CS.OneJS.Network.Here() } catch (e) { own = e }
        expect(csMissing(own, "OneJS.Network", "Here")).toBe(false)
    })

    it("does not take a bare TypeError for missing without the member it came from", () => {
        ;(globalThis as any).CS = fakeCS({ "OneJS.Network": {} }, { host: "undefined" })
        expect(csMissing(new TypeError("not a function"), "OneJS.Network")).toBe(false)
    })
})
