import { beforeAll, describe, expect, it } from "vitest"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
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

/** Runs `oj test` and resolves to its exit code and everything it printed. */
function ojTest(dir: string, runtime: string): Promise<{ code: number | null, output: string }> {
    const script = playtestOf(dir)
    const args = [OJ, "test", ...(script ? [script] : []), "--root", dir, "--runtime", runtime]
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
        let output = ""
        child.stdout.on("data", (d) => { output += d })
        child.stderr.on("data", (d) => { output += d })
        child.on("close", (code) => resolve({ code, output }))
    })
}

// Four browsers at a time: each is a software-rendered container, and more
// than this on one machine slows every frame without finishing sooner.
const LIMIT = 4
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

describe("oj test over every example", () => {
    let runtime = ""

    beforeAll(async () => {
        // One version for the whole sweep, fetched once, rather than each run
        // asking the site and racing the others to the same cache file.
        runtime = (await version()).runtime
        await ensureRuntime(siteOrigin(), runtime)
    }, 300_000)

    it("finds the examples and the fixtures, so an empty sweep cannot pass", () => {
        expect(SKETCHES.filter((d) => d.includes(`${path.sep}examples${path.sep}`)).length).toBeGreaterThan(20)
        expect(SKETCHES.some((d) => d.endsWith(`${path.sep}keys`))).toBe(true)
    })

    for (const dir of SKETCHES) {
        const name = path.relative(ROOT, dir)
        it.concurrent(`${name}${playtestOf(dir) ? ` (${playtestOf(dir)})` : ""}`, async () => {
            const { code, output } = await slot(() => ojTest(dir, runtime))
            expect(code, `oj test in ${name} exited ${code}:\n${output}`).toBe(0)
        }, 240_000)
    }
})
