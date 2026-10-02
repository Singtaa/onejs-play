import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as esbuild from "esbuild"
import { buildGame, formatBuildErrors, normalize } from "../build/game.mjs"
import { build, entryOf, manifestOf, readTree } from "./game.mjs"
import { addressFromRemote, sidFromRemote, sidOf, siteOrigin, folderFor, credentialArgs } from "./site.mjs"
import { chromeArgs, keyOf, keyEvent, launch } from "./chrome.mjs"
import { RUNTIME_FILES, runtimeDir } from "./local.mjs"
import { init } from "./init.mjs"
import { initUnity, oneJSOf, stableGuid, TEMPLATE_MAPPING } from "./unity.mjs"
import { assetsPlugin, buildConfig, syncAssets } from "./unity-assets.mjs"
import { spawnSync } from "node:child_process"
import { Game } from "./run.mjs"
import { containerBoot } from "../host/boot.mjs"
import { PACKAGE } from "../build/command.mjs"

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

    it("builds a .sl file into the bundle and hands back its manifest", async () => {
        // The plugin compiles the parser itself here, because Node can. In the
        // Worker, PlaySite hands one in; that path is covered on the site.
        const files = [
            { name: "plasma.sl", text: "uniform float warp = 0.5;\nfloat4 main() { return float4(uv * warp, 0, 1); }\n" },
            { name: "index.tsx", text: `import plasma from "./plasma.sl"\nconsole.log(plasma.hash)\n` },
        ]
        const built = await buildGame(esbuild, files, "index.tsx", NATIVE)
        // The compiled program, not a parser and not the source: a game is
        // downloaded before it is played, and the .sl text would be dead weight
        // in it. Nor an instruction buffer: the program is compiled.
        expect(built.code).not.toContain("uniform float warp")
        expect(built.code).toContain(`hash:"`)
        expect(built.code).toContain("sl_fs")
        expect(built.code).not.toContain("resultRegister")
        expect(built.slManifest?.programs).toHaveLength(1)
        expect(built.slManifest?.programs[0]?.uniforms).toEqual(["warp"])
        expect(built.slManifest?.programs[0]?.hlsl).toContain("CGPROGRAM")
    })

    it("reports a .sl parse error with its own file, line and column", async () => {
        const files = [
            { name: "bad.sl", text: "float4 main() {\n    return float4(uv.z, 0, 0, 1);\n}\n" },
            { name: "index.tsx", text: `import bad from "./bad.sl"\nconsole.log(bad)\n` },
        ]
        let lines: string[] = []
        try { await buildGame(esbuild, files, "index.tsx", NATIVE) } catch (error) { lines = formatBuildErrors(error) }
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatch(/^bad\.sl:2:22: .*is component 3 of a float2/)
    })

    it("hands back an empty manifest for a game with no shader at all", async () => {
        const files = [{ name: "index.tsx", text: "console.log(1)\n" }]
        const built = await buildGame(esbuild, files, "index.tsx", NATIVE)
        expect(built.slManifest).toEqual({ version: 1, programs: [] })
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

describe("the command line", () => {
    const OJ = path.resolve(import.meta.dirname, "oj.mjs")
    const OWN = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")).version

    // It printed the whole usage and exited 1, with the version as its last line.
    it("prints only its version for --version", () => {
        const run = spawnSync(process.execPath, [OJ, "--version"], { encoding: "utf8", env: { ...process.env, OJPLAY_NO_UPDATE_CHECK: "1" } })
        expect(run.stdout).toBe(`${OWN}\n`)
        expect(run.status).toBe(0)
    })

    const oj = (args: string[]) => spawnSync(process.execPath, [OJ, ...args], {
        encoding: "utf8",
        env: { ...process.env, OJPLAY_NO_UPDATE_CHECK: "1", OJPLAY_HANDED_OFF: "1" },
    })

    // `init --help` wrote four files, `build --help` built, and `push --help` pushed.
    it("prints help for <command> --help and runs nothing", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "oj-help-"))
        try {
            for (const flag of ["--help", "-h"]) {
                const run = oj(["init", flag, "--root", root])
                expect(run.status).toBe(0)
                expect(run.stdout).toMatch(/^usage:/)
            }
            expect(fs.readdirSync(root)).toEqual([])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("names the command a typo meant, without the whole usage", () => {
        const run = oj(["bulid"])
        expect(run.status).toBe(1)
        expect(run.stderr).toMatch(/unknown command bulid \(did you mean build\?\)/)
        expect(run.stdout).toBe("")
    })

    it("refuses an unknown flag before doing anything", () => {
        const run = oj(["test", "--hedaed"])
        expect(run.status).toBe(1)
        expect(run.stderr).toMatch(/unknown flag --hedaed \(did you mean --headed\?\)/)
    })
})

describe("the site from a terminal", () => {
    it("reads the sid out of a clone URL and nothing else", () => {
        expect(sidFromRemote("https://play.onejs.com/g/a5x3a2uwh5gb.git")).toBe("a5x3a2uwh5gb")
        expect(sidFromRemote("https://x:tok@play.onejs.com/g/a5x3a2uwh5gb.git/")).toBe("a5x3a2uwh5gb")
        expect(sidFromRemote("git@github.com:Singtaa/onejs-play.git")).toBeNull()
        expect(sidFromRemote("")).toBeNull()
    })

    // The site's short address moved from /g/ to /c/ (1 Oct 2026), and /g/
    // still answers git, so a clone can carry either.
    it("reads the sid out of a /c/ clone URL as well as an old /g/ one", () => {
        expect(sidFromRemote("https://play.onejs.com/c/a5x3a2uwh5gb.git")).toBe("a5x3a2uwh5gb")
        expect(sidFromRemote("https://x:tok@play.onejs.com/c/a5x3a2uwh5gb.git/")).toBe("a5x3a2uwh5gb")
        expect(sidFromRemote("https://play.onejs.com/x/a5x3a2uwh5gb.git")).toBeNull()
        expect(addressFromRemote("https://play.onejs.com/c/a5x3a2uwh5gb.git")).toBeNull()
    })

    // The address bar plus .git is the first URL a person tries, and the site
    // serves it, so push and status have to know which cart it is.
    it("reads the address out of a clone URL made from the address bar", () => {
        expect(addressFromRemote("https://play.onejs.com/@oj-newbie/dot-pop.git")).toBe("@oj-newbie/dot-pop")
        expect(addressFromRemote("https://x:tok@play.onejs.com/@OJ-Newbie/Dot-Pop.git/")).toBe("@oj-newbie/dot-pop")
        expect(addressFromRemote("https://play.onejs.com/g/a5x3a2uwh5gb.git")).toBeNull()
        expect(addressFromRemote("")).toBeNull()
    })

    describe("which cart a clone is", () => {
        function clone(remote: string): string {
            const root = scratch({})
            expect(spawnSync("git", ["init", "-q", root]).status).toBe(0)
            expect(spawnSync("git", ["-C", root, "remote", "add", "origin", remote]).status).toBe(0)
            return root
        }

        function account(carts: { sid: string, url: string }[]) {
            const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ handle: "oj-newbie", carts })))
            vi.stubGlobal("fetch", fetch)
            return fetch
        }

        afterEach(() => vi.unstubAllGlobals())

        it("reads a /c/ or /g/ clone's sid without asking the site", async () => {
            const fetch = account([])
            expect(await sidOf(clone("https://play.onejs.com/c/a5x3a2uwh5gb.git"), null)).toBe("a5x3a2uwh5gb")
            expect(await sidOf(clone("https://play.onejs.com/g/a5x3a2uwh5gb.git"), null)).toBe("a5x3a2uwh5gb")
            expect(fetch).not.toHaveBeenCalled()
        })

        it("asks the account which of its carts an address clone is", async () => {
            const fetch = account([
                { sid: "8xvg1ixn1i1r", url: `${siteOrigin()}/@oj-newbie/pop-kit` },
                { sid: "0gr0k7jhe16c", url: `${siteOrigin()}/@oj-newbie/dot-pop` },
            ])
            expect(await sidOf(clone("https://play.onejs.com/@oj-newbie/dot-pop.git"), "tok")).toBe("0gr0k7jhe16c")
            expect(fetch.mock.calls[0][0]).toBe(`${siteOrigin()}/api/me/carts`)
            expect(fetch.mock.calls[0][1]?.headers).toEqual({ authorization: "Bearer tok" })
        })

        it("names the address it could not find, and how to look", async () => {
            account([{ sid: "0gr0k7jhe16c", url: `${siteOrigin()}/@oj-newbie/dot-pop` }])
            await expect(sidOf(clone("https://play.onejs.com/@oj-newbie/square-dodge.git"), "tok"))
                .rejects.toThrow(/@oj-newbie\/square-dodge.*list/)
        })

        it("asks for a login before it can look an address up", async () => {
            account([])
            await expect(sidOf(clone("https://play.onejs.com/@oj-newbie/dot-pop.git"), null)).rejects.toThrow(/login/)
        })

        it("still says a folder is not a clone", async () => {
            account([])
            await expect(sidOf(clone("git@github.com:Singtaa/onejs-play.git"), "tok")).rejects.toThrow(/not a clone of a cart/)
        })
    })

    it("resets the credential helpers before adding its own, so a stored one cannot run first", () => {
        const args = credentialArgs("tok")
        expect(args.slice(0, 2)).toEqual(["-c", "credential.helper="])
        expect(args[3]).toMatch(/^credential\.helper=!f\(\) \{ echo username=oj; echo password=tok; \}; f$/)
    })

    it("names a folder after the cart without punctuation", () => {
        expect(path.basename(folderFor("My Cool Game!"))).toBe("my-cool-game")
        expect(path.basename(folderFor("???"))).toBe("cart")
    })
})

describe("the browser", () => {
    it("turns DOM key codes into what Chrome wants beside them", () => {
        expect(keyOf("KeyA")).toEqual({ key: "a", vk: 65, text: "a" })
        expect(keyOf("Digit3")).toEqual({ key: "3", vk: 51, text: "3" })
        expect(keyOf("Space")).toEqual({ key: " ", vk: 32, text: " " })
        expect(keyOf("Enter")).toEqual({ key: "Enter", vk: 13, text: "\r" })
        expect(keyOf("ArrowLeft")).toEqual({ key: "ArrowLeft", vk: 37 })
        expect(() => keyOf("a")).toThrow(/DOM codes/)
    })

    // Chrome's model of a keystroke: a key that types goes down as keyDown
    // with its text, one that types nothing as rawKeyDown. Enter used to go
    // down with no text, which a real keyboard never sends (#3).
    it("sends a key down the way a real keystroke arrives", () => {
        expect(keyEvent("keyDown", "Enter")).toMatchObject({ type: "keyDown", key: "Enter", text: "\r", windowsVirtualKeyCode: 13 })
        expect(keyEvent("keyDown", "KeyC")).toMatchObject({ type: "keyDown", key: "c", text: "c" })
        expect(keyEvent("keyDown", "Escape")).toEqual({ type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
        expect(keyEvent("keyDown", "ArrowUp").type).toBe("rawKeyDown")
        expect(keyEvent("keyUp", "Enter")).toEqual({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    })

    // CI ran Node 20 for months, where every oj run died on "WebSocket is
    // not defined"; nothing noticed until npm test started running oj test.
    it("refuses a Node without the global WebSocket before starting Chrome", async () => {
        vi.stubGlobal("WebSocket", undefined)
        try {
            await expect(launch()).rejects.toThrow(/needs Node 22 or newer; this is Node /)
        } finally {
            vi.unstubAllGlobals()
        }
    })

    // Without these, Chrome asks the OS keychain for its cookie key at the first
    // navigation: on macOS with no keychain under HOME that is a modal dialog,
    // and Page.navigate waits on it until somebody clicks. With a real HOME it
    // writes Chrome Safe Storage into the person's login keychain instead.
    it("keeps Chrome away from the system keychain and password store", () => {
        for (const headless of [true, false]) {
            const args = chromeArgs({ headless, window: [960, 540], profile: "/tmp/p" })
            expect(args).toContain("--use-mock-keychain")
            expect(args).toContain("--password-store=basic")
            expect(args).toContain("--user-data-dir=/tmp/p")
            expect(args.at(-1)).toBe("about:blank")
        }
    })

    // A Chrome that never came up left its profile in the temp folder, one per
    // failed run: 30 of them, 598 MB, on one machine by Oct 2026.
    it("removes its profile when Chrome does not start", async () => {
        const prefix = `oj-chrome-test-${process.pid}-`
        vi.stubEnv("OJ_CHROME", process.execPath)
        try {
            await expect(launch({ profilePrefix: prefix })).rejects.toThrow(/Chrome did not start/)
        } finally {
            vi.unstubAllEnvs()
        }
        expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix))).toEqual([])
    })

    it("caches a container per version under the oj home", () => {
        process.env.OJ_HOME = "/tmp/ojhome"
        expect(runtimeDir("1.0.40")).toBe(path.join("/tmp/ojhome", "runtime", "1.0.40"))
        delete process.env.OJ_HOME
        expect(RUNTIME_FILES).toHaveLength(4)
    })
})

describe("a running game's console", () => {
    // What the container prints for a typo on a C# member, in the order it
    // prints it: the proxy's miss, then the frame loop dropping the callback.
    const TYPO = [
        { level: "error", text: "[QuickJS] Property not found: UnityEngine.Time.realtimeSinceStartupp" },
        { level: "error", text: "[oj] frame callback removed after throwing: Error: [QuickJS] Property not found: UnityEngine.Time.realtimeSinceStartupp" },
        { level: "error", text: "[OneJS React] Uncaught error: Error: [QuickJS] Property not found: UnityEngine.Application.platfrom" },
    ]

    it("counts a missing C# member as an error, since that is how a typo reaches the console", () => {
        const browser = { listeners: new Set<(line: { level: string, text: string }) => void>(), console: [] }
        const game = new Game({ root: ".", browser, server: null, manifest: null, say: () => {} })
        for (const line of TYPO) for (const listener of browser.listeners) listener(line)
        expect(game.errors).toEqual(TYPO.map((l) => l.text))
    })

    it("leaves warnings and logs out of the errors", () => {
        const browser = { listeners: new Set<(line: { level: string, text: string }) => void>(), console: [] }
        const game = new Game({ root: ".", browser, server: null, manifest: null, say: () => {} })
        for (const listener of browser.listeners) {
            listener({ level: "warning", text: "The AudioContext was not allowed to start." })
            listener({ level: "log", text: "[oj-local] ready 12" })
        }
        expect(game.errors).toEqual([])
    })

    // The container says ready the moment the cart is mounted; UI Toolkit
    // lays the tree out on a later frame. A playtest that read positions
    // straight away found nothing laid out on a loaded machine: Arcane
    // Portal's "expected 5 swatches, found 0" in CI.
    it("is ready once the cart has run two frames past mounting, not the moment it mounted", async () => {
        let frame = 7
        const seen: number[] = []
        const browser = {
            listeners: new Set<(line: { level: string, text: string }) => void>(),
            console: [{ level: "log", text: "[oj-local] ready 12" }],
            eval: async () => {
                seen.push(frame)
                return String(frame++)
            },
        }
        const game = new Game({ root: ".", browser, server: null, manifest: null, say: () => {} })
        expect(await game.ready()).toBe(12)
        expect(seen[0]).toBe(7)
        expect(seen.at(-1)).toBe(9)
    })
})

describe("the boot both documents inline", () => {
    it("loads the runtime from the prefix, hands the manifest to the container and reports through the caller's function", () => {
        const script = containerBoot({
            runtime: "https://play.example.test/runtime/1.0.0",
            manifest: { name: "Pop", runtime: "1.0.0" },
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
        expect(pkg.devDependencies[PACKAGE]).toMatch(/^\^0\./)
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
        // The existing lines keep their CRLF; the added ones carry no CR.
        expect(text).not.toMatch(/package\.json\r/)
    })

    it("finds the exclude file of a clone added as a submodule, whose .git is a file", () => {
        const dir = scratch({ "index.tsx": "" })
        const store = fs.mkdtempSync(path.join(os.tmpdir(), "oj-gitdir-"))
        expect(spawnSync("git", ["init", "-q", `--separate-git-dir=${store}`, dir]).status).toBe(0)
        expect(fs.statSync(path.join(dir, ".git")).isFile()).toBe(true)
        init(dir)
        expect(fs.readFileSync(path.join(store, "info", "exclude"), "utf8")).toContain("package.json")
        expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false)
    })

    it("writes a .gitignore, not the enclosing repository's exclude, for a folder that is not its own repository", () => {
        const outer = scratch({})
        expect(spawnSync("git", ["init", "-q", outer]).status).toBe(0)
        const dir = path.join(outer, "Assets", "Game")
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, "index.tsx"), "")
        init(dir)
        expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain("package.json")
        expect(fs.readFileSync(path.join(outer, ".git", "info", "exclude"), "utf8")).not.toContain("package.json")
    })

    it("keeps the test script for a game that has a playtest", () => {
        const dir = scratch({ "index.tsx": "", "playtest.mjs": "export default async () => {}" })
        init(dir)
        expect(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).scripts.test).toBe("ojplay test playtest.mjs")
    })

    it("leaves the starter at two files", () => {
        expect(fs.readdirSync(STARTER).sort()).toEqual(["index.tsx", "oj.json"])
    })
})

/** OneJS's esbuild.config.mjs template, cut to the two places buildConfig edits. */
const ESBUILD_TEMPLATE = "const config = {\n    entryPoints: [\"index.tsx\"],\n    plugins: [\n        importTransformPlugin(),\n    ],\n}\n"
/** OneJS 3.2.3 to 3.9.2 alias oj to the package's former name, in the build and in tsconfig. */
const ALIAS = "const alias = { \"oj\": path.resolve(process.cwd(), \"node_modules/onejs-play/src/index.ts\") }\n"
const TSCONFIG_TEMPLATE = "{ \"compilerOptions\": { \"paths\": { \"oj\": [\"./node_modules/onejs-play/src\"] } } }\n"

describe("a clone made into a JSRunner project", () => {
    /** A Unity project with OneJS in the package cache, its templates reduced to what the checks read. */
    function unityProject(): string {
        const project = scratch({ "ProjectSettings/ProjectVersion.txt": "m_EditorVersion: 6000.5.2f1\n", "Assets/.keep": "" })
        const onejs = path.join(project, "Library", "PackageCache", "com.singtaa.onejs@abc123")
        fs.mkdirSync(path.join(onejs, "Editor", "Templates"), { recursive: true })
        fs.writeFileSync(path.join(onejs, "package.json"), JSON.stringify({ name: "com.singtaa.onejs" }))
        for (const [template] of TEMPLATE_MAPPING) {
            const text = template === "package.json.txt"
                ? JSON.stringify({ name: "onejs-app", "//note": "for the editor", dependencies: { "onejs-play": "^0.8.3" } })
                : template === "esbuild.config.mjs.txt" ? ESBUILD_TEMPLATE + ALIAS
                : template === "tsconfig.json.txt" ? TSCONFIG_TEMPLATE
                : `template ${template}`
            fs.writeFileSync(path.join(onejs, "Editor", "Templates", template), text)
        }
        return project
    }

    function clone(project: string, folder: string, files: Record<string, string>): string {
        const root = path.join(project, "Assets", folder, "~")
        for (const [name, text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
            fs.writeFileSync(path.join(root, name), text)
        }
        expect(spawnSync("git", ["init", "-q", root]).status).toBe(0)
        return root
    }

    it("finds OneJS wherever the project installed it, by its name", () => {
        const project = unityProject()
        expect(oneJSOf(project)).toMatch(/com\.singtaa\.onejs@abc123$/)
        const store = scratch({ "ProjectSettings/ProjectVersion.txt": "", "Assets/Singtaa/OneJS/package.json": JSON.stringify({ name: "com.singtaa.onejs" }),
            "Assets/Singtaa/OneJS/Editor/Templates/package.json.txt": "{}", "Assets/Other/package.json": JSON.stringify({ name: "other" }) })
        expect(oneJSOf(store)).toBe(path.join(store, "Assets", "Singtaa", "OneJS"))
        expect(oneJSOf(scratch({ "ProjectSettings/ProjectVersion.txt": "", "Assets/.keep": "" }))).toBeNull()
    })

    it("writes JSRunner's files into the clone, builds the cart's entry, and keeps them all out of git", () => {
        const project = unityProject()
        const root = clone(project, "Big Fish", { "game.tsx": "", "oj.json": "{\"name\":\"Big Fish!\",\"entry\":\"game.tsx\"}" })
        const made = initUnity(root)
        expect(made.prefab).toBe("Assets/Big Fish/BigFish.prefab")
        // The cart keeps its own entry: JSRunner's index.tsx is never written beside it.
        expect(fs.existsSync(path.join(root, "index.tsx"))).toBe(false)
        const config = fs.readFileSync(path.join(root, "esbuild.config.mjs"), "utf8")
        expect(config).toContain("entryPoints: [\"game.tsx\"]")
        expect(config.startsWith(`import { assetsPlugin, cartsPlugin } from "${PACKAGE}/unity"\n`)).toBe(true)
        expect(config).toContain("    plugins: [\n        // The carts oj.json uses, resolved and scoped as on the site\n        cartsPlugin(),\n        // The cart's files, copied into assets/ where OneJS looks for them\n        assetsPlugin(),\n        importTransformPlugin(),")
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
        expect(pkg.name).toBe("big-fish")
        expect(pkg["//note"]).toBeUndefined()
        const own = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")).version
        expect(pkg.dependencies["onejs-play"]).toBeUndefined()
        // The oj alias follows the package to its new name.
        expect(config).toContain(`node_modules/${PACKAGE}/src/index.ts`)
        expect(config).not.toContain("onejs-play")
        expect(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).toBe(TSCONFIG_TEMPLATE.replace("onejs-play", PACKAGE))
        expect(pkg.dependencies[PACKAGE]).toBe(`^${own}`)
        expect(fs.readFileSync(path.join(root, "types", "global.d.ts"), "utf8")).toBe("template global.d.ts.txt")
        // The build's copies of the cart's files stay out of git too.
        fs.writeFileSync(path.join(root, "glow.png"), "png")
        expect(syncAssets(root).copied).toEqual(["glow.png"])
        const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).stdout
        expect(status.split("\n").filter(Boolean).sort()).toEqual(["?? game.tsx", "?? glow.png", "?? oj.json"])
    })

    it("points OneJS's preset template at the cart's entry too", () => {
        const preset = "import { oneJSConfig } from \"onejs-unity/esbuild\"\nexport default oneJSConfig({\n    entry: \"index.tsx\",\n    plugins: [\n    ],\n})\n"
        const config = buildConfig(preset, "game.tsx")
        expect(config).toContain("entry: \"game.tsx\",")
        expect(config).not.toContain("index.tsx")
        expect(config).toContain("assetsPlugin(),")
    })

    it("refuses a build template it cannot add the file copy to", () => {
        expect(() => buildConfig("const config = {\n    entryPoints: [\"index.tsx\"],\n}\n", "index.tsx")).toThrow(/no plugins list/)
    })

    it("puts a prefab beside the clone whose JSRunner points at the PanelSettings next to it", () => {
        const project = unityProject()
        const root = clone(project, "Tinder", { "index.tsx": "" })
        initUnity(root)
        const folder = path.join(project, "Assets", "Tinder")
        const panelGuid = /guid: ([0-9a-f]{32})/.exec(fs.readFileSync(path.join(folder, "PanelSettings.asset.meta"), "utf8"))![1]
        expect(panelGuid).toBe(stableGuid("Assets/Tinder/PanelSettings.asset"))
        const prefab = fs.readFileSync(path.join(folder, "Tinder.prefab"), "utf8")
        expect(prefab).toContain(`_panelSettings: {fileID: 11400000, guid: ${panelGuid}, type: 2}`)
        expect(prefab).toContain("m_Script: {fileID: 11500000, guid: 35e89416e424048d08fdc44af24ad1b8, type: 3}")
        expect(fs.readFileSync(path.join(folder, "Tinder.prefab.meta"), "utf8")).toContain("PrefabImporter:")
    })

    it("leaves everything alone the second time", () => {
        const project = unityProject()
        const root = clone(project, "Tinder", { "index.tsx": "" })
        initUnity(root)
        fs.writeFileSync(path.join(root, "tsconfig.json"), "{ \"mine\": true }")
        const again = initUnity(root)
        expect(again.lines.filter((l) => l.endsWith(": written"))).toEqual([])
        expect(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).toBe("{ \"mine\": true }")
    })

    it("says where the clone should go when it is somewhere a JSRunner project cannot be", () => {
        const project = unityProject()
        const wrongName = path.join(project, "Assets", "Tinder")
        fs.mkdirSync(wrongName, { recursive: true })
        expect(() => initUnity(wrongName)).toThrow(/folder named ~ inside Assets, such as Assets\/Tinder\/~/)
        const outside = scratch({ "Game/~/index.tsx": "" })
        expect(() => initUnity(path.join(outside, "Game", "~"))).toThrow(/not inside a Unity project's Assets folder/)
        const bare = scratch({ "ProjectSettings/ProjectVersion.txt": "", "Assets/Game/~/index.tsx": "" })
        expect(() => initUnity(path.join(bare, "Assets", "Game", "~"))).toThrow(/does not have OneJS installed/)
    })
})

describe("a clone's files in a Unity project", () => {
    const read = (root: string, name: string) => fs.readFileSync(path.join(root, "assets", ...name.split("/")), "utf8")
    const has = (root: string, name: string) => fs.existsSync(path.join(root, "assets", ...name.split("/")))

    it("copies what the site would serve into assets/, keeping its folders", () => {
        const root = scratch({
            "index.tsx": "", "oj.json": "{}", "glow.png": "a", "art/bg.jpg": "b", "sfx/pop.wav": "c",
            "old.webp": "not stored", "notes.txt": "not an asset", ".oj/cover.png": "card art",
            "node_modules/x/y.png": "installed", ".git/z.png": "git",
        })
        expect(syncAssets(root)).toEqual({ copied: ["art/bg.jpg", "glow.png", "sfx/pop.wav"], removed: [] })
        expect(read(root, "glow.png")).toBe("a")
        expect(read(root, "art/bg.jpg")).toBe("b")
        for (const name of ["old.webp", "notes.txt", "index.tsx", "cover.png", ".oj/cover.png", "x/y.png", "z.png"]) {
            expect(has(root, name), name).toBe(false)
        }
    })

    it("copies only what changed, and again when a file does", () => {
        const root = scratch({ "glow.png": "a", "pop.wav": "b" })
        syncAssets(root)
        expect(syncAssets(root)).toEqual({ copied: [], removed: [] })
        // The same size, so only the time can tell it changed.
        fs.writeFileSync(path.join(root, "glow.png"), "z")
        const later = new Date(Date.now() + 10_000)
        fs.utimesSync(path.join(root, "glow.png"), later, later)
        expect(syncAssets(root).copied).toEqual(["glow.png"])
        expect(read(root, "glow.png")).toBe("z")
    })

    it("removes a copy once its file leaves the cart, and nothing it did not write", () => {
        const root = scratch({ "art/bg.png": "a", "glow.png": "b", "assets/mine.png": "put there by hand" })
        syncAssets(root)
        fs.rmSync(path.join(root, "art"), { recursive: true })
        expect(syncAssets(root)).toEqual({ copied: [], removed: ["art/bg.png"] })
        expect(has(root, "art")).toBe(false)
        expect(read(root, "glow.png")).toBe("b")
        expect(read(root, "mine.png")).toBe("put there by hand")
    })

    it("copies at the start of every build the plugin is in", async () => {
        const root = scratch({ "index.ts": "export const a = 1\n", "glow.png": "a" })
        await esbuild.build({ entryPoints: ["index.ts"], absWorkingDir: root, write: false, logLevel: "silent", plugins: [assetsPlugin()] })
        expect(read(root, "glow.png")).toBe("a")
    })
})

describe("the scaffold's pins", () => {
    // `oj init` writes this package.json into every new game. A pin a minor
    // behind the package it names installs the release before it, which in
    // 0.x is a different API; one the installed version does not satisfy
    // cannot install at all.
    const scaffold = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "scaffold/package.json"), "utf8"))
    const versionOf = (name: string) => name === PACKAGE
        ? JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")).version
        : JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../node_modules/${name}/package.json`), "utf8")).version
    for (const name of [PACKAGE, "onejs-unity", "onejs-react"]) {
        it(`pins ${name} on the minor it is`, () => {
            const pin = scaffold.devDependencies[name] as string
            const [major, minor, patch] = versionOf(name).split(".").map(Number)
            const floor = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pin)
            expect(floor, `${name} ${pin}`).not.toBeNull()
            expect([Number(floor![1]), Number(floor![2])], `${name} ${pin} against ${major}.${minor}.${patch}`).toEqual([major, minor])
            expect(Number(floor![3]), `${name} ${pin}`).toBeLessThanOrEqual(patch!)
        })
    }
})
