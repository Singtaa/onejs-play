import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { STARTUP_MS, launch } from "./chrome.mjs"
import { ensureRuntime } from "./local.mjs"
import { waitsFor } from "./runtime-line.mjs"
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
 * container is fetched once into ~/.onejs-play). Both are what `ojplay run` needs.
 */

const ROOT = path.resolve(import.meta.dirname, "..")
const OJ = path.join(ROOT, "cli", "oj.mjs")

/** Folders `oj test` can run: a manifest or an index beside it. */
function cartsIn(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name))
        .filter((d) => fs.existsSync(path.join(d, "oj.json")) || fs.existsSync(path.join(d, "index.tsx")))
        .sort()
}

const CARTS = [...cartsIn(path.join(ROOT, "examples")), ...cartsIn(path.join(ROOT, "cli", "fixtures"))]

/** The script a cart is tested with: playtest.mjs, else a lone *.playtest.mjs, else none (a smoke run). */
function playtestOf(dir: string): string | null {
    if (fs.existsSync(path.join(dir, "playtest.mjs"))) return "playtest.mjs"
    const named = fs.readdirSync(dir).filter((f) => f.endsWith(".playtest.mjs"))
    if (named.length > 1) throw new Error(`${dir}: more than one *.playtest.mjs; name the one to run playtest.mjs`)
    return named[0] ?? null
}

/**
 * How long one run may take once it has started. Measured on the CI runners,
 * one at a time: a median of 4 s on Ubuntu and 9 s on Windows, and 52 s at
 * worst on Windows. 180 s is 3.5 times that.
 */
const RUN_MS = 180_000

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
 * How many runs at once: one per four cores, at most four, and one on
 * Windows. Measured on the 4-core CI runners (2026-09-30, full npm test):
 *
 * - Ubuntu took the same 131 to 165 s for the sweep at one, two or four at a
 *   time. A software-rendered container already fills four cores, so running
 *   more only stretched each run (the worst from 11 s at one to 78 s at four)
 *   and gained nothing.
 * - Windows at two at a time ran past a 12 minute cap, and at four the runner
 *   stopped answering; one at a time took five minutes.
 *
 * Chrome's start stayed within 1.5 s at every setting once warm (STARTUP_MS),
 * so this is set by run length and by Windows, not by the start.
 * OJ_SWEEP_LIMIT overrides it, for measuring.
 */
const LIMIT = Number(process.env.OJ_SWEEP_LIMIT) || (process.platform === "win32" ? 1 : Math.min(4, Math.max(1, Math.floor(os.availableParallelism() / 4))))
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
/** How long the warm-up's cold Chrome took, start to closed. */
let coldS = 0

beforeAll(async () => {
    // One version for the whole file, fetched once, rather than each run
    // asking the site and racing the others to the same cache file.
    runtime = (await version()).runtime
    await ensureRuntime(siteOrigin(), runtime)
    // The first Chrome a fresh machine starts is slow: up to 32.4 s to its
    // first page on the CI runners, against 1.5 s at worst for every one after
    // (STARTUP_MS). It is paid here, once, and reported on its own, instead
    // of by whichever cart happens to run first.
    const began = Date.now()
    ;(await launch()).close()
    coldS = (Date.now() - began) / 1000
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

/** A cart's oj.json, or nothing for a fixture without one. */
function manifestOf(dir: string): Record<string, unknown> {
    const file = path.join(dir, "oj.json")
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
}

/**
 * One cart through the sweep: run with `oj test` against the live runtime,
 * unless its oj.json names a runtime line the live one is older than. An
 * example written for the next line uses API the live runtime does not have,
 * so it waits for that line, and runs by itself once the line is live.
 */
async function sweepOne(dir: string): Promise<{ waits: string } | { waits: null, code: number | null, output: string, runS: number }> {
    const waits = waitsFor(manifestOf(dir), runtime)
    if (waits !== null) return { waits }
    return slot(async () => {
        const began = Date.now()
        return { waits: null, ...(await ojTest(dir, runtime)), runS: (Date.now() - began) / 1000 }
    })
}

/** The carts that waited for a newer runtime line than the live one, and which. */
const waited: string[] = []

/** One run's browser start, as `oj test` printed it, and the run's own length. */
type Start = { name: string, portS: number | null, pageS: number | null, rendererS: number | null, runS: number }
const starts: Start[] = []

/**
 * The browser start times of the sweep, printed after it: the number that
 * says whether STARTUP_MS holds under this concurrency on this machine.
 */
function startSummary(): string {
    const pages = starts.map((s) => s.pageS).filter((s): s is number => s !== null).sort((a, b) => a - b)
    const at = (q: number) => pages[Math.min(pages.length - 1, Math.floor(q * pages.length))]
    const worst = starts.filter((s) => s.pageS !== null).sort((a, b) => b.pageS! - a.pageS!)[0]
    const failed = starts.filter((s) => s.pageS === null).map((s) => s.name)
    const runs = starts.map((s) => s.runS).sort((a, b) => a - b)
    const renderers = starts.filter((s) => s.rendererS !== null).sort((a, b) => a.rendererS! - b.rendererS!)
    const slowRenderer = renderers[renderers.length - 1]
    const slowest = [...starts].sort((a, b) => b.runS - a.runS)[0]
    return [
        `[sweep] ${process.platform}, ${os.availableParallelism()} cores, ${LIMIT} at a time, ${starts.length} runs; cold chrome warm-up ${coldS.toFixed(1)} s`,
        `[sweep] chrome page after: median ${at(0.5)?.toFixed(1)} s, p90 ${at(0.9)?.toFixed(1)} s, worst ${worst?.pageS?.toFixed(1)} s (${worst?.name}); limit ${STARTUP_MS / 1000} s`,
        `[sweep] no page: ${failed.length === 0 ? "none" : failed.join(", ")}`,
        // A listed page whose renderer is still waiting on the GPU process: how long that took is the windows-latest number to watch.
        `[sweep] renderer answering after: median ${renderers[Math.floor(renderers.length / 2)]?.rendererS?.toFixed(1)} s, worst ${slowRenderer?.rendererS?.toFixed(1)} s (${slowRenderer?.name})`,
        `[sweep] run length: median ${runs[Math.floor(runs.length / 2)]?.toFixed(1)} s, worst ${slowest?.runS.toFixed(1)} s (${slowest?.name}); limit ${RUN_MS / 1000} s`,
    ].join("\n")
}

describe("oj test over every example", () => {
    afterAll(() => {
        if (starts.length > 0) console.log(startSummary())
        console.log(`[sweep] runtime ${runtime}; ${waited.length} wait for a newer line${waited.length === 0 ? "" : `: ${waited.join(", ")}`}`)
        // A sweep where every cart waited compared nothing, and must not read as a pass.
        expect(starts.length, `every cart waited for a newer line than ${runtime}: nothing was run`).toBeGreaterThan(0)
    })

    it("finds the examples and the fixtures, so an empty sweep cannot pass", () => {
        expect(CARTS.filter((d) => d.includes(`${path.sep}examples${path.sep}`)).length).toBeGreaterThan(20)
        expect(CARTS.some((d) => d.endsWith(`${path.sep}keys`))).toBe(true)
    })

    for (const dir of CARTS) {
        const name = path.relative(ROOT, dir)
        it.concurrent(`${name}${playtestOf(dir) ? ` (${playtestOf(dir)})` : ""}`, async (ctx) => {
            const result = await sweepOne(dir)
            if (result.waits !== null) {
                waited.push(`${name} (${result.waits})`)
                console.log(`[sweep] ${name} waits for ${result.waits}; the live runtime is ${runtime}`)
                ctx.skip()
                return
            }
            const { code, output, runS } = result
            const port = /port after ([\d.]+) s/.exec(output)
            const page = /page after ([\d.]+) s/.exec(output)
            const renderer = /renderer after ([\d.]+) s/.exec(output)
            starts.push({ name, portS: port ? Number(port[1]) : null, pageS: page ? Number(page[1]) : null, rendererS: renderer ? Number(renderer[1]) : null, runS })
            expect(code, `oj test in ${name} exited ${code}:\n${output}`).toBe(0)
        // The deadline that matters is RUN_MS, per run; this one also counts
        // the wait for a slot, so it allows for every run ahead in the queue.
        }, (RUN_MS + 30_000) * Math.ceil(CARTS.length / LIMIT))
    }
})

describe("the sweep's runtime line gate", () => {
    /** A cart that fails on start, needing `line`, in a folder of its own. */
    function broken(line: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-gate-"))
        fs.writeFileSync(path.join(dir, "oj.json"), JSON.stringify({ schema: 1, name: "Broken", entry: "index.tsx", runtime: line }))
        fs.writeFileSync(path.join(dir, "index.tsx"), `throw new Error("broken on purpose")\n`)
        return dir
    }

    it("still runs, and fails, a broken cart the live runtime is new enough for", async () => {
        const dir = broken("1.0")
        try {
            const result = await sweepOne(dir)
            expect(result.waits).toBeNull()
            expect(result.waits === null && result.code).not.toBe(0)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }, RUN_MS + 30_000)

    it("names, and does not run, a cart that needs a line the live runtime is older than", async () => {
        const dir = broken("99.0")
        try {
            // Exactly { waits }: a cart that ran would also carry its code, output and runS, so this
            // says no browser started without timing it, which a loaded machine made flaky.
            expect(await sweepOne(dir)).toStrictEqual({ waits: "99.0" })
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
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
