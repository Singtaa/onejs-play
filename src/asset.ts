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
 * `assetUrl` is the one function that knows which. Every loader oj exports
 * (Image, useTexture, loadTexture, audio.load, useModel) runs a name through it,
 * so a game writes the bare file name everywhere:
 *
 *     <Image src="glow.png" />
 *     audio.load("blip.wav").then((blip) => blip.play())
 *
 * A game calls it itself only to hand one of its files to something outside
 * oj. What matters is that every loader agrees: when Image alone resolved names
 * its own way, the same `src` drew in Unity and 404ed on the site.
 */

import { useEffect, useState } from "react"
import { loadImageAsync, loadTextAsync } from "onejs-unity/assets"
import type { Font, SheetConfig, Texture } from "onejs-react"
import { setFileLoader } from "./physics3d/sources"

// Type-level redeclaration only, so dynamic host globals typecheck;
// no runtime binding is created.
// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: any

/**
 * The container's base, set by the host. Null outside one, which is what
 * selects the Unity convention below.
 */
let base: string | null = null

/**
 * Where, under the base, the carts this one uses keep their files. Empty when
 * they sit straight under it, as on the site and in a player, where a used
 * cart's `@handle/name@1.2.0/glow.png` is served or copied under its key. A
 * Unity editor reads a cart where it sits, so there they are under `.oj/carts`,
 * where `ojplay add` put them (`ojplay run` maps them the same way).
 */
let usedCarts = ""

/** One texture load per URL for the life of a host, shared by every component that asks. */
const textures = new Map<string, Promise<Texture>>()

/** One font load per URL for the life of a host, as textures are. */
const fonts = new Map<string, Promise<Font>>()

/** The fonts already built, by URL, so useFont hands a preloaded one to its first render. */
const builtFonts = new Map<string, Font>()

/** A file a build ships: its SHA-256 and its size in bytes. */
export type AssetEntry = readonly [sha256: string, bytes: number]

/**
 * The build's own files and its used carts' (`@h/n@1.2.0/glow.png`), by
 * name. Empty until a bundle says otherwise, and emptied by every new host,
 * because the map belongs to one build (docs/refs-and-assets.md, PlaySite).
 */
let files: Record<string, AssetEntry> = {}

/** Where the map's hashes are served from, when the build says: PlaySite's store. Null means the cart's own origin. */
let store: string | null = null

/** The files oj.json lists to load before the cart appears, as the builder opened them: mount waits for these. */
let startup: readonly string[] = []

/** Every file name the build ships: the map's, or the names alone when ojplay built it with no map. */
let names: readonly string[] = []

/** Called by the host. Games have no reason to touch this. */
export function setAssetBase(next: string | null, options: { usedCarts?: string } = {}): void {
    base = next === null ? null : next.replace(/\/+$/, "")
    usedCarts = next === null ? "" : (options.usedCarts ?? "").replace(/^\/+|\/+$/g, "")
    files = {}
    store = null
    startup = []
    names = []
    // A new host is a new Run, and a file may have changed under its name since.
    textures.clear()
    fonts.clear()
    builtFonts.clear()
}

/**
 * Called by a bundle the site built, before any of the game's own code runs:
 * the first module the builder puts in it hands over the build's files.
 *
 * With it, a name resolves to `<base>/<sha256>/<name>`. That URL names its
 * bytes, so it is cached for good and served without looking the name up,
 * and a preview, a version and a rollback each load exactly their own
 * commit's files. A name the map lacks resolves as it always did.
 *
 * With `store`, a mapped name resolves there instead, to
 * `<store>/<sha256><ext>`: the hash and the name's own extension, lowercased,
 * which is how PlaySite's store keys a file. The extension stays in the URL
 * because Unity's loaders choose a decoder by it (AudioBridge.AudioTypeFor).
 */
export function setAssetMap(next: Record<string, AssetEntry> | null, options: { store?: string, startup?: readonly string[], names?: readonly string[] } = {}): void {
    files = next ?? {}
    names = next !== null ? Object.keys(next) : Array.isArray(options.names) ? options.names.filter((n) => typeof n === "string") : []
    store = typeof options.store === "string" && options.store !== "" ? options.store.replace(/\/+$/, "") : null
    startup = Array.isArray(options.startup) ? options.startup.filter((n) => typeof n === "string") : []
    textures.clear()
    fonts.clear()
    builtFonts.clear()
}

/** The files this build loads before the cart appears (oj.json's preload list); empty for most carts. */
export function startupFiles(): readonly string[] {
    return startup
}

/** A name's last extension, lowercased, dot included: ".png", ".json" for a sidecar. Empty when it has none. */
function extensionOf(name: string): string {
    const slash = name.lastIndexOf("/")
    const dot = name.lastIndexOf(".")
    return dot > slash ? name.slice(dot).toLowerCase() : ""
}

/** A file this build ships, or undefined: its hash and size, for a loading bar. */
export function assetInfo(name: string): { sha256: string, bytes: number } | undefined {
    const entry = files[cleanName(name)]
    return entry === undefined ? undefined : { sha256: entry[0], bytes: entry[1] }
}

/** Every name this build ships, from its file map or, built by ojplay, the cart's folder: what `preload("folder/")` opens. */
export function assetNames(): string[] {
    return [...names]
}

/** Leading "./" and "assets/" are what a web habit produces; both mean the name after them. */
function cleanName(name: string): string {
    return name.replace(/^\.\//, "").replace(/^assets\//, "")
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
    const clean = cleanName(name)

    if (base !== null) {
        const known = files[clean]
        if (known !== undefined) return store !== null ? `${store}/${known[0]}${extensionOf(clean)}` : `${base}/${known[0]}/${clean}`
    }
    if (base !== null) return usedCarts !== "" && clean.startsWith("@") ? `${base}/${usedCarts}/${clean}` : `${base}/${clean}`

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
export function loadTexture(name: string): Promise<Texture> {
    const url = assetUrl(name)
    let loading = textures.get(url)
    if (loading === undefined) {
        loading = loadImageAsync(url) as Promise<Texture>
        textures.set(url, loading)
        // Forgotten on failure, so a file added after the first ask still loads.
        loading.catch(() => { if (textures.get(url) === loading) textures.delete(url) })
    }
    return loading
}

/**
 * Lets go of a picture loadTexture holds, so its memory comes back: the next
 * ask loads it again. Whatever still shows it shows nothing after this, so
 * unload a level's art once the level has gone.
 */
export async function forgetTexture(name: string): Promise<void> {
    const url = assetUrl(name)
    const loading = textures.get(url)
    if (loading === undefined) return
    textures.delete(url)
    const texture = await loading.catch(() => null)
    const destroy = (globalThis as { CS?: any }).CS?.UnityEngine?.Object?.Destroy
    if (texture !== null && typeof destroy === "function") destroy(texture)
}

/**
 * The hook form, for the common case of a component that needs a sprite.
 *
 * Null until it arrives, so a caller renders nothing (or a placeholder) for the
 * frame or two the fetch takes. Loading is not cancelled on unmount, because
 * loadTexture shares one load per URL and a second mount would otherwise pay
 * for the same bytes again; the result is simply dropped.
 */
export function useTexture(name: string): Texture | null {
    const [texture, setTexture] = useState<Texture | null>(null)

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

// fonts

/**
 * Loads one of this game's fonts (a .ttf or .otf file), for text to draw with.
 * Apply it with `fontFamily`; a font on a container reaches every Text inside
 * it, as on the web:
 *
 *     const title = await loadFont("fonts/Display.ttf")
 *     <View style={{ fontFamily: title }}>...</View>
 *
 * The container fetches the file's bytes and builds a font from them, one per
 * file however many ask, so `preload` in oj.json covers fonts too.
 */
export function loadFont(name: string): Promise<Font> {
    const url = assetUrl(name)
    let loading = fonts.get(url)
    if (loading === undefined) {
        loading = fontFrom(url, name)
        fonts.set(url, loading)
        loading.then((font) => { if (fonts.get(url) === loading) builtFonts.set(url, font) }, () => {})
        // Forgotten on failure, so a file added after the first ask still loads.
        loading.catch(() => { if (fonts.get(url) === loading) fonts.delete(url) })
    }
    return loading
}

async function fontFrom(url: string, name: string): Promise<Font> {
    const load = globalThis.CS?.OneJS?.Network?.LoadFontFromUrl
    if (typeof load !== "function") throw new Error(`[oj] could not load ${name}: loading a font needs a OneJS newer than 3.9.18`)
    const font = await load(url)
    if (font === null || font === undefined) throw new Error(`[oj] could not load ${name} as a font (the console says why)`)
    return font as Font
}

/**
 * The hook form: the font, or null for the frame or two its file takes, when
 * text draws in the default face. A font already built, by `preload` or an
 * earlier ask, is there on the first render. As useTexture, not cancelled on
 * unmount.
 */
export function useFont(name: string): Font | null {
    const [font, setFont] = useState<Font | null>(() => builtFont(name))

    useEffect(() => {
        let live = true
        setFont(builtFont(name))
        loadFont(name).then(
            (loaded) => { if (live) setFont(loaded) },
            (error) => console.error(`[oj] could not load ${name}:`, error),
        )
        return () => { live = false }
    }, [name])

    return font
}

/** The font already built from a file, or null: what useFont's first render shows. */
export function builtFont(name: string): Font | null {
    return builtFonts.get(assetUrl(name)) ?? null
}

/** Lets go of a font loadFont holds, so its memory comes back; text using it draws in the default face. */
export async function forgetFont(name: string): Promise<void> {
    const url = assetUrl(name)
    const loading = fonts.get(url)
    if (loading === undefined) return
    fonts.delete(url)
    builtFonts.delete(url)
    const font = await loading.catch(() => null)
    const destroy = (globalThis as { CS?: any }).CS?.UnityEngine?.Object?.Destroy
    if (font !== null && typeof destroy === "function") destroy(font)
}

// flipbook

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


/**
 * One of this game's files as bytes, by the same name every other loader takes:
 * fetched where the file has an address, read from disk in a Unity project.
 */
export async function loadAssetBytes(name: string): Promise<Uint8Array> {
    const url = assetUrl(name)
    if (url.includes("://") || !isResolvedPath(url)) {
        const response = await (globalThis as any).fetch(url)
        if (!response.ok) throw new Error(`[oj] ${name}: ${url} answered ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
    }
    const CS = (globalThis as any).CS
    // The C# byte[] crosses once, as base64, rather than a crossing a byte.
    const binary: string = (globalThis as any).atob(CS.System.Convert.ToBase64String(CS.System.IO.File.ReadAllBytes(url)))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}

/** A path on disk, which only a Unity project hands back: absolute, with no scheme. */
function isResolvedPath(url: string): boolean {
    return url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url)
}

setFileLoader(loadAssetBytes)
