/**
 * Browser events into the container's input sink.
 *
 * The container creates the input backend and hands it to onejs-unity, but a
 * backend with nothing pushing into it answers "no key is down" forever. This
 * is the half that pushes: it is the only file in onejs-play that touches the
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
 * pixels, which is the unit the container passes to setViewport. Keeping both
 * in CSS pixels is what makes toStage correct at any devicePixelRatio; mixing
 * physical pixels into one side is the classic retina offset bug.
 *
 * blur and visibilitychange both release everything held. Without them,
 * alt-tabbing while holding a key leaves it held forever, because the matching
 * keyup is delivered to whatever took focus.
 */

import type { InputSink } from "./input"

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

    /** CSS pixels relative to the target's top-left corner. */
    const at = (event: any): [number, number] => {
        if (target !== null && typeof target.getBoundingClientRect === "function") {
            const rect = target.getBoundingClientRect()
            return [event.clientX - rect.left, event.clientY - rect.top]
        }
        return [event.clientX, event.clientY]
    }

    const onKeyDown = (event: any) => {
        if (preventDefault && PREVENT_DEFAULT_CODES.has(event.code)) event.preventDefault()
        sink.keyDown(event.code)
    }
    const onKeyUp = (event: any) => { sink.keyUp(event.code) }
    // A touch drives both paths. UI Toolkit needs the pointer so a tap can press
    // a button, and a game needs the touch so it can tell two fingers apart.
    // Unity does the same: a touch moves the mouse and appears in Input.touches.
    const isTouch = (event: any) => event.pointerType === "touch"

    const onPointerMove = (event: any) => {
        const [x, y] = at(event)
        sink.pointerMove(x, y)
        if (isTouch(event)) sink.touchMove(event.pointerId, x, y)
    }
    const onPointerDown = (event: any) => {
        const [x, y] = at(event)
        sink.pointerDown(event.button, x, y)
        if (isTouch(event)) sink.touchDown(event.pointerId, x, y)
    }
    const onPointerUp = (event: any) => {
        const [x, y] = at(event)
        sink.pointerUp(event.button, x, y)
        if (isTouch(event)) sink.touchUp(event.pointerId, x, y, event.type === "pointercancel")
    }
    const onWheel = (event: any) => {
        if (preventDefault) event.preventDefault()
        sink.wheel(event.deltaX, event.deltaY)
    }
    const onBlur = () => { sink.blur() }
    const onVisibility = () => { if (view.document?.hidden) sink.blur() }

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
    view.addEventListener("blur", onBlur)
    view.document?.addEventListener?.("visibilitychange", onVisibility)

    return () => {
        view.removeEventListener("keydown", onKeyDown, capture)
        view.removeEventListener("keyup", onKeyUp, capture)
        view.removeEventListener("pointermove", onPointerMove)
        view.removeEventListener("pointerdown", onPointerDown)
        view.removeEventListener("pointerup", onPointerUp)
        view.removeEventListener("pointercancel", onPointerUp)
        view.removeEventListener("wheel", onWheel, wheelOptions)
        view.removeEventListener("blur", onBlur)
        view.document?.removeEventListener?.("visibilitychange", onVisibility)
    }
}
