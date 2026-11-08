/**
 * `ojplay bake [script]`: the light files a cart names, written into it
 * (PlaySite docs/lightmapping.md §2).
 *
 * It runs the cart as `ojplay run` does, on this machine's GPU, drives it with
 * the script first when there is one (a level behind a menu), and waits until
 * every `scene.bake(name)` has ended. A bake that found its file current
 * leaves it alone; one that baked here is written under its name. The page
 * hears each named bake through the container's light host (LIGHT_RECORDER in
 * local.mjs), which is where these are read from.
 *
 * Exit 0 when every named file was written or was already current, 1 when one
 * failed or had not finished within `seconds`, and 3 when the cart named no
 * file, so nothing was compared.
 */
import fs from "node:fs"
import path from "node:path"
import { start as startGame, stop, runScript } from "./run.mjs"
import { validPath, RESERVED_ASSET_FOLDER } from "./assets.mjs"

/**
 * How long a cart has, once it is running and its script is done, to begin a
 * named bake before it counts as naming none. A cart names its bake when its
 * scene is built, a moment after its models load, not seconds later; waiting
 * the whole `--for` instead would hold every cart without a bake for a minute.
 */
export const FIRST_BAKE_SECONDS = 5

/** How long every named bake must have stayed ended before the wait is over, for a cart that bakes a second file once the first is done. */
export const SETTLE_MS = 1000

const POLL_MS = 100

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Runs the command. `start` is run.mjs's, replaceable for a test, and is
 * handed `options` (headless, window, runtime) with the GPU and a light host.
 * Resolves to the exit code.
 *
 * @param {string} root
 * @param {{ script?: string, seconds?: number, say?: (line: string) => void, start?: (root: string, options: object) => Promise<any>, options?: object }} [options]
 * @returns {Promise<number>}
 */
export async function bake(root, { script, seconds = 60, say = () => {}, start = startGame, options = {} } = {}) {
    if (!(seconds > 0)) throw new Error(`--for takes a number of seconds above 0, not ${seconds}`)
    if (script && !fs.existsSync(path.resolve(root, script))) throw new Error(`no script at ${path.resolve(root, script)}`)
    const game = await start(root, { ...options, gpu: true, light: true, say })
    // A signal ends the run through the same cleanup as a finish, as test's
    // does: the browser sits in its own process group on Mac and Linux.
    let signalled = null
    let onSignal
    const interrupted = new Promise((resolve) => {
        onSignal = (signal) => { signalled = signal; resolve(1) }
        process.once("SIGINT", onSignal)
        process.once("SIGTERM", onSignal)
    })
    try {
        const run = baking(root, game, { script, seconds, say })
        // Once the browser is closed under it, the run fails; that is not the news.
        run.catch(() => {})
        const code = await Promise.race([run, interrupted])
        if (signalled !== null) say(`interrupted by ${signalled}`)
        return code
    } finally {
        process.off("SIGINT", onSignal)
        process.off("SIGTERM", onSignal)
        stop(game)
    }
}

async function baking(root, game, { script, seconds, say }) {
    const ms = await game.ready()
    say(`cart started in ${ms} ms`)
    if (script) await runScript(script, game)
    if (await game.eval("typeof __ojContainer === \"object\" && typeof __ojContainer.setLightHost === \"function\"") !== true) {
        say(`runtime ${game.manifest.runtime} cannot tell a host about its bakes, so nothing can be written. Run against a runtime with scene.bake's light files (--runtime <version>).`)
        return 1
    }
    const bakes = await waitForBakes(game, seconds * 1000)
    if (bakes.length === 0) {
        say(`the cart named no light file: no scene.bake(name) began within ${Math.min(FIRST_BAKE_SECONDS, seconds)} s, so nothing was written`)
        return 3
    }
    // Checked before anything is written: a run that logged an error is not
    // one whose light is worth keeping. On WebGPU, Unity's texture readback
    // logs an error and reads black, and the file it gave was a valid PNG of
    // a black lightmap.
    if (game.errors.length > 0) {
        say(`${game.errors.length} console error(s), so nothing was written:`)
        for (const e of game.errors.slice(0, 10)) console.error("  " + e)
        return 1
    }
    let failed = 0
    for (const b of bakes) {
        const line = await settle(root, game, b, seconds)
        if (line.failed) failed++
        say(line.text)
    }
    return failed > 0 ? 1 : 0
}

/**
 * The named bakes, once each has ended and stayed ended for SETTLE_MS, or as
 * they stand when `timeoutMs` runs out. Empty when none began within
 * FIRST_BAKE_SECONDS.
 */
async function waitForBakes(game, timeoutMs) {
    const began = Date.now()
    const firstBy = began + Math.min(FIRST_BAKE_SECONDS * 1000, timeoutMs)
    const until = began + timeoutMs
    let said = ""
    let quietSince = Date.now()
    for (;;) {
        const now = Date.now()
        const text = String(await game.eval("__ojLocal.lights()"))
        if (text !== said) {
            said = text
            quietSince = now
        }
        const bakes = JSON.parse(text)
        if (bakes.length === 0 && now >= firstBy) return []
        if (bakes.length > 0 && bakes.every((b) => b.state !== "baking") && now - quietSince >= SETTLE_MS) return bakes
        if (now >= until) return bakes
        await sleep(POLL_MS)
    }
}

/** What became of one bake, as the line the command prints, writing its file when it baked here. */
async function settle(root, game, b, seconds) {
    const took = `${(b.ms / 1000).toFixed(1)} s`
    switch (b.state) {
        // "current" is what runtimes before 1.4.1 said for "loaded".
        case "loaded":
        case "current": {
            const file = path.join(root, b.name)
            const size = fs.existsSync(file) ? ` (${kb(fs.statSync(file).size)})` : ""
            return { failed: false, text: `${b.name}${size}: current, shown in ${took}, left as it is` }
        }
        case "baked": {
            const problem = nameProblem(b.name)
            if (problem !== null) return { failed: true, text: `${b.name}: baked in ${took}, not written: ${problem}` }
            const bytes = Buffer.from(String(await game.eval(`__ojLocal.lightFile(${JSON.stringify(b.name)})`)), "base64")
            if (bytes.length === 0) return { failed: true, text: `${b.name}: baked in ${took}, but the page kept no file to write` }
            writeAtomically(path.join(root, b.name), bytes)
            return { failed: false, text: `${b.name}: wrote ${kb(bytes.length)}, baked in ${took}` }
        }
        case "failed":
            return { failed: true, text: `${b.name}: failed: ${b.why}` }
        case "stopped":
            return { failed: true, text: `${b.name}: stopped before it finished, by a later scene.bake or the scene going` }
        default:
            return { failed: true, text: `${b.name}: not finished within ${seconds} s (--for to wait longer)` }
    }
}

/** Why `name` cannot be written into the cart as its light file, or null. Light files live beside the code, never in .oj/ or assets/. */
export function nameProblem(name) {
    if (!validPath(name)) return "a light file is named from the cart's root, in letters, digits, dots, dashes and underscores, with no .. or leading dot"
    if (!/\.png$/i.test(name)) return "a light file is a PNG, so its name ends in .png"
    if (name.startsWith(`${RESERVED_ASSET_FOLDER}/`)) return `${RESERVED_ASSET_FOLDER}/ is not a folder of the cart's own`
    return null
}

function writeAtomically(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const partial = `${file}.part`
    fs.writeFileSync(partial, bytes)
    fs.renameSync(partial, file)
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
