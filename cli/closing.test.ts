import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { discard } from "./chrome.mjs"
import { CLOSE_MS, Closing, HUNG, Hung, closingHung, removeWithin } from "./closing.mjs"
import { makeTemp } from "./temp.mjs"
import { cleanCommit } from "./pipelines.mjs"

/** A process that never exits by itself, its command line naming `profile` as Chrome's do. */
function neverDies(profile: string) {
    return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", `--user-data-dir=${profile}`], { stdio: "ignore", detached: process.platform !== "win32" })
}

/** A kill command that never returns, as taskkill did not on windows-latest (22 Nov). */
const KILL_HANGS: [string, string[]] = [process.execPath, ["-e", "setInterval(() => {}, 1000)"]]

const started: { kill: () => void }[] = []
afterEach(() => {
    for (const child of started.splice(0)) child.kill()
})

describe("closing a run", () => {
    it("says nothing when every step is quick", () => {
        let t = 0
        const closing = new Closing(() => t)
        closing.step("chrome", () => { t += 300 })
        closing.step("profile", () => { t += 100 })
        expect(closing.line()).toBe(null)
    })

    it("says each step's length when one is slow", () => {
        let t = 0
        const closing = new Closing(() => t)
        closing.step("chrome", () => { t += 3100 })
        closing.step("profile", () => { t += 200 })
        expect(closing.line()).toBe("closing: chrome 3.1 s, profile 0.2 s")
        expect(closingHung(`[ojplay] passed\n[ojplay] ${closing.line()}\n`)).toBe(null)
    })

    it("says a step that did not finish as hung, by name, and the sweep reads it", () => {
        let t = 0
        const closing = new Closing(() => t)
        closing.step("chrome", () => { t += CLOSE_MS; throw new Hung("chrome did not exit; left: 41 main") })
        closing.step("profile", () => { t += 100 })
        expect(closing.line()).toBe(`${HUNG} chrome: chrome did not exit; left: 41 main (chrome 20.0 s, profile 0.1 s)`)
        expect(closingHung(`[ojplay] passed\n[ojplay] ${closing.line()}\n`)).toBe(`[ojplay] ${closing.line()}`)
    })

    it("counts a synchronous step that took past the limit as hung, since it could not be stopped", () => {
        let t = 0
        const closing = new Closing(() => t)
        closing.step("profile", () => { t += CLOSE_MS + 900 })
        expect(closing.line()).toMatch(new RegExp(`^${HUNG} profile: took 20\\.9 s, past 20 s`))
    })

    it("lets an error that is not a hang go on", () => {
        const closing = new Closing()
        expect(() => closing.step("chrome", () => { throw new Error("own") })).toThrow("own")
    })

    it("gives up on a folder that is not deleted in time, and says where it was left", async () => {
        const dir = makeTemp("oj-close-")
        try {
            const closing = new Closing()
            const slow = fs.promises.rm
            // A delete that never finishes, as one held by a process that will not let go.
            fs.promises.rm = () => new Promise(() => {})
            try {
                await closing.stepAsync("profile", () => removeWithin(dir, 50))
            } finally {
                fs.promises.rm = slow
            }
            expect(closing.line()).toMatch(new RegExp(`^${HUNG} profile: not deleted in 0.05 s; left at `))
            expect(closing.line()).toContain(dir)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    // A git that never answers, first on PATH. Windows' spawn finds no script
    // of this kind without a shell, so it is asked where it can be.
    it.skipIf(process.platform === "win32")("gives up on a git that does not answer, naming it", () => {
        const bin = makeTemp("oj-close-git-")
        const was = process.env.PATH
        try {
            fs.writeFileSync(path.join(bin, "git"), "#!/bin/sh\nexec sleep 60\n", { mode: 0o755 })
            process.env.PATH = `${bin}${path.delimiter}${was}`
            const closing = new Closing()
            const began = Date.now()
            closing.step("record", () => { cleanCommit(bin, { timeoutMs: 300 }) })
            expect(Date.now() - began).toBeLessThan(5000)
            expect(closing.line()).toMatch(new RegExp(`^${HUNG} record: git rev-parse did not answer in 0.3 s`))
        } finally {
            process.env.PATH = was
            fs.rmSync(bin, { recursive: true, force: true })
        }
    })

    it("returns with the verdict when Chrome does not die, naming what it left", async () => {
        const profile = makeTemp("oj-close-profile-")
        const child = neverDies(profile)
        started.push(child)
        await new Promise((resolve) => setTimeout(resolve, 300))
        expect(child.exitCode, "the child that never dies has died, so this test would measure nothing").toBe(null)
        const began = Date.now()
        const closing = new Closing()
        await discard(child, profile, closing, { killWith: KILL_HANGS, timeoutMs: 1500 })
        const took = Date.now() - began
        expect(took, "the close waited on a kill that never returns").toBeLessThan(10_000)
        const line = closing.line()
        expect(line).toMatch(new RegExp(`^${HUNG} chrome: chrome did not exit in 1.5 s \\(node(\\.exe)? of ${child.pid} did not return\\); left: `))
        expect(line).toContain(`${child.pid} main`)
        expect(closingHung(`[ojplay] ${line}`)).not.toBe(null)
        expect(fs.existsSync(path.join(profile)), "the profile is still deleted after a hung kill").toBe(false)
    }, 30_000)
})
