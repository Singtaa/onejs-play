/**
 * Whether a press at a stage point lands on UI that answers it.
 *
 * Gunyard's Invite button (engine-findings.md, "A press on a HUD button is
 * also a game input"): the game fired on `input.mouse.leftButton`, so a click
 * on Invite was also a shot, and a thumb on it would have started the left
 * stick. The cart worked round it by testing the button's rectangle twice.
 * Every cart with a button over its play area needs the same answer, so input
 * carries it: `input.mouse.overUI` and `touch.overUI` (onejs-unity), set from
 * this, and oj's sticks and pads leave such a touch alone.
 *
 * WHAT ANSWERS A PRESS
 *
 * Not merely what is under the point: a cart lays its HUD inside a View the
 * size of the stage, and UI Toolkit picks that View for a press anywhere, so
 * "over a pickable element" would be true everywhere. What a player means by a
 * button is an element that does something when pressed, so this picks the
 * element under the point and walks up the tree for one with a click, pointer
 * or change handler, which the bootstrap's handler map knows
 * (`__eventAPI.listens`, in a OneJS new enough to have it). A Text inside a
 * button is ignored by picking or answered by its parent; a slider's inner
 * parts by the slider.
 */

/** The handlers that make an element something a press is for. */
export const PRESS_EVENTS: readonly string[] = ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "change"]

/** How far up the tree to look: deeper than any HUD, shallow enough to bound a walk that went wrong. */
const MAX_DEPTH = 64

/** Answers whether a press at a stage point is the UI's. */
export type PressProbe = (x: number, y: number) => boolean

/**
 * The probe for the panel `root` is on, or null where it cannot be asked: no
 * root, or a OneJS whose bootstrap has no `__eventAPI.listens`. Stage pixels
 * are the panel's own units, so the point goes to `Pick` as it is.
 */
export function createPressProbe(root: any, cs: any = (globalThis as any).CS, events: any = (globalThis as any).__eventAPI): PressProbe | null {
    if (root == null || cs == null || typeof events?.listens !== "function") return null
    return (x, y) => {
        const panel = root.panel
        if (panel == null) return false
        let element = panel.Pick(new cs.UnityEngine.Vector2(x, y))
        for (let depth = 0; element != null && depth < MAX_DEPTH; depth++) {
            if (events.listens(element, PRESS_EVENTS)) return true
            element = element.parent
        }
        return false
    }
}
