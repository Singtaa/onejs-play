import { describe, it, expect } from "vitest"
import { createHostInputBackend } from "../hostinput"
import { computeStageLayout, normalizeStage } from "../stage"

/**
 * The backend an ejected game gets.
 *
 * Every one of these is checked against a fake bridge rather than a real one,
 * because the arithmetic is the part that was wrong and the arithmetic does not
 * need Unity. What still needs a real project is that the bridge is reachable
 * at all, and that is the one thing these cannot prove.
 */

/** 800x600 logical viewport, a 400x300 stage letterboxed into the middle. */
const layout = computeStageLayout(normalizeStage({ size: [400, 300], fit: "letterbox" }), 800, 600)

/** A stand-in for InputBridge, recording what was asked of it. */
function fakeBridge(overrides: Record<string, unknown> = {}) {
    const calls: string[] = []
    const bridge: Record<string, unknown> = {
        calls,
        GetMousePositionX: () => 400,
        GetMousePositionY: () => 0,
        GetMouseDeltaX: () => 0,
        GetMouseDeltaY: () => 0,
        GetTouchPositionX: (i: number) => 100 * (i + 1),
        GetTouchPositionY: () => 0,
        GetTouchDeltaX: () => 0,
        GetTouchDeltaY: () => 0,
        GetKeyDown: (key: string) => { calls.push(`GetKeyDown:${key}`); return key === "Space" },
        GetTouchCount: () => 2,
        GetGamepadCount: () => 1,
        SetRumble: (...args: unknown[]) => { calls.push(`SetRumble:${args.join(",")}`) },
        someNumber: 42,
        ...overrides,
    }
    return bridge
}

const make = (bridge: unknown, pixelRatio = 1) =>
    createHostInputBackend({ layout: () => layout, pixelRatio: () => pixelRatio, bridge })!

describe("createHostInputBackend", () => {
    it("returns null when there is no bridge to wrap", () => {
        expect(createHostInputBackend({ layout: () => layout, pixelRatio: () => 1, bridge: null })).toBeNull()
    })

    it("passes a keyboard call straight through, arguments and all", () => {
        const bridge = fakeBridge()
        const backend = make(bridge) as any
        expect(backend.GetKeyDown("Space")).toBe(true)
        expect(backend.GetKeyDown("Escape")).toBe(false)
        expect(bridge.calls).toEqual(["GetKeyDown:Space", "GetKeyDown:Escape"])
    })

    it("passes several arguments through in order", () => {
        const bridge = fakeBridge()
        const backend = make(bridge) as any
        backend.SetRumble(0, 0.5, 1, 2)
        expect(bridge.calls).toContain("SetRumble:0,0.5,1,2")
    })

    it("passes a non-function property through as a value", () => {
        expect((make(fakeBridge()) as any).someNumber).toBe(42)
    })

    it("passes through a method it has never heard of", () => {
        const backend = make(fakeBridge({ GetSomethingNew: () => "hello" })) as any
        expect(backend.GetSomethingNew()).toBe("hello")
    })

    /**
     * The whole reason this file exists. Unity reports y = 0 at the BOTTOM of
     * the screen; the stage counts down from the top.
     */
    it("flips the vertical axis of the mouse", () => {
        const backend = make(fakeBridge({ GetMousePositionY: () => 0 })) as any
        expect(backend.GetMousePositionY()).toBeCloseTo(layout.height, 4)

        const top = make(fakeBridge({ GetMousePositionY: () => 600 })) as any
        expect(top.GetMousePositionY()).toBeCloseTo(0, 4)
    })

    it("converts the horizontal axis without flipping it", () => {
        const backend = make(fakeBridge({ GetMousePositionX: () => 400 })) as any
        expect(backend.GetMousePositionX()).toBeCloseTo(layout.width / 2, 4)
    })

    it("divides physical pixels down to logical ones", () => {
        const dense = make(fakeBridge({ GetMousePositionX: () => 800 }), 2) as any
        const plain = make(fakeBridge({ GetMousePositionX: () => 400 }), 1) as any
        expect(dense.GetMousePositionX()).toBeCloseTo(plain.GetMousePositionX(), 4)
    })

    it("converts a touch by its index, not by the mouse", () => {
        const backend = make(fakeBridge()) as any
        // The fake returns 100 for touch 0 and 200 for touch 1.
        expect(backend.GetTouchPositionX(0)).toBeCloseTo(backend.GetTouchPositionX(0), 6)
        expect(backend.GetTouchPositionX(1)).toBeGreaterThan(backend.GetTouchPositionX(0))
    })

    it("flips a touch the same way it flips the mouse", () => {
        const backend = make(fakeBridge({ GetTouchPositionY: () => 0 })) as any
        expect(backend.GetTouchPositionY(0)).toBeCloseTo(layout.height, 4)
    })

    /**
     * A delta has no origin. Running one through the position conversion would
     * add the viewport height to every vertical movement, which still looks
     * like it works until something crosses the middle of the screen.
     */
    it("treats a delta as a movement, not a position", () => {
        const backend = make(fakeBridge({ GetMouseDeltaX: () => 0, GetMouseDeltaY: () => 0 })) as any
        expect(backend.GetMouseDeltaX()).toBe(0)
        expect(Math.abs(backend.GetMouseDeltaY())).toBe(0)
    })

    it("flips the direction of a vertical movement", () => {
        // Moving up in Unity is moving toward smaller y on the stage.
        const backend = make(fakeBridge({ GetMouseDeltaY: () => 10 })) as any
        expect(backend.GetMouseDeltaY()).toBeLessThan(0)
    })

    it("scales a movement by the stage rather than the viewport", () => {
        const backend = make(fakeBridge({ GetMouseDeltaX: () => layout.scaleX })) as any
        expect(backend.GetMouseDeltaX()).toBeCloseTo(1, 5)
    })

    it("reads the layout fresh, so a resize needs no reinstall", () => {
        let current = layout
        const backend = createHostInputBackend({
            layout: () => current,
            pixelRatio: () => 1,
            // A point halfway up the screen, because the bottom edge maps to
            // the bottom of the stage whatever the viewport is and so cannot
            // tell one layout from another.
            bridge: fakeBridge({ GetMousePositionY: () => 300 }),
        })! as any
        expect(backend.GetMousePositionY()).toBeCloseTo(150, 4)

        // Twice as tall, so the same stage is letterboxed with bars above and
        // below and the same screen point lands somewhere else on it.
        current = computeStageLayout(normalizeStage({ size: [400, 300] }), 800, 1200)
        expect(backend.GetMousePositionY()).toBeCloseTo(300, 4)
    })

    it("leaves counts and other plain numbers alone", () => {
        const backend = make(fakeBridge()) as any
        expect(backend.GetTouchCount()).toBe(2)
        expect(backend.GetGamepadCount()).toBe(1)
    })
})
