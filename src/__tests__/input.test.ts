import { describe, it, expect, vi, afterEach } from "vitest"
import { createInput, type InputSystem } from "../input"
import { computeStageLayout, normalizeStage } from "../stage"

const make = (opts = {}) => createInput(opts)

/** Advances a frame and returns the system, so tests read like a game loop. */
const tick = (sys: InputSystem) => { sys.beginFrame(); return sys }

afterEach(() => vi.restoreAllMocks())

describe("key edges", () => {
    it("reports pressed only on the frame the key went down", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyW")
        expect(sys.input.pressed("KeyW")).toBe(true)
        expect(sys.input.down("KeyW")).toBe(true)

        tick(sys)
        expect(sys.input.pressed("KeyW")).toBe(false)
        expect(sys.input.down("KeyW")).toBe(true)
    })

    it("reports released only on the frame the key came up", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyW")
        tick(sys)
        sys.sink.keyUp("KeyW")
        expect(sys.input.released("KeyW")).toBe(true)
        expect(sys.input.down("KeyW")).toBe(false)

        tick(sys)
        expect(sys.input.released("KeyW")).toBe(false)
    })

    it("ignores OS auto-repeat, so pressed does not re-fire while held", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyW")
        expect(sys.input.pressed("KeyW")).toBe(true)

        tick(sys)
        sys.sink.keyDown("KeyW") // auto-repeat
        sys.sink.keyDown("KeyW")
        expect(sys.input.pressed("KeyW")).toBe(false)
        expect(sys.input.down("KeyW")).toBe(true)
    })

    // A boolean-flag implementation loses one of these two. Frame numbers keep both.
    it("reports both pressed and released for a tap inside one frame", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("Space")
        sys.sink.keyUp("Space")
        expect(sys.input.pressed("Space")).toBe(true)
        expect(sys.input.released("Space")).toBe(true)
        expect(sys.input.down("Space")).toBe(false)
    })

    it("ignores a key up that had no matching key down", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyUp("KeyQ")
        expect(sys.input.released("KeyQ")).toBe(false)
        expect(sys.input.down("KeyQ")).toBe(false)
    })

    it("reports nothing for a key never touched", () => {
        const sys = make()
        tick(sys)
        expect(sys.input.down("KeyZ")).toBe(false)
        expect(sys.input.pressed("KeyZ")).toBe(false)
        expect(sys.input.released("KeyZ")).toBe(false)
    })

    it("tracks keys independently", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyA")
        sys.sink.keyDown("KeyB")
        tick(sys)
        sys.sink.keyUp("KeyA")
        expect(sys.input.down("KeyA")).toBe(false)
        expect(sys.input.down("KeyB")).toBe(true)
    })
})

describe("anyDown and anyPressed", () => {
    it("tracks whether anything is held", () => {
        const sys = make()
        tick(sys)
        expect(sys.input.anyDown()).toBe(false)
        sys.sink.keyDown("KeyA")
        expect(sys.input.anyDown()).toBe(true)
        sys.sink.keyUp("KeyA")
        expect(sys.input.anyDown()).toBe(false)
    })

    it("does not double count auto-repeat", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyA")
        sys.sink.keyDown("KeyA")
        sys.sink.keyUp("KeyA")
        expect(sys.input.anyDown()).toBe(false)
    })

    it("reports anyPressed for one frame only", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyA")
        expect(sys.input.anyPressed()).toBe(true)
        tick(sys)
        expect(sys.input.anyPressed()).toBe(false)
    })
})

describe("blur", () => {
    // Without this, alt-tabbing while holding a key leaves it held forever,
    // because the keyup goes to whatever took focus.
    it("releases every held key", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyW")
        sys.sink.keyDown("KeyD")
        tick(sys)
        sys.sink.blur()
        expect(sys.input.down("KeyW")).toBe(false)
        expect(sys.input.down("KeyD")).toBe(false)
        expect(sys.input.anyDown()).toBe(false)
    })

    it("fires released on the blur frame so cleanup runs", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyW")
        tick(sys)
        sys.sink.blur()
        expect(sys.input.released("KeyW")).toBe(true)
    })

    it("leaves the held count consistent, so later presses still register", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyW")
        sys.sink.blur()
        sys.sink.keyUp("KeyW") // the real keyup arrives late; must not corrupt the count
        tick(sys)
        sys.sink.keyDown("KeyW")
        expect(sys.input.anyDown()).toBe(true)
        expect(sys.input.pressed("KeyW")).toBe(true)
    })

    it("clears pointer buttons and hover", () => {
        const sys = make()
        tick(sys)
        sys.sink.pointerEnter()
        sys.sink.pointerDown(0)
        tick(sys)
        sys.sink.blur()
        expect(sys.input.pointer.down).toBe(false)
        expect(sys.input.pointer.buttons).toBe(0)
        expect(sys.input.pointer.over).toBe(false)
        expect(sys.input.pointerReleased(0)).toBe(true)
    })
})

describe("axes", () => {
    it("returns -1, 0 or 1 from the default horizontal axis", () => {
        const sys = make()
        tick(sys)
        expect(sys.input.axis("horizontal")).toBe(0)
        sys.sink.keyDown("KeyD")
        expect(sys.input.axis("horizontal")).toBe(1)
        sys.sink.keyUp("KeyD")
        sys.sink.keyDown("KeyA")
        expect(sys.input.axis("horizontal")).toBe(-1)
    })

    it("cancels to zero when both directions are held", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyA")
        sys.sink.keyDown("KeyD")
        expect(sys.input.axis("horizontal")).toBe(0)
    })

    it("accepts arrow keys as well as WASD", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("ArrowRight")
        expect(sys.input.axis("horizontal")).toBe(1)
    })

    // Differs from UnityEngine.Input on purpose: the stage is y-down, so
    // positive vertical has to be down or `y += axis * speed` moves backwards.
    it("makes positive vertical mean down the screen", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyS")
        expect(sys.input.axis("vertical")).toBe(1)
        sys.sink.keyUp("KeyS")
        sys.sink.keyDown("KeyW")
        expect(sys.input.axis("vertical")).toBe(-1)
    })

    it("merges custom axes over the defaults", () => {
        const sys = make({ axes: { fire: { negative: [], positive: ["Space"] } } })
        tick(sys)
        sys.sink.keyDown("Space")
        expect(sys.input.axis("fire")).toBe(1)
        expect(sys.input.axis("horizontal")).toBe(0)
    })

    it("lets a custom axis replace a default", () => {
        const sys = make({ axes: { horizontal: { negative: ["KeyJ"], positive: ["KeyL"] } } })
        tick(sys)
        sys.sink.keyDown("KeyD")
        expect(sys.input.axis("horizontal")).toBe(0)
        sys.sink.keyDown("KeyL")
        expect(sys.input.axis("horizontal")).toBe(1)
    })

    it("returns 0 for an unknown axis and warns exactly once", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const sys = make()
        tick(sys)
        expect(sys.input.axis("verticle")).toBe(0)
        expect(sys.input.axis("verticle")).toBe(0)
        expect(sys.input.axis("verticle")).toBe(0)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]![0]).toMatch(/unknown input axis "verticle"/)
    })

    it("can have the warning turned off", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const sys = make({ warnOnUnknownAxis: false })
        tick(sys)
        sys.input.axis("nope")
        expect(warn).not.toHaveBeenCalled()
    })
})

describe("pointer", () => {
    const layout = () => computeStageLayout(normalizeStage({ size: [960, 540] }), 1920, 540)

    it("passes viewport coordinates through when there is no stage", () => {
        const sys = make()
        tick(sys)
        sys.sink.pointerMove(100, 50)
        expect(sys.input.pointer.x).toBe(100)
        expect(sys.input.pointer.y).toBe(50)
    })

    // The whole reason input holds a stage layout: a game lays itself out in
    // logical units, so a pointer in device pixels would miss every hitbox.
    it("reports logical stage units once a layout is set", () => {
        const sys = make()
        sys.setStageLayout(layout())
        tick(sys)
        sys.sink.pointerMove(1920 / 2, 540 / 2)
        expect(sys.input.pointer.x).toBeCloseTo(480, 6)
        expect(sys.input.pointer.y).toBeCloseTo(270, 6)
        expect(sys.input.pointer.viewportX).toBe(960)
    })

    it("re-converts the last position when the layout changes", () => {
        const sys = make()
        sys.setStageLayout(layout())
        tick(sys)
        sys.sink.pointerMove(960, 270)
        expect(sys.input.pointer.x).toBeCloseTo(480, 6)

        sys.setStageLayout(computeStageLayout(normalizeStage({ size: [960, 540] }), 960, 540))
        expect(sys.input.pointer.x).toBeCloseTo(960, 6)
    })

    it("goes back to passthrough when the layout is cleared", () => {
        const sys = make()
        sys.setStageLayout(layout())
        tick(sys)
        sys.sink.pointerMove(1000, 100)
        sys.setStageLayout(null)
        expect(sys.input.pointer.x).toBe(1000)
    })

    it("reuses one object rather than allocating per read", () => {
        const sys = make()
        tick(sys)
        expect(sys.input.pointer).toBe(sys.input.pointer)
    })

    it("tracks buttons as a bitmask", () => {
        const sys = make()
        tick(sys)
        sys.sink.pointerDown(0)
        expect(sys.input.pointer.buttons).toBe(0b1)
        expect(sys.input.pointer.down).toBe(true)
        sys.sink.pointerDown(2)
        expect(sys.input.pointer.buttons).toBe(0b101)
        sys.sink.pointerUp(0)
        expect(sys.input.pointer.buttons).toBe(0b100)
        expect(sys.input.pointer.down).toBe(true)
        sys.sink.pointerUp(2)
        expect(sys.input.pointer.down).toBe(false)
    })

    it("reports button edges for one frame", () => {
        const sys = make()
        tick(sys)
        sys.sink.pointerDown(0)
        expect(sys.input.pointerPressed(0)).toBe(true)
        tick(sys)
        expect(sys.input.pointerPressed(0)).toBe(false)
        sys.sink.pointerUp(0)
        expect(sys.input.pointerReleased(0)).toBe(true)
    })

    it("defaults the button argument to the primary button", () => {
        const sys = make()
        tick(sys)
        sys.sink.pointerDown(0)
        expect(sys.input.pointerPressed()).toBe(true)
    })

    it("moves the pointer when a press carries a position", () => {
        const sys = make()
        tick(sys)
        sys.sink.pointerDown(0, 42, 24)
        expect(sys.input.pointer.viewportX).toBe(42)
        expect(sys.input.pointer.viewportY).toBe(24)
    })

    it("ignores out-of-range buttons rather than corrupting the mask", () => {
        const sys = make()
        tick(sys)
        sys.sink.pointerDown(99)
        sys.sink.pointerDown(-1)
        expect(sys.input.pointer.buttons).toBe(0)
        expect(sys.input.pointerPressed(99)).toBe(false)
    })

    it("tracks hover", () => {
        const sys = make()
        tick(sys)
        expect(sys.input.pointer.over).toBe(false)
        sys.sink.pointerEnter()
        expect(sys.input.pointer.over).toBe(true)
        sys.sink.pointerLeave()
        expect(sys.input.pointer.over).toBe(false)
    })
})

describe("bookkeeping", () => {
    it("advances the frame counter", () => {
        const sys = make()
        expect(sys.input.frame).toBe(0)
        tick(sys)
        expect(sys.input.frame).toBe(1)
        tick(sys)
        expect(sys.input.frame).toBe(2)
    })

    it("clears everything on reset", () => {
        const sys = make()
        tick(sys)
        sys.sink.keyDown("KeyW")
        sys.sink.pointerDown(0, 10, 10)
        sys.sink.pointerEnter()
        sys.reset()
        expect(sys.input.down("KeyW")).toBe(false)
        expect(sys.input.anyDown()).toBe(false)
        expect(sys.input.pointer.buttons).toBe(0)
        expect(sys.input.pointer.over).toBe(false)
        expect(sys.input.pointer.x).toBe(0)
    })

    it("returns null for gamepads in 1.0", () => {
        expect(make().input.gamepad(0)).toBeNull()
    })

    // White-box on purpose: "reading never grows the table" is the invariant
    // that stops a game polling computed key names from leaking, and there is
    // no black-box way to observe it.
    it("does not create key records when polling", () => {
        const sys = make()
        tick(sys)
        for (let i = 0; i < 500; i++) {
            sys.input.down(`Key${i}`)
            sys.input.pressed(`Key${i}`)
            sys.input.released(`Key${i}`)
        }
        expect((sys.input as unknown as { _keys: Map<string, unknown> })._keys.size).toBe(0)

        sys.sink.keyDown("KeyW")
        expect((sys.input as unknown as { _keys: Map<string, unknown> })._keys.size).toBe(1)
    })
})
