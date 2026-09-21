/**
 * The script that boots the container and loads a game into it.
 *
 * Two documents run a game: the sandbox document on a game's own origin, and
 * the page `oj run` serves on a developer's machine. They differ in where the
 * container's files are, how the bundle arrives, and whom they tell when the
 * game is up; they must not differ in how the container is booted and handed
 * the game, because that is the contract with the container app
 * (`__ojPlay.load`), and a copy of it that drifts fails only at runtime.
 *
 * So the boot is written once here, as source text a document inlines, with
 * the three differences as parameters. Each is a piece of JavaScript rather
 * than a value, because what varies is behaviour: `bundle` fetches a stored
 * file on one origin and asks a parent frame on another.
 */

/**
 * @param {object} options
 * @param {string} options.runtime  URL prefix of the container's files, no trailing slash
 * @param {object} options.manifest What `__ojPlay.load` is handed beside the source
 * @param {string} options.bundle   JS declaring `function bundle()` that resolves to the game's source
 * @param {string} options.report   JS declaring `function report(type, payload)`; type is "ready" (payload has ms) or "error" (payload has message)
 * @returns {string} the script body; the document supplies `canvas` (id c) and `status` (id s)
 */
export function containerBoot({ runtime, manifest, bundle, report }) {
    return `
const status = document.getElementById("s")
const canvas = document.getElementById("c")
const say = (m) => { if (status) status.textContent = m }
const manifest = ${JSON.stringify(manifest)}

/*
 * The bundle this document is running, kept so a host that swaps bundles (the
 * cover recorder, a local reload) can tell what is loaded and put it back.
 *
 * Deliberately not on globalThis. The container snapshots the globals it owns
 * and deletes everything else between games, so a global here is swept the
 * moment the next load runs and reads as a game that leaked state.
 */
let loadedSource = null

function load(src) {
    return new Promise((ok, no) => {
        const s = document.createElement("script")
        s.src = src; s.onload = ok; s.onerror = () => no(new Error("failed to load " + src))
        document.head.appendChild(s)
    })
}

/*
 * Keep Unity from asking for audio before anyone has touched the page.
 *
 * The container's framework does this, and it is Unity's code rather than
 * ours:
 *
 *     tryToResumeAudioContext = function () {
 *         if (WEBAudio.audioContext.state === "suspended")
 *             WEBAudio.audioContext.resume().catch(...)
 *         else Module.clearInterval(resumeInterval)
 *     }
 *     resumeInterval = Module.setInterval(tryToResumeAudioContext, 400)
 *
 * So it polls every 400ms until it succeeds. Chrome's autoplay policy refuses
 * every attempt made before the page has user activation, and prints a line
 * for each one. Measured on the live site: 47 identical warnings in a 20
 * second load of one sketch, 60 in 25 seconds, which was almost everything in
 * the console once the physics warnings went. Nothing is audible either way;
 * the browser was never going to allow it.
 *
 * RESOLVED RATHER THAN REJECTED, which is the part worth being careful about.
 * Unity attaches a .catch that logs "Could not resume audio context", so
 * rejecting would trade a browser warning for one of ours and change nothing.
 * Resolving without calling the real resume leaves the context suspended, so
 * Unity's poll keeps running and costs nothing, and the first gesture resumes
 * for real: the state flips, Unity's next tick clears its own interval, and
 * the patch takes itself off the prototype.
 *
 * On the page rather than in the container because this is about the document
 * Unity boots into, and it has to be in place before the loader runs.
 */
;(function deferAudioUntilGesture() {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Ctx || !Ctx.prototype || typeof Ctx.prototype.resume !== "function") return
    const EVENTS = ["pointerdown", "mousedown", "touchstart", "keydown"]
    const realResume = Ctx.prototype.resume
    const waiting = new Set()
    let activated = false

    Ctx.prototype.resume = function () {
        if (activated) return realResume.call(this)
        waiting.add(this)
        return Promise.resolve()
    }

    function wake() {
        if (activated) return
        activated = true
        Ctx.prototype.resume = realResume
        for (const ctx of waiting) {
            try { realResume.call(ctx) } catch (e) { /* closed, or never started */ }
        }
        waiting.clear()
        for (const type of EVENTS) removeEventListener(type, wake, true)
    }

    // Capture, so a handler that stops propagation cannot hide the gesture.
    for (const type of EVENTS) addEventListener(type, wake, true)
})()

${bundle}
${report}

/** Hands a bundle to the container. Negative means it did not start. */
function startGame(source) {
    const ms = globalThis.__ojPlay.load(source, manifest)
    if (ms >= 0) loadedSource = source
    return ms
}

;(async () => {
    try {
        // Started before the container, not after: the bundle and a 14 MB
        // runtime have no reason to wait for each other.
        const arriving = bundle()
        await load(${JSON.stringify(runtime + "/PlayContainer.loader.js")})
        await createUnityInstance(canvas, {
            dataUrl: ${JSON.stringify(runtime + "/PlayContainer.data")},
            frameworkUrl: ${JSON.stringify(runtime + "/PlayContainer.framework.js")},
            codeUrl: ${JSON.stringify(runtime + "/PlayContainer.wasm")},
            streamingAssetsUrl: ${JSON.stringify(runtime + "/StreamingAssets")},
            companyName: "OneJS", productName: "OneJS Play", productVersion: String(manifest.runtime ?? ""),
        }, (p) => say("loading runtime " + Math.round(p * 100) + "%"))

        say("starting")
        const source = await arriving

        // The container installs __ojPlay once its own app has run.
        const until = Date.now() + 15000
        while (typeof globalThis.__ojPlay === "undefined") {
            if (Date.now() > until) throw new Error("container never became ready")
            await new Promise((r) => setTimeout(r, 50))
        }

        const ms = startGame(source)
        if (ms < 0) throw new Error("the game failed to start")
        status && status.remove()
        canvas.focus()
        report("ready", { ms })
    } catch (e) {
        say(String(e && e.message ? e.message : e))
        report("error", { message: String(e && e.message ? e.message : e) })
    }
})()
`
}
