/**
 * Browser events into the container's input sink.
 *
 * The container creates the input backend and hands it to onejs-unity, but a
 * backend with nothing pushing into it answers "no key is down" forever. This
 * is the half that pushes: it is the only file in ojplay that touches the
 * DOM, and it exists because the container runs inside Unity WebGL, where the
 * bootstrap shares the embedding page's global scope and `document` is the
 * real one.
 *
 *     const input = createContainerInput()
 *     setInputBackend(input.backend)
 *     const detach = createDomInputAdapter(input.sink, { target: canvas })
 *
 * WHY EACH LISTENER IS WHERE IT IS
 *
 * Keys listen on the window rather than the canvas: the canvas can lose focus
 * to any element the page puts on top of it, and a game that stops receiving
 * keys because a div took focus is indistinguishable from a broken game.
 *
 * Pointer positions are measured against the target's rect and reported in CSS
 * pixels, which is the unit the container passes to setViewport and the unit a
 * pointer event carries. Keeping all of them in CSS pixels is what makes input
 * agree with layout at any devicePixelRatio; mixing physical pixels into one
 * side is the classic retina offset bug.
 *
 * blur and visibilitychange both release everything held. Without them,
 * alt-tabbing while holding a key leaves it held forever, because the matching
 * keyup is delivered to whatever took focus.
 *
 * Pointer lock (input.mouse.lock()) is the target's: the input asks for it
 * inside a press through the seam installed here, and the document says when
 * it was granted or let go. While locked, the browser holds clientX and
 * clientY where the lock began, so a movement goes in as movementX and
 * movementY, the only numbers that still move.
 */

import type { InputSink, PointerLockHost } from "./input"
import { setPageHidden } from "./play"
import { setShareBrowser, type ShareData } from "./share"

/**
 * Keys whose browser default would fight the game.
 *
 * Scrolling keys only. A platformer whose jump also scrolls the page is
 * unplayable, and that is the whole list of what needs suppressing.
 *
 * Two deliberate absences. Tab stays live: swallowing it would trap keyboard
 * focus inside the frame and break the page for anyone navigating without a
 * mouse. Backspace stays live too, because suppressing it is a fix for a
 * back-navigation behaviour browsers dropped years ago, and a game with a text
 * field needs it far more than it needs the guard.
 */
const PREVENT_DEFAULT_CODES: ReadonlySet<string> = new Set([
    "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "PageUp", "PageDown", "Home", "End",
])

export interface DomInputOptions {
    /** Element pointer coordinates are measured against. Defaults to the window. */
    target?: any
    /** Where key and focus events are listened for. Defaults to globalThis. */
    view?: any
    /**
     * Suppress the browser default for game keys. On by default; a game that
     * wants the page to scroll normally can turn it off.
     */
    preventDefault?: boolean
}

/** Each DOM button index's bit in a pointer event's `buttons`: left, middle, right, back, forward. */
const BUTTON_BITS: readonly number[] = [1, 4, 2, 8, 16]

/** Said once: the browser's refusal carries no reason a cart can read. */
let lockRefusalSaid = false
const LOCK_REFUSED = "[oj] The browser refused to lock the pointer. It grants a lock only in a press (a click or a key), and not again straight after Escape let it go."

/** True when this build has a DOM to listen to at all. */
export function hasDom(view: any = globalThis): boolean {
    return typeof view?.addEventListener === "function" && typeof view?.document !== "undefined"
}

/**
 * Pushes browser events into a sink. Returns a function that detaches every
 * listener; call it on unload, or the next game inherits these.
 */
export function createDomInputAdapter(sink: InputSink, options: DomInputOptions = {}): () => void {
    const view = options.view ?? globalThis
    if (!hasDom(view)) {
        // Not an error: a native build has no DOM, and the caller decides
        // whether that is a problem. Returning a no-op keeps teardown uniform.
        return () => {}
    }
    const target = options.target ?? null
    const preventDefault = options.preventDefault !== false

    // The element a lock holds the pointer to: the canvas, or the page.
    const doc = view.document
    const lockElement = target ?? doc?.documentElement ?? null
    const isLocked = () => lockElement !== null && doc?.pointerLockElement === lockElement
    const lockHost: PointerLockHost | null =
        typeof lockElement?.requestPointerLock === "function" && typeof doc?.exitPointerLock === "function"
            ? {
                request: () => {
                    // A phone has the method and nothing to lock: asking would only be refused.
                    if (view.matchMedia?.("(any-pointer: fine)")?.matches === false) return
                    try {
                        // Chrome answers with a promise as well as the event; the event is what is read.
                        lockElement.requestPointerLock()?.catch?.(() => {})
                    } catch {
                        onLockError()
                    }
                },
                exit: () => doc.exitPointerLock(),
            }
            : null

    /** CSS pixels relative to the target's top-left corner. */
    const at = (event: any): [number, number] => {
        if (target !== null && typeof target.getBoundingClientRect === "function") {
            const rect = target.getBoundingClientRect()
            return [event.clientX - rect.left, event.clientY - rect.top]
        }
        return [event.clientX, event.clientY]
    }

    /*
     * The frames share.ts may ask the browser in: those of the events that
     * grant a page user activation, as HTML defines them (a keydown other than
     * Escape, a mouse button going down, a touch or pen lifting), and of a
     * mouse button coming up. A finger going down grants nothing on a phone,
     * so a share asked for in the frame a touch began would be refused there.
     *
     * The mouse's release grants nothing either, but the press it ends just
     * did, and a Button's onClick fires on the release: a click held across
     * frames (any real one, at 60 fps) had its onClick refused when only the
     * press counted. Found 6 Nov by the share fixture on Windows CI, where
     * frames were short enough to split its 70 ms click.
     */
    const onKeyDown = (event: any) => {
        if (preventDefault && PREVENT_DEFAULT_CODES.has(event.code)) event.preventDefault()
        sink.keyDown(event.code)
        if (event.key !== "Escape") sink.activate()
    }
    const onKeyUp = (event: any) => { sink.keyUp(event.code) }
    // A touch drives both paths. UI Toolkit needs the pointer so a tap can press
    // a button, and a game needs the touch so it can tell two fingers apart.
    // Unity does the same: a touch moves the mouse and appears in Input.touches.
    const isTouch = (event: any) => event.pointerType === "touch"

    // A second mouse button pressed while one is held, or one of two let go, arrives
    // as a pointermove naming that button, not as a pointerdown or pointerup: the
    // Pointer Events spec fires those only for the first press and the last release.
    // Read from `buttons`, so "both buttons walk forward" sees the second one.
    const onPointerMove = (event: any) => {
        const [x, y] = at(event)
        if (isLocked()) sink.pointerMoveBy(event.movementX ?? 0, event.movementY ?? 0)
        else sink.pointerMove(x, y)
        if (isTouch(event)) sink.touchMove(event.pointerId, x, y)
        else if (event.button >= 0 && typeof event.buttons === "number" && BUTTON_BITS[event.button] !== undefined) {
            if ((event.buttons & BUTTON_BITS[event.button]) !== 0) sink.pointerDown(event.button, x, y)
            else sink.pointerUp(event.button, x, y)
        }
    }
    const onPointerDown = (event: any) => {
        const [x, y] = at(event)
        sink.pointerDown(event.button, x, y)
        if (isTouch(event)) sink.touchDown(event.pointerId, x, y)
        if (event.pointerType === "mouse") sink.activate()
    }
    const onPointerUp = (event: any) => {
        const [x, y] = at(event)
        sink.pointerUp(event.button, x, y)
        if (isTouch(event)) sink.touchUp(event.pointerId, x, y, event.type === "pointercancel")
        if (event.type === "pointerup") sink.activate()
    }
    // Right-drag is a camera's turn, so the browser's own menu never opens over a game.
    // A cart that wants a menu of its own reads the right button as any other.
    const onContextMenu = (event: any) => { if (preventDefault) event.preventDefault() }
    const onWheel = (event: any) => {
        if (preventDefault) event.preventDefault()
        sink.wheel(event.deltaX, event.deltaY)
    }
    const onBlur = () => { sink.blur() }
    const onLockChange = () => { sink.pointerLocked(isLocked()) }
    const onLockError = () => {
        if (lockRefusalSaid) return
        lockRefusalSaid = true
        console.warn(LOCK_REFUSED)
    }
    const onVisibility = () => {
        const hidden = view.document?.hidden === true
        if (hidden) sink.blur()
        setPageHidden(hidden)
    }

    // Wheel must be non-passive or preventDefault is ignored and logged as a
    // console violation; the others are passive-friendly but registered the
    // same way so the removal calls stay symmetrical.
    const wheelOptions = { passive: !preventDefault }

    // Keys are captured on the way down. Unity registers its own keyboard
    // listeners on the same document, and anything that calls stopPropagation
    // there would otherwise silently cut the game off from the keyboard. The
    // capture flag is part of the listener's identity, so removal repeats it.
    const capture = true

    view.addEventListener("keydown", onKeyDown, capture)
    view.addEventListener("keyup", onKeyUp, capture)
    view.addEventListener("pointermove", onPointerMove)
    view.addEventListener("pointerdown", onPointerDown)
    // Up on the window, not the target: a drag that ends outside the canvas
    // still has to release the button, or it reads as held forever.
    view.addEventListener("pointerup", onPointerUp)
    view.addEventListener("pointercancel", onPointerUp)
    view.addEventListener("wheel", onWheel, wheelOptions)
    view.addEventListener("contextmenu", onContextMenu)
    view.addEventListener("blur", onBlur)
    view.document?.addEventListener?.("visibilitychange", onVisibility)
    if (view.document?.hidden === true) setPageHidden(true)
    if (lockHost !== null) {
        doc.addEventListener("pointerlockchange", onLockChange)
        doc.addEventListener("pointerlockerror", onLockError)
    }
    sink.setPointerLock(lockHost)

    // The share sheet and the clipboard, called by share.ts in the frame of a press.
    const nav = view.navigator
    setShareBrowser({
        share: typeof nav?.share === "function" ? (data: ShareData) => nav.share(data) : null,
        canShare: typeof nav?.canShare === "function" ? (data: ShareData) => nav.canShare(data) : null,
        copy: typeof nav?.clipboard?.writeText === "function" ? (text: string) => nav.clipboard.writeText(text) : null,
    })

    return () => {
        view.removeEventListener("keydown", onKeyDown, capture)
        view.removeEventListener("keyup", onKeyUp, capture)
        view.removeEventListener("pointermove", onPointerMove)
        view.removeEventListener("pointerdown", onPointerDown)
        view.removeEventListener("pointerup", onPointerUp)
        view.removeEventListener("pointercancel", onPointerUp)
        view.removeEventListener("wheel", onWheel, wheelOptions)
        view.removeEventListener("contextmenu", onContextMenu)
        view.removeEventListener("blur", onBlur)
        view.document?.removeEventListener?.("visibilitychange", onVisibility)
        if (lockHost !== null) {
            doc.removeEventListener("pointerlockchange", onLockChange)
            doc.removeEventListener("pointerlockerror", onLockError)
            // The next game starts with the pointer free.
            if (isLocked()) doc.exitPointerLock()
        }
        sink.setPointerLock(null)
        setShareBrowser(null)
    }
}
