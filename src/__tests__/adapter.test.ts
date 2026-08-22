import { describe, it, expect, vi } from "vitest"
import { createDomInputAdapter, hasDom } from "../adapter"
import { createContainerInput, type ContainerInput } from "../input"

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
