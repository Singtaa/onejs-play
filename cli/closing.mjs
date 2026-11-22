/**
 * Closing a run, step by step: each step timed, and each one given CLOSE_MS
 * to finish. A run that has its verdict must still exit with it: on 22 Nov a
 * windows-latest run printed "[ojplay] passed" at 75 s and then did not exit
 * for 111 s, until the sweep killed it, and nothing said which step held it
 * (onejs-play CI 45000236450). A step that does not finish is said as hung,
 * with what it left behind, and the exit code stays the run's verdict. The
 * sweep fails a run that says so (closingHung), so the time limit cannot turn
 * a hung close into a pass.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"

/** A close with a step slower than this is said, step by step. */
export const SLOW_MS = 2000

/** How long one step of a close may take before it is given up on and said as hung. */
export const CLOSE_MS = 20_000

/** How the line for a close that did not finish begins. */
export const HUNG = "closing hung:"

/** Thrown inside a step that did not finish, naming what it left. */
export class Hung extends Error {}

/** The steps of one close, in order, each with its length and why it hung, if it did. */
export class Closing {
    constructor(now = Date.now) {
        this.now = now
        /** @type {{ name: string, ms: number, hung: string | null }[]} */
        this.steps = []
    }

    /** Runs a step that is synchronous. A Hung it throws is kept as the step's; any other error goes on. */
    step(name, fn) {
        const began = this.now()
        try {
            fn()
            this.done(name, began, null)
        } catch (error) {
            if (!(error instanceof Hung)) throw error
            this.done(name, began, error.message)
        }
    }

    /** Runs a step that returns a promise, as step() does. */
    async stepAsync(name, fn) {
        const began = this.now()
        try {
            await fn()
            this.done(name, began, null)
        } catch (error) {
            if (!(error instanceof Hung)) throw error
            this.done(name, began, error.message)
        }
    }

    done(name, began, hung) {
        const ms = this.now() - began
        // A synchronous step cannot be stopped from outside, only timed; one that took past the limit hung all the same.
        this.steps.push({ name, ms, hung: hung ?? (ms > CLOSE_MS ? `took ${(ms / 1000).toFixed(1)} s, past ${CLOSE_MS / 1000} s` : null) })
    }

    /** The line to print after a close, or null when every step was quick. */
    line() {
        const lengths = this.steps.map((s) => `${s.name} ${(s.ms / 1000).toFixed(1)} s`).join(", ")
        const hung = this.steps.filter((s) => s.hung !== null)
        if (hung.length > 0) return `${HUNG} ${hung.map((s) => `${s.name}: ${s.hung}`).join("; ")} (${lengths})`
        return this.steps.some((s) => s.ms > SLOW_MS) ? `closing: ${lengths}` : null
    }
}

/** The line of `oj test`'s output that says its close hung, or null. What the sweep fails a run on. */
export function closingHung(output) {
    return output.split("\n").find((line) => line.includes(`[ojplay] ${HUNG}`))?.trim() ?? null
}

/** Runs `command` as spawnSync does, for at most `timeoutMs`. `timedOut` says it was stopped. */
export function bounded(command, args, options = {}, timeoutMs = CLOSE_MS) {
    const result = spawnSync(command, args, { ...options, timeout: timeoutMs, killSignal: "SIGKILL" })
    return { ...result, timedOut: result.error?.code === "ETIMEDOUT" }
}

/** Deletes `dir`, giving up after `timeoutMs` with a Hung that says where it was left. A locked file is not a failure. */
export async function removeWithin(dir, timeoutMs = CLOSE_MS) {
    let timer
    const removed = fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).then(() => false, () => false)
    const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(true), timeoutMs) })
    const late = await Promise.race([removed, gaveUp])
    clearTimeout(timer)
    if (late) throw new Hung(`not deleted in ${timeoutMs / 1000} s; left at ${dir}`)
}

/**
 * The processes still running whose command line names `marker`, a run's
 * profile folder, which every process of its Chrome is given: what a kill
 * left. Each is its pid and its kind (Chrome's --type, "main" for the
 * browser process itself).
 */
export function left(marker) {
    try {
        let rows
        if (process.platform === "win32") {
            const quoted = marker.replace(/'/g, "''")
            const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${quoted}') } | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`
            rows = bounded("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }, 15_000).stdout ?? ""
        } else {
            rows = bounded("ps", ["-axww", "-o", "pid=,args="], { encoding: "utf8" }, 10_000).stdout ?? ""
        }
        const found = rows.split("\n").map((row) => row.trim()).filter((row) => row !== "" && row.includes(marker))
            .map((row) => {
                const pid = row.split(/\s+/, 1)[0]
                return `${pid} ${/--type=(\S+)/.exec(row)?.[1] ?? "main"}`
            })
        return found.length === 0 ? "nothing" : found.join(", ")
    } catch {
        return "could not be listed"
    }
}
