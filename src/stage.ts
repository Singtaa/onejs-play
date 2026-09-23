/**
 * The stage: the window a game draws into, in logical pixels.
 *
 * There is no fixed logical space and no fit. UI Toolkit is the renderer, so
 * a game lays itself out against the window and reflows when it changes, the
 * way a page does. A game that wants a fixed board (an arcade screen, a card
 * table) builds one in its own code: a fixed-size View with `scale` set to fit
 * the window, which UI Toolkit picks through, so its handlers need nothing.
 *
 * Logical pixels are CSS pixels. The container scales the panel by
 * devicePixelRatio, so one logical pixel is exactly one CSS pixel, and pointer
 * positions, input positions and layout all share that one space.
 *
 * Fullscreen changes how many pixels there are and nothing else. The host page
 * owns the Fullscreen API call so the user gesture and the Permissions Policy
 * stay on its side of the iframe boundary, and the game asks for it over
 * postMessage.
 */

/** The window, in logical pixels. */
export interface Stage {
    width: number
    height: number
}

/**
 * What the stage is before anything has been measured.
 *
 * UI Toolkit reports nothing on the frames before its first layout, and a zero
 * size divided through by a game seeds NaN into every coordinate downstream.
 */
const UNMEASURED: Stage = { width: 960, height: 540 }

function positiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0
}

/** The stage for a measured viewport, or the unmeasured default when it is not usable yet. */
export function stageOf(width: number, height: number): Stage {
    return positiveFinite(width) && positiveFinite(height) ? { width, height } : { ...UNMEASURED }
}

/**
 * Converts a Unity screen position into stage pixels.
 *
 * Two things differ between what Unity's input reports and what a game lays
 * itself out in, which is why this exists rather than arithmetic at each call
 * site:
 *
 *   Unity screen space counts from the BOTTOM left with y going up. Everything
 *   in UI Toolkit, and therefore everything a game positions, counts from the
 *   top left with y going down.
 *   Unity reports PHYSICAL pixels. A stage is in logical ones.
 *
 * Get the flip wrong and the game reads as haunted.
 *
 * The height comes from the stage rather than from Screen, so a stale Screen
 * reading cannot disagree with the stage the game is actually drawn against.
 * They are the same number when both are fresh.
 */
export function screenToStage(
    stage: Stage, screenX: number, screenY: number, pixelRatio: number,
): { x: number; y: number } {
    const dpr = pixelRatio > 0 ? pixelRatio : 1
    return { x: screenX / dpr, y: stage.height - screenY / dpr }
}

/**
 * The same for a movement rather than a position.
 *
 * A delta has no origin, so only the scale and the flipped axis apply. Passing
 * one through screenToStage instead would add the stage height to every
 * vertical movement, which is the kind of mistake that still looks like it is
 * working until something crosses the middle of the screen.
 */
export function screenDeltaToStage(deltaX: number, deltaY: number, pixelRatio: number): { x: number; y: number } {
    const dpr = pixelRatio > 0 ? pixelRatio : 1
    return { x: deltaX / dpr, y: -deltaY / dpr }
}
