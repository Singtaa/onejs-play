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
// --chain     a Magerie per-node dump folder (scripts/ojplay-dumps.sh): builds
//             that whole board in tex and compares every node's output with
//             Magerie's, fused only, instead of the cases.
// --isolate  with --chain: these node ids (comma separated) only, each fed
//             Magerie's own dumped inputs where they come from outside the
//             set, so a node's error shows without the drift before it.
//             `all`: every node on Magerie's inputs, the node-by-node check.
//             Without it the chain shows drift, which a Curvature at
//             intensity 3 multiplies about 36 times, so expect it to fail.
// --ground    <Magerie's colour exports>,<primoeden-three's textures>: draws
//             grain-textures.mjs's step as tex lines (cart/ground.ts) on each
//             colour export ground.json pairs with a shipped picture, and
//             compares with that picture, instead of the cases.
// --set <name> draws goldens/<name>: Magerie's emitted OJPlay code for a
//             set of textures, each file unchanged, against the PNGs Magerie
//             exported from the same boards (<name>.json), instead of the
//             cases. Prints the mean and spread of the difference, and where
//             the set asks, how many pixels fall on the other side of the
//             cutout (alpha 0.5) from Magerie's. --buildings is --set buildings.
// --tex-src   draws with this checkout's src/tex instead of the container's:
//             run.mjs bundles it and the cart evaluates the bundle before any
//             case (cart/tex.ts), so a tex edit is tried on a built container
//             in seconds. The run fails unless the cart reports the bundle
//             it was handed, so it cannot quietly draw the container's tex.
//             Only tex is swapped; everything else is the container's.
// --sabotage  with --tex-src: every pass writes fract(value + 0.37), and
//             the run must FAIL. The override's own check: a pass means the
//             cart drew something other than the bundle it was handed.
// --save      a folder to write every drawing's bytes into, as <name>.bin
// --ojplay    a folder holding a manifest.json in goldens/ojplay's format, to
//             draw instead of goldens/ojplay: a set Magerie has not vendored
//             yet, or one written from a Magerie node's JS twin.
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
import { fileURLToPath, pathToFileURL } from "node:url"
import { readPNG } from "./png.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.resolve(here, "../cli")
const { build } = await import(pathToFileURL(path.join(cli, "game.mjs")))
const { ensureRuntime, serve, streamingFetcher, RUNTIME_FILES } = await import(pathToFileURL(path.join(cli, "local.mjs")))
const { launch } = await import(pathToFileURL(path.join(cli, "chrome.mjs")))
const { Game, stop } = await import(pathToFileURL(path.join(cli, "run.mjs")))
const { siteOrigin } = await import(pathToFileURL(path.join(cli, "site.mjs")))

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : fallback
}
const SOFTWARE = process.argv.includes("--software")
const NEGATIVE = process.argv.includes("--negative")
const SABOTAGE = process.argv.includes("--sabotage")
const ONLY = arg("only", "")
const say = (m) => process.stderr.write(`[tex-parity] ${m}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const root = path.join(here, "cart")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "oj.json"), "utf8"))
const version = arg("runtime", manifest.runtime)
const CONTAINER = arg("container", null)
// A case drawn unfused (every node its own pass) is held to the same golden.
const base = (name) => name.replace(/@unfused$/, "")
const CHAIN_DIR = arg("chain", null)
// A 32-bit output's tolerance, in stored value: well under a half float's
// step at 0.25 (1/4096), so a picture kept in halves fails, and above the
// float maths a GPU and Magerie's JS twin differ by.
const FLOAT_TOLERANCE = 1 / 8192
// Another manifest in goldens/ojplay's format: a set Magerie has not vendored yet, or one made from its JS twins.
const OJPLAY_DIR = path.resolve(arg("ojplay", path.join(here, "goldens", "ojplay")))
const golden = (name) => base(name).startsWith("ground/")
    ? groundOut.get(base(name)).bytes
    : buildingsOut.has(base(name))
    ? buildingsOut.get(base(name)).bytes
    : base(name).startsWith("chain/")
    ? fs.readFileSync(path.join(CHAIN_DIR, chainOut.get(base(name)).file))
    : base(name).startsWith("ojplay/")
    ? fs.readFileSync(path.join(OJPLAY_DIR, `${base(name).slice("ojplay/".length)}.bin`))
    : fs.readFileSync(path.join(here, "goldens", `${base(name)}.bin`))

/** A chain case's name: the node, and the port when it is not the node's image. */
// tex's name for each output Magerie's port names otherwise (sdfShape's out-distance is its `sdf`), from the node table.
const TEX_NODES = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "tex", "tex-nodes.json"), "utf8"))
const outputKey = (type, port) => {
    const named = Object.entries(TEX_NODES.nodes[type]?.ports ?? {}).find(([, p]) => p === port)
    return named ? named[0] : port.replace(/^out-/, "")
}
const chainName = (id, port) => `chain/${id}${port === "out-image" ? "" : `.${port}`}`

/**
 * A dump's nodes as the cart reads them, in Magerie's order: each input by
 * its port, less the node id Magerie prefixes it with, and the node it
 * comes from. Writes an empty chain when there is none.
 */
function writeChain() {
    const out = new Map()
    let nodes = []
    if (CHAIN_DIR !== null) {
        const m = JSON.parse(fs.readFileSync(path.join(CHAIN_DIR, "manifest.json"), "utf8"))
        const byId = new Map(m.nodes.map((n) => [n.id, n]))
        const isolate = arg("isolate", null)?.split(",")
        nodes = m.nodes.map((n) => ({
            id: n.id, type: n.type, params: n.params,
            // Each input names the port it reads, so a Tile Grid's random and uv reach their readers, not its image.
            inputs: Object.entries(n.inputs).map(([port, i]) => {
                const out = i.port ? i.port.slice(i.node.length + 1) : "out-image"
                return { port: port.slice(n.id.length + 1), from: i.node, out, key: outputKey(byId.get(i.node)?.type, out) }
            }),
            outs: Object.entries(n.outputs ?? {}).filter(([, o]) => o?.type === "image" && o.file !== undefined)
                .map(([port, o]) => ({ port, key: outputKey(n.type, port), name: chainName(n.id, port), float: o.format === "float32" })),
        }))
        if (isolate) {
            // Each chosen node on Magerie's own bytes: an input from outside the set becomes a source holding the dump.
            const all = isolate.includes("all")
            const chosen = (id) => all || isolate.includes(id)
            const sources = new Map()
            const floats = new Set()
            nodes = nodes.filter((n) => chosen(n.id)).map((n) => ({ ...n, inputs: n.inputs.map((i) => {
                const o = byId.get(i.from).outputs[i.out]
                // A material carries no pixels of its own: it is rebuilt from its maps, which do.
                if (o?.file === undefined) {
                    if (!chosen(i.from)) throw new Error(`--isolate: ${n.id} reads ${i.from}, which has no pixels in the dump; isolate it too`)
                    return i
                }
                if (!all && chosen(i.from)) return i
                const id = `dump:${i.from}:${i.out}`
                const bytes = fs.readFileSync(path.join(CHAIN_DIR, o.file))
                // A float32 dump goes in as floats, unrounded, so a node is judged on Magerie's exact input.
                const float = o.format === "float32"
                if (float) floats.add(`${i.from} ${i.out}`)
                sources.set(id, { id, type: "pixels", w: o.width, h: o.height, tiles: o.tiles, float, hex: bytes.toString("hex") })
                return { ...i, from: id, out: "out-image", key: "image" }
            }) }))
            nodes = [...sources.values(), ...nodes]
            if (floats.size > 0) console.log(`[tex-parity] --isolate fed ${floats.size} float32 dumps as floats: ${[...floats].join(", ")}`)
        }
        // Every picture a node stores is a case, a float32 one compared as floats.
        for (const n of m.nodes) {
            for (const [port, o] of Object.entries(n.outputs ?? {})) {
                if (o?.type !== "image" || o.file === undefined) continue
                const float = o.format === "float32"
                out.set(chainName(n.id, port), { file: o.file, tiles: o.tiles, float, tolerance: float ? FLOAT_TOLERANCE : 1, report: true })
            }
        }
    }
    fs.writeFileSync(path.join(root, "chain.gen.ts"), `// Written by run.mjs${CHAIN_DIR ? ` from ${path.basename(CHAIN_DIR)}/manifest.json` : ""}. Do not edit.\nexport const CHAIN: { id: string, type: string, params?: unknown, inputs?: { port: string, from: string, out: string, key: string }[], outs?: { port: string, key: string, name: string, float: boolean }[], w?: number, h?: number, tiles?: boolean, hex?: string, float?: boolean }[] = ${JSON.stringify(nodes)}\n`)
    return out
}
const chainOut = writeChain()

/**
 * The ground pictures as the cart reads them: each colour export's RGB,
 * opaque, and its alpha as a grey height, both premultiplied as tex.pixels
 * takes them. The shipped picture is what each is compared with.
 */
function writeGround() {
    const out = new Map()
    const pictures = []
    const dirs = arg("ground", null)?.split(",")
    if (dirs !== undefined) {
        const [colourDir, shippedDir] = dirs.map((d) => d.replace(/^~/, os.homedir()))
        const set = JSON.parse(fs.readFileSync(path.join(here, "ground.json"), "utf8"))
        for (const p of set.pictures) {
            const c = readPNG(fs.readFileSync(path.join(colourDir, p.colour)))
            const s = readPNG(fs.readFileSync(path.join(shippedDir, p.shipped)))
            const lit = Buffer.from(c.rgba), height = Buffer.alloc(c.rgba.length)
            for (let i = 0; i < c.rgba.length; i += 4) { lit[i + 3] = 255; height.fill(c.rgba[i + 3], i, i + 3); height[i + 3] = 255 }
            const name = `ground/${p.shipped.replace(/\.png$/, "")}`
            pictures.push({ name, w: c.width, h: c.height, lit: lit.toString("hex"), height: height.toString("hex"), spread: set.spread })
            out.set(name, { bytes: Buffer.from(s.rgba), tiles: true, tolerance: 1 })
        }
    }
    fs.writeFileSync(path.join(root, "ground.gen.ts"), `// Written by run.mjs from ground.json. Do not edit.\nexport const GROUND: { name: string, w: number, h: number, lit: string, height: string, spread: number }[] = ${JSON.stringify(pictures)}\n`)
    return out
}
const groundOut = writeGround()

/** The set --set (or --buildings) draws, or null. */
const SET = process.argv.includes("--buildings") ? "buildings" : arg("set", null)

/**
 * goldens/<SET> as the cart reads it: each emitted file copied into
 * cart/buildings/ with its `import { tex } from "oj"` pointed at cart/tex.ts,
 * the one edit, so --tex-src reaches it; and each export it names compared
 * with the PNG Magerie wrote for it (<SET>.json).
 */
function writeBuildings() {
    const out = new Map()
    const entries = []
    const dir = path.join(here, "goldens", SET ?? "buildings")
    const genDir = path.join(root, "buildings")
    fs.rmSync(genDir, { recursive: true, force: true })
    if (SET !== null) {
        fs.mkdirSync(genDir)
        const set = JSON.parse(fs.readFileSync(path.join(dir, `${SET}.json`), "utf8"))
        for (const b of set.textures) {
            const source = fs.readFileSync(path.join(dir, `${b.file}.ts`), "utf8")
            const pointed = source.replace(/^import \{ tex \} from "oj"$/m, `import { tex } from "../tex"`)
            if (pointed === source) throw new Error(`goldens/${SET}/${b.file}.ts does not import tex from "oj" as Magerie writes it`)
            fs.writeFileSync(path.join(genDir, `${b.file}.ts`), pointed)
            const exports = []
            for (const [name, png] of Object.entries(b.exports)) {
                const p = readPNG(fs.readFileSync(path.join(dir, png)))
                // A texture's own look, where its board amplifies what the set's allows (its lookWhy says how), overrides the set's key by key.
                const look = b.look ? { ...set.look, ...b.look } : set.look
                out.set(`${SET}/${name}`, { bytes: Buffer.from(p.rgba), look, report: true, cutout: look?.cutout !== undefined })
                exports.push(name)
            }
            // The nodes it takes from tex.canvas(), so a gap is named and not a minified "kd is not a function".
            const names = (/const \{([^}]*)\} = tex\.canvas\(/.exec(source)?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean)
            entries.push({ file: b.file, exports, names })
        }
    }
    const loads = entries.map((e) => `    { file: ${JSON.stringify(e.file)}, exports: ${JSON.stringify(e.exports)}, names: ${JSON.stringify(e.names)}, load: () => import("./buildings/${e.file}") },`)
    fs.writeFileSync(path.join(root, "buildings.gen.ts"), `// Written by run.mjs from goldens/${SET}/${SET}.json. Do not edit.\nexport const SET_NAME = ${JSON.stringify(SET ?? "")}\nexport const BUILDINGS: { file: string, exports: string[], names: string[], load: () => Promise<Record<string, unknown>> }[] = [\n${loads.join("\n")}\n]\n`)
    return out
}
const buildingsOut = writeBuildings()

/**
 * The checkout's src/tex as one script for cart/tex.ts to evaluate, or null.
 * Bundled with this checkout's onejs-unity/sl and onejs-react's pass.ts (tex
 * draws through createPass, which oj does not export); react comes from the
 * container's externals, as a cart's does. Its id is printed by the cart.
 */
async function writeDevTex() {
    let code = null, id = null
    if (process.argv.includes("--tex-src")) {
        const esbuild = await import("esbuild")
        const pass = path.resolve(here, "../node_modules/onejs-react/src/pass.ts")
        const plugin = { name: "dev-tex", setup(b) {
            b.onResolve({ filter: /^onejs-react$/ }, () => ({ path: pass }))
            b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (a) => ({ path: a.path, namespace: "ext" }))
            b.onLoad({ filter: /.*/, namespace: "ext" }, (a) => ({ contents: `module.exports = __ojExternals[${JSON.stringify(a.path)}]`, loader: "js" }))
            // --sabotage: every pass writes fract(value + 0.37), moving every byte,
            // so a run must fail; one that passes was not drawing this bundle.
            if (SABOTAGE) b.onLoad({ filter: /[\\/]src[\\/]tex[\\/]engine\.ts$/ }, (a) => {
                const text = fs.readFileSync(a.path, "utf8")
                const broken = text.replace(/const v = valueOf\(node, node\)$/m, "const v = valueOf(node, node).add(0.37).fract() as Vec4")
                if (broken === text) throw new Error("--sabotage: engine.ts no longer has the line it breaks; update run.mjs")
                return { contents: broken, loader: "ts" }
            })
        } }
        const built = await esbuild.build({
            entryPoints: [path.resolve(here, "../src/tex/index.ts")], bundle: true, format: "iife", globalName: "__devTex",
            write: false, plugins: [plugin], target: "es2020", logLevel: "warning",
        })
        const text = built.outputFiles[0].text
        id = `${Date.now().toString(36)}-${text.length}`
        code = `${text}\n__devTex.DEV_ID = ${JSON.stringify(id)}\n`
        say(`tex from src/tex, bundle ${id}`)
    }
    fs.writeFileSync(path.join(root, "devtex.gen.ts"), `// Written by run.mjs --tex-src from src/tex. Do not edit.\nexport const DEV_TEX: string | null = ${JSON.stringify(code)}\n`)
    return id
}
const devTexId = await writeDevTex()

/**
 * The manifest's cases as the cart reads them: inputs inlined as hex, each
 * output by its port. A one-output case may still say `output`; Magerie's
 * multi-output nodes say `outputs`, one entry a port.
 */
function writeOjplay() {
    const dir = OJPLAY_DIR
    const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))
    const cases = m.cases.map((c) => {
        const outputs = (c.outputs ?? [c.output]).map((o) => ({ ...o, float: o.float === true || o.format === "rgba32f" }))
        const [w, h] = c.size
        // An input is a file, or a node run on its own inputs first (Material under Material Light).
        const input = ([port, i]) => i.node !== undefined
            ? { port, node: i.node, params: i.params, inputs: Object.entries(i.inputs).map(input), output: i.output }
            : { port, tiles: i.tiles, w, h, hex: fs.readFileSync(path.join(dir, i.file)).toString("hex") }
        const inputs = Object.entries(c.inputs).map(input)
        return {
            node: c.node, params: c.params, inputs,
            outputs: outputs.map((o) => ({
                port: o.port, name: `ojplay/${o.file.replace(/\.bin$/, "")}`, tiles: o.tiles, float: o.float,
                tolerance: o.tolerance ?? c.tolerance ?? (o.float ? FLOAT_TOLERANCE : 1),
            })),
        }
    })
    fs.writeFileSync(path.join(root, "ojplay.gen.ts"), `// Written by run.mjs from ${path.relative(here, dir)}/manifest.json (magerie-one ${m.magerieCommit}). Do not edit.\nexport const OJPLAY = ${JSON.stringify(cases)}\n`)
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
        try {
            await game.ready()
        } catch (e) {
            // Why it did not start is in the page's console, not in the error.
            for (const line of game.errors) say(`console error: ${line}`)
            throw e
        }
        // A budget per drawing, fused and unfused: SwiftShader compiles slowly, and the set grows.
        const budget = 60 + 4 * (CHAIN_DIR ? chainOut.size : groundOut.size || 4 * buildingsOut.size || 2 * ojplay.size)
        const until = Date.now() + budget * 1000
        while (!browser.console.some((l) => l.text === "[tex-parity] done")) {
            if (Date.now() > until) {
                const drawn = browser.console.filter((l) => /^\[tex-parity\] (case|error|pending) /.test(l.text)).length
                throw new Error(`the cart did not finish in ${budget} s; ${drawn} drawings had come back`)
            }
            await sleep(200)
        }
        const out = new Map()
        for (const { text } of browser.console) {
            const m = /^\[tex-parity\] (case|error|pending) (\S+) (.*)$/.exec(text)
            if (m === null) continue
            if (m[1] === "error") { out.set(m[2], { error: m[3] }); continue }
            if (m[1] === "pending") { out.set(m[2], { pending: m[3] }); continue }
            const [size, tiles, hex] = m[3].split(" ")
            const float = hex.startsWith("f:")
            out.set(m[2], { size, tiles: tiles === "tiles", float, bytes: Buffer.from(float ? hex.slice(2) : hex, "hex") })
        }
        for (const e of game.errors) say(`console error: ${e}`)
        // The cart names the tex it drew with: a --tex-src run must have drawn the bundle built for it.
        const source = browser.console.map((l) => /^\[tex-parity\] tex (.*)$/.exec(l.text)?.[1]).find((s) => s !== undefined)
        if (devTexId !== null && source !== `dev ${devTexId}`) throw new Error(`--tex-src built bundle ${devTexId}, and the cart drew with ${source ?? "no tex it named"}`)
        say(`drew with the ${source === undefined ? "unnamed" : source.startsWith("dev") ? `checkout's src/tex (${source})` : "container's"} tex`)
        return out
    } finally {
        stop(game)
    }
}

/** Little-endian float32s, from a golden's or a drawing's bytes. */
const floats = (b) => Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(i * 4))

function compare(got, expected, tolerance, float) {
    const bytes = float ? floats(got) : got

    if (float) expected = floats(expected)
    if (bytes.length !== expected.length) return { worst: Infinity, off: bytes.length, note: `${bytes.length} values against ${expected.length}` }
    let worst = 0, off = 0, sum = 0, over2 = 0
    for (let i = 0; i < bytes.length; i++) {
        const d = Math.abs(bytes[i] - expected[i])
        if (d > worst) worst = d
        if (d > tolerance) off++
        // The mean and the share past 2 are in 8-bit levels for a float too, so the two read alike.
        const levels = float ? d * 255 : d
        if (levels > 2) over2++
        sum += levels
    }
    // Pixels on the other side of the cutout (alpha 0.5) from the golden's: an edge moved, whatever the mean says.
    let cutout = 0
    if (!float) for (let i = 3; i < bytes.length; i += 4) if ((bytes[i] >= 128) !== (expected[i] >= 128)) cutout++
    return { worst, off, mean: sum / bytes.length, over2: over2 / bytes.length, cutout, pixels: bytes.length / 4 }
}

const drawn = await draw()
const SAVE = arg("save", null)
if (SAVE !== null) {
    for (const [name, got] of drawn) {
        if (!got.bytes) continue
        const file = path.join(SAVE, `${name}.bin`)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, got.bytes)
    }
}
const names = [...drawn.keys()].filter((n) => n.startsWith(ONLY))
let compared = 0, failed = 0, errored = 0
const rows = []
// Cases for nodes tex has not built yet: listed, never compared, never a pass.
const pending = new Map()
for (const [i, name] of names.entries()) {
    const got = drawn.get(name)
    if (got.error) { failed++; errored++; rows.push(`FAIL  ${name}: ${got.error}`); continue }
    if (got.pending) { if (!name.endsWith("@unfused")) pending.set(got.pending, (pending.get(got.pending) ?? 0) + 1); continue }
    let against = name
    if (NEGATIVE) {
        // The next case whose golden is the same size, so only the pixels differ.
        const size = golden(name).length
        against = [...names.slice(i + 1), ...names.slice(0, i)].find((n) => base(n) !== base(name) && golden(n).length === size && !golden(n).equals(golden(name)))
        if (against === undefined) continue
    }
    const expect = ojplay.get(base(name)) ?? chainOut.get(base(name)) ?? groundOut.get(base(name)) ?? buildingsOut.get(base(name))
    const tolerance = expect?.tolerance ?? 1
    // A float golden is held as float, and a drawing that came back in bytes against one fails on its length.
    const r = compare(got.bytes, golden(against), tolerance, expect?.float === true && got.float === true)
    // Whether it tiles is part of the answer: it decides how every reader's edges go.
    const tilesWrong = !NEGATIVE && typeof expect?.tiles === "boolean" && expect.tiles !== got.tiles
    compared++
    // A Look case (buildings.json says why) passes on its mean and its share of bytes off by more than 2.
    const look = expect?.look
    const ok = (look ? r.mean <= look.mean && r.over2 <= look.over2 && (look.cutout === undefined || r.cutout / r.pixels <= look.cutout) : r.worst <= tolerance) && !tilesWrong
    if (!ok) failed++
    rows.push(`${ok ? "pass" : "FAIL"}  ${name}${NEGATIVE ? ` vs ${against}` : ""}: max ${r.worst}${look ? ` (Look: mean at most ${look.mean}, at most ${100 * look.over2}% off by > 2)` : `${tolerance !== 1 ? ` (tolerance ${tolerance})` : ""}${r.off ? `, ${r.off} bytes past it` : ""}`}${r.note ? ` (${r.note})` : ""}${expect?.report && r.mean !== undefined ? `; mean ${r.mean.toFixed(2)}, ${(100 * r.over2).toFixed(1)}% of bytes off by > 2, ${got.size} ${got.tiles ? "tiles" : "edges"}` : ""}${expect?.cutout ? `; cutout ${r.cutout} px (${(100 * r.cutout / r.pixels).toFixed(2)}%) across alpha 0.5` : ""}${tilesWrong ? `, tiles ${got.tiles} where Magerie's ${expect.tiles}` : ""}`)
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
    say(`${compared - (failed - errored)} of ${compared} within tolerance${failed ? `, ${failed} failed${errored ? `, ${errored} of them drawing nothing` : ""}` : ""}`)
    process.exitCode = failed === 0 ? 0 : 1
}
