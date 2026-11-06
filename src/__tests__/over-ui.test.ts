import { describe, it, expect, afterEach, vi } from "vitest"
import { setInputBackend, input } from "onejs-unity/input"
import { createContainerInput } from "../input"
import { createHostInputBackend } from "../hostinput"
import { createPressProbe, PRESS_EVENTS, STAGE_SIZED_HINT, WORLD_CLASS } from "../over-ui"
import { newStick, readPad, readStick, type PadState, type TouchPoint } from "../stick"
import { stageOf } from "../stage"

/**
 * A press on a HUD button is not a game input (engine-findings.md; Gunyard's
 * Invite button fired the gun and would have started the left stick).
 */

afterEach(() => setInputBackend(null))

/** An element as the probe reads one: its parent, its classes and its rect. */
function element(name: string, parent: any, size: [number, number], classes: string[] = []) {
    return {
        name, parent,
        worldBound: { width: size[0], height: size[1] },
        ClassListContains: (c: string) => classes.includes(c),
    }
}

/**
 * A 400 by 300 panel with a stage-sized View and, inside it, a button at
 * 10..94, 10..40 with a Text in it. With `world`, the View has a press
 * handler of its own (a camera's drag), marked `oj-world` or not.
 */
function scene({ listens = true, world = "none" as "none" | "unmarked" | "marked" } = {}) {
    const stage = element("stage", null, [400, 300], world === "marked" ? [WORLD_CLASS] : [])
    const button = element("button", stage, [84, 30])
    const label = element("label", button, [40, 20])
    const handlers = new Map<object, string[]>([[button, ["click"]]])
    if (world !== "none") handlers.set(stage, ["pointerdown"])
    const asked: string[] = []
    const root = {
        worldBound: { width: 400, height: 300 },
        panel: {
            Pick: (p: { x: number, y: number }) => {
                asked.push(`${p.x},${p.y}`)
                return p.x >= 10 && p.x <= 94 && p.y >= 10 && p.y <= 40 ? (p.x < 50 ? label : button) : stage
            },
        },
    }
    const cs = { UnityEngine: { Vector2: function (this: any, x: number, y: number) { this.x = x; this.y = y } } }
    const events = listens ? { listens: (el: object, types: readonly string[]) => (handlers.get(el) ?? []).some((t) => types.includes(t)) } : {}
    return { root, cs, events, asked }
}

const args = (s: ReturnType<typeof scene>) => [s.root, s.cs, s.events] as const

describe("the probe", () => {
    it("answers for a button and anything inside it, and not for the stage-sized View around them", () => {
        const s = scene()
        const probe = createPressProbe(s.root, s.cs, s.events)!
        expect(probe(70, 20)).toBe(true)   // the button
        expect(probe(20, 20)).toBe(true)   // its label, answered by the button above it
        expect(probe(300, 300)).toBe(false) // the game, inside a pickable View that answers nothing
        expect(PRESS_EVENTS).toContain("click")
    })

    // runtime-1.3.md section 10b: a camera's View that fills the stage made every press UI.
    it("reads every press as UI under a stage-sized View with a handler, and none through one marked oj-world", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const unmarked = createPressProbe(...args(scene({ world: "unmarked" })))!
        expect(unmarked(300, 200)).toBe(true)
        const marked = createPressProbe(...args(scene({ world: "marked" })))!
        expect(marked(300, 200)).toBe(false)
        // A button inside the game's View is still the UI's.
        expect(marked(70, 20)).toBe(true)
        expect(marked(20, 20)).toBe(true)
        expect(warn).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })

    it("says how to mark a stage-sized View once, and never for a button", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const probe = createPressProbe(...args(scene({ world: "unmarked" })))!
        probe(70, 20)
        expect(warn).not.toHaveBeenCalled()
        probe(300, 200)
        probe(150, 250)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toBe(STAGE_SIZED_HINT)
        expect(STAGE_SIZED_HINT).toContain(`className="${WORLD_CLASS}"`)
        warn.mockRestore()
    })

    it("asks an element's classes only once it has a handler", () => {
        const s = scene({ world: "marked" })
        let classAsks = 0
        const counting = (el: any) => { const ask = el.ClassListContains; el.ClassListContains = (c: string) => { classAsks++; return ask(c) } }
        const label = s.root.panel.Pick({ x: 20, y: 20 })
        for (let el = label; el != null; el = el.parent) counting(el)
        createPressProbe(s.root, s.cs, s.events)!(20, 20)
        // The label has no handler and is never asked; the button answers.
        expect(classAsks).toBe(1)
    })

    it("is absent where the OneJS cannot say which elements listen, or there is no root", () => {
        const s = scene({ listens: false })
        expect(createPressProbe(s.root, s.cs, s.events)).toBeNull()
        expect(createPressProbe(null, s.cs, scene().events)).toBeNull()
    })
})

describe("the container's input", () => {
    const s = scene()
    const probe = createPressProbe(s.root, s.cs, s.events)

    it("marks a touch that came down on the button for its whole life, and one on the game not at all", () => {
        const c = createContainerInput({ overUI: probe })
        setInputBackend(c.backend)
        c.sink.touchDown(1, 70, 20)
        c.sink.touchDown(2, 300, 300)
        c.beginFrame()
        expect(input.touches.map((t) => [t.fingerId, t.overUI])).toEqual([[0, true], [1, false]])
        c.sink.touchMove(1, 300, 300)
        c.beginFrame()
        expect(input.touches[0].overUI).toBe(true)
    })

    it("keeps a click that began on the button over UI while it is held, and says where the pointer is otherwise", () => {
        const c = createContainerInput({ overUI: probe })
        setInputBackend(c.backend)
        c.sink.pointerDown(0, 70, 20)
        c.beginFrame()
        expect([input.mouse.leftButton, input.mouse.overUI]).toEqual([true, true])
        c.sink.pointerMove(300, 300)
        c.beginFrame()
        expect(input.mouse.overUI).toBe(true)
        c.sink.pointerUp(0, 300, 300)
        c.beginFrame()
        expect(input.mouse.overUI).toBe(false)
        c.sink.pointerDown(0, 300, 300)
        c.beginFrame()
        expect([input.mouse.leftButton, input.mouse.overUI]).toEqual([true, false])
    })

    it("says nothing is over UI without a probe", () => {
        const c = createContainerInput()
        setInputBackend(c.backend)
        c.sink.touchDown(1, 70, 20)
        c.sink.pointerDown(0, 70, 20)
        c.beginFrame()
        expect([input.touches[0].overUI, input.mouse.overUI]).toEqual([false, false])
    })
})

describe("sticks and pads", () => {
    const touch = (fingerId: number, x: number, y: number, phase: TouchPoint["phase"], overUI = false): TouchPoint =>
        ({ fingerId, position: { x, y }, phase, overUI })

    it("leave a thumb that came down on UI alone, and take the next one that lands on the game", () => {
        const s = newStick(50)
        readStick(s, [touch(1, 70, 20, "began", true)], () => true)
        expect(s.active).toBe(false)
        readStick(s, [touch(1, 120, 40, "moved", true), touch(2, 100, 300, "began")], () => true)
        expect([s.active, s.finger]).toEqual([true, 2])

        const p: PadState = { down: false, pressed: false, released: false, x: 70, y: 20, radius: 30, finger: -1 }
        readPad(p, [touch(3, 70, 20, "began", true)])
        expect(p.down).toBe(false)
    })
})

describe("an ejected cart's input", () => {
    const stage = stageOf(800, 600)
    const bridge = (state: { buttons: number, mx: number, my: number, touches: Array<{ id: number, x: number, y: number, phase: number }> }) => ({
        GetMouseButtons: () => state.buttons,
        GetMousePositionX: () => state.mx,
        GetMousePositionY: () => 600 - state.my,
        GetTouchFingerId: (i: number) => state.touches[i].id,
        GetTouchPhase: (i: number) => state.touches[i].phase,
        GetTouchPositionX: (i: number) => state.touches[i].x,
        GetTouchPositionY: (i: number) => 600 - state.touches[i].y,
        IsMouseOverUI: () => { throw new Error("InputBridge has no IsMouseOverUI") },
    })

    it("places a press the first time it is asked about, keeps it while held, and never asks the bridge", () => {
        const state = { buttons: 1, mx: 70, my: 20, touches: [{ id: 5, x: 70, y: 20, phase: 0 }] }
        const host = createHostInputBackend({ stage: () => stage, pixelRatio: () => 1, bridge: bridge(state), overUI: probe() }) as any
        expect(host.IsMouseOverUI()).toBe(true)
        expect(host.GetTouchOverUI(0)).toBe(true)
        state.mx = 300; state.my = 300
        state.touches[0] = { id: 5, x: 300, y: 300, phase: 1 }
        expect(host.IsMouseOverUI()).toBe(true)
        expect(host.GetTouchOverUI(0)).toBe(true)
        state.buttons = 0
        expect(host.IsMouseOverUI()).toBe(false)
        // The same finger id, down again on the game: placed afresh.
        state.touches[0] = { id: 5, x: 300, y: 300, phase: 0 }
        expect(host.GetTouchOverUI(0)).toBe(false)
    })

    function probe() {
        const s = scene()
        return createPressProbe(s.root, s.cs, s.events)
    }
})
