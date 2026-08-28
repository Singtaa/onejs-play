/**
 * Input for a game running outside the container, which is what an eject
 * produces.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * `createRuntime` installs the container's input backend, because that is what
 * the container needs. `startStandalone` calls `createRuntime`. So an ejected
 * game got the container's backend with nothing feeding it: no adapter pushes
 * browser events into it in a Unity project, and there are no browser events to
 * push. Every key read as up, the mouse sat at the origin, and no touch ever
 * arrived. Not a wrong answer, an answer that never changed.
 *
 * `standalone.ts` even documented the opposite ("no input backend override"),
 * which is what it intended and not what the code did.
 *
 * WHY NOT SIMPLY INSTALL NOTHING
 *
 * That was the first idea and it is half a fix. With no backend, onejs-unity
 * falls through to the real InputBridge, so input starts working, but it
 * reports Unity screen space: physical pixels, origin at the BOTTOM left, y
 * counting up. A game lays itself out in stage units from the TOP left with y
 * counting down. So a pointer game would run, and be wrong in three ways at
 * once, with the flipped axis reading as a haunting rather than a bug.
 *
 * So this wraps the real bridge instead of replacing it. Keyboard, gamepad and
 * haptics pass straight through, because they were never in any coordinate
 * space. The pointer methods are converted, and only those.
 *
 * WHAT IS NOT COVERED
 *
 * Input actions. A backend is not consulted for those (see backend.ts), so an
 * ejected game using them reaches the real bridge directly, which is correct
 * for everything except positions read out of an action. That is a narrow gap
 * and it is written down rather than papered over.
 */

import { screenToStage, screenDeltaToStage, type StageLayout } from "./stage"

// Type-level redeclaration only, so dynamic host globals typecheck;
// no runtime binding is created.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

/** Methods whose return value is a position in Unity screen space. */
const POSITION_X = new Set(["GetMousePositionX", "GetTouchPositionX"])
const POSITION_Y = new Set(["GetMousePositionY", "GetTouchPositionY"])
/** Methods whose return value is a movement in Unity screen space. */
const DELTA_X = new Set(["GetMouseDeltaX", "GetTouchDeltaX"])
const DELTA_Y = new Set(["GetMouseDeltaY", "GetTouchDeltaY"])

/** The real thing, or null where it cannot be reached. */
function realBridge(): any | null {
    try {
        return globalThis.CS?.OneJS?.Input?.InputBridge ?? null
    } catch {
        return null
    }
}

export interface HostInputOptions {
    /** The layout to convert against, read fresh on every call. */
    layout(): StageLayout
    /** Physical pixels per logical one. */
    pixelRatio(): number
    /** For tests. Defaults to the real InputBridge. */
    bridge?: unknown
}

/**
 * A backend that is the real bridge with its pointer coordinates converted.
 *
 * Returns null when there is no bridge to wrap, so the caller can install
 * nothing and let onejs-unity produce its own error rather than this file
 * inventing a worse one.
 *
 * A Proxy rather than forty forwarding methods, because the interface is not
 * frozen: a method added to InputBridge tomorrow should reach an ejected game
 * without anybody remembering to add it here. The ones this file cares about
 * are named above, and everything else is a pass-through by construction.
 */
export function createHostInputBackend(options: HostInputOptions): Record<string, unknown> | null {
    // An explicit `bridge: null` means "there is none", not "find one": `??`
    // would treat it as absent and go looking, which makes the no-bridge case
    // untestable and, worse, unreachable.
    const bridge = "bridge" in options ? options.bridge : realBridge()
    if (bridge === null || bridge === undefined) return null

    const source = bridge as Record<string, any>

    /** Both axes at once, because converting a position needs the pair. */
    const positionOf = (index?: number) => {
        const x = index === undefined ? source.GetMousePositionX() : source.GetTouchPositionX(index)
        const y = index === undefined ? source.GetMousePositionY() : source.GetTouchPositionY(index)
        return screenToStage(options.layout(), x, y, options.pixelRatio())
    }

    const deltaOf = (index?: number) => {
        const x = index === undefined ? source.GetMouseDeltaX() : source.GetTouchDeltaX(index)
        const y = index === undefined ? source.GetMouseDeltaY() : source.GetTouchDeltaY(index)
        return screenDeltaToStage(options.layout(), x, y, options.pixelRatio())
    }

    const touchIndex = (name: string, args: unknown[]) =>
        name.startsWith("GetTouch") ? (args[0] as number) : undefined

    return new Proxy({}, {
        get(_target, property) {
            if (typeof property !== "string") return undefined

            if (POSITION_X.has(property)) {
                return (...args: unknown[]) => positionOf(touchIndex(property, args)).x
            }
            if (POSITION_Y.has(property)) {
                return (...args: unknown[]) => positionOf(touchIndex(property, args)).y
            }
            if (DELTA_X.has(property)) {
                return (...args: unknown[]) => deltaOf(touchIndex(property, args)).x
            }
            if (DELTA_Y.has(property)) {
                return (...args: unknown[]) => deltaOf(touchIndex(property, args)).y
            }

            const value = source[property]
            if (typeof value !== "function") return value
            // Called through the source rather than bound to it: a CS proxy's
            // methods are not ordinary functions and do not always survive
            // Function.prototype.bind.
            return (...args: unknown[]) => source[property](...args)
        },
    }) as Record<string, unknown>
}
