import { describe, it, expect, vi } from "vitest"
import { createDomInputAdapter, hasDom } from "../adapter"
import { createContainerInput, type ContainerInput } from "../input"
import { isPageHidden, onPageHidden, setPageHidden } from "../play"

/** The backend is a Partial by design, so tests read it the way onejs-unity does. */
const b = (c: ContainerInput) => c.backend as Record<string, (...a: any[]) => any>

/**
 * A DOM stand-in that records listeners and can fire them.
 *
 * Keyed by type AND capture flag, exactly as the real EventTarget is. That
 * detail is the point: addEventListener and removeEventListener only pair up
 * when their capture flags match, so a fake that ignored it would report a
 * clean detach for code that actually leaks every key listener.
 */
function fakeView(overrides: Record<string, unknown> = {}) {
    const listeners = new Map<string, Set<Function>>()
    const view: any = {
        document: { hidden: false, addEventListener: add, removeEventListener: remove },
        addEventListener: add,
        removeEventListener: remove,
        fire(type: string, event: any) {
            // Both phases, since a caller should not have to know which one a
            // given listener was registered for.
            for (const phase of ["capture", "bubble"]) {
                for (const fn of listeners.get(`${type}:${phase}`) ?? []) fn(event)
            }
        },
        total() {
            let n = 0
            for (const set of listeners.values()) n += set.size
            return n
        },
        ...overrides,
    }
    const keyOf = (type: string, options: any) =>
        `${type}:${options === true || options?.capture === true ? "capture" : "bubble"}`
    function add(type: string, fn: Function, options?: any) {
        const key = keyOf(type, options)
        if (!listeners.has(key)) listeners.set(key, new Set())
        listeners.get(key)!.add(fn)
    }
    function remove(type: string, fn: Function, options?: any) {
        listeners.get(keyOf(type, options))?.delete(fn)
    }
    return view
}

const keyEvent = (code: string) => ({ code, preventDefault: vi.fn() })

describe("hasDom", () => {
    it("is false for a runtime with no document", () => {
        expect(hasDom({ addEventListener() {} })).toBe(false)
        expect(hasDom(undefined)).toBe(false)
    })

    it("is true for something that looks like a window", () => {
        expect(hasDom(fakeView())).toBe(true)
    })
})

describe("createDomInputAdapter", () => {
    it("is a no-op without a DOM, rather than throwing", () => {
        const input = createContainerInput()
        const detach = createDomInputAdapter(input.sink, { view: { addEventListener() {} } })
        expect(detach).toBeTypeOf("function")
        expect(() => detach()).not.toThrow()
    })

    it("feeds keys through to the backend", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view })

        view.fire("keydown", keyEvent("KeyA"))
        input.beginFrame()
        expect(b(input).GetKeyDown("A")).toBe(true)
        expect(b(input).GetKeyPressed("A")).toBe(true)

        view.fire("keyup", keyEvent("KeyA"))
        input.beginFrame()
        expect(b(input).GetKeyDown("A")).toBe(false)
        expect(b(input).GetKeyReleased("A")).toBe(true)
    })

    it("maps Enter and Backspace, which is all Wordle needs", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view })
        view.fire("keydown", keyEvent("Enter"))
        view.fire("keydown", keyEvent("Backspace"))
        input.beginFrame()
        expect(b(input).GetKeyPressed("Return")).toBe(true)
        expect(b(input).GetKeyPressed("Backspace")).toBe(true)
    })

    it("suppresses the browser default only for keys that would fight the game", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view })

        const space = keyEvent("Space")
        view.fire("keydown", space)
        expect(space.preventDefault).toHaveBeenCalled()

        // Tab must stay live or keyboard focus is trapped inside the frame.
        const tab = keyEvent("Tab")
        view.fire("keydown", tab)
        expect(tab.preventDefault).not.toHaveBeenCalled()

        const letter = keyEvent("KeyA")
        view.fire("keydown", letter)
        expect(letter.preventDefault).not.toHaveBeenCalled()
    })

    it("reports pointer positions relative to the target, in CSS pixels", () => {
        const input = createContainerInput()
        const view = fakeView()
        const target = { getBoundingClientRect: () => ({ left: 40, top: 12 }) }
        createDomInputAdapter(input.sink, { view, target })

        view.fire("pointermove", { clientX: 140, clientY: 112 })
        input.beginFrame()
        expect(b(input).GetMousePositionX()).toBe(100)
        expect(b(input).GetMousePositionY()).toBe(100)
    })

    // learn Mac, 6 Nov: right-drag is WoW's turn, and it opened the browser's menu.
    it("never lets the browser's context menu open over the game, unless defaults are left alone", () => {
        const view = fakeView()
        const detach = createDomInputAdapter(createContainerInput().sink, { view })
        const menu = { preventDefault: vi.fn() }
        view.fire("contextmenu", menu)
        expect(menu.preventDefault).toHaveBeenCalled()
        detach()

        const left = fakeView()
        createDomInputAdapter(createContainerInput().sink, { view: left, preventDefault: false })
        const kept = { preventDefault: vi.fn() }
        left.fire("contextmenu", kept)
        expect(kept.preventDefault).not.toHaveBeenCalled()
    })

    // learn Mac, 6 Nov: "both buttons walk forward" missed the second button. By the Pointer Events
    // spec a button joining one already held, or leaving while another stays, is a pointermove.
    it("reads a second mouse button from a pointermove's buttons, both on the way down and up", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view })
        const mouse = (button: number, buttons: number) => ({ pointerType: "mouse", pointerId: 1, clientX: 50, clientY: 50, button, buttons })
        // Unity's order: left 1, right 2, middle 4.
        view.fire("pointerdown", mouse(0, 1))
        input.beginFrame()
        expect(b(input).GetMouseButtons()).toBe(1)
        view.fire("pointermove", mouse(2, 3))
        input.beginFrame()
        expect(b(input).GetMouseButtons()).toBe(3)
        expect(b(input).GetMouseButtonsPressed()).toBe(2)
        view.fire("pointermove", mouse(-1, 3))
        input.beginFrame()
        expect(b(input).GetMouseButtons()).toBe(3)
        view.fire("pointermove", mouse(0, 2))
        input.beginFrame()
        expect(b(input).GetMouseButtons()).toBe(2)
        expect(b(input).GetMouseButtonsReleased()).toBe(1)
        view.fire("pointerup", mouse(2, 0))
        input.beginFrame()
        expect(b(input).GetMouseButtons()).toBe(0)
    })

    it("releases everything held when focus is lost", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view })
        view.fire("keydown", keyEvent("KeyW"))
        input.beginFrame()
        expect(b(input).GetKeyDown("W")).toBe(true)

        view.fire("blur", {})
        input.beginFrame()
        expect(b(input).GetKeyDown("W")).toBe(false)
    })

    it("releases everything held when the tab is hidden", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view })
        view.fire("keydown", keyEvent("KeyW"))
        input.beginFrame()

        view.document.hidden = true
        view.fire("visibilitychange", {})
        input.beginFrame()
        expect(b(input).GetKeyDown("W")).toBe(false)
    })

    /**
     * Rooms hand the host to a page that is showing (room.ts), and this is
     * the only place that knows: a hidden page has to reach play.ts.
     */
    it("reports the page hidden and shown, for rooms", () => {
        const input = createContainerInput()
        const view = fakeView()
        // Module state: the test above left the page hidden.
        setPageHidden(false)
        const seen: boolean[] = []
        const stop = onPageHidden((hidden) => seen.push(hidden))
        const detach = createDomInputAdapter(input.sink, { view })
        view.document.hidden = true
        view.fire("visibilitychange", {})
        expect(isPageHidden()).toBe(true)
        view.document.hidden = false
        view.fire("visibilitychange", {})
        expect(isPageHidden()).toBe(false)
        expect(seen).toEqual([true, false])
        stop()
        detach()
    })

    it("detaches every listener it added", () => {
        const input = createContainerInput()
        const view = fakeView()
        const detach = createDomInputAdapter(input.sink, { view })
        expect(view.total()).toBeGreaterThan(0)
        detach()
        expect(view.total()).toBe(0)
    })

    it("stops feeding the sink after detaching, so a swap cannot leak input", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view })()
        view.fire("keydown", keyEvent("KeyA"))
        input.beginFrame()
        expect(b(input).GetKeyDown("A")).toBe(false)
    })
})

/**
 * input.mouse.lock() in the browser (runtime-1.3.md section 10). A browser
 * grants a lock only inside a press, so the lock is asked at once in a
 * press's frame and otherwise inside the next press's own event.
 */
describe("pointer lock", () => {
    function lockPage(options: { fine?: boolean, refuse?: boolean } = {}) {
        const input = createContainerInput()
        const view = fakeView({ matchMedia: () => ({ matches: options.fine !== false }) })
        const requests: string[] = []
        const target: any = {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
            requestPointerLock: () => {
                requests.push("request")
                if (options.refuse) view.fire("pointerlockerror", {})
                return Promise.resolve()
            },
        }
        view.document.pointerLockElement = null
        view.document.exitPointerLock = () => {
            requests.push("exit")
            view.document.pointerLockElement = null
            view.fire("pointerlockchange", {})
        }
        const grant = () => {
            view.document.pointerLockElement = target
            view.fire("pointerlockchange", {})
        }
        const detach = createDomInputAdapter(input.sink, { view, target })
        const mouseDown = () => view.fire("pointerdown", { pointerType: "mouse", button: 0, clientX: 10, clientY: 10 })
        return { input, view, target, requests, grant, detach, mouseDown }
    }

    it("asks at once in a press's frame, whether or not the frame has drained it", () => {
        const page = lockPage()
        page.mouseDown()
        // A Button's onClick can run before the container's frame takes the press.
        b(page.input).LockMouse()
        expect(page.requests).toEqual(["request"])
        page.input.beginFrame()
        b(page.input).LockMouse()
        expect(page.requests).toEqual(["request", "request"])
    })

    it("outside a press, asks inside the next press's own event", () => {
        const page = lockPage()
        page.input.beginFrame()
        b(page.input).LockMouse()
        expect(page.requests).toEqual([])
        page.mouseDown()
        // Before any frame: the browser's event is the only place it is granted.
        expect(page.requests).toEqual(["request"])
        page.mouseDown()
        expect(page.requests).toEqual(["request"])
    })

    it("reads locked from the browser's answer, on the frame after it", () => {
        const page = lockPage()
        page.mouseDown()
        b(page.input).LockMouse()
        expect(b(page.input).IsMouseLocked()).toBe(false)
        page.grant()
        page.input.beginFrame()
        expect(b(page.input).IsMouseLocked()).toBe(true)
        // Escape: the browser lets go by itself.
        page.view.document.pointerLockElement = null
        page.view.fire("pointerlockchange", {})
        page.input.beginFrame()
        expect(b(page.input).IsMouseLocked()).toBe(false)
    })

    it("feeds movement into the delta while locked, with the position held", () => {
        const page = lockPage()
        page.view.fire("pointermove", { pointerType: "mouse", button: -1, clientX: 100, clientY: 50 })
        page.input.beginFrame()
        page.grant()
        // The browser holds clientX and clientY where the lock began.
        page.view.fire("pointermove", { pointerType: "mouse", button: -1, clientX: 100, clientY: 50, movementX: 7, movementY: -3 })
        page.view.fire("pointermove", { pointerType: "mouse", button: -1, clientX: 100, clientY: 50, movementX: 5, movementY: 1 })
        page.input.beginFrame()
        expect([b(page.input).GetMouseDeltaX(), b(page.input).GetMouseDeltaY()]).toEqual([12, -2])
        expect([b(page.input).GetMousePositionX(), b(page.input).GetMousePositionY()]).toEqual([100, 50])
        page.view.document.pointerLockElement = null
        page.view.fire("pointerlockchange", {})
        page.view.fire("pointermove", { pointerType: "mouse", button: -1, clientX: 130, clientY: 50, movementX: 30, movementY: 0 })
        page.input.beginFrame()
        expect(b(page.input).GetMousePositionX()).toBe(130)
        expect(b(page.input).GetMouseDeltaX()).toBe(30)
    })

    it("unlocks a held lock and forgets one still waiting for a press", () => {
        const page = lockPage()
        page.input.beginFrame()
        b(page.input).LockMouse()
        b(page.input).UnlockMouse()
        page.mouseDown()
        expect(page.requests).toEqual([])
        b(page.input).LockMouse()
        page.grant()
        page.input.beginFrame()
        b(page.input).UnlockMouse()
        expect(page.requests).toEqual(["request", "exit"])
        page.input.beginFrame()
        expect(b(page.input).IsMouseLocked()).toBe(false)
    })

    it("does nothing on a phone, which has the method and nothing to lock", () => {
        const page = lockPage({ fine: false })
        page.mouseDown()
        b(page.input).LockMouse()
        page.input.beginFrame()
        expect(page.requests).toEqual([])
        expect(b(page.input).IsMouseLocked()).toBe(false)
    })

    it("does nothing where the page cannot lock at all", () => {
        const input = createContainerInput()
        const view = fakeView()
        createDomInputAdapter(input.sink, { view, target: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } })
        view.fire("pointerdown", { pointerType: "mouse", button: 0, clientX: 1, clientY: 1 })
        expect(() => b(input).LockMouse()).not.toThrow()
        input.beginFrame()
        expect(b(input).IsMouseLocked()).toBe(false)
    })

    it("says a refusal once", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const page = lockPage({ refuse: true })
        page.mouseDown()
        b(page.input).LockMouse()
        b(page.input).LockMouse()
        const said = warn.mock.calls.filter((c) => String(c[0]).includes("refused to lock the pointer"))
        expect(said).toHaveLength(1)
        warn.mockRestore()
    })

    it("lets go on detach and on a restart, so the next game starts free", () => {
        const page = lockPage()
        page.mouseDown()
        b(page.input).LockMouse()
        page.grant()
        page.input.beginFrame()
        page.input.reset()
        expect(page.requests).toEqual(["request", "exit"])
        expect(b(page.input).IsMouseLocked()).toBe(false)
        page.grant()
        page.detach()
        expect(page.requests).toEqual(["request", "exit", "exit"])
        expect(page.view.total()).toBe(0)
    })
})

describe("input.pointerType through the page", () => {
    const press = (pointerType: string) => ({ pointerType, pointerId: 7, button: 0, buttons: 1, clientX: 5, clientY: 5 })

    it("guesses from the page's primary pointer until a press says, then is the last press's", () => {
        let coarse = true
        const view = fakeView({ matchMedia: (q: string) => ({ matches: q === "(pointer: coarse)" && coarse }) })
        const input = createContainerInput()
        const detach = createDomInputAdapter(input.sink, { view })
        expect(b(input).GetPointerType()).toBe("touch")
        coarse = false
        expect(b(input).GetPointerType(), "a tablet's mode can change it").toBe("mouse")
        view.fire("pointerdown", press("touch"))
        view.fire("pointerup", press("touch"))
        input.beginFrame()
        expect(b(input).GetPointerType()).toBe("touch")
        view.fire("pointerdown", press("pen"))
        input.beginFrame()
        expect(b(input).GetPointerType()).toBe("pen")
        view.fire("pointerdown", press("mouse"))
        input.beginFrame()
        expect(b(input).GetPointerType()).toBe("mouse")
        view.fire("pointerdown", press("kinect"))
        input.beginFrame()
        expect(b(input).GetPointerType(), "a type it does not know changes nothing").toBe("mouse")
        detach()
    })

    it("is no press for a moved mouse, and keeps the last press across a restart", () => {
        const view = fakeView({ matchMedia: () => ({ matches: false }) })
        const input = createContainerInput()
        const detach = createDomInputAdapter(input.sink, { view })
        view.fire("pointerdown", press("touch"))
        view.fire("pointerup", press("touch"))
        input.beginFrame()
        view.fire("pointermove", { pointerType: "mouse", pointerId: 1, button: -1, buttons: 0, clientX: 50, clientY: 50 })
        input.beginFrame()
        expect(b(input).GetPointerType()).toBe("touch")
        input.reset()
        expect(b(input).GetPointerType()).toBe("touch")
        detach()
        expect(b(input).GetPointerType()).toBe("touch")
    })

    it("is the mouse with no page to ask", () => {
        expect(b(createContainerInput()).GetPointerType()).toBe("mouse")
    })
})
