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
        sys.keyDown("KeyW")
        expect(sys.pressed("KeyW")).toBe(true)
        expect(sys.down("KeyW")).toBe(true)

        tick(sys)
        expect(sys.pressed("KeyW")).toBe(false)
        expect(sys.down("KeyW")).toBe(true)
    })

    it("reports released only on the frame the key came up", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyW")
        tick(sys)
        sys.keyUp("KeyW")
        expect(sys.released("KeyW")).toBe(true)
        expect(sys.down("KeyW")).toBe(false)

        tick(sys)
        expect(sys.released("KeyW")).toBe(false)
    })

    it("ignores OS auto-repeat, so pressed does not re-fire while held", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyW")
        expect(sys.pressed("KeyW")).toBe(true)

        tick(sys)
        sys.keyDown("KeyW") // auto-repeat
        sys.keyDown("KeyW")
        expect(sys.pressed("KeyW")).toBe(false)
        expect(sys.down("KeyW")).toBe(true)
    })

    // A boolean-flag implementation loses one of these two. Frame numbers keep both.
    it("reports both pressed and released for a tap inside one frame", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("Space")
        sys.keyUp("Space")
        expect(sys.pressed("Space")).toBe(true)
        expect(sys.released("Space")).toBe(true)
        expect(sys.down("Space")).toBe(false)
    })

    it("ignores a key up that had no matching key down", () => {
        const sys = make()
        tick(sys)
        sys.keyUp("KeyQ")
        expect(sys.released("KeyQ")).toBe(false)
        expect(sys.down("KeyQ")).toBe(false)
    })

    it("reports nothing for a key never touched", () => {
        const sys = make()
        tick(sys)
        expect(sys.down("KeyZ")).toBe(false)
        expect(sys.pressed("KeyZ")).toBe(false)
        expect(sys.released("KeyZ")).toBe(false)
    })

    it("tracks keys independently", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyA")
        sys.keyDown("KeyB")
        tick(sys)
        sys.keyUp("KeyA")
        expect(sys.down("KeyA")).toBe(false)
        expect(sys.down("KeyB")).toBe(true)
    })
})

describe("anyDown and anyPressed", () => {
    it("tracks whether anything is held", () => {
        const sys = make()
        tick(sys)
        expect(sys.anyDown()).toBe(false)
        sys.keyDown("KeyA")
        expect(sys.anyDown()).toBe(true)
        sys.keyUp("KeyA")
        expect(sys.anyDown()).toBe(false)
    })

    it("does not double count auto-repeat", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyA")
        sys.keyDown("KeyA")
        sys.keyUp("KeyA")
        expect(sys.anyDown()).toBe(false)
    })

    it("reports anyPressed for one frame only", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyA")
        expect(sys.anyPressed()).toBe(true)
        tick(sys)
        expect(sys.anyPressed()).toBe(false)
    })
})

describe("blur", () => {
    // Without this, alt-tabbing while holding a key leaves it held forever,
    // because the keyup goes to whatever took focus.
    it("releases every held key", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyW")
        sys.keyDown("KeyD")
        tick(sys)
        sys.blur()
        expect(sys.down("KeyW")).toBe(false)
        expect(sys.down("KeyD")).toBe(false)
        expect(sys.anyDown()).toBe(false)
    })

    it("fires released on the blur frame so cleanup runs", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyW")
        tick(sys)
        sys.blur()
        expect(sys.released("KeyW")).toBe(true)
    })

    it("leaves the held count consistent, so later presses still register", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyW")
        sys.blur()
        sys.keyUp("KeyW") // the real keyup arrives late; must not corrupt the count
        tick(sys)
        sys.keyDown("KeyW")
        expect(sys.anyDown()).toBe(true)
        expect(sys.pressed("KeyW")).toBe(true)
    })

    it("clears pointer buttons and hover", () => {
        const sys = make()
        tick(sys)
        sys.pointerEnter()
        sys.pointerDown(0)
        tick(sys)
        sys.blur()
        expect(sys.pointer.down).toBe(false)
        expect(sys.pointer.buttons).toBe(0)
        expect(sys.pointer.over).toBe(false)
        expect(sys.pointerReleased(0)).toBe(true)
    })
})

describe("axes", () => {
    it("returns -1, 0 or 1 from the default horizontal axis", () => {
        const sys = make()
        tick(sys)
        expect(sys.axis("horizontal")).toBe(0)
        sys.keyDown("KeyD")
        expect(sys.axis("horizontal")).toBe(1)
        sys.keyUp("KeyD")
        sys.keyDown("KeyA")
        expect(sys.axis("horizontal")).toBe(-1)
    })

    it("cancels to zero when both directions are held", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyA")
        sys.keyDown("KeyD")
        expect(sys.axis("horizontal")).toBe(0)
    })

    it("accepts arrow keys as well as WASD", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("ArrowRight")
        expect(sys.axis("horizontal")).toBe(1)
    })

    // Differs from UnityEngine.Input on purpose: the stage is y-down, so
    // positive vertical has to be down or `y += axis * speed` moves backwards.
    it("makes positive vertical mean down the screen", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyS")
        expect(sys.axis("vertical")).toBe(1)
        sys.keyUp("KeyS")
        sys.keyDown("KeyW")
        expect(sys.axis("vertical")).toBe(-1)
    })

    it("merges custom axes over the defaults", () => {
        const sys = make({ axes: { fire: { negative: [], positive: ["Space"] } } })
        tick(sys)
        sys.keyDown("Space")
        expect(sys.axis("fire")).toBe(1)
        expect(sys.axis("horizontal")).toBe(0)
    })

    it("lets a custom axis replace a default", () => {
        const sys = make({ axes: { horizontal: { negative: ["KeyJ"], positive: ["KeyL"] } } })
        tick(sys)
        sys.keyDown("KeyD")
        expect(sys.axis("horizontal")).toBe(0)
        sys.keyDown("KeyL")
        expect(sys.axis("horizontal")).toBe(1)
    })

    it("returns 0 for an unknown axis and warns exactly once", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const sys = make()
        tick(sys)
        expect(sys.axis("verticle")).toBe(0)
        expect(sys.axis("verticle")).toBe(0)
        expect(sys.axis("verticle")).toBe(0)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]![0]).toMatch(/unknown input axis "verticle"/)
    })

})

describe("pointer", () => {
    const layout = () => computeStageLayout(normalizeStage({ size: [960, 540] }), 1920, 540)

    it("passes viewport coordinates through when there is no stage", () => {
        const sys = make()
        tick(sys)
        sys.pointerMove(100, 50)
        expect(sys.pointer.x).toBe(100)
        expect(sys.pointer.y).toBe(50)
    })

    // The whole reason input holds a stage layout: a game lays itself out in
    // logical units, so a pointer in device pixels would miss every hitbox.
    it("reports logical stage units once a layout is set", () => {
        const sys = make()
        sys.setStageLayout(layout())
        tick(sys)
        sys.pointerMove(1920 / 2, 540 / 2)
        expect(sys.pointer.x).toBeCloseTo(480, 6)
        expect(sys.pointer.y).toBeCloseTo(270, 6)
        expect(sys.pointer.viewportX).toBe(960)
    })

    it("re-converts the last position when the layout changes", () => {
        const sys = make()
        sys.setStageLayout(layout())
        tick(sys)
        sys.pointerMove(960, 270)
        expect(sys.pointer.x).toBeCloseTo(480, 6)

        sys.setStageLayout(computeStageLayout(normalizeStage({ size: [960, 540] }), 960, 540))
        expect(sys.pointer.x).toBeCloseTo(960, 6)
    })

    it("goes back to passthrough when the layout is cleared", () => {
        const sys = make()
        sys.setStageLayout(layout())
        tick(sys)
        sys.pointerMove(1000, 100)
        sys.setStageLayout(null)
        expect(sys.pointer.x).toBe(1000)
    })

    it("reuses one object rather than allocating per read", () => {
        const sys = make()
        tick(sys)
        expect(sys.pointer).toBe(sys.pointer)
    })

    it("tracks buttons as a bitmask", () => {
        const sys = make()
        tick(sys)
        sys.pointerDown(0)
        expect(sys.pointer.buttons).toBe(0b1)
        expect(sys.pointer.down).toBe(true)
        sys.pointerDown(2)
        expect(sys.pointer.buttons).toBe(0b101)
        sys.pointerUp(0)
        expect(sys.pointer.buttons).toBe(0b100)
        expect(sys.pointer.down).toBe(true)
        sys.pointerUp(2)
        expect(sys.pointer.down).toBe(false)
    })

    it("reports button edges for one frame", () => {
        const sys = make()
        tick(sys)
        sys.pointerDown(0)
        expect(sys.pointerPressed(0)).toBe(true)
        tick(sys)
        expect(sys.pointerPressed(0)).toBe(false)
        sys.pointerUp(0)
        expect(sys.pointerReleased(0)).toBe(true)
    })

    it("defaults the button argument to the primary button", () => {
        const sys = make()
        tick(sys)
        sys.pointerDown(0)
        expect(sys.pointerPressed()).toBe(true)
    })

    it("moves the pointer when a press carries a position", () => {
        const sys = make()
        tick(sys)
        sys.pointerDown(0, 42, 24)
        expect(sys.pointer.viewportX).toBe(42)
        expect(sys.pointer.viewportY).toBe(24)
    })

    it("ignores out-of-range buttons rather than corrupting the mask", () => {
        const sys = make()
        tick(sys)
        sys.pointerDown(99)
        sys.pointerDown(-1)
        expect(sys.pointer.buttons).toBe(0)
        expect(sys.pointerPressed(99)).toBe(false)
    })

    it("tracks hover", () => {
        const sys = make()
        tick(sys)
        expect(sys.pointer.over).toBe(false)
        sys.pointerEnter()
        expect(sys.pointer.over).toBe(true)
        sys.pointerLeave()
        expect(sys.pointer.over).toBe(false)
    })
})

describe("bookkeeping", () => {
    it("advances the frame counter", () => {
        const sys = make()
        expect(sys.frame).toBe(0)
        tick(sys)
        expect(sys.frame).toBe(1)
        tick(sys)
        expect(sys.frame).toBe(2)
    })

    it("clears everything on reset", () => {
        const sys = make()
        tick(sys)
        sys.keyDown("KeyW")
        sys.pointerDown(0, 10, 10)
        sys.pointerEnter()
        sys.reset()
        expect(sys.down("KeyW")).toBe(false)
        expect(sys.anyDown()).toBe(false)
        expect(sys.pointer.buttons).toBe(0)
        expect(sys.pointer.over).toBe(false)
        expect(sys.pointer.x).toBe(0)
    })

    // White-box on purpose: "reading never grows the table" is the invariant
    // that stops a game polling computed key names from leaking, and there is
    // no black-box way to observe it.
    it("does not create key records when polling", () => {
        const sys = make()
        tick(sys)
        for (let i = 0; i < 500; i++) {
            sys.down(`Key${i}`)
            sys.pressed(`Key${i}`)
            sys.released(`Key${i}`)
        }
        expect((sys as unknown as { _keys: Map<string, unknown> })._keys.size).toBe(0)

        sys.keyDown("KeyW")
        expect((sys as unknown as { _keys: Map<string, unknown> })._keys.size).toBe(1)
    })
})
