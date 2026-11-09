// Draws Magerie's kernel-parity cases with tex in a real container, in headless
// Chrome, and compares every byte with Magerie's Mac golden.
//
//     node run.mjs [--runtime <version>] [--software] [--only <prefix>] [--negative]
//
// --runtime   the container to draw in: a version under ~/.onejs-play/runtime
//             (OJ_HOME moves it), fetched from the site when it is not there.
//             Default: the cart's oj.json runtime.
// --container a PlayRuntime build folder (PlayRuntime/Builds/WebGL/PlayContainer)
//             to draw in instead, for a runtime not yet on the site.
// --software  SwiftShader, as a CI runner without a GPU draws.
// --negative  compares each case with the next golden of the same size, and
//             passes only if that FAILS: the instrument's own check, so a
//             harness that compares nothing cannot pass.
//
// Every case is drawn twice, fused as a bake draws it and with every node a
// pass of its own (`name@unfused`), and both are held to the one golden:
// fusing may change what a graph costs, never its pixels.
//
// Two sets of cases: cart/cases.ts, ported by hand from Magerie's
// kernel-parity test, and goldens/ojplay/manifest.json, which Magerie records
// for tex and which this script turns into cart/ojplay.gen.ts before each
// build, so the manifest stays the one place a case is written.
//
// A case passes when every byte is within its tolerance of the golden: 1,
// Magerie's own (kernel-parity.ts), unless the manifest names another, and
// when the manifest says whether the output tiles, when tex agrees. Exits 0
// when all pass, 1 when any fails or errors, 3 when nothing was compared.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.resolve(here, "../cli")
const { build } = await import(path.join(cli, "game.mjs"))
const { ensureRuntime, serve, streamingFetcher, RUNTIME_FILES } = await import(path.join(cli, "local.mjs"))
const { launch } = await import(path.join(cli, "chrome.mjs"))
const { Game, stop } = await import(path.join(cli, "run.mjs"))
const { siteOrigin } = await import(path.join(cli, "site.mjs"))

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : fallback
}
const SOFTWARE = process.argv.includes("--software")
const NEGATIVE = process.argv.includes("--negative")
const ONLY = arg("only", "")
const say = (m) => process.stderr.write(`[tex-parity] ${m}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const root = path.join(here, "cart")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "oj.json"), "utf8"))
const version = arg("runtime", manifest.runtime)
const CONTAINER = arg("container", null)
// A case drawn unfused (every node its own pass) is held to the same golden.
const base = (name) => name.replace(/@unfused$/, "")
const golden = (name) => fs.readFileSync(path.join(here, "goldens", `${base(name)}.bin`))

/**
 * The manifest's cases as the cart reads them: inputs inlined as hex, each
 * output by its port. A one-output case may still say `output`; Magerie's
 * multi-output nodes say `outputs`, one entry a port.
 */
function writeOjplay() {
    const dir = path.join(here, "goldens", "ojplay")
    const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))
    const cases = m.cases.map((c) => {
        const outputs = c.outputs ?? [c.output]
        const [w, h] = c.size
        // An input is a file, or a node run on its own inputs first (Material under Material Light).
        const input = ([port, i]) => i.node !== undefined
            ? { port, node: i.node, params: i.params, inputs: Object.entries(i.inputs).map(input) }
            : { port, tiles: i.tiles, w, h, hex: fs.readFileSync(path.join(dir, i.file)).toString("hex") }
        const inputs = Object.entries(c.inputs).map(input)
        return {
            node: c.node, params: c.params, inputs,
            outputs: outputs.map((o) => ({ port: o.port, name: `ojplay/${o.file.replace(/\.bin$/, "")}`, tiles: o.tiles, tolerance: c.tolerance ?? 1 })),
        }
    })
    fs.writeFileSync(path.join(root, "ojplay.gen.ts"), `// Written by run.mjs from goldens/ojplay/manifest.json (magerie-one ${m.magerieCommit}). Do not edit.\nexport const OJPLAY = ${JSON.stringify(cases)}\n`)
    return new Map(cases.flatMap((c) => c.outputs.map((o) => [o.name, o])))
}
const ojplay = writeOjplay()

/**
 * A local build as the runtime folder serve() takes: its four files
 * decompressed (the build writes them only as .br) into a fresh temp folder,
 * and its StreamingAssets read from disk.
 */
function localContainer(dir) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "tex-parity-container-"))
    for (const name of RUNTIME_FILES) {
        const raw = path.join(dir, "Build", name)
        const bytes = fs.existsSync(raw) ? fs.readFileSync(raw) : zlib.brotliDecompressSync(fs.readFileSync(`${raw}.br`))
        fs.writeFileSync(path.join(out, name), bytes)
    }
    const streaming = path.join(dir, "StreamingAssets")
    return [out, async (rel) => {
        const file = path.join(streaming, rel)
        return file.startsWith(streaming) && fs.existsSync(file) ? fs.readFileSync(file) : null
    }]
}

/** Every case's bytes from the cart, or the error it printed. */
async function draw() {
    const built = await build(root)
    const site = siteOrigin()
    const [runtime, fetchStreaming] = CONTAINER ? localContainer(CONTAINER) : [await ensureRuntime(site, version, say), streamingFetcher(site, version)]
    const server = await serve({ runtime, root, manifest: { ...manifest, runtime: version }, bundle: () => built.code, site, fetchStreaming })
    const browser = await launch({ headless: true, gpu: !SOFTWARE, window: [640, 480], say })
    const game = new Game({ root, browser, server, manifest, say })
    try {
        await browser.navigate(server.url)
        await game.ready()
        const until = Date.now() + 180_000
        while (!browser.console.some((l) => l.text === "[tex-parity] done")) {
            if (Date.now() > until) throw new Error("the cart did not finish in 180 s")
            await sleep(200)
        }
        const out = new Map()
        for (const { text } of browser.console) {
            const m = /^\[tex-parity\] (case|error|pending) (\S+) (.*)$/.exec(text)
            if (m === null) continue
            if (m[1] === "error") { out.set(m[2], { error: m[3] }); continue }
            if (m[1] === "pending") { out.set(m[2], { pending: m[3] }); continue }
            const [size, tiles, hex] = m[3].split(" ")
            out.set(m[2], { size, tiles: tiles === "tiles", bytes: Buffer.from(hex, "hex") })
        }
        for (const e of game.errors) say(`console error: ${e}`)
        return out
    } finally {
        stop(game)
    }
}

function compare(bytes, expected, tolerance) {
    if (bytes.length !== expected.length) return { worst: Infinity, off: bytes.length, note: `${bytes.length} bytes against ${expected.length}` }
    let worst = 0, off = 0
    for (let i = 0; i < bytes.length; i++) {
        const d = Math.abs(bytes[i] - expected[i])
        if (d > worst) worst = d
        if (d > tolerance) off++
    }
    return { worst, off }
}

const drawn = await draw()
const names = [...drawn.keys()].filter((n) => n.startsWith(ONLY))
let compared = 0, failed = 0
const rows = []
// Cases for nodes tex has not built yet: listed, never compared, never a pass.
const pending = new Map()
for (const [i, name] of names.entries()) {
    const got = drawn.get(name)
    if (got.error) { failed++; rows.push(`FAIL  ${name}: ${got.error}`); continue }
    if (got.pending) { if (!name.endsWith("@unfused")) pending.set(got.pending, (pending.get(got.pending) ?? 0) + 1); continue }
    let against = name
    if (NEGATIVE) {
        // The next case whose golden is the same size, so only the pixels differ.
        const size = golden(name).length
        against = [...names.slice(i + 1), ...names.slice(0, i)].find((n) => base(n) !== base(name) && golden(n).length === size && !golden(n).equals(golden(name)))
        if (against === undefined) continue
    }
    const expect = ojplay.get(base(name))
    const tolerance = expect?.tolerance ?? 1
    const r = compare(got.bytes, golden(against), tolerance)
    // Whether it tiles is part of the answer: it decides how every reader's edges go.
    const tilesWrong = !NEGATIVE && expect !== undefined && expect.tiles !== got.tiles
    compared++
    const ok = r.worst <= tolerance && !tilesWrong
    if (!ok) failed++
    rows.push(`${ok ? "pass" : "FAIL"}  ${name}${NEGATIVE ? ` vs ${against}` : ""}: max ${r.worst}${tolerance !== 1 ? ` (tolerance ${tolerance})` : ""}${r.off ? `, ${r.off} bytes past it` : ""}${r.note ? ` (${r.note})` : ""}${tilesWrong ? `, tiles ${got.tiles} where Magerie's ${expect.tiles}` : ""}`)
}
for (const r of rows) console.log(r)
if (pending.size > 0) say(`not compared, nodes tex does not have yet: ${[...pending].map(([n, k]) => `${n} (${k})`).join(", ")}`)

if (compared === 0) {
    say(failed ? `nothing was compared, ${failed} failed` : "nothing was compared")
    process.exitCode = failed ? 1 : 3
} else if (NEGATIVE) {
    // Every swapped comparison must fail for the instrument to be measuring anything.
    const passedWrongly = rows.filter((r) => r.startsWith("pass")).length
    say(`${compared} swapped comparisons, ${passedWrongly} wrongly passed`)
    process.exitCode = passedWrongly === 0 ? 0 : 1
} else {
    say(`${compared - failed} of ${compared} within tolerance${failed ? `, ${failed} failed` : ""}`)
    process.exitCode = failed === 0 ? 0 : 1
}
