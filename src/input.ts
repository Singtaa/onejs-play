/**
 * The container's input backend.
 *
 * This is NOT a second input API. Games call onejs-unity's `input`, the same
 * one a normal OneJS project uses, so game code reads identically here and
 * after eject. That module normally reads UnityEngine's InputBridge through CS,
 * which the container shadows, so this supplies the same methods from browser
 * events instead. See onejs-unity/input/backend.ts for the seam.
 *
 *     import { input, setInputBackend } from "onejs-unity/input"
 *     import { createContainerInput } from "onejs-play/container"
 *
 *     const container = createContainerInput()
 *     setInputBackend(container.backend)
 *     // adapter pushes browser events into container.sink
 *     // game calls input.keyboard.wasKeyPressed("Space")
 *
 * THREE THINGS WORTH KNOWING
 *
 * 1. Edges are frame numbers, not booleans cleared each frame. A key pressed
 *    and released inside one frame reports both pressed and released, and OS
 *    auto-repeat does not re-fire pressed.
 *
 * 2. The sink speaks DOM, the backend speaks Unity. Events arrive as
 *    KeyboardEvent.code and MouseEvent.button; queries arrive as Unity key
 *    names and Unity button bits. Translation happens once, on ingestion.
 *
 * 3. Mouse position is reported in logical stage units, not viewport pixels,
 *    so a game laid out in its own coordinate space hits its own hitboxes.
 *
 * 4. Events are queued and applied at the frame boundary, not when they arrive.
 *    A browser delivers a keydown whenever it likes, including between frames.
 *    Applying it immediately stamps it with the frame that is already ending,
 *    so by the time game logic runs it reads as last frame's press and
 *    wasKeyPressed is false. Queuing makes a frame see exactly the events that
 *    arrived since the previous one, whenever they happened to land.
 */

import { keyNameFromDomCode, resolveKeyName, type InputBackend } from "onejs-unity/input"
import { toStage, type StageLayout } from "./stage"

/** Modifier bits, matching InputBridge.GetModifiers. */
const MOD_SHIFT = 1
const MOD_CTRL = 2
const MOD_ALT = 4
const MOD_META = 8

/**
 * DOM MouseEvent.button to Unity's button bit.
 *
 * These disagree in the middle: DOM calls 1 the auxiliary (middle) button and 2
 * the secondary (right), while Unity's mask is left, right, middle. Mapping
 * straight through would silently swap middle and right click.
 */
const DOM_BUTTON_TO_BIT: readonly number[] = [0, 2, 1, 3, 4]

const MODIFIER_KEYS: Record<string, number> = {
    LeftShift: MOD_SHIFT, RightShift: MOD_SHIFT,
    LeftCtrl: MOD_CTRL, RightCtrl: MOD_CTRL,
    LeftAlt: MOD_ALT, RightAlt: MOD_ALT,
    LeftMeta: MOD_META, RightMeta: MOD_META,
}

interface KeyRecord {
    down: boolean
    downFrame: number
    upFrame: number
}

const NEVER: Readonly<KeyRecord> = { down: false, downFrame: -1, upFrame: -1 }

/** Browser events go in here. Codes are DOM codes; buttons are DOM button indices. */
/**
 * One finger, for as long as it is down plus the frame it lifts on.
 *
 * fingerId is a small stable index rather than the browser's pointerId, because
 * that is what Unity's API means by it and what a game will use to key state to
 * a finger. The browser's id is kept only to match up later events.
 */
interface TouchRecord {
    fingerId: number
    pointerId: number
    x: number
    y: number
    prevX: number
    prevY: number
    deltaX: number
    deltaY: number
    phase: number
    beganFrame: number
    /** -1 while still down. */
    endedFrame: number
    canceled: boolean
}

/** Unity's TouchPhase order, which onejs-unity maps back to names. */
const PHASE_BEGAN = 0, PHASE_MOVED = 1, PHASE_STATIONARY = 2, PHASE_ENDED = 3, PHASE_CANCELED = 4

export interface InputSink {
    keyDown(code: string): void
    keyUp(code: string): void
    pointerMove(viewportX: number, viewportY: number): void
    pointerDown(button: number, viewportX?: number, viewportY?: number): void
    pointerUp(button: number, viewportX?: number, viewportY?: number): void
    wheel(deltaX: number, deltaY: number): void
    /**
     * A finger, identified by the browser's pointerId.
     *
     * Separate from pointerDown even though a touch drives the pointer path
     * too, because they answer different questions. UI Toolkit needs the
     * pointer so a tap can press a button; a game needs the touch so it can
     * tell two fingers apart. Unity behaves the same way: a touch moves the
     * mouse as well as appearing in Input.touches.
     */
    touchDown(pointerId: number, viewportX: number, viewportY: number): void
    touchMove(pointerId: number, viewportX: number, viewportY: number): void
    touchUp(pointerId: number, viewportX: number, viewportY: number, canceled?: boolean): void
    /**
     * Focus was lost, so release everything held.
     *
     * Without this, alt-tabbing while holding a key leaves it held forever,
     * because the matching keyup goes to whatever took focus.
     */
    blur(): void
}

export interface ContainerInput {
    /** Where the adapter pushes browser events. */
    readonly sink: InputSink
    /** Hand this to onejs-unity's setInputBackend. */
    readonly backend: InputBackend
    /** Call once per frame, before game logic. */
    beginFrame(): void
    /** Keeps mouse coordinates in logical units as the viewport changes. */
    setStageLayout(layout: StageLayout | null): void
    /** Clears everything. For hot reload and game restart. */
    reset(): void
}

class ContainerInputImpl implements ContainerInput, InputSink {
    private _keys = new Map<string, KeyRecord>()
    private _frame = 0
    private _downCount = 0
    private _lastPressFrame = -1
    private _modifiers = 0

    private _buttons = 0
    private _buttonDownFrame = new Int32Array(5).fill(-1)
    private _buttonUpFrame = new Int32Array(5).fill(-1)

    /** Events waiting for the next frame boundary. See note 4 above. */
    private _queue: Array<() => void> = []

    private _stage: StageLayout | null = null
    private _viewportX = 0
    private _viewportY = 0
    private _stageX = 0
    private _stageY = 0

    // Movement and scroll accumulate between frames, then read as one delta.
    private _accumDeltaX = 0
    private _accumDeltaY = 0
    private _deltaX = 0
    private _deltaY = 0
    private _touches: TouchRecord[] = []

    private _accumScrollX = 0
    private _accumScrollY = 0
    private _scrollX = 0
    private _scrollY = 0

    get sink(): InputSink {
        return this
    }

    // MARK: ingestion

    keyDown(code: string): void {
        this._queue.push(() => this._applyKeyDown(code))
    }

    keyUp(code: string): void {
        this._queue.push(() => this._applyKeyUp(code))
    }

    touchDown(pointerId: number, viewportX: number, viewportY: number): void {
        this._queue.push(() => this._applyTouchDown(pointerId, viewportX, viewportY))
    }

    touchMove(pointerId: number, viewportX: number, viewportY: number): void {
        this._queue.push(() => this._applyTouchMove(pointerId, viewportX, viewportY))
    }

    touchUp(pointerId: number, viewportX: number, viewportY: number, canceled = false): void {
        this._queue.push(() => this._applyTouchUp(pointerId, viewportX, viewportY, canceled))
    }

    pointerMove(viewportX: number, viewportY: number): void {
        this._queue.push(() => this._applyPointerMove(viewportX, viewportY))
    }

    pointerDown(button: number, viewportX?: number, viewportY?: number): void {
        this._queue.push(() => this._applyPointerButton(button, true, viewportX, viewportY))
    }

    pointerUp(button: number, viewportX?: number, viewportY?: number): void {
        this._queue.push(() => this._applyPointerButton(button, false, viewportX, viewportY))
    }

    wheel(deltaX: number, deltaY: number): void {
        this._queue.push(() => { this._accumScrollX += deltaX; this._accumScrollY += deltaY })
    }

    blur(): void {
        this._queue.push(() => this._applyBlur())
    }

    // MARK: applied at the frame boundary

    private _applyKeyDown(code: string): void {
        const name = keyNameFromDomCode(code)
        if (name === null) return
        const key = this._record(name)
        // Ignore OS auto-repeat, which would make pressed() true every frame.
        if (key.down) return
        key.down = true
        key.downFrame = this._frame
        this._downCount++
        this._lastPressFrame = this._frame
        const bit = MODIFIER_KEYS[name]
        if (bit !== undefined) this._modifiers |= bit
    }

    private _applyKeyUp(code: string): void {
        const name = keyNameFromDomCode(code)
        if (name === null) return
        const key = this._keys.get(name)
        // An up with no down means the key went down while something else had
        // focus. Reporting a release would fire an action the player never
        // started.
        if (key === undefined || !key.down) return
        key.down = false
        key.upFrame = this._frame
        this._downCount--
        this._recomputeModifiers()
    }

    private _applyPointerMove(viewportX: number, viewportY: number): void {
        this._accumDeltaX += viewportX - this._viewportX
        this._accumDeltaY += viewportY - this._viewportY
        this._viewportX = viewportX
        this._viewportY = viewportY
        this._syncPointer()
    }

    private _applyPointerButton(button: number, down: boolean, viewportX?: number, viewportY?: number): void {
        if (viewportX !== undefined && viewportY !== undefined) this._applyPointerMove(viewportX, viewportY)
        const bit = DOM_BUTTON_TO_BIT[button]
        if (bit === undefined) return
        if (down) {
            this._buttons |= 1 << bit
            this._buttonDownFrame[bit] = this._frame
        } else {
            this._buttons &= ~(1 << bit)
            this._buttonUpFrame[bit] = this._frame
        }
    }

    private _findTouch(pointerId: number): TouchRecord | undefined {
        return this._touches.find((t) => t.pointerId === pointerId)
    }

    private _applyTouchDown(pointerId: number, viewportX: number, viewportY: number): void {
        if (this._findTouch(pointerId) !== undefined) return
        const p = this._toStage(viewportX, viewportY)
        // Smallest free index, so lifting one finger and putting it back down
        // reuses the id a game may already have keyed state to, which is what
        // Unity does.
        let fingerId = 0
        while (this._touches.some((t) => t.fingerId === fingerId)) fingerId++
        this._touches.push({
            fingerId, pointerId,
            x: p.x, y: p.y, prevX: p.x, prevY: p.y, deltaX: 0, deltaY: 0,
            phase: PHASE_BEGAN, beganFrame: this._frame, endedFrame: -1, canceled: false,
        })
    }

    private _applyTouchMove(pointerId: number, viewportX: number, viewportY: number): void {
        const touch = this._findTouch(pointerId)
        if (touch === undefined || touch.endedFrame !== -1) return
        const p = this._toStage(viewportX, viewportY)
        touch.x = p.x
        touch.y = p.y
    }

    private _applyTouchUp(pointerId: number, viewportX: number, viewportY: number, canceled: boolean): void {
        const touch = this._findTouch(pointerId)
        if (touch === undefined || touch.endedFrame !== -1) return
        const p = this._toStage(viewportX, viewportY)
        touch.x = p.x
        touch.y = p.y
        touch.canceled = canceled
        // A tap shorter than a frame arrives with its down and its up in the
        // same drain. Reporting it as ended straight away would mean a game
        // watching for began never sees the tap at all, so the end waits a
        // frame and the touch is reported as began first.
        touch.endedFrame = touch.beganFrame === this._frame ? this._frame + 1 : this._frame
    }

    private _applyBlur(): void {
        // A finger whose pointerup went to whatever took focus would otherwise
        // stay down forever, exactly as a held key would.
        for (const t of this._touches) {
            if (t.endedFrame === -1) { t.canceled = true; t.endedFrame = this._frame }
        }
        for (const key of this._keys.values()) {
            if (!key.down) continue
            key.down = false
            key.upFrame = this._frame
        }
        this._downCount = 0
        this._modifiers = 0
        for (let bit = 0; bit < 5; bit++) {
            if ((this._buttons & (1 << bit)) === 0) continue
            this._buttonUpFrame[bit] = this._frame
        }
        this._buttons = 0
    }

    // MARK: driving

    beginFrame(): void {
        this._frame++
        // Drain first, so everything that arrived since the last boundary is
        // stamped with the frame about to run rather than the one just ended.
        if (this._queue.length > 0) {
            const pending = this._queue
            this._queue = []
            for (const apply of pending) apply()
        }
        this._deltaX = this._accumDeltaX
        this._deltaY = this._accumDeltaY
        this._accumDeltaX = 0
        this._accumDeltaY = 0
        this._scrollX = this._accumScrollX
        this._scrollY = this._accumScrollY
        this._accumScrollX = 0
        this._accumScrollY = 0
        this._advanceTouches()
    }

    setStageLayout(layout: StageLayout | null): void {
        this._stage = layout
        this._syncPointer()
    }

    reset(): void {
        this._queue = []
        this._touches = []
        this._keys.clear()
        this._downCount = 0
        this._lastPressFrame = -1
        this._modifiers = 0
        this._buttons = 0
        this._buttonDownFrame.fill(-1)
        this._buttonUpFrame.fill(-1)
        this._viewportX = 0
        this._viewportY = 0
        this._stageX = 0
        this._stageY = 0
        this._accumDeltaX = 0
        this._accumDeltaY = 0
        this._deltaX = 0
        this._deltaY = 0
        this._accumScrollX = 0
        this._accumScrollY = 0
        this._scrollX = 0
        this._scrollY = 0
    }

    // MARK: the backend onejs-unity reads

    get backend(): InputBackend {
        return {
            GetKeyDown: (key: string) => this._peek(key).down,
            GetKeyPressed: (key: string) => this._peek(key).downFrame === this._frame,
            GetKeyReleased: (key: string) => this._peek(key).upFrame === this._frame,
            GetAnyKeyDown: () => this._downCount > 0,
            GetAnyKeyPressed: () => this._lastPressFrame === this._frame,
            GetModifiers: () => this._modifiers,

            GetMousePositionX: () => this._stageX,
            GetMousePositionY: () => this._stageY,
            GetMouseDeltaX: () => this._deltaX,
            GetMouseDeltaY: () => this._deltaY,
            GetScrollX: () => this._scrollX,
            GetScrollY: () => this._scrollY,
            GetMouseButtons: () => this._buttons,
            GetMouseButtonsPressed: () => this._buttonMask(this._buttonDownFrame),
            GetMouseButtonsReleased: () => this._buttonMask(this._buttonUpFrame),

            // Not "unsupported": a game asking for gamepads or touches should
            // hear "none connected", which is what makes input.gamepad null.
            GetGamepadCount: () => 0,
            IsGamepadConnected: () => false,
            GetTouchCount: () => this._touches.length,
            GetTouchFingerId: (i: number) => this._touches[i]?.fingerId ?? -1,
            GetTouchPositionX: (i: number) => this._touches[i]?.x ?? 0,
            GetTouchPositionY: (i: number) => this._touches[i]?.y ?? 0,
            GetTouchDeltaX: (i: number) => this._touches[i]?.deltaX ?? 0,
            GetTouchDeltaY: (i: number) => this._touches[i]?.deltaY ?? 0,
            GetTouchPhase: (i: number) => this._touches[i]?.phase ?? PHASE_ENDED,
        }
    }

    // MARK: internals

    private _record(name: string): KeyRecord {
        let key = this._keys.get(name)
        if (key === undefined) {
            key = { down: false, downFrame: -1, upFrame: -1 }
            this._keys.set(name, key)
        }
        return key
    }

    /**
     * Looks a key up without creating a record, so a game polling computed key
     * names cannot grow the table. Queries arrive in Unity spelling and may use
     * any accepted alias, so they resolve through the same table InputBridge uses.
     */
    private _peek(query: string): Readonly<KeyRecord> {
        const name = resolveKeyName(query)
        if (name === null) return NEVER
        return this._keys.get(name) ?? NEVER
    }

    private _recomputeModifiers(): void {
        let mods = 0
        for (const [name, bit] of Object.entries(MODIFIER_KEYS)) {
            if (this._keys.get(name)?.down) mods |= bit
        }
        this._modifiers = mods
    }

    private _buttonMask(frames: Int32Array): number {
        let mask = 0
        for (let bit = 0; bit < 5; bit++) {
            if (frames[bit] === this._frame) mask |= 1 << bit
        }
        return mask
    }

    private _toStage(viewportX: number, viewportY: number): { x: number; y: number } {
        if (this._stage === null) return { x: viewportX, y: viewportY }
        return toStage(this._stage, viewportX, viewportY)
    }

    private _syncPointer(): void {
        const p = this._toStage(this._viewportX, this._viewportY)
        this._stageX = p.x
        this._stageY = p.y
    }

    /**
     * Advances every touch to the phase this frame should report.
     *
     * Runs after the queue drains, so it sees everything that arrived since the
     * last boundary. A touch that ended is reported once, on the frame it
     * ended, and is gone the next: that is what lets a game handle a lift by
     * checking the phase rather than by diffing two frames of touch lists.
     */
    private _advanceTouches(): void {
        for (let i = this._touches.length - 1; i >= 0; i--) {
            const t = this._touches[i]!
            if (t.endedFrame !== -1 && t.endedFrame < this._frame) {
                this._touches.splice(i, 1)
                continue
            }
            t.deltaX = t.x - t.prevX
            t.deltaY = t.y - t.prevY
            t.prevX = t.x
            t.prevY = t.y

            if (t.endedFrame === this._frame) t.phase = t.canceled ? PHASE_CANCELED : PHASE_ENDED
            else if (t.beganFrame === this._frame) t.phase = PHASE_BEGAN
            else if (t.deltaX !== 0 || t.deltaY !== 0) t.phase = PHASE_MOVED
            else t.phase = PHASE_STATIONARY
        }
    }
}

export function createContainerInput(): ContainerInput {
    return new ContainerInputImpl()
}
