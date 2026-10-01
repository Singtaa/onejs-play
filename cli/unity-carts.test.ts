import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as esbuild from "esbuild"
import { cartsPlugin, syncCartAssets, withCartsPlugin } from "./unity-assets.mjs"
import { add } from "./carts.mjs"
import { COMMAND, PACKAGE } from "../build/command.mjs"

/**
 * Used carts in a OneJS app's own build (PlaySite docs/carts.md §4, step 6,
 * option b): cartsPlugin() resolves and scopes them on disk the way the
 * site's builder does in its tree, copies their files to assets/<key>/, and
 * fetches what a fresh clone lacks. Real esbuild, the way OneJS's
 * esbuild.config.mjs runs it, with "oj" aliased to a stand-in.
 */

const GLOW = new Uint8Array([137, 80, 78, 71, 9, 9, 9])
const LIGHTNING = {
    "oj.json": JSON.stringify({ name: "lightning", entry: "index.tsx", version: "1.2.0", exports: "bolt.tsx" }),
    "index.tsx": "export {}\n",
    "bolt.tsx": `import { useTexture } from "oj"\nexport const Bolt = () => useTexture("glow.png")\nexport const said = "a bolt from lightning"\n`,
}
const KEY = "@singtaa/lightning@1.2.0"

let server: Server
let origin = ""
const asked: string[] = []
beforeAll(async () => {
    server = createServer((req, res) => {
        asked.push(req.url ?? "")
        const json = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
        if (req.url === "/api/carts/@singtaa/lightning/kept/1.2.0") {
            return json(200, { address: "@singtaa/lightning", version: "1.2.0", commit: "1".repeat(40), builtAt: 1, files: Object.entries(LIGHTNING).map(([name, text]) => ({ name, text })), assets: { "glow.png": "x" } })
        }
        if (req.url === "/api/carts/@singtaa/lightning/kept/1.2.0/files/glow.png") { res.writeHead(200); return res.end(GLOW) }
        if (req.url === "/api/carts/@singtaa/lightning/pin") return json(200, { address: "@singtaa/lightning", version: "1.2.0", commit: "1".repeat(40), builtAt: 1 })
        json(404, { error: "No cart at that address." })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const at = server.address()
    origin = `http://127.0.0.1:${typeof at === "object" && at !== null ? at.port : 0}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const made: string[] = []
const saved = { site: process.env.OJ_SITE, home: process.env.OJ_HOME, token: process.env.OJ_TOKEN }
afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
    process.env.OJ_SITE = saved.site
    process.env.OJ_HOME = saved.home
    if (saved.token === undefined) delete process.env.OJ_TOKEN
    else process.env.OJ_TOKEN = saved.token
})

/** A OneJS app's ~ in a Unity project: its files, and a stand-in oj that says which name it was asked for. */
function app(files: Record<string, string | Uint8Array>): string {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "ojp-unity-carts-"))
    made.push(project)
    fs.mkdirSync(path.join(project, "ProjectSettings"))
    fs.writeFileSync(path.join(project, "ProjectSettings", "ProjectVersion.txt"), "")
    const root = path.join(project, "Assets", "App", "~")
    for (const [name, data] of Object.entries({
        "node_modules/oj-stand-in/index.js": "export const useTexture = (name) => \"texture:\" + name\nexport const assetUrl = (n) => n\nexport const loadTexture = (n) => n\nexport const loadSheet = (n) => n\nexport const useFlipbook = (r, n) => n\nexport const audio = { load: (n) => n }\nexport const mount = () => {}\n",
        ...files,
    })) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
        fs.writeFileSync(path.join(root, name), data)
    }
    process.env.OJ_SITE = origin
    process.env.OJ_HOME = path.join(project, "home")
    delete process.env.OJ_TOKEN
    asked.length = 0
    return root
}

/** OneJS's build, cut to what matters here: bundle from disk, oj aliased, the plugin. */
async function buildApp(root: string, entry = "index.tsx") {
    const result = await esbuild.build({
        entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, format: "esm", logLevel: "silent",
        alias: { oj: path.join(root, "node_modules/oj-stand-in/index.js") },
        plugins: [cartsPlugin()],
    })
    return result.outputFiles[0]!.text
}

const fetched = () => Object.fromEntries(Object.entries(LIGHTNING).map(([n, t]) => [`.oj/carts/${KEY}/${n}`, t]))

describe("cartsPlugin, in a OneJS app's build", () => {
    it("compiles the used cart in, its oj scoped to its key, and copies its art to assets/<key>/", async () => {
        const root = app({
            "index.tsx": `import { Bolt, said } from "@singtaa/lightning"\nimport { useTexture } from "oj"\nglobalThis.out = [Bolt(), said, useTexture("glow.png")]\n`,
            "oj.json": JSON.stringify({ dependencies: { "@singtaa/lightning": "1.2.0" } }),
            "glow.png": new Uint8Array([1]),
            ...fetched(),
            [`.oj/carts/${KEY}/glow.png`]: GLOW,
        })
        const code = await buildApp(root)
        expect(code).toContain("a bolt from lightning")
        // The cart asks for its own file under its key; the app's own oj is untouched.
        expect(code).toContain(JSON.stringify(KEY + "/"))
        const out = new Function(code.replace(/export\s*\{[^}]*\};?/g, "") + "\nreturn globalThis.out")() as string[]
        expect(out).toEqual([`texture:${KEY}/glow.png`, "a bolt from lightning", "texture:glow.png"])
        expect(new Uint8Array(fs.readFileSync(path.join(root, "assets", ...KEY.split("/"), "glow.png")))).toEqual(GLOW)
        expect(asked).toEqual([])
    })

    it("fetches what a fresh clone lacks, at build time", async () => {
        const root = app({
            "index.tsx": `import { said } from "@singtaa/lightning"\nglobalThis.out = said\n`,
            "oj.json": JSON.stringify({ dependencies: { "@singtaa/lightning": "1.2.0" } }),
        })
        expect(await buildApp(root)).toContain("a bolt from lightning")
        expect(asked).toEqual(["/api/carts/@singtaa/lightning/kept/1.2.0", "/api/carts/@singtaa/lightning/kept/1.2.0/files/glow.png"])
        expect(fs.existsSync(path.join(root, "assets", ...KEY.split("/"), "glow.png"))).toBe(true)
    })

    it("fails offline in one line that names the cart and the command", async () => {
        const root = app({
            "index.tsx": `import { said } from "@singtaa/lightning"\n`,
            "oj.json": JSON.stringify({ dependencies: { "@singtaa/lightning": "1.2.0" } }),
        })
        process.env.OJ_SITE = "http://127.0.0.1:9"
        const failure = await buildApp(root).then(() => null, (e: esbuild.BuildFailure) => e.errors.map((m) => m.text))
        expect(failure).toHaveLength(1)
        expect(failure![0]).toMatch(new RegExp(`^\\[ojp\\] @singtaa/lightning 1\\.2\\.0 is not in \\.oj/carts and could not be fetched: Could not reach http://127\\.0\\.0\\.1:9 \\([^)]+\\)\\. Connect and run it again, or: ${COMMAND.replace(/ /g, " ")} add$`))
        expect(failure![0]).not.toContain("\n")
    })

    it("runs a whole cart's entry on a bare import", async () => {
        const root = app({
            "index.tsx": `import "@singtaa/portal"\n`,
            "oj.json": JSON.stringify({ dependencies: { "@singtaa/portal": "#aaaaaaaaaaaa" } }),
            ".oj/carts/@singtaa/portal@aaaaaaaaaaaa/oj.json": JSON.stringify({ name: "portal", entry: "main.tsx" }),
            ".oj/carts/@singtaa/portal@aaaaaaaaaaaa/main.tsx": `globalThis.said = "the portal runs"\n`,
        })
        expect(await buildApp(root)).toContain("the portal runs")
    })

    it("leaves the app's own scoped npm imports alone", async () => {
        const root = app({
            "index.tsx": `import { x } from "@scope/thing"\nglobalThis.out = x\n`,
            "node_modules/@scope/thing/package.json": JSON.stringify({ name: "@scope/thing", main: "index.js" }),
            "node_modules/@scope/thing/index.js": "export const x = \"from npm\"\n",
        })
        expect(await buildApp(root)).toContain("from npm")
    })

    it("removes the folder of a cart nothing uses now, and only one it copied", () => {
        const root = app({ ...fetched(), [`.oj/carts/${KEY}/glow.png`]: GLOW, "assets/@mine/hand/kept.png": "mine" })
        syncCartAssets(root, [KEY])
        expect(fs.existsSync(path.join(root, "assets", "@singtaa", "lightning@1.2.0", "glow.png"))).toBe(true)
        expect(syncCartAssets(root, [])).toEqual({ copied: [], removed: [KEY] })
        expect(fs.existsSync(path.join(root, "assets", "@singtaa"))).toBe(false)
        expect(fs.readFileSync(path.join(root, "assets", "@mine", "hand", "kept.png"), "utf8")).toBe("mine")
    })
})

describe("ojp add in a OneJS app's ~", () => {
    it("adds the cart to oj.json, the plugin to the build and ojp to package.json, once", async () => {
        const root = app({
            "package.json": JSON.stringify({ name: "app", dependencies: { "onejs-play": "^0.8.3" } }),
            "esbuild.config.mjs": `import { assetsPlugin } from "${PACKAGE}/unity"\nconst config = {\n    plugins: [\n        importTransformPlugin(),\n    ],\n}\n`,
            "index.tsx": "export {}\n",
        })
        const npm: string[] = []
        const lines = await add(root, "@singtaa/lightning", { npm: (_dir: string, args: string[]) => { npm.push(args.join(" ")); return 0 } })
        expect(lines).toEqual([
            `Added @singtaa/lightning 1.2.0 to oj.json. It exports Bolt, said: import { Bolt, said } from "@singtaa/lightning"`,
            "Next: npm run build (or save a file while JSRunner watches)",
        ])
        expect(JSON.parse(fs.readFileSync(path.join(root, "oj.json"), "utf8"))).toEqual({ dependencies: { "@singtaa/lightning": "1.2.0" } })
        const config = fs.readFileSync(path.join(root, "esbuild.config.mjs"), "utf8")
        expect(config.startsWith(`import { assetsPlugin, cartsPlugin } from "${PACKAGE}/unity"\n`)).toBe(true)
        expect(config).toContain("        cartsPlugin(),\n        importTransformPlugin(),")
        expect(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies).toMatchObject({ "onejs-play": "^0.8.3", [PACKAGE]: expect.stringMatching(/^\^0\./) })
        expect(npm).toEqual(["install --no-audit --no-fund"])
        // Again: nothing doubled, npm not run twice.
        await add(root, "@singtaa/lightning", { npm: (_dir: string, args: string[]) => { npm.push(args.join(" ")); return 0 } })
        expect(fs.readFileSync(path.join(root, "esbuild.config.mjs"), "utf8")).toBe(config)
        expect(npm).toHaveLength(1)
    })

    it("adds the plugin call once, beside assetsPlugin's import or on its own", () => {
        const bare = `const config = {\n    plugins: [\n        x(),\n    ],\n}\n`
        const once = withCartsPlugin(bare)
        expect(once.startsWith(`import { cartsPlugin } from "${PACKAGE}/unity"\n`)).toBe(true)
        expect(withCartsPlugin(once)).toBe(once)
        expect(() => withCartsPlugin("const config = {}\n")).toThrow(/no plugins list/)
    })
})
