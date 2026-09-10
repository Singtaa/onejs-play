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

/** The four files a container is. Mirrors RUNTIME_FILES in the site's staging script. */
export const RUNTIME_FILES = [
    "PlayContainer.loader.js",
    "PlayContainer.framework.js",
    "PlayContainer.wasm",
    "PlayContainer.data",
]

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
const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm",
    ".data": "application/octet-stream", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
    ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2", ".ttf": "font/ttf",
}

/**
 * The document the game runs in. The same boot the site's sandbox document
 * performs: load the loader, create the Unity instance, wait for the
 * container to install __ojPlay, hand it the bundle and the manifest. What
 * the site posts to its parent frame, this prints to the console, which is
 * where the command line is listening.
 */
function hostPage(manifest) {
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
<script>
const status = document.getElementById("s")
const canvas = document.getElementById("c")
const say = (m) => { if (status) status.textContent = m }
const manifest = ${JSON.stringify(manifest)}
const load = (src) => new Promise((ok, no) => {
    const s = document.createElement("script")
    s.src = src; s.onload = ok; s.onerror = () => no(new Error("failed to load " + src))
    document.head.appendChild(s)
})
const bundle = () => fetch("/bundle.js?v=" + Date.now()).then((r) => {
    if (!r.ok) throw new Error("bundle " + r.status)
    return r.text()
})
// What the command line calls to swap in a new build without reloading the
// 14 MB behind it. Returns the container's own measure of the swap.
globalThis.__ojLocal = {
    async reload() {
        const source = await bundle()
        const ms = globalThis.__ojPlay.load(source, manifest)
        console.log(ms < 0 ? "[oj-local] error the game failed to start" : "[oj-local] ready " + ms)
        return ms
    },
}
;(async () => {
    try {
        const arriving = bundle()
        await load("/runtime/PlayContainer.loader.js")
        await createUnityInstance(canvas, {
            dataUrl: "/runtime/PlayContainer.data",
            frameworkUrl: "/runtime/PlayContainer.framework.js",
            codeUrl: "/runtime/PlayContainer.wasm",
            streamingAssetsUrl: "/runtime/StreamingAssets",
            companyName: "OneJS", productName: "OneJS Play", productVersion: manifest.runtime,
        }, (p) => say("loading runtime " + Math.round(p * 100) + "%"))
        say("starting")
        const source = await arriving
        const until = Date.now() + 15000
        while (typeof globalThis.__ojPlay === "undefined") {
            if (Date.now() > until) throw new Error("container never became ready")
            await new Promise((r) => setTimeout(r, 50))
        }
        const ms = globalThis.__ojPlay.load(source, manifest)
        if (ms < 0) throw new Error("the game failed to start")
        status && status.remove()
        canvas.focus()
        console.log("[oj-local] ready " + ms)
    } catch (e) {
        say(String(e && e.message ? e.message : e))
        console.log("[oj-local] error " + String(e && e.message ? e.message : e))
    }
})()
</script>
</body>
</html>`
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c])

/**
 * Serves the game the way its origin does: the host page at /, the container
 * under /runtime/, the current bundle at /bundle.js, and the game's own files
 * under /assets/, which is where `assetUrl()` looks. Resolves to `{ url,
 * close }`; `bundle` is read on every request so a rebuild is one refetch.
 */
export function serve({ runtime, root, manifest, bundle, port = 0 }) {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent((req.url ?? "/").split("?")[0])
        const send = (code, body, type) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body) }
        if (url === "/") return send(200, hostPage(manifest), TYPES[".html"])
        if (url === "/bundle.js") return send(200, bundle(), TYPES[".js"])
        // Chrome asks for one unprompted, and a 404 is logged as a network
        // error that a run would then be failed for.
        if (url === "/favicon.ico") return send(204, "", "image/x-icon")
        let file = null
        if (url.startsWith("/runtime/")) file = path.join(runtime, url.slice("/runtime/".length))
        else if (url.startsWith("/assets/")) file = path.join(root, url.slice("/assets/".length))
        if (file === null || url.includes("..") || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, "not found", "text/plain")
        res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" })
        fs.createReadStream(file).pipe(res)
    })
    return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
            resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })
        })
    })
}
