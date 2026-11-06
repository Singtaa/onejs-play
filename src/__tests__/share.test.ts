import { afterEach, describe, expect, it, vi } from "vitest"
import { createDomInputAdapter } from "../adapter"
import { createRuntime } from "../runtime"
import { copy, setPressCheck, setShareBrowser, share } from "../share"
import { unityClipboard } from "../standalone"

/**
 * share() and copy() go to the browser in the frame of a press, synchronously,
 * and answer "refused" without asking it when the frame saw none.
 *
 * The window they rely on, measured 6 Nov in Safari 26.5 on macOS with the
 * cart's frame built as the site builds it (PlaySite/docs/engine-findings.md):
 * clipboard.writeText allowed 16, 100 and 500 ms after a click, refused at
 * 1.1 s and 3 s, with navigator.userActivation.isActive still true. Chrome
 * allows 5 s. So the call is made in the press's frame with nothing awaited
 * before it, which is what "asked synchronously" below pins, and a call from
 * a later frame is refused here rather than by a phone.
 */

/** A window stand-in: listeners that can be fired, and a navigator that records what it was asked. */
function fakeView(nav: any) {
    const listeners = new Map<string, Set<Function>>()
    const view: any = {
        navigator: nav,
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        addEventListener(type: string, fn: Function) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn) },
        removeEventListener(type: string, fn: Function) { listeners.get(type)?.delete(fn) },
        fire(type: string, event: any) { for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, clientX: 0, clientY: 0, button: 0, pointerId: 1, ...event, type }) },
    }
    return view
}

/** A navigator whose share and clipboard answer as told, recording each call as it is made. */
function fakeNavigator(answers: { share?: "ok" | string | null, copy?: "ok" | string | null, canShare?: boolean } = {}) {
    const calls: string[] = []
    const settle = (answer: string) => (answer === "ok" ? Promise.resolve() : Promise.reject(Object.assign(new Error(answer), { name: answer })))
    const nav: any = {}
    if (answers.share !== null) nav.share = (data: any) => { calls.push(`share ${JSON.stringify(data)}`); return settle(answers.share ?? "ok") }
    if (answers.canShare !== undefined) nav.canShare = () => answers.canShare
    if (answers.copy !== null) nav.clipboard = { writeText: (text: string) => { calls.push(`copy ${text}`); return settle(answers.copy ?? "ok") } }
    return { nav, calls }
}

/** The container as the site runs it: a runtime, its input fed by the adapter from `nav`'s window. */
function container(nav: any) {
    const runtime = createRuntime({ root: {}, version: "0.0.0" })
    const view = fakeView(nav)
    const detach = createDomInputAdapter(runtime.input.sink, { view })
    return { runtime, view, detach }
}

let teardown: (() => void)[] = []
afterEach(() => {
    for (const t of teardown) t()
    teardown = []
    setShareBrowser(null)
    setPressCheck(null)
    vi.restoreAllMocks()
})

function started(nav: any) {
    const c = container(nav)
    teardown.push(() => { c.detach(); c.runtime.dispose() })
    return c
}

describe("copy", () => {
    it("is refused without asking the browser in a frame with no press, and says why once", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { nav, calls } = fakeNavigator()
        const { runtime } = started(nav)
        runtime.beginFrame(1 / 60)
        expect(await copy("a")).toBe("refused")
        expect(await copy("b")).toBe("refused")
        expect(calls).toEqual([])
        expect(warn.mock.calls.filter(([m]) => String(m).includes("frame of a press"))).toHaveLength(1)
    })

    it("asks the browser synchronously in the frame of a click, and not in the next", async () => {
        const { nav, calls } = fakeNavigator()
        const { runtime, view } = started(nav)
        view.fire("pointerdown", { pointerType: "mouse" })
        runtime.beginFrame(1 / 60)
        const answer = copy("https://ojplay.com/c/x")
        // Before anything is awaited: Safari's window closes about a second after the press.
        expect(calls).toEqual(["copy https://ojplay.com/c/x"])
        expect(await answer).toBe("copied")
        runtime.beginFrame(1 / 60)
        vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(await copy("late")).toBe("refused")
        expect(calls).toHaveLength(1)
    })

    // Windows CI, 6 Nov: a 70 ms click spans frames at 60 fps, and its onClick fires on the release.
    it("copies in the frame a mouse click is released, frames after it went down, which is when a Button's onClick fires", async () => {
        const { nav, calls } = fakeNavigator()
        const { runtime, view } = started(nav)
        view.fire("pointerdown", { pointerType: "mouse" })
        for (let i = 0; i < 4; i++) runtime.beginFrame(1 / 60)
        view.fire("pointerup", { pointerType: "mouse" })
        runtime.beginFrame(1 / 60)
        expect(await copy("held")).toBe("copied")
        expect(calls).toEqual(["copy held"])
    })

    it("counts a press the frame has not drained yet, as a Button's onClick answers it before the container's frame", async () => {
        const { nav, calls } = fakeNavigator()
        const { runtime, view } = started(nav)
        runtime.beginFrame(1 / 60)
        view.fire("pointerup", { pointerType: "touch" })
        expect(await copy("x")).toBe("copied")
        // Drained at the next boundary, it still counts for that frame and no longer.
        runtime.beginFrame(1 / 60)
        expect(await copy("y")).toBe("copied")
        runtime.beginFrame(1 / 60)
        vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(await copy("z")).toBe("refused")
        expect(calls).toEqual(["copy x", "copy y"])
    })

    it("counts what grants a page activation and a mouse coming up: a key but Escape, a mouse down or up, a finger or pen lifting, not a finger going down", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { nav } = fakeNavigator()
        const { runtime, view } = started(nav)
        const after = async (type: string, event: any) => {
            runtime.beginFrame(1 / 60)
            view.fire(type, event)
            runtime.beginFrame(1 / 60)
            return copy("t")
        }
        expect(await after("keydown", { code: "Space", key: " " })).toBe("copied")
        expect(await after("keydown", { code: "Escape", key: "Escape" })).toBe("refused")
        expect(await after("pointerdown", { pointerType: "mouse" })).toBe("copied")
        expect(await after("pointerup", { pointerType: "mouse" })).toBe("copied")
        expect(await after("pointerdown", { pointerType: "touch", pointerId: 7 })).toBe("refused")
        expect(await after("pointerup", { pointerType: "touch", pointerId: 7 })).toBe("copied")
        expect(await after("pointerup", { pointerType: "pen" })).toBe("copied")
        expect(await after("pointercancel", { pointerType: "touch" })).toBe("refused")
    })

    it("answers refused when the browser refuses or has no clipboard", async () => {
        const refused = fakeNavigator({ copy: "NotAllowedError" })
        const { runtime, view, detach } = container(refused.nav)
        view.fire("keydown", { code: "KeyC", key: "c" })
        runtime.beginFrame(1 / 60)
        expect(await copy("x")).toBe("refused")
        detach()
        runtime.dispose()
        const none = fakeNavigator({ copy: null })
        const second = started(none.nav)
        second.view.fire("keydown", { code: "KeyC", key: "c" })
        second.runtime.beginFrame(1 / 60)
        expect(await copy("x")).toBe("refused")
    })
})

describe("share", () => {
    const pressed = (answers: Parameters<typeof fakeNavigator>[0]) => {
        const { nav, calls } = fakeNavigator(answers)
        const { runtime, view } = started(nav)
        view.fire("pointerup", { pointerType: "touch" })
        runtime.beginFrame(1 / 60)
        return calls
    }
    const INVITE = { url: "https://ojplay.com/c/gunyard?room=ab12", title: "Join me in Gunyard" }

    it("opens the sheet synchronously and answers shared, leaving out empty fields", async () => {
        const calls = pressed({})
        const answer = share({ ...INVITE, text: "" })
        expect(calls).toEqual([`share ${JSON.stringify(INVITE)}`])
        expect(await answer).toBe("shared")
    })

    it("answers cancelled when the player closes the sheet, and copies nothing behind their back", async () => {
        const calls = pressed({ share: "AbortError" })
        expect(await share(INVITE, { fallback: "copy" })).toBe("cancelled")
        expect(calls).toHaveLength(1)
    })

    it("copies the link where the browser refuses the sheet, with the fallback, and answers refused without it", async () => {
        const calls = pressed({ share: "NotAllowedError" })
        expect(await share(INVITE, { fallback: "copy" })).toBe("copied")
        expect(await share(INVITE)).toBe("refused")
        expect(calls).toEqual([`share ${JSON.stringify(INVITE)}`, `copy ${INVITE.url}`, `share ${JSON.stringify(INVITE)}`])
    })

    it("copies synchronously where there is no sheet, the text when there is no link", async () => {
        const calls = pressed({ share: null })
        const answer = share(INVITE, { fallback: "copy" })
        expect(calls).toEqual([`copy ${INVITE.url}`])
        expect(await answer).toBe("copied")
        expect(await share({ text: "Score: 41" }, { fallback: "copy" })).toBe("copied")
        expect(await share(INVITE)).toBe("refused")
        expect(calls).toEqual([`copy ${INVITE.url}`, "copy Score: 41"])
    })

    it("copies where the sheet will not take the data, and answers refused when the copy is refused too", async () => {
        const calls = pressed({ canShare: false, copy: "NotAllowedError" })
        expect(await share(INVITE, { fallback: "copy" })).toBe("refused")
        expect(calls).toEqual([`copy ${INVITE.url}`])
    })

    it("is refused without asking in a frame with no press", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { nav, calls } = fakeNavigator()
        const { runtime } = started(nav)
        runtime.beginFrame(1 / 60)
        expect(await share(INVITE, { fallback: "copy" })).toBe("refused")
        expect(calls).toEqual([])
    })

    it("is refused with no host at all, as in the editor's type check", async () => {
        expect(await share(INVITE, { fallback: "copy" })).toBe("refused")
        expect(await copy("x")).toBe("refused")
    })

    it("takes the press check and the browser away when the container is torn down", async () => {
        const { nav, calls } = fakeNavigator()
        const { runtime, view, detach } = container(nav)
        view.fire("keydown", { code: "KeyC", key: "c" })
        runtime.beginFrame(1 / 60)
        detach()
        runtime.dispose()
        expect(await copy("x")).toBe("refused")
        expect(calls).toEqual([])
    })
})

describe("an ejected cart's clipboard", () => {
    const unity = (platform: number) => ({
        GUIUtility: { systemCopyBuffer: "" },
        Application: { platform },
        RuntimePlatform: { WebGLPlayer: 17 },
    })

    it("is Unity's, with no sheet and no press rule", async () => {
        const engine = unity(2)
        setShareBrowser(unityClipboard(engine))
        expect(await copy("seed 1234")).toBe("copied")
        expect(engine.GUIUtility.systemCopyBuffer).toBe("seed 1234")
        expect(await share({ url: "https://example.com" })).toBe("refused")
        expect(await share({ url: "https://example.com" }, { fallback: "copy" })).toBe("copied")
        expect(engine.GUIUtility.systemCopyBuffer).toBe("https://example.com")
    })

    it("refuses in a WebGL player, whose clipboard the page never sees", async () => {
        const engine = unity(17)
        setShareBrowser(unityClipboard(engine))
        expect(await copy("x")).toBe("refused")
        expect(engine.GUIUtility.systemCopyBuffer).toBe("")
        // No UnityEngine at all.
        setShareBrowser(unityClipboard(null))
        expect(await copy("x")).toBe("refused")
    })
})
