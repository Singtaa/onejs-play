/**
 * The stage: how a game's logical coordinate space maps onto whatever pixels
 * the player's window happens to give it.
 *
 * A fixed logical space is what lets an author lay a game out once instead of
 * solving responsive design, so 960x540 is the default. It is only a default.
 * A game picks its own size, and picks how that size is fitted:
 *
 *     letterbox   preserve aspect, bars fill the remainder (default)
 *     cover       preserve aspect, crop the overflow
 *     stretch     ignore aspect, fill exactly
 *     fluid       no fixed stage; the stage is the viewport in logical pixels
 *
 * fluid matters more than it looks. UI Toolkit is the renderer, so a good share
 * of games in this lane are responsive apps (cards, incrementals, builders)
 * rather than fixed arcade screens, and those want to reflow, not scale.
 *
 * Fullscreen is orthogonal to all of it. It changes how many pixels are
 * available; the fit still applies. The host page owns the Fullscreen API call
 * so the user gesture and the Permissions Policy stay on its side of the iframe
 * boundary, and the game asks for it over postMessage.
 *
 * Pointer positions are always reported to games in logical units. toStage is
 * that conversion and it is the reason every layout here also carries scaleX,
 * scaleY and the offsets.
 */

export type StageFit = "letterbox" | "cover" | "stretch" | "fluid"

const FITS: readonly StageFit[] = ["letterbox", "cover", "stretch", "fluid"]

export const DEFAULT_STAGE_WIDTH = 960
export const DEFAULT_STAGE_HEIGHT = 540
/** Dark enough to sit behind anything without competing with it. */
export const DEFAULT_STAGE_MATTE = "#14181d"

/** Loose stage input, as it appears in oj.json. */
export interface StageInput {
    /** Sugar for width and height together. */
    size?: readonly [number, number]
    width?: number
    height?: number
    fit?: StageFit
    /**
     * Snap the scale to a whole number so texel grids stay aligned. Floors for
     * letterbox (never below 1) and ceils for cover, so coverage is preserved.
     * Ignored for stretch and fluid, which have no single uniform scale.
     */
    pixelPerfect?: boolean
    /**
     * What fills the space around a letterboxed stage.
     *
     * Painted by the UI, deliberately. The engine offers two lower-level ways
     * to clear a background, a camera and PanelSettings.colorClearValue, and
     * both write the value straight into the framebuffer without the sRGB
     * conversion the UI colour pipeline applies. In a linear-colour project
     * that turns #14181d into #4f565f, measured, which is the kind of bug that
     * looks like a design choice. A colour on an element cannot drift that way.
     */
    matte?: string
}

/** A validated stage configuration. Every field is resolved. */
export interface StageConfig {
    width: number
    height: number
    fit: StageFit
    pixelPerfect: boolean
    matte: string
}

/** A rectangle in logical stage units. */
export interface StageRect {
    x: number
    y: number
    width: number
    height: number
}

/** The resolved mapping from logical units to viewport pixels. */
export interface StageLayout {
    /**
     * The fit this layout came from.
     *
     * Carried rather than re-derived: a presenter has to treat stretch
     * differently from letterbox, and inferring it from scaleX !== scaleY is
     * wrong the moment a stretched stage happens to match the viewport aspect.
     */
    fit: StageFit
    /** What fills the space around the stage. See StageInput.matte. */
    matte: string
    /** Logical width the game should draw into. Tracks the viewport when fluid. */
    width: number
    /** Logical height. */
    height: number
    /**
     * Conservative uniform scale in pixels per logical unit, useful for picking
     * crisp font sizes. Under stretch this is the smaller of the two axes, so
     * prefer scaleX and scaleY there.
     */
    scale: number
    scaleX: number
    scaleY: number
    /** Where the stage origin sits in viewport pixels. Negative when cropped. */
    offsetX: number
    offsetY: number
    /** The part of the logical stage actually on screen. The whole stage unless cropped. */
    visible: StageRect
    viewportWidth: number
    viewportHeight: number
}

function positiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0
}

/** Sub-pixel slack, below which a layout counts as fitting exactly. */
const FIT_TOLERANCE_PX = 1e-6

/**
 * How much of one stage axis survives the crop, in logical units.
 *
 * Cropping is decided in pixel space against a tolerance rather than read back
 * out of the offsets, because float error in (viewport - size * scale) makes an
 * exactly-fitting layout look a hair cropped. Without the tolerance a plain
 * letterbox reports visible.x of about 5e-14, and the obvious test for whether
 * a game is cropped (visible.x > 0) is then true for every game.
 */
function visibleAxis(size: number, scale: number, offset: number, viewport: number): { start: number; size: number } {
    if (size * scale <= viewport + FIT_TOLERANCE_PX) {
        return { start: 0, size }
    }
    const start = Math.max(0, -offset) / scale
    return { start, size: Math.min(size - start, viewport / scale) }
}

/**
 * Resolves loose stage input into a complete config, applying defaults and
 * rejecting nonsense at publish time rather than at play time.
 */
export function normalizeStage(input: StageInput | undefined | null): StageConfig {
    const raw = input ?? {}

    let width = raw.width
    let height = raw.height
    if (raw.size !== undefined) {
        if (!Array.isArray(raw.size) || raw.size.length !== 2) {
            throw new Error(`[oj] stage size must be [width, height]`)
        }
        width = width ?? raw.size[0]
        height = height ?? raw.size[1]
    }

    width = width ?? DEFAULT_STAGE_WIDTH
    height = height ?? DEFAULT_STAGE_HEIGHT

    if (!positiveFinite(width) || !positiveFinite(height)) {
        throw new Error(`[oj] stage size must be positive and finite, got ${width}x${height}`)
    }

    const fit = raw.fit ?? "letterbox"
    if (!FITS.includes(fit)) {
        throw new Error(`[oj] invalid stage fit "${fit}", expected one of ${FITS.join(", ")}`)
    }

    const matte = raw.matte ?? DEFAULT_STAGE_MATTE
    if (typeof matte !== "string" || matte.trim() === "") {
        throw new Error(`[oj] stage matte must be a colour string, got ${JSON.stringify(raw.matte)}`)
    }

    return { width, height, fit, pixelPerfect: raw.pixelPerfect ?? false, matte }
}

/**
 * Maps a stage config onto a viewport.
 *
 * A viewport that is zero or not finite (which happens on the frames before UI
 * Toolkit has measured anything) falls back to an unscaled layout rather than
 * dividing through and seeding NaN into every downstream coordinate.
 */
export function computeStageLayout(
    config: StageConfig,
    viewportWidth: number,
    viewportHeight: number,
): StageLayout {
    const measured = positiveFinite(viewportWidth) && positiveFinite(viewportHeight)
    const vw = measured ? viewportWidth : config.width
    const vh = measured ? viewportHeight : config.height

    if (config.fit === "fluid") {
        return {
            fit: config.fit,
            matte: config.matte,
            width: vw,
            height: vh,
            scale: 1,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            visible: { x: 0, y: 0, width: vw, height: vh },
            viewportWidth: vw,
            viewportHeight: vh,
        }
    }

    const { width, height } = config
    let scaleX: number
    let scaleY: number

    if (config.fit === "stretch") {
        scaleX = vw / width
        scaleY = vh / height
    } else {
        const raw = config.fit === "cover"
            ? Math.max(vw / width, vh / height)
            : Math.min(vw / width, vh / height)
        let uniform = raw
        if (config.pixelPerfect) {
            uniform = config.fit === "cover" ? Math.ceil(raw) : Math.floor(raw)
            if (uniform < 1) uniform = 1
        }
        scaleX = uniform
        scaleY = uniform
    }

    const offsetX = (vw - width * scaleX) / 2
    const offsetY = (vh - height * scaleY) / 2

    const h = visibleAxis(width, scaleX, offsetX, vw)
    const v = visibleAxis(height, scaleY, offsetY, vh)
    const visible: StageRect = { x: h.start, y: v.start, width: h.size, height: v.size }

    return {
        fit: config.fit,
        matte: config.matte,
        width,
        height,
        scale: Math.min(scaleX, scaleY),
        scaleX,
        scaleY,
        offsetX,
        offsetY,
        visible,
        viewportWidth: vw,
        viewportHeight: vh,
    }
}

/** Converts a viewport pixel position into logical stage units. */
export function toStage(layout: StageLayout, viewportX: number, viewportY: number): { x: number; y: number } {
    return {
        x: (viewportX - layout.offsetX) / layout.scaleX,
        y: (viewportY - layout.offsetY) / layout.scaleY,
    }
}

/** Converts a logical stage position into viewport pixels. */
export function fromStage(layout: StageLayout, stageX: number, stageY: number): { x: number; y: number } {
    return {
        x: stageX * layout.scaleX + layout.offsetX,
        y: stageY * layout.scaleY + layout.offsetY,
    }
}
