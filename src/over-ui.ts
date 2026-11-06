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
 *
 * THE GAME'S OWN HANDLERS
 *
 * A View the size of the stage with a press handler of its own (a camera's
 * drag, a tap-to-jump area) answers every press, so every press read as UI
 * and a stick beside it went dead with nothing said (learn Mac's lesson 1,
 * runtime-1.3.md section 10b). An element with the class `oj-world` is the
 * game's: the walk passes over it and keeps looking above it, so a button
 * inside it is still UI. The class is asked only of an element that has a
 * handler, so a press costs nothing more until one does. When the element
 * that answered is about the stage's size, the first such press says how to
 * mark it, once: a hint, since a full-screen menu answering every press is
 * also right.
 */

/** The handlers that make an element something a press is for. */
export const PRESS_EVENTS: readonly string[] = ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "change"]

/** How far up the tree to look: deeper than any HUD, shallow enough to bound a walk that went wrong. */
const MAX_DEPTH = 64

/** The class that makes an element the game's: a press through it is not over UI. */
export const WORLD_CLASS = "oj-world"

/** Said once, the first time an element about the stage's size answers a press. */
export const STAGE_SIZED_HINT = "[oj] Every press reads as overUI here: a View the size of the stage has a press handler, "
    + "so input.mouse.overUI, touch.overUI and useStick treat the whole screen as UI. "
    + `If its presses are the game's (a camera drag, a tap anywhere), give it className="${WORLD_CLASS}".`

/** Each side at least this share of the stage's reads as the stage's size. */
const STAGE_SHARE = 0.9

/** Answers whether a press at a stage point is the UI's. */
export type PressProbe = (x: number, y: number) => boolean

/**
 * The probe for the panel `root` is on, or null where it cannot be asked: no
 * root, or a OneJS whose bootstrap has no `__eventAPI.listens`. Stage pixels
 * are the panel's own units, so the point goes to `Pick` as it is.
 */
export function createPressProbe(root: any, cs: any = (globalThis as any).CS, events: any = (globalThis as any).__eventAPI): PressProbe | null {
    if (root == null || cs == null || typeof events?.listens !== "function") return null
    let hinted = false
    const hintIfStageSized = (element: any) => {
        const bound = element.worldBound
        const stage = root.worldBound
        if (bound == null || stage == null || !(stage.width > 0 && stage.height > 0)) return
        if (bound.width < stage.width * STAGE_SHARE || bound.height < stage.height * STAGE_SHARE) return
        hinted = true
        console.warn(STAGE_SIZED_HINT)
    }
    return (x, y) => {
        const panel = root.panel
        if (panel == null) return false
        let element = panel.Pick(new cs.UnityEngine.Vector2(x, y))
        for (let depth = 0; element != null && depth < MAX_DEPTH; depth++) {
            if (events.listens(element, PRESS_EVENTS) && !element.ClassListContains(WORLD_CLASS)) {
                if (!hinted) hintIfStageSized(element)
                return true
            }
            element = element.parent
        }
        return false
    }
}
