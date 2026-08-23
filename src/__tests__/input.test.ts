import { describe, it, expect, afterEach } from "vitest"
import { setInputBackend, input } from "onejs-unity/input"
import { createContainerInput, type ContainerInput } from "../input"
import { computeStageLayout, normalizeStage } from "../stage"

const make = () => createContainerInput()
const tick = (c: ContainerInput) => { c.beginFrame(); return c }
/**
 * Crosses the frame boundary, which is when queued events become visible.
 * Mirrors a real loop: the browser delivers whenever it likes, beginFrame
 * decides which frame sees it.
 */
const deliver = (c: ContainerInput) => { c.beginFrame(); return c }

/** The backend is what onejs-unity calls; tests read through it. */
const b = (c: ContainerInput) => c.backend as Record<string, (...a: any[]) => any>

afterEach(() => setInputBackend(null))

const BEGAN = 0, MOVED = 1, STATIONARY = 2, ENDED = 3, CANCELED = 4

describe("touches", () => {
    it("walks one finger through its phases and then forgets it", () => {
        const c = tick(make())
        c.sink.touchDown(7, 100, 200)
        deliver(c)
        expect(b(c).GetTouchCount()).toBe(1)
        expect(b(c).GetTouchPhase(0)).toBe(BEGAN)
        expect(b(c).GetTouchPositionX(0)).toBe(100)

        // Down but not moving is stationary, not moved: a game holding still
        // should not read a stream of movement.
        tick(c)
        expect(b(c).GetTouchPhase(0)).toBe(STATIONARY)

        c.sink.touchMove(7, 130, 200)
        deliver(c)
        expect(b(c).GetTouchPhase(0)).toBe(MOVED)
        expect(b(c).GetTouchDeltaX(0)).toBe(30)

        // The delta is what happened in that frame, so it clears once read.
        tick(c)
        expect(b(c).GetTouchDeltaX(0)).toBe(0)

        c.sink.touchUp(7, 130, 200)
        deliver(c)
        expect(b(c).GetTouchPhase(0)).toBe(ENDED)
        expect(b(c).GetTouchCount()).toBe(1)

        // Reported once, then gone, so a lift can be handled by reading the
        // phase rather than by diffing two frames of touch lists.
        tick(c)
        expect(b(c).GetTouchCount()).toBe(0)
    })

    it("shows a tap faster than a frame as began before ended", () => {
        // Both events land in the same drain. Collapsing them into ended would
        // mean a game watching for began never sees the tap at all.
        const c = tick(make())
        c.sink.touchDown(1, 10, 10)
        c.sink.touchUp(1, 10, 10)
        deliver(c)
        expect(b(c).GetTouchPhase(0)).toBe(BEGAN)
        tick(c)
        expect(b(c).GetTouchPhase(0)).toBe(ENDED)
        tick(c)
        expect(b(c).GetTouchCount()).toBe(0)
    })

    it("gives each finger its own id and reuses one that lifted", () => {
        const c = tick(make())
        c.sink.touchDown(11, 0, 0)
        c.sink.touchDown(12, 50, 50)
        deliver(c)
        expect(b(c).GetTouchCount()).toBe(2)
        expect([b(c).GetTouchFingerId(0), b(c).GetTouchFingerId(1)]).toEqual([0, 1])

        c.sink.touchUp(11, 0, 0)
        deliver(c)
        tick(c)
        expect(b(c).GetTouchCount()).toBe(1)
        expect(b(c).GetTouchFingerId(0)).toBe(1)

        // The freed id comes back, which is what Unity does and what a game
        // keying state to a finger depends on.
        c.sink.touchDown(13, 5, 5)
        deliver(c)
        expect(b(c).GetTouchFingerId(1)).toBe(0)
    })

    it("ignores a move or a lift for a finger it never saw go down", () => {
        const c = tick(make())
        c.sink.touchMove(99, 1, 1)
        c.sink.touchUp(99, 1, 1)
        deliver(c)
        expect(b(c).GetTouchCount()).toBe(0)
    })

    it("cancels every finger when focus is lost", () => {
        // Otherwise the pointerup goes to whatever took focus and the finger
        // stays down forever, exactly as a held key would.
        const c = tick(make())
        c.sink.touchDown(4, 20, 20)
        deliver(c)
        c.sink.blur()
        deliver(c)
        expect(b(c).GetTouchPhase(0)).toBe(CANCELED)
        tick(c)
        expect(b(c).GetTouchCount()).toBe(0)
    })

    it("reports touches in stage units, as it does the pointer", () => {
        const c = make()
        const stage = normalizeStage({ size: [600, 300], fit: "letterbox" })
        c.setStageLayout(computeStageLayout(stage, 1200, 600))
        tick(c)
        c.sink.touchDown(2, 600, 300)
        deliver(c)
        // Halfway across a viewport twice the stage's size is halfway across
        // the stage, whatever the letterboxing did.
        expect(b(c).GetTouchPositionX(0)).toBeCloseTo(300, 0)
        expect(b(c).GetTouchPositionY(0)).toBeCloseTo(150, 0)
    })

    it("answers none when nothing is touching", () => {
        const c = tick(make())
        expect(b(c).GetTouchCount()).toBe(0)
        expect(b(c).GetTouchFingerId(0)).toBe(-1)
    })
})

describe("key edges", () => {
    it("reports pressed only on the frame the key went down", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        deliver(c)
        expect(b(c).GetKeyPressed("W")).toBe(true)
        expect(b(c).GetKeyDown("W")).toBe(true)
        tick(c)
        expect(b(c).GetKeyPressed("W")).toBe(false)
        expect(b(c).GetKeyDown("W")).toBe(true)
    })

    it("reports released only on the frame the key came up", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        tick(c)
        c.sink.keyUp("KeyW")
        deliver(c)
        expect(b(c).GetKeyReleased("W")).toBe(true)
        expect(b(c).GetKeyDown("W")).toBe(false)
        tick(c)
        expect(b(c).GetKeyReleased("W")).toBe(false)
    })

    it("ignores OS auto-repeat", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        tick(c)
        c.sink.keyDown("KeyW")
        c.sink.keyDown("KeyW")
        deliver(c)
        expect(b(c).GetKeyPressed("W")).toBe(false)
        expect(b(c).GetKeyDown("W")).toBe(true)
    })

    // A boolean-flag implementation loses one of these two.
    it("reports both pressed and released for a tap inside one frame", () => {
        const c = tick(make())
        c.sink.keyDown("Space")
        c.sink.keyUp("Space")
        deliver(c)
        expect(b(c).GetKeyPressed("Space")).toBe(true)
        expect(b(c).GetKeyReleased("Space")).toBe(true)
        expect(b(c).GetKeyDown("Space")).toBe(false)
    })

    it("ignores a key up with no matching key down", () => {
        const c = tick(make())
        c.sink.keyUp("KeyQ")
        deliver(c)
        expect(b(c).GetKeyReleased("Q")).toBe(false)
    })

    it("tracks any-key state", () => {
        const c = tick(make())
        expect(b(c).GetAnyKeyDown()).toBe(false)
        c.sink.keyDown("KeyA")
        deliver(c)
        expect(b(c).GetAnyKeyDown()).toBe(true)
        expect(b(c).GetAnyKeyPressed()).toBe(true)
        tick(c)
        expect(b(c).GetAnyKeyPressed()).toBe(false)
        c.sink.keyUp("KeyA")
        deliver(c)
        expect(b(c).GetAnyKeyDown()).toBe(false)
    })
})

describe("DOM to Unity translation", () => {
    it("stores DOM codes under their Unity key name", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        c.sink.keyDown("ArrowLeft")
        c.sink.keyDown("ShiftLeft")
        deliver(c)
        expect(b(c).GetKeyDown("W")).toBe(true)
        expect(b(c).GetKeyDown("LeftArrow")).toBe(true)
        expect(b(c).GetKeyDown("LeftShift")).toBe(true)
    })

    it("accepts any alias InputBridge accepts on the query side", () => {
        const c = tick(make())
        c.sink.keyDown("ArrowUp")
        deliver(c)
        expect(b(c).GetKeyDown("UpArrow")).toBe(true)
        expect(b(c).GetKeyDown("Up")).toBe(true)
        expect(b(c).GetKeyDown("up")).toBe(true)
    })

    it("ignores a DOM code with no Unity equivalent instead of storing junk", () => {
        const c = tick(make())
        c.sink.keyDown("Sparkle")
        deliver(c)
        expect(b(c).GetAnyKeyDown()).toBe(false)
    })

    it("returns false for an unrecognised query rather than throwing", () => {
        expect(b(tick(make())).GetKeyDown("Sparkle")).toBe(false)
    })
})

describe("modifiers", () => {
    it("reports the InputBridge bit layout", () => {
        const c = tick(make())
        c.sink.keyDown("ShiftLeft")
        deliver(c)
        expect(b(c).GetModifiers()).toBe(1)
        c.sink.keyDown("ControlLeft")
        deliver(c)
        expect(b(c).GetModifiers()).toBe(1 | 2)
        c.sink.keyDown("AltLeft")
        c.sink.keyDown("MetaLeft")
        deliver(c)
        expect(b(c).GetModifiers()).toBe(1 | 2 | 4 | 8)
    })

    it("clears a modifier only when both sides are up", () => {
        const c = tick(make())
        c.sink.keyDown("ShiftLeft")
        c.sink.keyDown("ShiftRight")
        c.sink.keyUp("ShiftLeft")
        deliver(c)
        expect(b(c).GetModifiers()).toBe(1)
        c.sink.keyUp("ShiftRight")
        deliver(c)
        expect(b(c).GetModifiers()).toBe(0)
    })

    it("clears on blur", () => {
        const c = tick(make())
        c.sink.keyDown("ShiftLeft")
        c.sink.blur()
        deliver(c)
        expect(b(c).GetModifiers()).toBe(0)
    })
})

describe("blur", () => {
    it("releases every held key and fires released", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        tick(c)
        c.sink.blur()
        deliver(c)
        expect(b(c).GetKeyDown("W")).toBe(false)
        expect(b(c).GetKeyReleased("W")).toBe(true)
        expect(b(c).GetAnyKeyDown()).toBe(false)
    })

    it("leaves the held count consistent when the real keyup arrives late", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        c.sink.blur()
        c.sink.keyUp("KeyW")
        tick(c)
        c.sink.keyDown("KeyW")
        deliver(c)
        expect(b(c).GetAnyKeyDown()).toBe(true)
    })

    it("clears pointer buttons", () => {
        const c = tick(make())
        c.sink.pointerDown(0)
        tick(c)
        c.sink.blur()
        deliver(c)
        expect(b(c).GetMouseButtons()).toBe(0)
        expect(b(c).GetMouseButtonsReleased()).toBe(1)
    })
})

describe("mouse buttons", () => {
    // DOM says 1 is middle and 2 is right; Unity's mask is left, right, middle.
    // Mapping straight through silently swaps them.
    it("maps DOM button indices onto Unity's bits without swapping middle and right", () => {
        const c = tick(make())
        c.sink.pointerDown(2) // DOM right
        deliver(c)
        expect(b(c).GetMouseButtons()).toBe(2) // Unity right bit
        c.sink.pointerDown(1) // DOM middle
        deliver(c)
        expect(b(c).GetMouseButtons()).toBe(2 | 4) // Unity middle bit
    })

    it("tracks the primary button", () => {
        const c = tick(make())
        c.sink.pointerDown(0)
        deliver(c)
        expect(b(c).GetMouseButtons()).toBe(1)
        c.sink.pointerUp(0)
        deliver(c)
        expect(b(c).GetMouseButtons()).toBe(0)
    })

    it("reports button edges for one frame", () => {
        const c = tick(make())
        c.sink.pointerDown(0)
        deliver(c)
        expect(b(c).GetMouseButtonsPressed()).toBe(1)
        tick(c)
        expect(b(c).GetMouseButtonsPressed()).toBe(0)
        c.sink.pointerUp(0)
        deliver(c)
        expect(b(c).GetMouseButtonsReleased()).toBe(1)
    })

    it("ignores an out-of-range button rather than corrupting the mask", () => {
        const c = tick(make())
        c.sink.pointerDown(99)
        deliver(c)
        expect(b(c).GetMouseButtons()).toBe(0)
    })
})

describe("mouse position, delta and scroll", () => {
    const layout = () => computeStageLayout(normalizeStage({ size: [960, 540] }), 1920, 540)

    it("passes viewport coordinates through with no stage", () => {
        const c = tick(make())
        c.sink.pointerMove(100, 50)
        deliver(c)
        expect(b(c).GetMousePositionX()).toBe(100)
        expect(b(c).GetMousePositionY()).toBe(50)
    })

    // A game lays itself out in logical units, so a pointer in device pixels
    // would miss every hitbox.
    it("reports logical stage units once a layout is set", () => {
        const c = make()
        c.setStageLayout(layout())
        tick(c)
        c.sink.pointerMove(960, 270)
        deliver(c)
        expect(b(c).GetMousePositionX()).toBeCloseTo(480, 6)
        expect(b(c).GetMousePositionY()).toBeCloseTo(270, 6)
    })

    it("re-converts the last position when the layout changes", () => {
        const c = make()
        c.setStageLayout(layout())
        tick(c)
        c.sink.pointerMove(960, 270)
        c.setStageLayout(computeStageLayout(normalizeStage({ size: [960, 540] }), 960, 540))
        deliver(c)
        expect(b(c).GetMousePositionX()).toBeCloseTo(960, 6)
    })

    it("accumulates delta between frames and clears it at the boundary", () => {
        const c = tick(make())
        c.sink.pointerMove(10, 10)
        c.sink.pointerMove(30, 25)
        deliver(c)
        expect(b(c).GetMouseDeltaX()).toBe(30)
        expect(b(c).GetMouseDeltaY()).toBe(25)
        tick(c)
        expect(b(c).GetMouseDeltaX()).toBe(0)
    })

    it("accumulates scroll between frames and clears it at the boundary", () => {
        const c = tick(make())
        c.sink.wheel(1, -3)
        c.sink.wheel(0, -2)
        deliver(c)
        expect(b(c).GetScrollX()).toBe(1)
        expect(b(c).GetScrollY()).toBe(-5)
        tick(c)
        expect(b(c).GetScrollY()).toBe(0)
    })
})

describe("devices the container has none of", () => {
    // Not "unsupported": a game should hear "none connected", which is what
    // makes input.gamepad read as null.
    it("reports zero gamepads rather than throwing", () => {
        const c = tick(make())
        expect(b(c).GetGamepadCount()).toBe(0)
        expect(b(c).IsGamepadConnected(0)).toBe(false)
    })

    it("reports zero touches", () => {
        expect(b(tick(make())).GetTouchCount()).toBe(0)
    })
})

describe("bookkeeping", () => {
    it("clears everything on reset", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        c.sink.pointerDown(0, 10, 10)
        c.reset()
        deliver(c)
        expect(b(c).GetKeyDown("W")).toBe(false)
        expect(b(c).GetAnyKeyDown()).toBe(false)
        expect(b(c).GetMouseButtons()).toBe(0)
        expect(b(c).GetMousePositionX()).toBe(0)
    })

    // Stops a game polling computed key names from growing the table.
    it("does not create key records when polling", () => {
        const c = tick(make())
        for (let i = 0; i < 200; i++) b(c).GetKeyDown(`F${(i % 12) + 1}`)
        expect((c as unknown as { _keys: Map<string, unknown> })._keys.size).toBe(0)
        c.sink.keyDown("KeyW")
        deliver(c)
        expect((c as unknown as { _keys: Map<string, unknown> })._keys.size).toBe(1)
    })
})

// The whole point of the seam: game code is identical here and after eject.
describe("through onejs-unity's public input API", () => {
    it("answers keyboard queries from browser events", () => {
        const c = make()
        setInputBackend(c.backend)
        tick(c)
        c.sink.keyDown("Space")
        deliver(c)
        expect(input.keyboard.isKeyDown("Space")).toBe(true)
        expect(input.keyboard.wasKeyPressed("Space")).toBe(true)
        tick(c)
        expect(input.keyboard.wasKeyPressed("Space")).toBe(false)
    })

    it("exposes modifiers", () => {
        const c = make()
        setInputBackend(c.backend)
        tick(c)
        c.sink.keyDown("ShiftLeft")
        deliver(c)
        expect(input.keyboard.shift).toBe(true)
        expect(input.keyboard.ctrl).toBe(false)
    })

    it("answers mouse queries in stage units", () => {
        const c = make()
        c.setStageLayout(computeStageLayout(normalizeStage({ size: [960, 540] }), 1920, 540))
        setInputBackend(c.backend)
        tick(c)
        c.sink.pointerMove(960, 270)
        deliver(c)
        expect(input.mouse.position.x).toBeCloseTo(480, 6)
    })

    it("reads no gamepad as absent rather than as an error", () => {
        const c = make()
        setInputBackend(c.backend)
        tick(c)
        expect(input.gamepad).toBeNull()
    })
})
