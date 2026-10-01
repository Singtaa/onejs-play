/**
 * Which of a cart's files the site serves as assets, and under what name.
 *
 * A cart asks for a sound or an image by name (`audio.load("pop.wav")`,
 * `assetUrl("art/bg.png")`), the runtime turns that into `/assets/<name>` on
 * the game's origin, and the site answers from the files the cart pushed.
 * `oj run` plays the part of that origin, so it has to answer the same
 * requests the same way, or a cart that sounds right here is silent live.
 * Before this it served any file under the cart's root by any name, and
 * two examples kept their sounds in an `assets/` folder that the site never
 * serves (#3).
 *
 * The rule is the site's, copied, for the reason cli/game.mjs copies SOURCE:
 * a published npm package cannot import the Worker's source. The functions
 * below mirror PlaySite/src/media.ts (ASSET_TYPES, UPLOADABLE_IMAGE,
 * validPath, validSitePath, validAssetName, isUploadableAsset) and its serving
 * path, PlaySite/src/routes/assets.ts serveGameAsset. A git push stores a file
 * as an asset when isUploadableAsset(path) holds (PlaySite/src/git/policy.ts);
 * the origin serves a name only when validAssetName(name) holds. So a name
 * resolves here exactly when both hold and the file is there under that
 * exact name.
 */
import fs from "node:fs"
import path from "node:path"

/** Every extension an asset may have, and its content type. PlaySite ASSET_TYPES. */
export const ASSET_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}

/** The images the site will store: narrower than the ones it can name. PlaySite UPLOADABLE_IMAGE. */
export const UPLOADABLE_IMAGE = new Set([".png", ".jpg", ".jpeg"])

/** The one folder an asset may not sit in: the runtime strips a leading `assets/` from every name. */
export const RESERVED_ASSET_FOLDER = "assets"

/** The one dot folder a cart's files may sit in. */
export const OJ_FOLDER = ".oj"

export const VALID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const MAX_NAME_LENGTH = 120
export const MAX_PATH_DEPTH = 6

const extOf = (name) => {
    const dot = name.lastIndexOf(".")
    return dot < 0 ? "" : name.slice(dot).toLowerCase()
}

export function isAssetName(name) {
    return extOf(name) in ASSET_TYPES || isSidecar(name)
}

/** A flipbook's sidecar, served beside its sheet. PlaySite isSidecar. */
export function isSidecar(name) {
    return /\.sheet\.json$/i.test(name)
}

/** Whether the site would STORE these bytes: every asset type, except images other than png and jpeg. */
export function isUploadableAsset(name) {
    const type = ASSET_TYPES[extOf(name)]
    if (type === undefined) return false
    return !type.startsWith("image/") || UPLOADABLE_IMAGE.has(extOf(name))
}

export function validPath(name) {
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false
    if (name.includes("..")) return false
    const segments = name.split("/")
    if (segments.length > MAX_PATH_DEPTH) return false
    return segments.every((segment) => VALID_SEGMENT.test(segment))
}

export function validSitePath(name) {
    if (name.length > MAX_NAME_LENGTH) return false
    const prefix = `${OJ_FOLDER}/`
    if (!name.startsWith(prefix)) return validPath(name)
    return validPath(name.slice(prefix.length))
}

export function validAssetName(name) {
    if (name.startsWith(`${RESERVED_ASSET_FOLDER}/`)) return false
    return validSitePath(name) && isAssetName(name)
}

/** Content type for a served asset. */
export function contentTypeOf(name) {
    if (isSidecar(name)) return "application/json; charset=utf-8"
    return ASSET_TYPES[extOf(name)] ?? "application/octet-stream"
}

/**
 * The file `/assets/<name>` answers with, or why there is none, as
 * `{ file }` or `{ reason }`. The reason is written for the person running
 * the cart: it says what the site would do and what to change.
 */
export function resolveAsset(root, name) {
    if (!validAssetName(name)) {
        if (name.startsWith(`${RESERVED_ASSET_FOLDER}/`)) {
            return { reason: `${name}: the site never serves a file inside an assets/ folder. Move it to ${name.slice(RESERVED_ASSET_FOLDER.length + 1)} and ask for it by that name.` }
        }
        if (!isAssetName(name)) {
            return { reason: `${name}: not an asset type the site serves (${Object.keys(ASSET_TYPES).join(" ")}).` }
        }
        return { reason: `${name}: not a name the site accepts (letters, digits, . _ - in each part, at most ${MAX_PATH_DEPTH} levels, ${MAX_NAME_LENGTH} characters).` }
    }
    if (!isUploadableAsset(name) && !isSidecar(name)) {
        return { reason: `${name}: the site does not store ${extOf(name)} images; convert it to png or jpg.` }
    }
    const file = exactFile(root, name)
    if (file === null) {
        const loose = path.join(root, ...name.split("/"))
        const hint = exactFile(root, `${RESERVED_ASSET_FOLDER}/${name}`) !== null
            ? ` There is one at ${RESERVED_ASSET_FOLDER}/${name}, which the site never serves: move it up to ${name}.`
            : fs.existsSync(loose) ? " A file matches it only ignoring case, and the site's names are case-sensitive." : ""
        return { reason: `${name}: no such file in the cart.${hint}` }
    }
    return { file }
}

/**
 * The file at `name` under `root` when every segment matches an entry's name
 * exactly. A Mac or Windows disk would open `Pop.wav` for `pop.wav`; the site
 * would not, so neither does this.
 */
function exactFile(root, name) {
    let dir = root
    const segments = name.split("/")
    for (let i = 0; i < segments.length; i++) {
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
        const entry = entries.find((e) => e.name === segments[i])
        if (entry === undefined) return null
        const last = i === segments.length - 1
        if (last ? !entry.isFile() : !entry.isDirectory()) return null
        dir = path.join(dir, entry.name)
    }
    return dir
}

/**
 * Asset files in the cart that no request can reach, one line each: what
 * the site does with the file, and what to change. Empty when every asset
 * would be served. Walks what a push would carry: node_modules is skipped,
 * and dot folders other than `.oj/`, and `.oj/carts/`, which holds the carts
 * this one uses as `oj add` fetched them: their files are theirs, served
 * under their own key.
 */
export function unservableAssets(root) {
    const problems = []
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === "node_modules") continue
            if (entry.name.startsWith(".") && !(prefix === "" && entry.name === OJ_FOLDER)) continue
            const rel = prefix + entry.name
            if (entry.isDirectory() && rel === `${OJ_FOLDER}/carts`) continue
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + "/")
            else if (entry.isFile() && isAssetName(rel)) {
                const { reason } = resolveAsset(root, rel)
                if (reason !== undefined) problems.push(reason)
            }
        }
    }
    walk(root, "")
    return problems
}
