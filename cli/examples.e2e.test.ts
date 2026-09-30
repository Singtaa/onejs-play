import { beforeAll, describe, expect, it, vi } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { launch } from "./chrome.mjs"
import { ensureRuntime } from "./local.mjs"
import { siteOrigin, version } from "./site.mjs"

/**
 * `oj test` over every example, and over the CLI's own fixtures, in the real
 * container in the CLI's own headless Chrome.
 *
 * Three examples (fireworks, one-note, wordie) failed `oj test` for months
 * while every unit test passed, because nothing ran them (#3). So each one is
 * run here the way an author runs it: its playtest.mjs when it has one, and
 * otherwise `oj test` with no script, which boots it, lets it run and fails
 * on a console error, an asset the site would not serve, or a crowded or
 * misaligned row. A failure prints the command's own output.
 *
 * Needs Chrome and the network (the site says which runtime is live, and the
 * container is fetched once into ~/.onejs-play). Both are what `oj run` needs.
 */

const ROOT = path.resolve(import.meta.dirname, "..")
const OJ = path.join(ROOT, "cli", "oj.mjs")

/** Folders `oj test` can run: a manifest or an index beside it. */
function sketchesIn(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name))
        .filter((d) => fs.existsSync(path.join(d, "oj.json")) || fs.existsSync(path.join(d, "index.tsx")))
        .sort()
}

const SKETCHES = [...sketchesIn(path.join(ROOT, "examples")), ...sketchesIn(path.join(ROOT, "cli", "fixtures"))]

/** The script a sketch is tested with: playtest.mjs, else a lone *.playtest.mjs, else none (a smoke run). */
function playtestOf(dir: string): string | null {
    if (fs.existsSync(path.join(dir, "playtest.mjs"))) return "playtest.mjs"
    const named = fs.readdirSync(dir).filter((f) => f.endsWith(".playtest.mjs"))
    if (named.length > 1) throw new Error(`${dir}: more than one *.playtest.mjs; name the one to run playtest.mjs`)
    return named[0] ?? null
}

/** How long one run may take once it has started: a sketch takes about ten seconds. */
const RUN_MS = 120_000

/**
 * Stops a run the way Ctrl-C would, so `oj test` closes its browser on the
 * way out. Windows has no such signal; a tree kill takes the browser with it.
 */
function interrupt(pid: number) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
    else process.kill(pid, "SIGTERM")
}

/**
 * Runs `oj test` and resolves to its exit code and everything it printed. A
 * run past RUN_MS is interrupted and fails with what it printed so far,
 * rather than holding the suite until vitest's own timeout, which would
 * leave it running.
 */
function ojTest(dir: string, runtime: string, script = playtestOf(dir), onOutput = (_text: string, _child: ReturnType<typeof spawn>) => {}): Promise<{ code: number | null, output: string }> {
    const args = [OJ, "test", ...(script ? [script] : []), "--root", dir, "--runtime", runtime]
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
        let output = ""
        const take = (d: Buffer) => { output += d; onOutput(output, child) }
        child.stdout.on("data", take)
        child.stderr.on("data", take)
        const deadline = setTimeout(() => {
            output += `\n[sweep] no result after ${RUN_MS / 1000}s; interrupted\n`
            interrupt(child.pid!)
        }, RUN_MS)
        child.on("close", (code) => {
            clearTimeout(deadline)
            resolve({ code, output })
        })
    })
}

/**
 * How many runs at once. Each is a software-rendered container that wants a
 * couple of cores, so half the machine's, at most four. Windows runs one: on
 * a four-core Windows runner four at once starved the whole machine, to the
 * point that a build took two minutes and the runner stopped answering, while
 * one at a time took ten seconds a sketch.
 */
const LIMIT = process.platform === "win32" ? 1 : Math.min(4, Math.max(1, Math.floor(os.availableParallelism() / 2)))
let running = 0
const waiting: Array<() => void> = []
async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= LIMIT) await new Promise<void>((go) => waiting.push(go))
    running++
    try {
        return await work()
    } finally {
        running--
        waiting.shift()?.()
    }
}

let runtime = ""

beforeAll(async () => {
    // One version for the whole file, fetched once, rather than each run
    // asking the site and racing the others to the same cache file.
    runtime = (await version()).runtime
    await ensureRuntime(siteOrigin(), runtime)
}, 300_000)

/** Probes a browser's debugging port until it stops answering, or 5 s pass. */
async function answersOn(port: string): Promise<boolean> {
    const alive = async () => {
        try {
            await fetch(`http://127.0.0.1:${port}/json/version`)
            return true
        } catch {
            return false
        }
    }
    const deadline = Date.now() + 5000
    while (await alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    return alive()
}

describe("oj test over every example", () => {

    it("finds the examples and the fixtures, so an empty sweep cannot pass", () => {
        expect(SKETCHES.filter((d) => d.includes(`${path.sep}examples${path.sep}`)).length).toBeGreaterThan(20)
        expect(SKETCHES.some((d) => d.endsWith(`${path.sep}keys`))).toBe(true)
    })

    for (const dir of SKETCHES) {
        const name = path.relative(ROOT, dir)
        it.concurrent(`${name}${playtestOf(dir) ? ` (${playtestOf(dir)})` : ""}`, async () => {
            const { code, output } = await slot(() => ojTest(dir, runtime))
            expect(code, `oj test in ${name} exited ${code}:\n${output}`).toBe(0)
        // The deadline that matters is RUN_MS, per run; this one also counts
        // the wait for a slot, so it allows for every run ahead in the queue.
        }, (RUN_MS + 30_000) * Math.ceil(SKETCHES.length / LIMIT))
    }
})

describe("the CLI's own browser", () => {
    // A start that fails after Chrome is up used to leave it running, found
    // when a failed attach left a headless browser behind.
    it("closes the browser it started when attaching to it fails", async () => {
        const urls: string[] = []
        vi.stubGlobal("WebSocket", class {
            constructor(url: string) {
                urls.push(url)
                throw new Error("no socket")
            }
        })
        try {
            await expect(launch()).rejects.toThrow("no socket")
        } finally {
            vi.unstubAllGlobals()
        }
        expect(urls).toHaveLength(1)
        const port = new URL(urls[0]).port
        expect(await answersOn(port), `Chrome still answers on port ${port}`).toBe(false)
    }, 60_000)

    // How the sweep stops a run that overstays, and what Ctrl-C does. The
    // browser has its own process group on Mac and Linux, so an oj that just
    // died left it running. Windows has no SIGTERM; a tree kill covers it.
    it.skipIf(process.platform === "win32")("closes its browser when oj test is interrupted", async () => {
        const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oj-hang-")), "hang.playtest.mjs")
        fs.writeFileSync(script, [
            "export default async function (game) {",
            "    console.log(`port ${new URL(game.browser.page.webSocketDebuggerUrl).port}`)",
            "    await new Promise(() => {})",
            "}",
            "",
        ].join("\n"))
        let port = ""
        const { code, output } = await ojTest(path.join(ROOT, "cli", "fixtures", "keys"), runtime, script, (text, child) => {
            const seen = /port (\d+)/.exec(text)
            if (seen && port === "") {
                port = seen[1]
                child.kill("SIGTERM")
            }
        }).finally(() => fs.rmSync(path.dirname(script), { recursive: true, force: true }))
        expect(port, output).not.toBe("")
        expect(output).toMatch(/interrupted by SIGTERM/)
        expect(code).toBe(1)
        expect(await answersOn(port), `Chrome still answers on port ${port}`).toBe(false)
    }, 120_000)
})
