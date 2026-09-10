/**
 * A game running on this machine, and the handle a test script drives it by.
 *
 * `oj run` and `oj test` share everything up to the point where somebody
 * decides what to do with the running game: a person watches it, a script
 * reads it, clicks it and asserts.
 */
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { build, stageOf } from "./game.mjs"
import { ensureRuntime, serve } from "./local.mjs"
import { launch } from "./chrome.mjs"
import { siteOrigin, version } from "./site.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The CS proxy probing for optional members logs this on the way past; it is
// normal traffic, and every harness on the site filters it.
const NOISE = /Property not found/

/**
 * The running game.
 *
 * Positions are stage units, the coordinates the game lays itself out in,
 * unless a method says otherwise: a script written against a 600x600 stage
 * should not know or care how the window letterboxed it.
 */
export class Game {
    constructor({ root, browser, server, manifest, say }) {
        this.root = root
        this.browser = browser
        this.server = server
        this.manifest = manifest
        this.say = say
        /** Console lines that are errors, minus the proxy's probing noise. */
        this.errors = []
        browser.listeners.add((line) => {
            if (line.level === "error" && !NOISE.test(line.text)) this.errors.push(line.text)
        })
    }

    /** Every console line so far. */
    get console() {
        return this.browser.console
    }

    /** Waits for the container to report the game started, or throws what went wrong. */
    async ready(timeoutMs = 60000) {
        const until = Date.now() + timeoutMs
        while (Date.now() < until) {
            const line = this.browser.console.find((l) => l.text.startsWith("[oj-local] "))
            if (line) {
                this.browser.console.splice(this.browser.console.indexOf(line), 1)
                if (line.text.startsWith("[oj-local] ready")) return Number(line.text.split(" ")[2])
                throw new Error(line.text.slice("[oj-local] error ".length))
            }
            await sleep(100)
        }
        throw new Error(`the game did not start within ${timeoutMs / 1000}s`)
    }

    /** Rebuilds the folder and swaps the new bundle in, leaving the container up. Resolves to the swap time in ms. */
    async reload() {
        const built = await build(this.root)
        this.server.bundle = built.code
        await this.browser.eval("__ojLocal.reload()")
        return this.ready(15000)
    }

    /** Evaluates in the game's page. `__root`, `__ojPlay` and `CS` are there. */
    eval(expression) {
        return this.browser.eval(expression)
    }

    /**
     * The text on screen, top to bottom: what a player reads. Each element
     * with text contributes one line.
     */
    async read() {
        const out = await this.eval(`(() => {
            const lines = []
            // Only elements that carry text are asked for it: reading .text
            // on a plain VisualElement makes the CS proxy log a probe error.
            const textual = (el) => { try { return /Text|Label|Button/.test(String(el.__csType)) } catch { return false } }
            const walk = (el, d) => {
                if (!el || d > 16) return
                try { if (textual(el) && typeof el.text === "string" && el.text.length) lines.push(el.text) } catch {}
                let n = 0
                try { n = el.childCount || 0 } catch {}
                for (let i = 0; i < n; i++) { try { walk(el.hierarchy.ElementAt(i), d + 1) } catch {} }
            }
            walk(globalThis.__root, 0)
            return JSON.stringify(lines)
        })()`)
        return JSON.parse(out)
    }

    /** The stage layout the container is presenting: size, fit, scale and offset in the viewport. */
    async layout() {
        const text = await this.eval("JSON.stringify(__ojPlay.runtime.oj.stage)")
        const layout = JSON.parse(text)
        // The container lays out in CSS pixels of the canvas, which fills the
        // window, so a viewport point is a page point.
        return layout
    }

    /** A stage point as a page point. */
    async at(x, y) {
        const l = await this.layout()
        return { x: x * l.scaleX + l.offsetX, y: y * l.scaleY + l.offsetY }
    }

    async move(x, y, steps = 6) {
        const to = await this.at(x, y)
        const from = this.pointer ?? to
        for (let i = 1; i <= steps; i++) {
            await this.browser.mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
            await sleep(16)
        }
        this.pointer = to
    }

    /** Presses and releases at a stage point. */
    async click(x, y) {
        const p = await this.at(x, y)
        await this.browser.mouse("mouseMoved", p.x, p.y)
        await this.browser.mouse("mousePressed", p.x, p.y)
        await sleep(70)
        await this.browser.mouse("mouseReleased", p.x, p.y)
        this.pointer = p
    }

    /** Presses a stage point, drags to another over `steps` moves, releases. */
    async drag(x1, y1, x2, y2, steps = 8) {
        const a = await this.at(x1, y1)
        const b = await this.at(x2, y2)
        await this.browser.mouse("mouseMoved", a.x, a.y)
        await this.browser.mouse("mousePressed", a.x, a.y)
        this.browser.down = true
        for (let i = 1; i <= steps; i++) {
            await this.browser.mouse("mouseMoved", a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
            await sleep(30)
        }
        this.browser.down = false
        await this.browser.mouse("mouseReleased", b.x, b.y)
        this.pointer = b
    }

    /** Presses a key by DOM code (KeyA, Space, ArrowLeft, Enter) and releases it after `holdMs`. */
    async press(code, holdMs = 90) {
        await this.browser.key("keyDown", code)
        await sleep(holdMs)
        await this.browser.key("keyUp", code)
    }

    /** Holds a key down until `release` is called. */
    async hold(code) {
        await this.browser.key("keyDown", code)
        return () => this.browser.key("keyUp", code)
    }

    /** Types a string, one key per character; letters, digits and space only. */
    async type(text) {
        for (const ch of text) {
            const code = ch === " " ? "Space" : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : null
            if (code === null) throw new Error(`type() cannot press "${ch}"; use press() with a DOM code`)
            await this.press(code, 40)
            await sleep(30)
        }
    }

    wait(ms) {
        return sleep(ms)
    }

    /** Waits until `predicate()` resolves truthy, polling; throws with `what` after `timeoutMs`. */
    async until(predicate, { timeoutMs = 10000, what = "the condition", every = 100 } = {}) {
        const end = Date.now() + timeoutMs
        while (Date.now() < end) {
            const value = await predicate()
            if (value) return value
            await sleep(every)
        }
        throw new Error(`waited ${timeoutMs / 1000}s for ${what}`)
    }

    /** A screenshot of the page, PNG, written to `file` (default under .oj/). */
    shot(file = path.join(".oj", `shot-${Date.now()}.png`)) {
        return this.browser.screenshot(path.resolve(this.root, file))
    }
}

/**
 * Builds the folder, fetches the container, serves both and boots a browser.
 * Resolves to a started Game; the caller closes it.
 */
export async function start(root, { headless = true, window: size, runtime: pinned, say = () => {} } = {}) {
    const built = await build(root)
    say(`built ${built.entry}: ${(built.code.length / 1024).toFixed(1)} KB`)
    for (const w of built.warnings) say(`warning: ${w}`)

    const site = siteOrigin()
    const runtimeVersion = pinned ?? (await version()).runtime
    const runtime = await ensureRuntime(site, runtimeVersion, say)
    say(`runtime ${runtimeVersion}`)

    const stage = stageOf(built.manifest)
    const manifest = { name: built.manifest.name ?? path.basename(root), runtime: runtimeVersion, stage }
    const server = await serve({ runtime, root, manifest, bundle: () => server.bundle })
    server.bundle = built.code
    say(`serving ${server.url}`)

    let browser
    try {
        browser = await launch({ headless, window: size ?? (stage.fit === "fluid" ? [960, 540] : stage.size), say })
    } catch (error) {
        server.close()
        throw error
    }
    const game = new Game({ root, browser, server, manifest, say })
    await browser.navigate(server.url)
    return game
}

export function stop(game) {
    game.browser.close()
    game.server.close()
}

/**
 * Watches the folder and swaps a fresh build in on every change, debounced:
 * an editor save is several writes, and a build per write is a queue of
 * stale bundles.
 */
export function watch(root, game, say) {
    let timer = null
    let busy = false
    const trigger = () => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
            if (busy) return trigger()
            busy = true
            try {
                const ms = await game.reload()
                say(`reloaded in ${ms} ms`)
            } catch (error) {
                say(error.lines ? error.lines.join("\n") : `reload failed: ${error.message}`)
            } finally {
                busy = false
            }
        }, 150)
    }
    const watcher = fs.watch(root, { recursive: true }, (_, name) => {
        if (name && (name.startsWith(".") || name.includes("node_modules"))) return
        trigger()
    })
    return () => watcher.close()
}

/** Loads a test script and runs its default export against the game. */
export async function runScript(file, game) {
    const mod = await import(pathToFileURL(path.resolve(game.root, file)).href)
    const fn = mod.default
    if (typeof fn !== "function") throw new Error(`${file} must export a default async function (game) { ... }`)
    await fn(game)
}
