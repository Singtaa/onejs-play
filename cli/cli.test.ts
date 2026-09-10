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

const STARTER = path.resolve(import.meta.dirname, "../examples/starter")

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
        try { await buildGame(esbuild, files, "index.tsx") } catch (error) { lines = formatBuildErrors(error) }
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatch(/^index\.tsx:1:15: "lodash" is not available here/)
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
