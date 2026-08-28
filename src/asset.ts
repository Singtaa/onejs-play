/**
 * Where a game's own files live, on both sides of an eject.
 *
 * A game that ships a sprite or a sound has to name it, and the name has to
 * mean the same thing in two places that store files completely differently:
 *
 *   on the site, under `/assets/` on the game's own origin, fetched over HTTP;
 *   in a Unity project, under the project's `assets/` folder in the editor and
 *   inside `StreamingAssets/onejs/assets/` in a build.
 *
 * `assetUrl` is the one function that knows which. A game writes the bare file
 * name and gets back something the loaders can actually fetch:
 *
 *     <Image src={assetUrl("glow.png")} />
 *     const blip = await audio.load(assetUrl("blip.wav"))
 *
 * Explicit at the call site on purpose. The alternative was to teach every
 * loader a hidden base, which would mean a bare "glow.png" resolving through
 * machinery a reader cannot see, and two loaders that disagreed about it would
 * be a bug with no visible cause. One call, greppable, same source everywhere.
 */

import { useEffect, useState } from "react"
import { loadImageAsync, loadTextAsync } from "onejs-unity/assets"
import type { SheetConfig } from "onejs-react"

// Type-level redeclaration only, so dynamic host globals typecheck;
// no runtime binding is created.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

/**
 * The container's base, set by the host. Null outside one, which is what
 * selects the Unity convention below.
 */
let base: string | null = null

/** Called by the host. Games have no reason to touch this. */
export function setAssetBase(next: string | null): void {
    base = next === null ? null : next.replace(/\/+$/, "")
}

export function getAssetBase(): string | null {
    return base
}

/** Already fetchable as written: a full URL, or a rooted path in a project. */
function isResolved(name: string): boolean {
    return name.includes("://") || name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)
}

/**
 * The address of one of this game's files.
 *
 * Names are bare: "glow.png", not "assets/glow.png" and not a path. Anything
 * that already resolves (a full URL, or an absolute path in a Unity project) is
 * handed back untouched, so passing a remote image through this is harmless.
 */
export function assetUrl(name: string): string {
    if (typeof name !== "string" || name === "") {
        throw new Error("[oj] assetUrl needs a file name")
    }
    if (isResolved(name)) return name

    // Leading "./" and "assets/" are what a web habit produces, and both mean
    // the thing this function is already about. Accepting them costs one line
    // and removes a class of "why is my sprite missing".
    const clean = name.replace(/^\.\//, "").replace(/^assets\//, "")

    if (base !== null) return `${base}/${clean}`

    // No container, so this is a real Unity project and OneJS's own convention
    // applies. Editor and player put the same file in different places, which
    // is why this cannot be a constant.
    const CS = globalThis.CS
    if (CS?.UnityEngine?.Application === undefined) {
        // No host at all: a unit test, or a component rendered outside OneJS.
        // A relative path is the least surprising thing to hand back.
        return `assets/${clean}`
    }
    const Path = CS.System.IO.Path
    if (CS.UnityEngine.Application.isEditor === true) {
        const workingDir = typeof globalThis.__workingDir === "string"
            ? globalThis.__workingDir
            : Path.Combine(Path.GetDirectoryName(CS.UnityEngine.Application.dataPath), "App")
        return Path.Combine(workingDir, "assets", clean)
    }
    const streaming: string = CS.UnityEngine.Application.streamingAssetsPath
    // On Android streamingAssetsPath is a jar:file:// URL and on WebGL an
    // http one, neither of which Path.Combine can join correctly.
    if (streaming.includes("://")) return `${streaming}/onejs/assets/${clean}`
    return Path.Combine(streaming, "onejs", "assets", clean)
}


/**
 * Loads one of this game's images, as something the runtime can draw.
 *
 * What comes back is a Unity texture, and it is deliberately opaque: a game
 * holds it and hands it to whatever wants a sprite, without ever calling
 * anything on it. That is what the particle system's `texture` field takes.
 *
 *     const glow = await loadTexture("glow.png")
 *     useParticles(ref, { emitters: [{ texture: glow, ... }] })
 *
 * A bare name, resolved the same way everywhere. SVG works too, and comes back
 * as a VectorImage rather than a texture.
 */
export async function loadTexture(name: string): Promise<unknown> {
    return loadImageAsync(assetUrl(name))
}

/**
 * The hook form, for the common case of a component that needs a sprite.
 *
 * Null until it arrives, so a caller renders nothing (or a placeholder) for the
 * frame or two the fetch takes. Loading is not cancelled on unmount, because
 * the underlying loader caches by URL and a second mount would otherwise pay
 * for the same bytes again; the result is simply dropped.
 */
export function useTexture(name: string): unknown | null {
    const [texture, setTexture] = useState<unknown | null>(null)

    useEffect(() => {
        let live = true
        setTexture(null)
        loadTexture(name).then(
            (loaded) => { if (live) setTexture(loaded) },
            (error) => console.error(`[oj] could not load ${name}:`, error),
        )
        return () => { live = false }
    }, [name])

    return texture
}

// MARK: flipbook

/**
 * One flipbook contract on the site, not two: the sidecar reuses the particle
 * system's SheetConfig fields verbatim, and the cell-to-uv mapping below is the
 * same one ParticleSystem2D.cs applies to a particle's quad. Frame 0 is the
 * sheet's top-left cell; texture V runs bottom-up.
 */
export type { SheetConfig }

/** A normalized uv rect in the shape the Image element's `uv` prop takes. */
export interface UvRect { x: number; y: number; width: number; height: number }

/**
 * The sidecar's name: `glow.png` looks for `glow.sheet.json` beside it. A name
 * with no extension gets `.sheet.json` appended whole.
 */
export function sheetName(name: string): string {
    const dot = name.lastIndexOf(".")
    const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"))
    const stem = dot > slash ? name.slice(0, dot) : name
    return `${stem}.sheet.json`
}

/**
 * Validates and fills in a parsed sidecar.
 *
 * Defaults are SheetConfig's own, not a second set invented here: mode "life",
 * fps 24, randomStart false, frameCount cols*rows. cols and rows have no
 * default because a sheet without a grid is not a sheet.
 *
 * A frameCount larger than the grid is clamped with a loud error rather than
 * thrown, which deliberately diverges from ParticleWire.Parse. There the config
 * comes from code and a throw lands on the author's own screen at the call
 * site; here it comes from a data file at load time, and a game that dies over
 * a padded sheet's metadata is a worse outcome than a flipbook that plays the
 * cells that exist.
 */
export function parseSheet(raw: unknown, source: string): Required<SheetConfig> | null {
    if (typeof raw !== "object" || raw === null) {
        console.error(`[oj] ${source}: a sheet sidecar must be a JSON object`)
        return null
    }
    const data = raw as Record<string, unknown>
    const cols = data.cols, rows = data.rows
    if (typeof cols !== "number" || typeof rows !== "number" ||
        !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
        console.error(`[oj] ${source}: needs integer cols and rows, got cols=${cols} rows=${rows}`)
        return null
    }
    const total = cols * rows
    let frameCount = typeof data.frameCount === "number" ? Math.floor(data.frameCount) : total
    if (frameCount < 1) frameCount = total
    if (frameCount > total) {
        console.error(`[oj] ${source}: frameCount ${frameCount} exceeds the ${cols}x${rows} grid; playing ${total}`)
        frameCount = total
    }
    return {
        cols, rows, frameCount,
        mode: data.mode === "fps" ? "fps" : "life",
        fps: typeof data.fps === "number" && data.fps > 0 ? data.fps : 24,
        randomStart: data.randomStart === true,
    }
}

/**
 * Loads the sheet sidecar for an asset, or null when the asset is a plain
 * sprite. Absence is not an error: a missing sidecar means "no animation", the
 * same way a missing sheet field means it on a particle emitter. A sidecar
 * that exists but cannot be used reports itself and comes back null too, so
 * every failure mode degrades to a static image rather than a dead game.
 */
export async function loadSheet(name: string): Promise<Required<SheetConfig> | null> {
    const sidecar = sheetName(name)
    let text: string
    try {
        text = await loadTextAsync(assetUrl(sidecar))
    } catch {
        return null
    }
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch (error) {
        console.error(`[oj] ${sidecar}: not valid JSON:`, error)
        return null
    }
    return parseSheet(raw, sidecar)
}

/** Which cell to show at a moment. Both modes loop at fps: a quad has no lifetime for "life" to follow. */
export function sheetFrame(sheet: Required<SheetConfig>, seconds: number, startFrame = 0): number {
    return (startFrame + Math.floor(seconds * sheet.fps)) % sheet.frameCount
}

/**
 * A frame's uv rect, matching ParticleSystem2D.cs: frame 0 top-left,
 * col = f % cols, row = f / cols, V bottom-up.
 */
export function sheetUv(sheet: Required<SheetConfig>, frame: number): UvRect {
    const col = frame % sheet.cols
    const row = Math.floor(frame / sheet.cols)
    const du = 1 / sheet.cols, dv = 1 / sheet.rows
    return { x: col * du, y: 1 - row * dv - dv, width: du, height: dv }
}

/** The whole image, for a sprite with no sidecar. */
const FULL_UV: UvRect = { x: 0, y: 0, width: 1, height: 1 }

/**
 * Drives one Image element as a flipbook: sets its texture, then narrows its
 * uv to the current cell as time passes. Split from the hook so it can be
 * exercised without a renderer; the hook is a thin lifetime wrapper around it.
 *
 * Writes the element only when the frame index changes, so a 24 fps sheet
 * costs 24 uv writes a second, not one per tick, and a null sheet costs none.
 */
export function attachFlipbook(
    element: any,
    texture: unknown,
    sheet: Required<SheetConfig> | null,
    raf: (cb: (ms: number) => void) => number = (cb) => requestAnimationFrame(cb),
    caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): () => void {
    const CS = globalThis.CS
    const rect = (uv: UvRect) =>
        CS?.UnityEngine?.Rect !== undefined
            ? new CS.UnityEngine.Rect(uv.x, uv.y, uv.width, uv.height)
            : uv
    // Drawn once, so the first paint and the ticking loop agree on where the
    // animation began. Two draws would show one frame and then jump.
    const start = sheet !== null && sheet.randomStart
        ? Math.floor(Math.random() * sheet.frameCount) : 0
    element.image = texture
    element.uv = rect(sheet === null ? FULL_UV : sheetUv(sheet, start))
    if (sheet === null || sheet.frameCount < 2) return () => {}

    let id = 0
    let last: number | null = null
    let seconds = 0
    let shown = start
    const tick = (ms: number) => {
        id = raf(tick)
        if (last !== null) seconds += (ms - last) / 1000
        last = ms
        const frame = sheetFrame(sheet, seconds, start)
        if (frame !== shown) {
            shown = frame
            element.uv = rect(sheetUv(sheet, frame))
        }
    }
    id = raf(tick)
    return () => caf(id)
}

/**
 * A flipbook on an element, from a sheet and its sidecar:
 *
 *     const ref = useRef(null)
 *     useFlipbook(ref, "glow.png")
 *     <Image ref={ref} style={{ width: 64, height: 64 }} />
 *
 * Follows useParticles' shape: the ref names the element, the hook owns the
 * animation's lifetime. No sidecar means the image simply shows whole, so the
 * same call works for animated and plain sprites alike.
 */
export function useFlipbook(ref: { current: any }, name: string): void {
    useEffect(() => {
        let live = true
        let detach: (() => void) | null = null
        Promise.all([loadTexture(name), loadSheet(name)]).then(
            ([texture, sheet]) => {
                if (!live || ref.current === null) return
                detach = attachFlipbook(ref.current, texture, sheet)
            },
            (error) => console.error(`[oj] could not load ${name}:`, error),
        )
        return () => {
            live = false
            if (detach !== null) detach()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name])
}
