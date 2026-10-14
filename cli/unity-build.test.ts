import { afterEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as esbuild from "esbuild"
import { buildUnity, filesManifest, OUTPUT, prologue, UsageError } from "./unity-build.mjs"
import { buildGame, notAvailable } from "../build/game.mjs"

/**
 * `ojplay build --unity`, held to the contract OneJS cart runners build
 * against (Specs/ROOT_CARTS.md §5.4a in the OneJS container): four files by
 * those names, the bundle last, files.json's shape, the asset base compiled
 * in, the site's import rule, nothing written inside the cart, and the exit
 * codes. Real esbuild and the real oj, React and loaders, linked into each
 * cart's node_modules the way `ojplay init` and `npm install` put them there.
 */

const PACKAGE_ROOT = path.join(import.meta.dirname, "..")
const LINKS: Record<string, string> = {
    "react": path.join(PACKAGE_ROOT, "node_modules", "react"),
    "onejs-react": path.join(PACKAGE_ROOT, "node_modules", "onejs-react"),
    "onejs-unity": path.join(PACKAGE_ROOT, "node_modules", "onejs-unity"),
    "ojplay": PACKAGE_ROOT,
}
const KEY = "@test/art@1.0.0"

const made: string[] = []
const cwd = process.cwd()
afterEach(() => {
    process.chdir(cwd)
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** A Unity project with a cart at its root, in a folder named `folder`. */
function rootCart(files: Record<string, string>, folder = "Lightning"): { root: string, project: string } {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-unity-build-")))
    made.push(project)
    const root = path.join(project, folder)
    for (const [name, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
        fs.writeFileSync(path.join(root, name), text)
    }
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true })
    for (const [name, target] of Object.entries(LINKS)) fs.symlinkSync(target, path.join(root, "node_modules", name), "junction")
    return { root, project }
}

const CART = {
    "oj.json": JSON.stringify({ name: "Lightning", entry: "index.tsx", dependencies: { "@test/art": "1.0.0" } }),
    "index.tsx": `import { mount, View, assetUrl } from "oj"\nimport { Art } from "@test/art"\nconsole.log(assetUrl("glow.png"))\nmount(<View><Art /></View>)\nexport function onPlay() {}\n`,
    "glow.png": "own glow",
    "art/bg.png": "own bg",
    [`.oj/carts/${KEY}/oj.json`]: JSON.stringify({ name: "Art", entry: "index.tsx", version: "1.0.0", exports: "art.tsx" }),
    [`.oj/carts/${KEY}/index.tsx`]: "export {}\n",
    [`.oj/carts/${KEY}/art.tsx`]: `import { useTexture } from "oj"\nexport const Art = () => { useTexture("spark.png"); return null }\n`,
    [`.oj/carts/${KEY}/spark.png`]: "art spark",
}

/** Every path under `dir` but node_modules, with each file's bytes, for a before and after. */
function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (at: string, prefix: string) => {
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue
            const rel = prefix + entry.name
            if (entry.isDirectory()) walk(path.join(at, entry.name), rel + "/")
            else out[rel] = fs.readFileSync(path.join(at, entry.name), "utf8")
        }
    }
    walk(dir, "")
    return out
}

async function build(root: string, out: string, production = false) {
    const said: string[] = [], complained: string[] = []
    const code = await buildUnity(root, { out, production, say: (l) => said.push(l), complain: (l) => complained.push(l) })
    process.chdir(cwd)
    return { code, said, complained }
}

describe("build --unity writes the contract's four files", () => {
    it("writes app.js.txt, app.js.map.txt, app.sl.json and files.json, says so once, and exits 0", async () => {
        const { root, project } = rootCart(CART)
        const out = path.join(project, "Library", "OneJS", "Carts", "Lightning")
        const { code, said, complained } = await build(root, out)
        expect(complained).toEqual([])
        expect(code).toBe(0)
        expect(fs.readdirSync(out).sort()).toEqual([OUTPUT.bundle, OUTPUT.map, OUTPUT.shaders, OUTPUT.files].sort())
        expect(said).toEqual([`[ojplay] built ${path.join(out, OUTPUT.bundle).split(path.sep).join("/")}`])
        const bundle = fs.readFileSync(path.join(out, OUTPUT.bundle), "utf8")
        expect(bundle.startsWith("var __exports = ")).toBe(true)
        expect(bundle).toContain("onPlay")
        expect(JSON.parse(fs.readFileSync(path.join(out, OUTPUT.shaders), "utf8")).programs).toEqual([])
        const map = JSON.parse(fs.readFileSync(path.join(out, OUTPUT.map), "utf8"))
        expect(map.sources).toContain("index.tsx")
        expect(map.sourcesContent.length).toBe(map.sources.length)
    })

    it("lists the cart's own files and its used carts' in files.json, from where they sit to where a player reads them", async () => {
        const { root, project } = rootCart(CART)
        const out = path.join(project, "out")
        await build(root, out)
        expect(JSON.parse(fs.readFileSync(path.join(out, OUTPUT.files), "utf8"))).toEqual({
            version: 1,
            base: "onejs/carts/Lightning",
            files: [
                { from: "art/bg.png", to: "art/bg.png" },
                { from: "glow.png", to: "glow.png" },
                { from: `.oj/carts/${KEY}/spark.png`, to: `${KEY}/spark.png` },
            ],
        })
    })

    it("writes the bundle last, whole, and nothing beside it but the four files", async () => {
        const { root, project } = rootCart(CART)
        const out = path.join(project, "out")
        await build(root, out)
        const time = (name: string) => fs.statSync(path.join(out, name)).mtimeMs
        for (const name of [OUTPUT.map, OUTPUT.shaders, OUTPUT.files]) expect(time(OUTPUT.bundle)).toBeGreaterThanOrEqual(time(name))
        expect(fs.readdirSync(out).some((n) => n.endsWith(".tmp"))).toBe(false)
    })

    it("writes nothing inside the cart", async () => {
        const { root, project } = rootCart(CART)
        const before = snapshot(root)
        await build(root, path.join(project, "out"))
        await build(root, path.join(project, "out-player"), true)
        expect(snapshot(root)).toEqual(before)
    })

    it("bundles a used cart's import of oj as the scoped oj, so its files keep its key", async () => {
        const { root, project } = rootCart(CART)
        const out = path.join(project, "out")
        await build(root, out)
        expect(fs.readFileSync(path.join(out, OUTPUT.bundle), "utf8")).toContain(`"${KEY}/"`)
    })
})

describe("build --unity compiles the asset base in", () => {
    /** Runs a prologue with its imports replaced by recorders, under a stand-in CS. */
    function run(source: string, streaming: string) {
        const calls: Array<[string, unknown, unknown]> = []
        const body = source.split("\n").filter((l) => !l.startsWith("import ")).join("\n")
        const record = (who: string) => (base: unknown, options: unknown) => { calls.push([who, base, options]) }
        const saved = (globalThis as any).CS
        ;(globalThis as any).CS = { UnityEngine: { Application: { streamingAssetsPath: streaming } } }
        try {
            new Function("setAssetBase", "unityAssets", "react", body)(record("oj"), { setAssetBase: record("onejs-unity") }, { setImageBase: record("onejs-react") })
        } finally {
            ;(globalThis as any).CS = saved
        }
        return calls
    }

    it("is the cart's folder in the editor, with used carts under .oj/carts, for oj and both loaders", () => {
        const calls = run(prologue("/Project/Lightning", { production: false }), "unused")
        expect(calls).toEqual(["oj", "onejs-unity", "onejs-react"].map((who) => [who, "/Project/Lightning", { usedCarts: ".oj/carts" }]))
    })

    it("is StreamingAssets/onejs/carts/<folder> in a player, read when the bundle runs", () => {
        const calls = run(prologue("/Project/My Cart", { production: true }), "C:/Game/Game_Data/StreamingAssets")
        expect(calls[0]).toEqual(["oj", "C:/Game/Game_Data/StreamingAssets/onejs/carts/My Cart", {}])
    })

    it("percent-encodes the folder when StreamingAssets is a URL, as on Android and WebGL", () => {
        const calls = run(prologue("/Project/My Cart", { production: true }), "https://game.example/StreamingAssets")
        expect(calls.map((c) => c[1])).toEqual(Array(3).fill("https://game.example/StreamingAssets/onejs/carts/My%20Cart"))
    })

    it("keeps the folder unencoded in files.json, which names a path to copy to", () => {
        const { root } = rootCart({ "oj.json": "{}", "index.tsx": "" }, "My Cart")
        expect(filesManifest(root, []).base).toBe("onejs/carts/My Cart")
    })
})

describe("build --unity holds a cart to the site's import rule", () => {
    it("refuses a package the site does not provide, in the site's words", async () => {
        const { root, project } = rootCart({ "oj.json": JSON.stringify({ name: "L", entry: "index.tsx" }), "index.tsx": `import { View } from "onejs-react"\nconsole.log(View)\n` })
        const { code, complained } = await build(root, path.join(project, "out"))
        expect(code).toBe(1)
        expect(complained).toEqual([`index.tsx:1:22: ${notAvailable("onejs-react")}`])
        const site = await buildGame(esbuild, [{ name: "index.tsx", text: `import { View } from "onejs-react"\nconsole.log(View)\n` }], "index.tsx", { workingDir: path.parse(process.cwd()).root }).catch((e) => e)
        expect(site.errors[0].text).toBe(notAvailable("onejs-react"))
        expect(fs.existsSync(path.join(project, "out", OUTPUT.bundle))).toBe(false)
    })

    it("refuses a C# namespace as an import, as the site does: CS is the door to the host", async () => {
        const { root, project } = rootCart({ "oj.json": JSON.stringify({ name: "L", entry: "index.tsx" }), "index.tsx": `import { Debug } from "UnityEngine"\nDebug.Log(1)\n` })
        const { complained } = await build(root, path.join(project, "out"))
        expect(complained).toEqual([`index.tsx:1:23: ${notAvailable("UnityEngine")}`])
    })
})

describe("build --unity's failures and refusals", () => {
    it("exits 1 with file:line:column on a syntax error, and leaves the last good build in place", async () => {
        const { root, project } = rootCart(CART)
        const out = path.join(project, "out")
        expect((await build(root, out)).complained).toEqual([])
        const good = fs.readFileSync(path.join(out, OUTPUT.bundle), "utf8")
        fs.appendFileSync(path.join(root, "index.tsx"), "const broken = (\n")
        const { code, said, complained } = await build(root, out)
        expect(code).toBe(1)
        expect(said).toEqual([])
        expect(complained[0]).toMatch(/^index\.tsx:\d+:\d+: /)
        expect(fs.readFileSync(path.join(out, OUTPUT.bundle), "utf8")).toBe(good)
    })

    it("is a usage error without --out, or where there is no cart", async () => {
        const { root, project } = rootCart(CART)
        await expect(buildUnity(root, {})).rejects.toBeInstanceOf(UsageError)
        await expect(buildUnity(project, { out: path.join(project, "out") })).rejects.toThrow(/has no oj\.json/)
    })

    it("exits 2 on a usage error from the command line", () => {
        const { root } = rootCart(CART)
        const result = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, "cli", "oj.mjs"), "build", "--unity"], { cwd: root, encoding: "utf8", env: { ...process.env, npm_command: "exec" } })
        expect(result.status).toBe(2)
        expect(result.stderr).toContain("needs --out")
    })
})
