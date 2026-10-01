/**
 * A Chrome this machine already has, driven over the DevTools protocol.
 *
 * Raw CDP over the built-in WebSocket, no npm dependency: the same pattern the
 * site's own harnesses use, and everything a game needs is a handful of
 * methods. Headless by default; `--headed` opens a window a person can watch.
 */
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const CANDIDATES = {
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ],
    win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
    linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
}

/** The browser binary: OJ_CHROME, then the usual places. */
export function findChrome() {
    const named = process.env.OJ_CHROME ?? process.env.PLAYTEST_CHROME
    if (named) return named
    for (const candidate of CANDIDATES[process.platform] ?? CANDIDATES.linux) {
        if (path.isAbsolute(candidate)) {
            if (fs.existsSync(candidate)) return candidate
        } else {
            const found = spawnSync(process.platform === "win32" ? "where" : "which", [candidate], { encoding: "utf8" })
            if (found.status === 0) return found.stdout.trim().split(/\r?\n/)[0]
        }
    }
    throw new Error("No Chrome found. Install Google Chrome, or set OJ_CHROME to a Chromium-based browser binary.")
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * How long a browser may take to start and offer a page. Measured on the CI
 * runners (4 cores, Ubuntu and Windows, 2026-09-30): once one Chrome has run
 * on the machine, every start listed its page within 1.5 s, at any number of
 * runs at once. The first start on a fresh machine is another matter: 0.6 to
 * 32.4 s, and 32.4 s is past the 30 s this used to allow, which is how a sweep
 * failed on main with "offered no page". A person's first `ojplay run` after a
 * reboot pays the same. 90 s is 2.8 times that worst cold start.
 */
export const STARTUP_MS = 90000

/**
 * Launches a browser and attaches to its first page.
 *
 * Chrome picks the debugging port itself (`--remote-debugging-port=0`) and
 * writes it to DevToolsActivePort in the profile, so two runs on one machine
 * cannot collide. The profile is fresh and thrown away: nothing a game does
 * survives into the next run.
 */
/** The command line launch() starts Chrome with. */
export function chromeArgs({ headless, window, profile }) {
    return [
        ...(headless ? ["--headless=new"] : []),
        "--remote-debugging-port=0", `--user-data-dir=${profile}`,
        "--no-first-run", "--no-default-browser-check", "--mute-audio", "--disable-gpu-sandbox",
        // Chrome fetches its cookie key from the OS at the first navigation. On
        // macOS that is the keychain: with none under HOME it is a modal dialog
        // on the person's screen and Page.navigate waits until somebody clicks,
        // and with one it writes Chrome Safe Storage into their login keychain.
        // Linux has the same through the desktop's password store. A throwaway
        // profile needs neither.
        "--use-mock-keychain", "--password-store=basic",
        // Software rasteriser, deliberately: headless Chrome has no usable GPU
        // on the machines this has run on, and asking for the real one falls
        // back here anyway. A headed window gets whatever the desktop has.
        ...(headless ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
        `--window-size=${window[0]},${window[1]}`,
        "about:blank",
    ]
}

export async function launch({ headless = true, window = [960, 540], say = () => {}, profilePrefix = "oj-chrome-" } = {}) {
    // Checked before Chrome starts, so an old Node fails with the fix in hand
    // rather than "WebSocket is not defined" after starting a browser for nothing.
    if (typeof WebSocket !== "function") {
        throw new Error(`oj drives Chrome over Node's built-in WebSocket, which needs Node 22 or newer; this is Node ${process.versions.node}.`)
    }
    const binary = findChrome()
    // The prefix names this run's browsers and nothing else. A harness that
    // sweeps orphans with `pkill -f <prefix>` gives its own, so the sweep
    // cannot reach another session's Chrome.
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix))
    const args = chromeArgs({ headless, window, profile })
    const began = Date.now()
    const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32" })
    let stderr = ""
    child.stderr.on("data", (d) => { stderr += d })

    // One deadline for the whole start, generous on purpose (STARTUP_MS): a
    // run that fails here fails for a reason that has nothing to do with the
    // cart.
    const deadline = Date.now() + STARTUP_MS
    const portFile = path.join(profile, "DevToolsActivePort")
    let port = null
    while (port === null && Date.now() < deadline) {
        if (child.exitCode !== null) break
        try { port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]) } catch { await sleep(100) }
    }
    if (port === null) {
        discard(child, profile)
        throw new Error(`Chrome did not start (${binary}):\n${stderr.slice(-600)}`)
    }
    const portMs = Date.now() - began
    let page = null
    let last = "nothing yet"
    while (page === null && Date.now() < deadline) {
        try {
            const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
            page = list.find((t) => t.type === "page") ?? null
            last = `targets [${list.map((t) => t.type).join(", ")}]`
        } catch (error) {
            last = `list failed: ${error.message}`
        }
        if (page === null) await sleep(100)
    }
    if (page === null) {
        discard(child, profile)
        throw new Error(`Chrome started but offered no page to attach to within ${STARTUP_MS / 1000}s (port after ${seconds(portMs)}; last: ${last})`)
    }
    const pageMs = Date.now() - began

    // The start time, in a form a harness can read back: how close a run
    // under load comes to STARTUP_MS is the number that says whether it holds.
    say(`chrome ${headless ? "headless" : "headed"} ${window[0]}x${window[1]} (${path.basename(binary)}), port after ${seconds(portMs)}, page after ${seconds(pageMs)}`)
    const browser = new Browser(child, profile, page)
    // From here the browser is ours to close: a step that fails must not
    // leave it running with nobody holding its handle.
    try {
        await browser.open()
        // The page a person types into is the focused, visible tab. Headless
        // Chrome opens it visible but unfocused, and the first key event that
        // reaches it then flips document.visibilityState to "hidden": a hidden
        // page gets no requestAnimationFrame, so the container's frame loop stops
        // dead and everything after that key is lost. Found as Wordie's Enter
        // "never submitting" (#3); Escape, and letters or Enter sent without
        // text, did the same on a blank page. Activating the tab and emulating
        // focus keeps it the page a player would be on.
        await browser.send("Page.bringToFront")
        await browser.send("Emulation.setFocusEmulationEnabled", { enabled: true })
        // --window-size is the window; headless Chrome keeps a toolbar's worth of
        // it for itself, and a 600x600 window came back as a 600x457 viewport. The
        // viewport is what the game measures, so it is set here, exactly.
        if (headless) {
            await browser.send("Emulation.setDeviceMetricsOverride", { width: window[0], height: window[1], deviceScaleFactor: 1, mobile: false })
        }
    } catch (e) {
        browser.close()
        throw e
    }
    return browser
}

/** Stops Chrome and deletes its profile: every way out of a run, failed or not. */
function discard(child, profile) {
    kill(child)
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch { /* a locked profile is not worth failing over */ }
}

function kill(child) {
    try {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
        else process.kill(-child.pid, "SIGKILL")
    } catch { /* already gone */ }
}

/** A CDP session on one page, with the console kept. */
export class Browser {
    constructor(child, profile, page) {
        this.child = child
        this.profile = profile
        this.page = page
        this.id = 0
        this.pending = new Map()
        /** Every console line, as `{ level, text }`, in order. */
        this.console = []
        /** Listeners for console lines as they arrive. */
        this.listeners = new Set()
    }

    async open() {
        this.ws = new WebSocket(this.page.webSocketDebuggerUrl)
        this.ws.onmessage = (e) => this.receive(JSON.parse(e.data))
        await new Promise((ok, no) => { this.ws.onopen = ok; this.ws.onerror = () => no(new Error("CDP socket failed")) })
        await this.send("Runtime.enable")
        await this.send("Page.enable")
        await this.send("Log.enable")
    }

    receive(m) {
        if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); return }
        let line = null
        if (m.method === "Runtime.consoleAPICalled") {
            const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")
            line = { level: m.params.type === "warning" ? "warn" : m.params.type, text }
        } else if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails
            line = { level: "error", text: d.exception?.description ?? d.text }
        } else if (m.method === "Log.entryAdded") {
            // Network failures and the like: a 404 on an asset is an error
            // here and nowhere else.
            const e = m.params.entry
            line = { level: e.level === "warning" ? "warn" : e.level, text: `${e.source}: ${e.text}${e.url ? " " + e.url : ""}` }
        }
        if (line !== null) {
            // Unity ends every log with a newline of its own.
            line.text = line.text.replace(/\s+$/, "")
            this.console.push(line)
            for (const listener of this.listeners) listener(line)
        }
    }

    /**
     * A CDP call that gives up rather than hanging: an unanswered call would
     * leave node exiting on an empty event loop with nothing cleaned up, and
     * a browser left running keeps playing whatever it was in.
     *
     * Resolves to the raw protocol message, error and all, so a caller that
     * attaches to other targets (a game in a cross-origin frame is its own
     * target) can pass a sessionId and read what came back. `send` is the
     * unwrapped form for the common case.
     */
    call(method, params = {}, sessionId) {
        return new Promise((ok, no) => {
            const id = ++this.id
            const timer = setTimeout(() => { this.pending.delete(id); no(new Error(`CDP ${method} did not answer in 30s`)) }, 30000)
            this.pending.set(id, (m) => { clearTimeout(timer); ok(m) })
            this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
        })
    }

    async send(method, params = {}, sessionId) {
        const m = await this.call(method, params, sessionId)
        if (m.error) throw new Error(`${method}: ${m.error.message}`)
        return m.result
    }

    /** Evaluates in the page. Resolves to the value, or throws the exception's text. */
    async eval(expression) {
        const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
        return r.result?.value
    }

    navigate(url) {
        return this.send("Page.navigate", { url })
    }

    async screenshot(file) {
        const s = await this.send("Page.captureScreenshot", { format: "png" })
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, Buffer.from(s.data, "base64"))
        return file
    }

    async mouse(type, x, y, button = "left") {
        await this.send("Input.dispatchMouseEvent", {
            type, x, y, button: type === "mouseMoved" ? "none" : button,
            buttons: type === "mousePressed" || type === "mouseMoved" && this.down ? 1 : 0, clickCount: 1,
        })
    }

    async key(type, code) {
        await this.send("Input.dispatchKeyEvent", keyEvent(type, code))
    }

    close() {
        try { this.ws?.close() } catch { /* going anyway */ }
        discard(this.child, this.profile)
    }
}

const NAMED = {
    Space: [" ", 32, " "], Enter: ["Enter", 13, "\r"], NumpadEnter: ["Enter", 13, "\r"], Escape: ["Escape", 27], Backspace: ["Backspace", 8], Tab: ["Tab", 9],
    ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40],
    ShiftLeft: ["Shift", 16], ShiftRight: ["Shift", 16], ControlLeft: ["Control", 17], AltLeft: ["Alt", 18],
    Delete: ["Delete", 46], Home: ["Home", 36], End: ["End", 35], PageUp: ["PageUp", 33], PageDown: ["PageDown", 34],
}

/**
 * A DOM `code` (KeyA, Digit1, Space, ArrowLeft) as the key and virtual key
 * code Chrome wants beside it, plus the text the key types when it types
 * any: Enter types a carriage return, the way a real keyboard's does.
 */
export function keyOf(code) {
    if (NAMED[code]) return NAMED[code][2] === undefined
        ? { key: NAMED[code][0], vk: NAMED[code][1] }
        : { key: NAMED[code][0], vk: NAMED[code][1], text: NAMED[code][2] }
    let m = /^Key([A-Z])$/.exec(code)
    if (m) return { key: m[1].toLowerCase(), vk: m[1].charCodeAt(0), text: m[1].toLowerCase() }
    m = /^Digit(\d)$/.exec(code)
    if (m) return { key: m[1], vk: m[1].charCodeAt(0), text: m[1] }
    m = /^F(\d{1,2})$/.exec(code)
    if (m) return { key: code, vk: 111 + Number(m[1]) }
    throw new Error(`Unknown key code ${code}. Use DOM codes: KeyA, Digit1, Space, ArrowLeft, Enter.`)
}

/**
 * The CDP event for one key edge, shaped the way Chrome describes a real
 * keystroke: a key that types something goes down as `keyDown` carrying its
 * text, one that types nothing as `rawKeyDown` (Puppeteer's rule too).
 */
export function keyEvent(type, code) {
    const k = keyOf(code)
    const base = { key: k.key, code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }
    if (type !== "keyDown") return { type, ...base }
    return k.text === undefined
        ? { type: "rawKeyDown", ...base }
        : { type: "keyDown", ...base, text: k.text, unmodifiedText: k.text }
}
