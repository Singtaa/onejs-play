/**
 * Running a game on this machine: the container the site serves, fetched
 * once into a cache, and a local origin that plays the part the game's
 * sandbox origin plays in production.
 *
 * The container is the real one, byte for byte what play.onejs.com serves at
 * /runtime/<version>/, not a build of our own: the point of testing locally is
 * to test what ships. Those URLs are immutable, so a version fetched once is
 * good for ever.
 */
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { containerBoot } from "../host/boot.mjs"
import { gameCsp } from "../host/csp.mjs"
import { contentTypeOf, resolveAsset } from "./assets.mjs"
import { DEFAULT_SITE } from "./site.mjs"

/** The four files a container is. Mirrors RUNTIME_FILES in the site's staging script. */
export const RUNTIME_FILES = [
    "PlayContainer.loader.js",
    "PlayContainer.framework.js",
    "PlayContainer.wasm",
    "PlayContainer.data",
]

/**
 * A file under the container's StreamingAssets, from the site, or null when the
 * site has none. The container's own four files are fetched up front by
 * ensureRuntime; these are fetched when something asks for one.
 */
export function streamingFetcher(site, version) {
    return async (rel) => {
        const response = await fetch(`${site}/runtime/${version}/${rel}`)
        if (response.status === 404) return null
        if (!response.ok) throw new Error(`${response.status} from the site`)
        return Buffer.from(await response.arrayBuffer())
    }
}

export function home() {
    return process.env.OJ_HOME ?? path.join(os.homedir(), ".onejs-play")
}

export function runtimeDir(version) {
    return path.join(home(), "runtime", version)
}

/**
 * Makes sure the container for `version` is on disk, fetching what is
 * missing from the site. Reports each fetch through `say`.
 *
 * A file is written whole under its final name only once it has fully
 * arrived, so an interrupted fetch leaves nothing that looks complete. The
 * wasm's magic bytes are checked because a 404 page saved as a .wasm is the
 * kind of thing that fails much later with a message about nothing.
 */
export async function ensureRuntime(site, version, say = () => {}) {
    const dir = runtimeDir(version)
    fs.mkdirSync(dir, { recursive: true })
    for (const name of RUNTIME_FILES) {
        const file = path.join(dir, name)
        if (fs.existsSync(file)) continue
        const url = `${site}/runtime/${version}/${name}`
        say(`fetching ${url}`)
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${response.status} fetching ${url}`)
        const bytes = Buffer.from(await response.arrayBuffer())
        if (name.endsWith(".wasm") && bytes.subarray(0, 4).toString("latin1") !== "\0asm") {
            throw new Error(`${url} is not a wasm module (${bytes.length} bytes)`)
        }
        const partial = file + ".part"
        fs.writeFileSync(partial, bytes)
        fs.renameSync(partial, file)
        say(`  ${name}: ${(bytes.length / 1048576).toFixed(1)} MB`)
    }
    return dir
}

// Unity refuses a wasm served as octet-stream, and node ships no mime table.
// The container's own files only: assets take theirs from the site's table.
const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm",
    ".data": "application/octet-stream", ".json": "application/json",
}

/**
 * The document the game runs in. The same boot the site's sandbox document
 * performs: load the loader, create the Unity instance, wait for the
 * container to install __ojPlay, hand it the bundle and the manifest. What
 * the site posts to its parent frame, this prints to the console, which is
 * where the command line is listening.
 */
/**
 * The page's light host, for `ojplay bake`: it keeps each named bake the
 * container tells it of, by name, the newest start replacing an older one, and
 * the file a bake here finished with. The command line reads them through
 * `__ojLocal.lights()` and `__ojLocal.lightFile(name)`. Page-scoped rather
 * than global, since the container sweeps globals it did not make.
 */
export const LIGHT_RECORDER = `const lightBakes = new Map()
const lightHost = {
    begun(name) { lightBakes.set(name, { state: "baking", started: performance.now(), ms: 0, why: "", file: null }) },
    baked(light) { const bake = lightBakes.get(light.name); if (bake) bake.file = light.bytes },
    ended(name, end) {
        const bake = lightBakes.get(name)
        if (!bake) return
        bake.state = end.how
        bake.why = end.why || ""
        bake.ms = Math.round(performance.now() - bake.started)
    },
}
function lightsSaid() {
    return JSON.stringify([...lightBakes].map(([name, b]) => ({ name, state: b.state, why: b.why, ms: b.ms, bytes: b.file ? b.file.length : 0 })))
}
function lightFileSaid(name) {
    const file = lightBakes.has(name) ? lightBakes.get(name).file : null
    if (!file) return ""
    let binary = ""
    for (let i = 0; i < file.length; i += 0x8000) binary += String.fromCharCode(...file.subarray(i, i + 0x8000))
    return btoa(binary)
}`

/**
 * With `record`, the container records the pipelines the game draws (from
 * runtime 1.8; PlaySite/docs/proposals/pipeline-sets.md), and the command line
 * reads the game's set through `__ojLocal.pipelines()`. Set before the boot,
 * since the container reads it as it starts. An older container has no
 * recorder, and the read is null.
 */
const RECORD_PIPELINES = "globalThis.__ojRecordPipelines = true\n"
// This server answers /pipelines/, so the container may ask it for the game's set.
// It asks no host that does not say so: an older one's 404 is a console error.
const SERVES_PIPELINES = "globalThis.__ojGameSets = true\n"

function hostPage(manifest, { light = false, record = false } = {}) {
    const boot = containerBoot({
        runtime: "/runtime",
        manifest,
        bundle: `function bundle() {
    return fetch("/bundle.js?v=" + Date.now()).then((r) => {
        if (!r.ok) throw new Error("bundle " + r.status)
        return r.text()
    })
}`,
        report: `function report(type, payload) {
    console.log(type === "ready" ? "[oj-local] ready " + payload.ms : "[oj-local] error " + payload.message)
}`,
        ...(light ? { light: LIGHT_RECORDER } : {}),
    })
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(manifest.name ?? "oj")}</title>
<style>
    html, body { margin: 0; height: 100%; background: #14181d; overflow: hidden; overscroll-behavior: none; }
    #c { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
    #s { position: absolute; inset: 0; display: grid; place-items: center;
         color: #8a8a8a; font: 13px ui-monospace, monospace; pointer-events: none; }
</style>
</head>
<body>
<canvas id="c" tabindex="1"></canvas>
<div id="s">loading runtime</div>
<script>${SERVES_PIPELINES}${record ? RECORD_PIPELINES : ""}${boot}
// What the command line calls to swap in a new build without reloading the
// 14 MB behind it. Reports the way the boot does.
globalThis.__ojLocal = {
    async reload() {
        const source = await bundle()
        // Other code from here on, so a recorded set carries only this code's own shaders.
        if (globalThis.__ojPrewarm && globalThis.__ojPrewarm.mark) globalThis.__ojPrewarm.mark("swap")
        const ms = startGame(source)
        report(ms < 0 ? "error" : "ready", ms < 0 ? { message: "the cart failed to start" } : { ms })
        return ms
    },${light ? `
    // What ojplay bake reads: each named bake so far, and a finished one's file as base64.
    lights: lightsSaid,
    lightFile: lightFileSaid,` : ""}${record ? `
    // The game's pipeline set as JSON, or "null" before the container has one.
    pipelines: () => JSON.stringify(globalThis.__ojPrewarm && globalThis.__ojPrewarm.recorded ? globalThis.__ojPrewarm.recorded() : null),` : ""}
}
</script>
</body>
</html>`
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c])

/**
 * Serves the game the way its origin does: the host page at /, the container
 * under /runtime/, the current bundle at /bundle.js, and the game's assets
 * under /assets/, which is where `assetUrl()` looks, by the site's rule
 * (assets.mjs). Resolves to `{ url, close }`; `bundle` is read on every
 * request so a rebuild is one refetch. `refused` hears why each asset
 * request the site would 404 was refused. The host page carries the game
 * origin's Content Security Policy for `site`, so what the site would refuse
 * is refused here too. With `light`, the page keeps the named bakes the
 * container tells it of (LIGHT_RECORDER), for `ojplay bake`. With `record`, the
 * container records the game's pipelines (RECORD_PIPELINES). `pipelines` is
 * asked for a game's set by its container key, and answers its gzipped bytes or
 * null, which is served as the game's origin serves it, at
 * /pipelines/<key>.json.gz.
 */
export function serve({ runtime, root, manifest, bundle, site = DEFAULT_SITE, port = 0, refused = () => {}, fetchStreaming = null, light = false, record = false, pipelines = null }) {
    // When the browser first asked for the page, so a navigate that times out
    // can say whether the page was ever asked for, rather than leave a slow
    // machine, a slow server and a stuck browser reading the same.
    let pageAskedAt = null
    const server = http.createServer(async (req, res) => {
        const url = decodeURIComponent((req.url ?? "/").split("?")[0])
        const send = (code, body, type) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body) }
        if (url === "/") {
            pageAskedAt ??= Date.now()
            res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store", "content-security-policy": gameCsp(site) })
            return res.end(hostPage(manifest, { light, record }))
        }
        const set = /^\/pipelines\/([0-9a-f]{16,64})\.json\.gz$/.exec(url)
        if (set !== null) {
            const bytes = pipelines === null ? null : pipelines(set[1])
            // 204 as the site answers it: a 404 is a console error, and ojplay fails a run for one.
            if (bytes === null) { res.writeHead(204, { "cache-control": "no-store" }); return res.end() }
            return send(200, bytes, "application/gzip")
        }
        if (url === "/bundle.js") return send(200, bundle(), TYPES[".js"])
        // Chrome asks for one unprompted, and a 404 is logged as a network
        // error that a run would then be failed for.
        if (url === "/favicon.ico") return send(204, "", "image/x-icon")
        if (url.startsWith("/assets/")) {
            let name = url.slice("/assets/".length)
            let from = root
            // A used cart's file, asked for by its scoped oj under its key,
            // from where `ojplay add` fetched it. The key's own shape is checked
            // so it can only name a folder in .oj/carts.
            const used = /^(@[a-z0-9-]+)\/([a-z0-9-]+@[a-z0-9.]+)\/(.+)$/.exec(name)
            if (used !== null) {
                from = path.join(root, ".oj", "carts", used[1], used[2])
                name = used[3]
            }
            const asset = resolveAsset(from, name)
            if (asset.reason !== undefined) {
                refused(asset.reason)
                return send(404, asset.reason, "text/plain")
            }
            res.writeHead(200, { "content-type": contentTypeOf(name), "cache-control": "no-store" })
            return fs.createReadStream(asset.file).pipe(res)
        }
        const file = url.startsWith("/runtime/") ? path.join(runtime, url.slice("/runtime/".length)) : null
        if (file !== null && !url.includes("..") && !fs.existsSync(file) && fetchStreaming !== null && url.startsWith("/runtime/StreamingAssets/")) {
            // A file the engine or oj asks for by URL at runtime, such as the
            // physics engine's module: fetched from the site once, then kept
            // beside the container it belongs to.
            try {
                const bytes = await fetchStreaming(url.slice("/runtime/".length))
                if (bytes !== null) {
                    fs.mkdirSync(path.dirname(file), { recursive: true })
                    fs.writeFileSync(file + ".part", bytes)
                    fs.renameSync(file + ".part", file)
                }
            } catch (error) {
                return send(502, `could not fetch ${url}: ${error.message}`, "text/plain")
            }
        }
        if (file === null || url.includes("..") || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, "not found", "text/plain")
        res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" })
        fs.createReadStream(file).pipe(res)
    })
    return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
            resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close(), pageAskedAt: () => pageAskedAt })
        })
    })
}
