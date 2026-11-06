/**
 * What `ojplay` does differently when it is the copy `npm install -g ojplay` put
 * on the PATH (Sai, 1 Oct 2026).
 *
 * Hand-off: inside a cart or project that has its own ojplay in node_modules,
 * the global ojplay runs that one instead, so the version that builds the cart
 * is the one its package.json chose. Said once, in --help.
 *
 * Update notice: at most once a day, one line, and only when npm has a newer
 * ojplay than this one. The check runs in the background of one command and the
 * line prints at the end of a later one, so no command waits on npm; when
 * npm cannot be reached, nothing is said.
 */
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { BIN, INSTALL, PACKAGE } from "../build/command.mjs"
import { parse } from "./args.mjs"
import { home } from "./local.mjs"

const SELF = fs.realpathSync(path.join(import.meta.dirname, "oj.mjs"))
const OWN = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version
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
 *
 * A flag this ojplay knows and the copy does not is refused here, before the
 * copy runs, naming both versions: `push --unlisted` handed to a 0.14.0 that
 * has no --unlisted would otherwise be the copy's to judge, and a cart whose
 * first push was meant Unlisted must never be pushed Public (learn Mac, 6 Nov
 * 2026). Refused rather than run here: the hand-off exists so the version the
 * cart's package.json chose is the one that builds it. Answers true when it
 * refused too, with the exit code set, since nothing else should run.
 */
export async function handOff(root, argv = process.argv.slice(2), { say = (l) => console.error(`[${BIN}] ${l}`) } = {}) {
    if (process.env.OJPLAY_HANDED_OFF === "1") return false
    const local = localCopy(root)
    if (local === null) return false
    const unknown = await unknownToCopy(local, argv)
    if (unknown !== null) {
        say(unknown)
        process.exitCode = 1
        return true
    }
    process.env.OJPLAY_HANDED_OFF = "1"
    await import(pathToFileURL(local).href)
    return true
}

/**
 * Why the copy at `local` (its cli/oj.mjs) cannot take `argv`, or null. Asked
 * of the copy's own reader, which every copy since 0.10.0 exports; a copy
 * without one cannot say which flags it knows, so any flag is refused.
 */
export async function unknownToCopy(local, argv) {
    let ours
    try { ours = parse(argv) } catch { return null } // ours refuses it too: the copy will say so
    const flags = Object.keys(ours.flags)
    if (flags.length === 0) return null
    const pkg = path.join(path.dirname(local), "..", "package.json")
    let version = "an unknown version"
    try { version = JSON.parse(fs.readFileSync(pkg, "utf8")).version ?? version } catch { /* no package.json: said as unknown */ }
    const update = `update it with npm install ${PACKAGE}@latest in the cart, or leave the flag out`
    let theirs
    try { theirs = (await import(pathToFileURL(path.join(path.dirname(local), "args.mjs")).href)).parse } catch { theirs = undefined }
    if (typeof theirs !== "function") {
        return `this cart's ${PACKAGE} is ${version}, which cannot say whether it knows ${flags.map((f) => `--${f}`).join(" ")}. Nothing ran: ${update}`
    }
    try {
        theirs(argv)
        return null
    } catch (error) {
        const flag = /^unknown flag (\S+)/.exec(String(error?.message))?.[1]
        if (flag === undefined) return null // its own complaint about a value: the copy will say it
        const here = version === OWN ? "" : ` (this ${BIN} is ${OWN})`
        return `this cart's ${PACKAGE} is ${version}, which has no ${flag}${here}. Nothing ran: ${update}`
    }
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
