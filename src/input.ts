/**
 * Polled input.
 *
 * UI Toolkit is event-driven; games are not. A game asks "is W held right now"
 * once per frame, so this module turns a stream of key and pointer events into
 * state that can be polled, with correct one-frame edges.
 *
 * THREE THINGS WORTH KNOWING
 *
 * 1. The core has no platform in it.
 *    Events arrive through InputSink, which an adapter fills: UI Toolkit key
 *    events in the container, browser events on WebGL, a recorded script in a
 *    headless agent run. Adding a platform means writing an adapter, never
 *    editing this file. That is also why the whole thing is testable in Node.
 *
 * 2. Edges are frame numbers, not booleans.
 *    pressed() asks whether the key went down on the current frame rather than
 *    reading a flag cleared each frame. That gets the awkward cases right: a
 *    key pressed and released inside one frame reports both pressed and
 *    released, and OS auto-repeat does not re-fire pressed every frame.
 *
 * 3. Reading never allocates and never grows the key table.
 *    Only ingestion creates key records, so a game polling computed key names
 *    cannot leak. pointer returns one reused object.
 *
 * Games see the read-only Input. The container runtime holds the InputSystem
 * that wraps it and drives beginFrame.
 */

import { toStage, type StageLayout } from "./stage"

/** Highest pointer button tracked. Covers left, right, middle, and two extras. */
const MAX_POINTER_BUTTONS = 5

/** A key that has never been touched. Never mutated; shared by every miss. */
const NEVER: Readonly<KeyRecord> = { down: false, downFrame: -1, upFrame: -1 }

interface KeyRecord {
    down: boolean
    downFrame: number
    upFrame: number
}

/** Pointer position and buttons. Reused across frames: read it, do not retain it. */
export interface PointerState {
    /** Logical stage units, the same space a game lays itself out in. */
    x: number
    y: number
    /** Raw viewport pixels, before the stage transform. */
    viewportX: number
    viewportY: number
    /** Whether any button is held. */
    down: boolean
    /** Bitmask of held buttons, bit 0 being the primary button. */
    buttons: number
    /** Whether the pointer is currently over the game surface. */
    over: boolean
}

/** A gamepad snapshot. Always null in 1.0; the shape is fixed so games can code against it. */
export interface GamepadState {
    index: number
    connected: boolean
    buttons: readonly boolean[]
    axes: readonly number[]
}

/** Keys that drive an axis. Codes are DOM KeyboardEvent.code values. */
export interface AxisBinding {
    negative: readonly string[]
    positive: readonly string[]
}

export interface InputOptions {
    /** Extra or replacement axes. Merged over the defaults. */
    axes?: Record<string, AxisBinding>
    /** Warn once per unknown axis name. On by default; turn off for a shipped build. */
    warnOnUnknownAxis?: boolean
}

/**
 * Default axes, in DOM key codes so they stay on the physical keys regardless
 * of layout: WASD is the same three-key row on AZERTY.
 *
 * Positive vertical is DOWN, unlike UnityEngine.Input, because the stage is a
 * y-down screen space. It means `y += axis("vertical") * speed` moves the way
 * the player pressed, which is what a game actually wants.
 */
const DEFAULT_AXES: Record<string, AxisBinding> = {
    horizontal: { negative: ["KeyA", "ArrowLeft"], positive: ["KeyD", "ArrowRight"] },
    vertical: { negative: ["KeyW", "ArrowUp"], positive: ["KeyS", "ArrowDown"] },
}

/** What a game polls. Read-only: nothing here changes input state. */
export interface Input {
    /** Whether the key is held. */
    down(code: string): boolean
    /** Whether the key went down on this frame. */
    pressed(code: string): boolean
    /** Whether the key came up on this frame. */
    released(code: string): boolean
    /** Whether any key is held. */
    anyDown(): boolean
    /** Whether any key went down on this frame. */
    anyPressed(): boolean
    /** -1, 0 or 1. Unsmoothed; see axisSmoothing in the follow-ups. */
    axis(name: string): number
    /** The reused pointer state. */
    readonly pointer: PointerState
    pointerPressed(button?: number): boolean
    pointerReleased(button?: number): boolean
    /** Always null in 1.0. */
    gamepad(index: number): GamepadState | null
    /** Frames elapsed since the system was created. */
    readonly frame: number
}

/** What an adapter pushes events into. The whole platform contract. */
export interface InputSink {
    keyDown(code: string): void
    keyUp(code: string): void
    pointerMove(viewportX: number, viewportY: number): void
    pointerDown(button: number, viewportX?: number, viewportY?: number): void
    pointerUp(button: number, viewportX?: number, viewportY?: number): void
    pointerEnter(): void
    pointerLeave(): void
    /**
     * Focus was lost. Releases everything held.
     *
     * Without this, alt-tabbing while holding a key leaves it held forever,
     * because the matching keyup goes to whatever took focus.
     */
    blur(): void
}

class InputState implements Input, InputSink {
    private _keys = new Map<string, KeyRecord>()
    private _axes: Record<string, AxisBinding>
    private _warnUnknownAxis: boolean
    private _warnedAxes = new Set<string>()

    private _frame = 0
    private _downCount = 0
    private _lastPressFrame = -1

    private _buttonDownFrame = new Int32Array(MAX_POINTER_BUTTONS).fill(-1)
    private _buttonUpFrame = new Int32Array(MAX_POINTER_BUTTONS).fill(-1)

    private _stage: StageLayout | null = null

    private _pointer: PointerState = {
        x: 0, y: 0, viewportX: 0, viewportY: 0, down: false, buttons: 0, over: false,
    }

    constructor(options: InputOptions = {}) {
        this._axes = { ...DEFAULT_AXES, ...(options.axes ?? {}) }
        this._warnUnknownAxis = options.warnOnUnknownAxis ?? true
    }

    // MARK: reading

    get frame(): number {
        return this._frame
    }

    get pointer(): PointerState {
        return this._pointer
    }

    down(code: string): boolean {
        return (this._keys.get(code) ?? NEVER).down
    }

    pressed(code: string): boolean {
        return (this._keys.get(code) ?? NEVER).downFrame === this._frame
    }

    released(code: string): boolean {
        return (this._keys.get(code) ?? NEVER).upFrame === this._frame
    }

    anyDown(): boolean {
        return this._downCount > 0
    }

    anyPressed(): boolean {
        return this._lastPressFrame === this._frame
    }

    axis(name: string): number {
        const binding = this._axes[name]
        if (binding === undefined) {
            if (this._warnUnknownAxis && !this._warnedAxes.has(name)) {
                this._warnedAxes.add(name)
                console.warn(`[oj] unknown input axis "${name}"`)
            }
            return 0
        }
        let value = 0
        for (const code of binding.negative) {
            if (this.down(code)) { value -= 1; break }
        }
        for (const code of binding.positive) {
            if (this.down(code)) { value += 1; break }
        }
        return value
    }

    pointerPressed(button = 0): boolean {
        if (button < 0 || button >= MAX_POINTER_BUTTONS) return false
        return this._buttonDownFrame[button] === this._frame
    }

    pointerReleased(button = 0): boolean {
        if (button < 0 || button >= MAX_POINTER_BUTTONS) return false
        return this._buttonUpFrame[button] === this._frame
    }

    gamepad(_index: number): GamepadState | null {
        return null
    }

    // MARK: ingestion

    keyDown(code: string): void {
        const key = this._record(code)
        // Ignore OS auto-repeat, which would otherwise make pressed() true on
        // every frame the key is held rather than only the first.
        if (key.down) return
        key.down = true
        key.downFrame = this._frame
        this._downCount++
        this._lastPressFrame = this._frame
    }

    keyUp(code: string): void {
        const key = this._keys.get(code)
        // An up with no matching down means the key went down while something
        // else had focus. Reporting released() for it would fire a game action
        // the player never started.
        if (key === undefined || !key.down) return
        key.down = false
        key.upFrame = this._frame
        this._downCount--
    }

    pointerMove(viewportX: number, viewportY: number): void {
        this._pointer.viewportX = viewportX
        this._pointer.viewportY = viewportY
        this._syncPointer()
    }

    pointerDown(button: number, viewportX?: number, viewportY?: number): void {
        if (viewportX !== undefined && viewportY !== undefined) {
            this.pointerMove(viewportX, viewportY)
        }
        if (button < 0 || button >= MAX_POINTER_BUTTONS) return
        this._pointer.buttons |= 1 << button
        this._pointer.down = true
        this._buttonDownFrame[button] = this._frame
    }

    pointerUp(button: number, viewportX?: number, viewportY?: number): void {
        if (viewportX !== undefined && viewportY !== undefined) {
            this.pointerMove(viewportX, viewportY)
        }
        if (button < 0 || button >= MAX_POINTER_BUTTONS) return
        this._pointer.buttons &= ~(1 << button)
        this._pointer.down = this._pointer.buttons !== 0
        this._buttonUpFrame[button] = this._frame
    }

    pointerEnter(): void {
        this._pointer.over = true
    }

    pointerLeave(): void {
        this._pointer.over = false
    }

    blur(): void {
        for (const key of this._keys.values()) {
            if (!key.down) continue
            key.down = false
            key.upFrame = this._frame
        }
        this._downCount = 0

        for (let button = 0; button < MAX_POINTER_BUTTONS; button++) {
            if ((this._pointer.buttons & (1 << button)) === 0) continue
            this._buttonUpFrame[button] = this._frame
        }
        this._pointer.buttons = 0
        this._pointer.down = false
        this._pointer.over = false
    }

    // MARK: runtime

    beginFrame(): void {
        this._frame++
    }

    setStageLayout(layout: StageLayout | null): void {
        this._stage = layout
        this._syncPointer()
    }

    reset(): void {
        this._keys.clear()
        this._downCount = 0
        this._lastPressFrame = -1
        this._buttonDownFrame.fill(-1)
        this._buttonUpFrame.fill(-1)
        this._pointer.x = 0
        this._pointer.y = 0
        this._pointer.viewportX = 0
        this._pointer.viewportY = 0
        this._pointer.down = false
        this._pointer.buttons = 0
        this._pointer.over = false
    }

    private _record(code: string): KeyRecord {
        let key = this._keys.get(code)
        if (key === undefined) {
            key = { down: false, downFrame: -1, upFrame: -1 }
            this._keys.set(code, key)
        }
        return key
    }

    /**
     * Recomputes logical coordinates from the raw viewport position.
     *
     * Done on ingestion and on layout change rather than on read, so polling
     * the pointer in a hot loop costs a field access. Uses the shared toStage
     * so the conversion cannot drift from the stage module's.
     */
    private _syncPointer(): void {
        if (this._stage === null) {
            this._pointer.x = this._pointer.viewportX
            this._pointer.y = this._pointer.viewportY
            return
        }
        const p = toStage(this._stage, this._pointer.viewportX, this._pointer.viewportY)
        this._pointer.x = p.x
        this._pointer.y = p.y
    }
}

/** What the container runtime holds. Games only ever see `input`. */
export interface InputSystem {
    /** Handed to games as oj.input. */
    readonly input: Input
    /** Where an adapter pushes platform events. */
    readonly sink: InputSink
    /** Call once per frame, before game logic. */
    beginFrame(): void
    /** Keeps pointer coordinates in logical units as the viewport changes. */
    setStageLayout(layout: StageLayout | null): void
    /** Clears everything. For hot reload and game restart. */
    reset(): void
}

export function createInput(options: InputOptions = {}): InputSystem {
    const state = new InputState(options)
    return {
        input: state,
        sink: state,
        beginFrame: () => state.beginFrame(),
        setStageLayout: (layout) => state.setStageLayout(layout),
        reset: () => state.reset(),
    }
}
