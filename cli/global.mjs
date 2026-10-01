/**
 * What `ojp` does differently when it is the copy `npm install -g ojp` put
 * on the PATH (Sai, 1 Oct 2026).
 *
 * Hand-off: inside a cart or project that has its own ojp in node_modules,
 * the global ojp runs that one instead, so the version that builds the cart
 * is the one its package.json chose. Said once, in --help.
 *
 * Update notice: at most once a day, one line, and only when npm has a newer
 * ojp than this one. The check runs in the background of one command and the
 * line prints at the end of a later one, so no command waits on npm; when
 * npm cannot be reached, nothing is said.
 */
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { BIN, INSTALL, PACKAGE } from "../build/command.mjs"
import { home } from "./local.mjs"

const SELF = fs.realpathSync(path.join(import.meta.dirname, "oj.mjs"))
const DAY = 24 * 60 * 60 * 1000

/** The cart's own copy of this CLI, from `root` upward, when it is not this one. */
export function localCopy(root) {
    for (let at = path.resolve(root); ; at = path.dirname(at)) {
        const candidate = path.join(at, "node_modules", ...PACKAGE.split("/"), "cli", "oj.mjs")
        if (fs.existsSync(candidate)) {
            const real = fs.realpathSync(candidate)
            return real === SELF ? null : real
        }
        if (path.dirname(at) === at) return null
    }
}

/**
 * Runs the cart's own copy in this process when there is one, and answers
 * whether it did. The copy sees the same argv; the flag keeps it from
 * looking again.
 */
export async function handOff(root) {
    if (process.env.OJP_HANDED_OFF === "1") return false
    const local = localCopy(root)
    if (local === null) return false
    process.env.OJP_HANDED_OFF = "1"
    await import(pathToFileURL(local).href)
    return true
}

/** "0.9.2" > "0.9.10"? Numerically, part by part; a pre-release tag is not news. */
export function newer(latest, own) {
    if (typeof latest !== "string" || !/^\d+\.\d+\.\d+$/.test(latest)) return false
    const a = latest.split(".").map(Number), b = own.split(".").map(Number)
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
    return false
}

/**
 * Starts the daily check and arranges the line, for a run of the global
 * copy at a terminal. `now` and `fetchLatest` are for tests.
 */
export function updateNotice(own, { now = Date.now(), fetchLatest = latestOnNpm, print = (l) => console.error(l), file = path.join(home(), "update.json") } = {}) {
    let state = {}
    try { state = JSON.parse(fs.readFileSync(file, "utf8")) } catch { /* first run, or unreadable: start over */ }
    const save = (next) => {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, JSON.stringify(next) + "\n")
        } catch { /* a read-only home: no notice, no harm */ }
    }
    const checking = now - (state.checkedAt ?? 0) >= DAY
        ? fetchLatest().then((latest) => { if (latest !== null) { state = { ...state, checkedAt: now, latest }; save(state) } }, () => {})
        : Promise.resolve()
    const tell = () => {
        if (!newer(state.latest, own) || now - (state.toldAt ?? 0) < DAY) return
        print(`[${BIN}] ${PACKAGE} ${state.latest} is out (this is ${own}): ${INSTALL}`)
        state = { ...state, toldAt: now }
        save(state)
    }
    return { checking, tell }
}

async function latestOnNpm() {
    try {
        const response = await fetch(`https://registry.npmjs.org/${PACKAGE.replace("/", "%2f")}/latest`, { signal: AbortSignal.timeout(3000) })
        if (!response.ok) return null
        const body = await response.json()
        return typeof body.version === "string" ? body.version : null
    } catch {
        return null
    }
}
