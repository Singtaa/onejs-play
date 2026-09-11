import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as esbuild from "esbuild"
import { buildGame, formatBuildErrors, normalize } from "../build/game.mjs"
import { build, entryOf, manifestOf, readTree, stageOf } from "./game.mjs"
import { sidFromRemote, folderFor } from "./site.mjs"
import { keyOf } from "./chrome.mjs"
import { RUNTIME_FILES, runtimeDir } from "./local.mjs"
import { init } from "./init.mjs"
import { containerBoot } from "../host/boot.mjs"

const STARTER = path.resolve(import.meta.dirname, "../examples/starter")

// buildGame defaults absWorkingDir to "/", which the wasm build accepts
// everywhere and the native binary refuses on Windows. These tests drive the
// native binary, so they state it the way cli/game.mjs does.
const NATIVE = { workingDir: path.parse(process.cwd()).root || "/" }

function scratch(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-test-"))
    for (const [name, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
        fs.writeFileSync(path.join(dir, name), text)
    }
    return dir
}

describe("the tree the site would build", () => {
    it("reads source files, nested, and leaves dot folders, node_modules and assets out", () => {
        const dir = scratch({
            "index.tsx": "a", "ui/Panel.tsx": "b", "oj.json": "{}", "notes.md": "n",
            "sprite.png": "\x89PNG", ".oj/bundle.js": "built", ".gitignore": "x",
            "node_modules/x/index.js": "no", "tsconfig.json": "{}",
        })
        expect(readTree(dir).map((f) => f.name)).toEqual(["index.tsx", "notes.md", "oj.json", "tsconfig.json", "ui/Panel.tsx"])
    })

    it("takes the entry from the manifest and refuses one that names a missing file", () => {
        const files = [{ name: "index.tsx", text: "" }, { name: "game.tsx", text: "" }, { name: "oj.json", text: "{\"entry\":\"game.tsx\"}" }]
        expect(entryOf(files, manifestOf(files))).toBe("game.tsx")
        expect(() => entryOf(files, { entry: "nope.tsx" })).toThrow(/nope\.tsx/)
        expect(entryOf([{ name: "index.ts", text: "" }], {})).toBe("index.ts")
        expect(() => entryOf([{ name: "a.ts", text: "" }], {})).toThrow(/index\.tsx/)
    })

    it("refuses a manifest that is not JSON rather than treating it as empty", () => {
        expect(() => manifestOf([{ name: "oj.json", text: "{" }])).toThrow(/oj\.json/)
    })

    it("shapes the stage the way the sandbox document sends it", () => {
        expect(stageOf({})).toEqual({ size: [600, 600], fit: "letterbox" })
        expect(stageOf({ stage: { size: [960, 540], fit: "fluid" } })).toEqual({ size: [960, 540], fit: "fluid" })
    })
})

describe("building with the site's builder", () => {
    it("bundles the starter as an IIFE that reads its externals from the container", async () => {
        const built = await build(STARTER)
        expect(built.entry).toBe("index.tsx")
        expect(built.code.startsWith("var __exports=")).toBe(true)
        expect(built.code).toContain("__ojExternals")
        expect(built.code).not.toContain("react-reconciler")
    })

    it("names the file, line and column of a syntax error, one line per error", async () => {
        const dir = scratch({ "index.tsx": "import { mount } from \"oj\"\nconst x = ;\n" })
        await expect(build(dir)).rejects.toMatchObject({ lines: ["index.tsx:2:11: Unexpected \";\""] })
    })

    it("refuses a bare import with the site's sentence", async () => {
        const files = [{ name: "index.tsx", text: "import l from \"lodash\"\nconsole.log(l)\n" }]
        let lines: string[] = []
        try { await buildGame(esbuild, files, "index.tsx", NATIVE) } catch (error) { lines = formatBuildErrors(error) }
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatch(/^index\.tsx:1:15: "lodash" is not available here/)
    })

    it("bundles a game whose files import each other, at the root and a folder down", async () => {
        // The single-file starter cannot catch this. With a non-"/" working
        // directory esbuild rejoins the virtual resolveDir onto it, so the
        // resolver sees "C:\index.tsx" rather than "/index.tsx"; before the
        // resolver tolerated that prefix, every multi-file game on Windows
        // failed with `cannot resolve ./ui/Panel`, blaming the game's own
        // import for a defect in the builder.
        const files = [
            { name: "index.tsx", text: `import { panel } from "./ui/Panel"\nimport { tag } from "./tag"\nconsole.log(panel(), tag())\n` },
            { name: "ui/Panel.tsx", text: `export const panel = () => "panel"\n` },
            { name: "tag.ts", text: `export const tag = () => "tag"\n` },
        ]
        const built = await buildGame(esbuild, files, "index.tsx", NATIVE)
        expect(built.code).toContain("panel")
        expect(built.code).toContain("tag")
    })

    it("names the importing file when a relative import really is missing", async () => {
        const files = [{ name: "index.tsx", text: `import { gone } from "./nope"\nconsole.log(gone)\n` }]
        let lines: string[] = []
        try { await buildGame(esbuild, files, "index.tsx", NATIVE) } catch (error) { lines = formatBuildErrors(error) }
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatch(/cannot resolve \.\/nope/)
    })

    it("resolves relative imports inside the tree only", () => {
        expect(normalize("/ui/../game.ts")).toBe("/game.ts")
        expect(normalize("/../../etc/passwd")).toBe("/etc/passwd")
    })
})

describe("the site from a terminal", () => {
    it("reads the sid out of a clone URL and nothing else", () => {
        expect(sidFromRemote("https://play.onejs.com/g/a5x3a2uwh5gb.git")).toBe("a5x3a2uwh5gb")
        expect(sidFromRemote("https://x:tok@play.onejs.com/g/a5x3a2uwh5gb.git/")).toBe("a5x3a2uwh5gb")
        expect(sidFromRemote("git@github.com:Singtaa/onejs-play.git")).toBeNull()
        expect(sidFromRemote("")).toBeNull()
    })

    it("names a folder after the game without punctuation", () => {
        expect(path.basename(folderFor("My Cool Game!"))).toBe("my-cool-game")
        expect(path.basename(folderFor("???"))).toBe("game")
    })
})

describe("the browser", () => {
    it("turns DOM key codes into what Chrome wants beside them", () => {
        expect(keyOf("KeyA")).toEqual({ key: "a", vk: 65 })
        expect(keyOf("Digit3")).toEqual({ key: "3", vk: 51 })
        expect(keyOf("Space")).toEqual({ key: " ", vk: 32 })
        expect(keyOf("ArrowLeft")).toEqual({ key: "ArrowLeft", vk: 37 })
        expect(() => keyOf("a")).toThrow(/DOM codes/)
    })

    it("caches a container per version under the oj home", () => {
        process.env.OJ_HOME = "/tmp/ojhome"
        expect(runtimeDir("1.0.40")).toBe(path.join("/tmp/ojhome", "runtime", "1.0.40"))
        delete process.env.OJ_HOME
        expect(RUNTIME_FILES).toHaveLength(4)
    })
})

describe("the boot both documents inline", () => {
    it("loads the runtime from the prefix, hands the manifest to the container and reports through the caller's function", () => {
        const script = containerBoot({
            runtime: "https://play.example.test/runtime/1.0.0",
            manifest: { name: "Pop", runtime: "1.0.0", stage: { size: [600, 600], fit: "letterbox" } },
            bundle: "function bundle() { return Promise.resolve(\"var __exports = {}\") }",
            report: "function report(type, payload) { globalThis.reported = [type, payload] }",
        })
        expect(script).toContain("\"https://play.example.test/runtime/1.0.0/PlayContainer.loader.js\"")
        expect(script).toContain("__ojPlay.load(source, manifest)")
        expect(script).toContain("const manifest = {\"name\":\"Pop\"")
        expect(script).toContain("report(\"ready\", { ms })")
        expect(script).toContain("function bundle()")
        // The parts a caller does not supply are declared here, once.
        expect(script).toContain("function startGame(source)")
        expect(script).toContain("let loadedSource = null")
        // Parseable as a script: a syntax error here is every game on the site not starting.
        expect(() => new Function(script)).not.toThrow()
    })
})

describe("the tooling a clone writes for itself", () => {
    it("writes the files once, names the package after the game, and never overwrites", () => {
        const dir = scratch({ "index.tsx": "", "oj.json": "{\"name\":\"Big Fish!\"}", ".gitignore": "node_modules\n" })
        const first = init(dir)
        expect(first).toEqual([
            "package.json: written", "tsconfig.json: written", "env.d.ts: written",
            ".gitignore: added .oj, package.json, package-lock.json, tsconfig.json, env.d.ts",
        ])
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
        expect(pkg.name).toBe("big-fish")
        expect(pkg.scripts.test).toBeUndefined()
        expect(pkg.devDependencies["onejs-play"]).toMatch(/^\^0\./)
        fs.writeFileSync(path.join(dir, "tsconfig.json"), "{ \"mine\": true }")
        const second = init(dir)
        expect(second[1]).toBe("tsconfig.json: already there, left alone")
        expect(second[3]).toBe(".gitignore: already covers the tooling")
        expect(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8")).toBe("{ \"mine\": true }")
    })

    it("keeps the ignore rules out of the repository when there is one", () => {
        const dir = scratch({ "index.tsx": "", ".git/HEAD": "ref: refs/heads/main\n" })
        const lines = init(dir)
        expect(lines[3]).toBe(".git/info/exclude: written")
        expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false)
        expect(fs.readFileSync(path.join(dir, ".git/info/exclude"), "utf8")).toContain("package.json")
    })

    it("recognises entries a Windows .gitignore already carries, CRLF and all", () => {
        const dir = scratch({ "index.tsx": "", ".gitignore": "node_modules\r\n.oj\r\n" })
        const lines = init(dir)
        expect(lines[3]).toBe(".gitignore: added package.json, package-lock.json, tsconfig.json, env.d.ts")
        const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8")
        expect(text.match(/node_modules/g)).toHaveLength(1)
        expect(text).not.toMatch(/\r\n?[^\n]*\r/)
    })

    it("keeps the test script for a game that has a playtest", () => {
        const dir = scratch({ "index.tsx": "", "playtest.mjs": "export default async () => {}" })
        init(dir)
        expect(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).scripts.test).toBe("oj test playtest.mjs")
    })

    it("leaves the starter at two files", () => {
        expect(fs.readdirSync(STARTER).sort()).toEqual(["index.tsx", "oj.json"])
    })
})
