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
