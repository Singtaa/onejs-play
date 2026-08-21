import { describe, it, expect, afterEach } from "vitest"
import { setInputBackend, input } from "onejs-unity/input"
import { createContainerInput, type ContainerInput } from "../input"
import { computeStageLayout, normalizeStage } from "../stage"

const make = () => createContainerInput()
const tick = (c: ContainerInput) => { c.beginFrame(); return c }
/** The backend is what onejs-unity calls; tests read through it. */
const b = (c: ContainerInput) => c.backend as Record<string, (...a: any[]) => any>

afterEach(() => setInputBackend(null))

describe("key edges", () => {
    it("reports pressed only on the frame the key went down", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
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
        expect(b(c).GetKeyPressed("W")).toBe(false)
        expect(b(c).GetKeyDown("W")).toBe(true)
    })

    // A boolean-flag implementation loses one of these two.
    it("reports both pressed and released for a tap inside one frame", () => {
        const c = tick(make())
        c.sink.keyDown("Space")
        c.sink.keyUp("Space")
        expect(b(c).GetKeyPressed("Space")).toBe(true)
        expect(b(c).GetKeyReleased("Space")).toBe(true)
        expect(b(c).GetKeyDown("Space")).toBe(false)
    })

    it("ignores a key up with no matching key down", () => {
        const c = tick(make())
        c.sink.keyUp("KeyQ")
        expect(b(c).GetKeyReleased("Q")).toBe(false)
    })

    it("tracks any-key state", () => {
        const c = tick(make())
        expect(b(c).GetAnyKeyDown()).toBe(false)
        c.sink.keyDown("KeyA")
        expect(b(c).GetAnyKeyDown()).toBe(true)
        expect(b(c).GetAnyKeyPressed()).toBe(true)
        tick(c)
        expect(b(c).GetAnyKeyPressed()).toBe(false)
        c.sink.keyUp("KeyA")
        expect(b(c).GetAnyKeyDown()).toBe(false)
    })
})

describe("DOM to Unity translation", () => {
    it("stores DOM codes under their Unity key name", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        c.sink.keyDown("ArrowLeft")
        c.sink.keyDown("ShiftLeft")
        expect(b(c).GetKeyDown("W")).toBe(true)
        expect(b(c).GetKeyDown("LeftArrow")).toBe(true)
        expect(b(c).GetKeyDown("LeftShift")).toBe(true)
    })

    it("accepts any alias InputBridge accepts on the query side", () => {
        const c = tick(make())
        c.sink.keyDown("ArrowUp")
        expect(b(c).GetKeyDown("UpArrow")).toBe(true)
        expect(b(c).GetKeyDown("Up")).toBe(true)
        expect(b(c).GetKeyDown("up")).toBe(true)
    })

    it("ignores a DOM code with no Unity equivalent instead of storing junk", () => {
        const c = tick(make())
        c.sink.keyDown("Sparkle")
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
        expect(b(c).GetModifiers()).toBe(1)
        c.sink.keyDown("ControlLeft")
        expect(b(c).GetModifiers()).toBe(1 | 2)
        c.sink.keyDown("AltLeft")
        c.sink.keyDown("MetaLeft")
        expect(b(c).GetModifiers()).toBe(1 | 2 | 4 | 8)
    })

    it("clears a modifier only when both sides are up", () => {
        const c = tick(make())
        c.sink.keyDown("ShiftLeft")
        c.sink.keyDown("ShiftRight")
        c.sink.keyUp("ShiftLeft")
        expect(b(c).GetModifiers()).toBe(1)
        c.sink.keyUp("ShiftRight")
        expect(b(c).GetModifiers()).toBe(0)
    })

    it("clears on blur", () => {
        const c = tick(make())
        c.sink.keyDown("ShiftLeft")
        c.sink.blur()
        expect(b(c).GetModifiers()).toBe(0)
    })
})

describe("blur", () => {
    it("releases every held key and fires released", () => {
        const c = tick(make())
        c.sink.keyDown("KeyW")
        tick(c)
        c.sink.blur()
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
        expect(b(c).GetAnyKeyDown()).toBe(true)
    })

    it("clears pointer buttons", () => {
        const c = tick(make())
        c.sink.pointerDown(0)
        tick(c)
        c.sink.blur()
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
        expect(b(c).GetMouseButtons()).toBe(2) // Unity right bit
        c.sink.pointerDown(1) // DOM middle
        expect(b(c).GetMouseButtons()).toBe(2 | 4) // Unity middle bit
    })

    it("tracks the primary button", () => {
        const c = tick(make())
        c.sink.pointerDown(0)
        expect(b(c).GetMouseButtons()).toBe(1)
        c.sink.pointerUp(0)
        expect(b(c).GetMouseButtons()).toBe(0)
    })

    it("reports button edges for one frame", () => {
        const c = tick(make())
        c.sink.pointerDown(0)
        expect(b(c).GetMouseButtonsPressed()).toBe(1)
        tick(c)
        expect(b(c).GetMouseButtonsPressed()).toBe(0)
        c.sink.pointerUp(0)
        expect(b(c).GetMouseButtonsReleased()).toBe(1)
    })

    it("ignores an out-of-range button rather than corrupting the mask", () => {
        const c = tick(make())
        c.sink.pointerDown(99)
        expect(b(c).GetMouseButtons()).toBe(0)
    })
})

describe("mouse position, delta and scroll", () => {
    const layout = () => computeStageLayout(normalizeStage({ size: [960, 540] }), 1920, 540)

    it("passes viewport coordinates through with no stage", () => {
        const c = tick(make())
        c.sink.pointerMove(100, 50)
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
        expect(b(c).GetMousePositionX()).toBeCloseTo(480, 6)
        expect(b(c).GetMousePositionY()).toBeCloseTo(270, 6)
    })

    it("re-converts the last position when the layout changes", () => {
        const c = make()
        c.setStageLayout(layout())
        tick(c)
        c.sink.pointerMove(960, 270)
        c.setStageLayout(computeStageLayout(normalizeStage({ size: [960, 540] }), 960, 540))
        expect(b(c).GetMousePositionX()).toBeCloseTo(960, 6)
    })

    it("accumulates delta between frames and clears it at the boundary", () => {
        const c = tick(make())
        c.sink.pointerMove(10, 10)
        c.sink.pointerMove(30, 25)
        tick(c)
        expect(b(c).GetMouseDeltaX()).toBe(30)
        expect(b(c).GetMouseDeltaY()).toBe(25)
        tick(c)
        expect(b(c).GetMouseDeltaX()).toBe(0)
    })

    it("accumulates scroll between frames and clears it at the boundary", () => {
        const c = tick(make())
        c.sink.wheel(1, -3)
        c.sink.wheel(0, -2)
        tick(c)
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
        expect(input.keyboard.shift).toBe(true)
        expect(input.keyboard.ctrl).toBe(false)
    })

    it("answers mouse queries in stage units", () => {
        const c = make()
        c.setStageLayout(computeStageLayout(normalizeStage({ size: [960, 540] }), 1920, 540))
        setInputBackend(c.backend)
        tick(c)
        c.sink.pointerMove(960, 270)
        expect(input.mouse.position.x).toBeCloseTo(480, 6)
    })

    it("reads no gamepad as absent rather than as an error", () => {
        const c = make()
        setInputBackend(c.backend)
        tick(c)
        expect(input.gamepad).toBeNull()
    })
})
