/**
 * How a Play game's built-in controls look.
 *
 * UI Toolkit ships a runtime theme meant for the editor, and a Button drawn
 * with it is a grey slab that lightens on hover in a way that looks like
 * nothing else on the site. Every game that used one had to restyle it, or
 * live with it, and most of them lived with it.
 *
 * So `mount()` compiles this once. It is deliberately small and it only
 * touches the controls the runtime provides, never anything a game makes for
 * itself: a game's own Views and Texts are its business, and a theme that
 * reached into those would fight every author who had an opinion.
 *
 * It is a default rather than a rule. `mount(<Game />, { theme: false })` skips
 * it, and an inline style on an element beats it, because inline styles win
 * over a stylesheet in UI Toolkit exactly as they do on the web.
 *
 * AFTER AN EJECT
 *
 * It travels. This is compiled by mount(), not applied by the container, so an
 * ejected project gets the same look from the same code rather than reverting
 * to the editor theme and leaving an author wondering what changed.
 */

/** Dark, cool, and matched to the site the games are shown on. */
export const THEME_USS = `
.unity-button {
    background-color: rgb(42, 50, 64);
    border-width: 1px;
    border-color: rgb(66, 78, 98);
    border-radius: 6px;
    color: rgb(222, 231, 245);
    padding-left: 14px;
    padding-right: 14px;
    padding-top: 7px;
    padding-bottom: 7px;
    margin: 0;
    -unity-text-align: middle-center;
    /* Short enough to feel immediate, long enough to read as a response. */
    transition-property: background-color, border-color, color;
    transition-duration: 0.08s;
}

.unity-button:hover {
    background-color: rgb(56, 68, 88);
    border-color: rgb(104, 126, 158);
}

/* Pressed is darker than resting, not lighter. A button that brightens under
   the finger reads as being released. */
.unity-button:active {
    background-color: rgb(30, 37, 48);
    border-color: rgb(120, 146, 184);
}

.unity-button:focus {
    border-color: rgb(96, 146, 214);
}

.unity-button:disabled {
    opacity: 0.4;
}

/* Sliders. The track recedes and the handle is what the eye follows, which is
   the opposite of the default, where both are the same pale grey. */
.unity-base-slider__tracker {
    background-color: rgb(38, 45, 58);
    border-width: 0;
    border-radius: 3px;
    height: 4px;
    margin-top: 6px;
}

.unity-base-slider__dragger {
    background-color: rgb(150, 170, 200);
    border-width: 0;
    border-radius: 3px;
    width: 10px;
    height: 18px;
    margin-top: -1px;
    transition-property: background-color;
    transition-duration: 0.08s;
}

.unity-base-slider:hover .unity-base-slider__dragger {
    background-color: rgb(196, 214, 240);
}

.unity-base-slider__dragger-border {
    border-width: 0;
}

/* Toggles and text fields, so a game using one does not stand out. */
.unity-toggle__checkmark {
    background-color: rgb(42, 50, 64);
    border-color: rgb(66, 78, 98);
    border-radius: 4px;
}

.unity-base-text-field__input {
    background-color: rgb(24, 29, 38);
    border-color: rgb(66, 78, 98);
    border-radius: 5px;
    color: rgb(222, 231, 245);
    padding-left: 8px;
    padding-right: 8px;
}

.unity-base-text-field__input:focus {
    border-color: rgb(96, 146, 214);
}

/* Scrollers, which otherwise arrive as a pair of editor arrow buttons. */
.unity-scroller--vertical {
    width: 8px;
    background-color: transparent;
}

.unity-scroller--horizontal {
    height: 8px;
    background-color: transparent;
}

.unity-scroller__low-button,
.unity-scroller__high-button {
    display: none;
}

.unity-scroller .unity-base-slider__tracker {
    background-color: transparent;
    margin-top: 0;
}

.unity-scroller .unity-base-slider__dragger {
    background-color: rgb(64, 76, 96);
    border-radius: 4px;
    width: 6px;
    margin-left: 1px;
}

.unity-scroller:hover .unity-base-slider__dragger {
    background-color: rgb(96, 112, 138);
}
`

declare const globalThis: any

let applied = false

/**
 * Compiles the theme, once per runtime.
 *
 * Guarded rather than idempotent-by-luck: compileStyleSheet attaches a new
 * sheet each time it is called, and mount() can legitimately run more than once
 * in a session (a container swapping games, a hot reload in a project).
 * Stacking a dozen identical sheets costs memory and makes any later override
 * fight a growing pile of equal-specificity rules.
 */
export function applyTheme(): void {
    if (applied) return
    const compile = globalThis.compileStyleSheet
    if (typeof compile !== "function") return
    try {
        compile(THEME_USS, "oj/theme.uss")
        applied = true
    } catch (error) {
        // A game without a theme is a game that still runs.
        console.warn("[oj] could not apply the default theme:", error)
    }
}

/** Lets a container reset the guard when it tears a game down. */
export function resetTheme(): void {
    applied = false
}
