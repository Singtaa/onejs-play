import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { add, remove, syncTypes, update } from "./carts.mjs"
import { build } from "./game.mjs"
import { COMMAND, PACKAGE } from "../build/command.mjs"

/**
 * `ojplay add`, `update` and `remove` (PlaySite docs/carts.md §3, step 5)
 * against a stand-in for the site's three routes: the pin, a kept build, and
 * one of its files. The stand-in answers the way PlaySite's do, which its own
 * tests hold (src/used-carts.test.ts, "a kept build, for oj add").
 */

interface Build { files: Record<string, string>, assets?: Record<string, Uint8Array>, builtAt?: number }
interface Cart { versions: Record<string, string>, live: string | null, builds: Record<string, Build> }

const COMMIT = (c: string) => c.repeat(40).slice(0, 40)
let carts: Record<string, Cart> = {}
/** What /api/me/carts answers the token "the-owner". */
let mineList: Array<{ sid: string, name: string, public: boolean, url: string, clone: string }> = []
const asked: string[] = []
let server: Server
let origin = ""

const keptOf = (cart: Cart, pin: string) => {
    if (pin in cart.versions) return { commit: cart.versions[pin]!, version: pin }
    const commit = Object.keys(cart.builds).find((c) => c.startsWith(pin))
    return commit === undefined ? null : { commit, version: null }
}

beforeAll(async () => {
    server = createServer((req, res) => {
        const send = (status: number, body: unknown) => {
            res.writeHead(status, { "content-type": "application/json" })
            res.end(JSON.stringify(body))
        }
        asked.push(`${req.method} ${req.url}`)
        let body = ""
        req.on("data", (c) => { body += c })
        req.on("end", () => {
            if (req.url === "/api/me/carts") {
                return req.headers.authorization === "Bearer the-owner" ? send(200, { handle: "singtaa", carts: mineList }) : send(401, { error: "The site does not know this token. Run npx ojplay login again." })
            }
            const m = /^\/api\/carts\/(@[^/]+\/[^/]+)\/(pin|kept\/([^/]+)(?:\/files\/(.+))?)$/.exec(req.url ?? "")
            const cart = m === null ? undefined : carts[m[1]!.toLowerCase()]
            if (m === null || cart === undefined) return send(404, { error: "No cart at that address. Check the spelling; a private cart can be added only by its owner." })
            const address = m[1]!.toLowerCase()
            if (m[2] === "pin") {
                const { within, major } = body === "" ? {} : JSON.parse(body)
                const versions = Object.keys(cart.versions)
                    .filter((v) => within === undefined || major === true || v.split(".")[0] === within.split(".")[0])
                    .sort((a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]! })
                if (Object.keys(cart.versions).length > 0) {
                    const version = versions.at(-1)
                    if (version === undefined) return send(409, { error: "This cart has no such version." })
                    const commit = cart.versions[version]!
                    return send(200, { address, version, commit, builtAt: cart.builds[commit]!.builtAt ?? 1 })
                }
                if (cart.live === null) return send(409, { error: "This cart has nothing running yet, so there is nothing to add. Try again once it builds." })
                return send(200, { address, version: null, commit: cart.live, builtAt: cart.builds[cart.live]!.builtAt ?? 1 })
            }
            const kept = keptOf(cart, decodeURIComponent(m[3]!))
            if (kept === null) return send(404, { error: `${address} has no version ${m[3]}.` })
            const build = cart.builds[kept.commit]!
            if (m[4] !== undefined) {
                const bytes = build.assets?.[decodeURIComponent(m[4])]
                if (bytes === undefined) return send(404, { error: "No such file in that build." })
                res.writeHead(200, { "content-type": "application/octet-stream" })
                return res.end(bytes)
            }
            send(200, {
                address, version: kept.version, commit: kept.commit, builtAt: build.builtAt ?? 1,
                files: Object.entries(build.files).map(([name, text]) => ({ name, text })),
                assets: Object.fromEntries(Object.keys(build.assets ?? {}).map((n) => [n, "sha-" + n])),
            })
        })
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

/** A folder named `name`, holding `files`, with the stand-in as the site and no login anywhere. */
function folder(name: string, files: Record<string, string> = {}): string {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-add-"))
    made.push(parent)
    const root = path.join(parent, name)
    fs.mkdirSync(root)
    for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), text)
    }
    process.env.OJ_SITE = origin
    process.env.OJ_HOME = path.join(parent, "home")
    delete process.env.OJ_TOKEN
    asked.length = 0
    return root
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8")
const json = (root: string, file: string) => JSON.parse(read(root, file))
const exists = (root: string, file: string) => fs.existsSync(path.join(root, file))
const GLOW = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

/** A cart with pieces: Bolt and Glow, a constant, and art of its own. */
function lightning(versions: string[]): Cart {
    const cart: Cart = { versions: {}, live: null, builds: {} }
    versions.forEach((v, i) => {
        const commit = COMMIT(String(i + 1))
        cart.versions[v] = commit
        cart.builds[commit] = {
            files: {
                "oj.json": JSON.stringify({ schema: 1, name: "lightning", entry: "index.tsx", version: v, exports: "bolt.tsx", runtime: "1.4.0", controls: ["pointer"] }),
                "index.tsx": "import { mount, View } from \"oj\"\nmount(<View />)\n",
                "bolt.tsx": `import { View } from "oj"\nexport const said = "lightning ${v}"\nexport const COLORS = ["#fff"]\nexport function Bolt() { return <View name="bolt ${v}" /> }\nexport const Glow = () => <View />\n`,
                "fx/spark.ts": "export const spark = 1\n",
            },
            assets: { "glow.png": GLOW, "fx/flash.png": GLOW },
        }
    })
    return cart
}

/** A whole cart: no exports, a game that runs when imported. Built twice, no versions. */
function portal(): Cart {
    const one = COMMIT("a"), two = COMMIT("b")
    const files = (word: string) => ({
        "oj.json": JSON.stringify({ schema: 1, name: "portal", entry: "main.tsx", runtime: "1.3.0", controls: ["keyboard"] }),
        "main.tsx": `import { mount, View } from "oj"\nglobalThis.said = "${word}"\nmount(<View />)\n`,
    })
    return {
        versions: {}, live: two,
        builds: { [one]: { files: files("portal one"), builtAt: Date.UTC(2026, 8, 30, 9) / 1000 }, [two]: { files: files("portal two"), builtAt: Date.UTC(2026, 9, 1, 9) / 1000 } },
    }
}

const CART = (deps?: Record<string, string>) => ({
    "oj.json": JSON.stringify({ schema: 1, name: "Storm", entry: "index.tsx", ...(deps ? { dependencies: deps } : {}) }, null, 4) + "\n",
    "index.tsx": "import { mount, View } from \"oj\"\nmount(<View />)\n",
})

describe("ojplay add, in a folder with nothing in it", () => {
    it("starts a cart that shows the used cart's components, with no account", async () => {
        carts = { "@singtaa/lightning": lightning(["1.2.0"]) }
        const root = folder("storm-chaser")
        expect(await add(root, "@singtaa/lightning")).toEqual([
            "Started a cart here that uses @singtaa/lightning 1.2.0: index.tsx shows Bolt, Glow.",
            `Next: ${COMMAND} run`,
        ])
        expect(json(root, "oj.json")).toEqual({
            schema: 1, runtime: "1.4.0", name: "Storm Chaser", entry: "index.tsx", controls: ["pointer"],
            dependencies: { "@singtaa/lightning": "1.2.0" },
        })
        expect(read(root, "index.tsx")).toContain(`import { said, COLORS, Bolt, Glow } from "@singtaa/lightning"`)
        expect(read(root, "index.tsx")).toContain("            <Bolt />\n            <Glow />\n")
        expect(read(root, ".gitignore")).toContain(".oj")
        // The source and the art, byte for byte, where the build reads them.
        expect(read(root, ".oj/carts/@singtaa/lightning@1.2.0/fx/spark.ts")).toBe("export const spark = 1\n")
        expect(new Uint8Array(fs.readFileSync(path.join(root, ".oj/carts/@singtaa/lightning@1.2.0/fx/flash.png")))).toEqual(GLOW)
        // Nobody was asked who they are: no login, no header.
        expect(fs.existsSync(path.join(process.env.OJ_HOME!, "token"))).toBe(false)
        const built = await build(root)
        expect(built.code).toContain("bolt 1.2.0")
    })

    it("starts a cart that runs a whole cart by importing it", async () => {
        carts = { "@singtaa/portal": portal() }
        const root = folder("my-portal")
        expect(await add(root, "@singtaa/portal")).toEqual([
            "Started a cart here that runs @singtaa/portal (1 Oct): index.tsx imports it, oj.json lists it.",
            `Next: ${COMMAND} run`,
        ])
        expect(json(root, "oj.json").dependencies).toEqual({ "@singtaa/portal": "#bbbbbbbbbbbb" })
        expect(json(root, "oj.json").controls).toEqual(["keyboard"])
        expect(read(root, "index.tsx")).toBe(`// @singtaa/portal is a whole cart: importing it runs it.\nimport "@singtaa/portal"\n`)
        expect((await build(root)).code).toContain("portal two")
    })

    it("says so when there is no such cart, and leaves the folder empty", async () => {
        carts = {}
        const root = folder("empty")
        await expect(add(root, "@singtaa/nothing")).rejects.toThrow("No cart at that address. Check the spelling; a private cart can be added only by its owner.")
        expect(fs.readdirSync(root)).toEqual([])
    })

    it("refuses what is not an address, saying what one looks like", async () => {
        const root = folder("empty")
        await expect(add(root, "lightning")).rejects.toThrow(`"lightning" is not a cart's address. One looks like @singtaa/lightning: @, the handle, a slash, the name.`)
        expect(asked).toEqual([])
    })
})

describe("ojplay add, in a cart", () => {
    it("adds the newest version to oj.json, fetches it, and says how to import it", async () => {
        carts = { "@singtaa/lightning": lightning(["1.2.0", "1.3.0"]) }
        const root = folder("storm", CART())
        expect(await add(root, "@Singtaa/Lightning")).toEqual([
            `Added @singtaa/lightning 1.3.0 to oj.json. It exports said, COLORS, Bolt, Glow: import { said, COLORS, Bolt, Glow } from "@singtaa/lightning"`,
            `Next: ${COMMAND} run`,
        ])
        expect(json(root, "oj.json")).toEqual({ schema: 1, name: "Storm", entry: "index.tsx", dependencies: { "@singtaa/lightning": "1.3.0" } })
        // The cart's own index.tsx is the author's: add never writes it.
        expect(read(root, "index.tsx")).toBe(CART()["index.tsx"])
        expect(await add(root, "@singtaa/lightning")).toEqual([
            `@singtaa/lightning 1.3.0 is already in oj.json, at its newest. It exports said, COLORS, Bolt, Glow: import { said, COLORS, Bolt, Glow } from "@singtaa/lightning"`,
            `Next: ${COMMAND} run`,
        ])
    })

    it("fetches what oj.json lists, and the carts those use, with no address", async () => {
        const rain = COMMIT("c")
        carts = {
            "@singtaa/lightning": lightning(["1.2.0"]),
            "@koma/rain": { versions: {}, live: rain, builds: { [rain]: { files: { "oj.json": JSON.stringify({ name: "rain", entry: "index.tsx", exports: "rain.ts", dependencies: { "@singtaa/lightning": "1.2.0" } }), "rain.ts": "export const rain = 1\n" }, builtAt: Date.UTC(2026, 9, 1, 9) / 1000 } } },
        }
        const root = folder("storm", CART({ "@koma/rain": "#cccccccccccc" }))
        expect(await add(root, undefined)).toEqual(["Fetched @koma/rain (1 Oct), @singtaa/lightning 1.2.0 into .oj/carts.", `Next: ${COMMAND} run`])
        expect(exists(root, ".oj/carts/@singtaa/lightning@1.2.0/bolt.tsx")).toBe(true)
        expect(await add(root, undefined)).toEqual(["Everything oj.json uses is already in .oj/carts.", `Next: ${COMMAND} run`])
    })

    it("points the tsconfig ojplay init wrote at the fetched source", async () => {
        carts = { "@singtaa/lightning": lightning(["1.2.0"]) }
        const root = folder("storm", { ...CART(), "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { oj: [`./node_modules/${PACKAGE}/src/index.ts`] } }, exclude: ["node_modules"] }) })
        await add(root, "@singtaa/lightning")
        expect(json(root, "tsconfig.json")).toEqual({
            compilerOptions: { paths: {
                "oj": [`./node_modules/${PACKAGE}/src/index.ts`],
                "@singtaa/lightning": ["./.oj/carts/@singtaa/lightning@1.2.0/bolt.tsx"],
                "@singtaa/lightning/*": ["./.oj/carts/@singtaa/lightning@1.2.0/*"],
            } },
            exclude: ["node_modules", ".oj"],
        })
        // A tsconfig that is the cart's own (no oj path) is left alone.
        const mine = folder("mine", { ...CART(), "tsconfig.json": "{ \"mine\": true }" })
        syncTypes(mine)
        expect(read(mine, "tsconfig.json")).toBe("{ \"mine\": true }")
    })

    it("refuses a Unity project without OneJS before fetching anything", async () => {
        const root = folder("Game", { "Assets/.keep": "", "ProjectSettings/ProjectVersion.txt": "" })
        await expect(add(root, "@singtaa/lightning")).rejects.toThrow(/^This Unity project does not have OneJS installed yet/)
        expect(asked).toEqual([])
        expect(fs.readdirSync(path.join(root, "Assets"))).toEqual([".keep"])
    })

    it("refuses a folder that has code but is not a cart, rather than writing over it", async () => {
        const root = folder("app", { "index.tsx": "export {}" })
        await expect(add(root, "@singtaa/lightning")).rejects.toThrow(`This folder has an index.tsx but no oj.json, so it is not a cart. Start one in an empty folder: mkdir my-cart && cd my-cart && ${COMMAND} add @singtaa/lightning`)
        expect(fs.readdirSync(root)).toEqual(["index.tsx"])
    })
})

describe("ojplay update", () => {
    it("moves a version within its major, and further with --major", async () => {
        carts = { "@singtaa/lightning": lightning(["1.2.0", "1.3.0", "2.0.0"]) }
        const root = folder("storm", CART({ "@singtaa/lightning": "1.2.0" }))
        expect(await update(root, undefined)).toEqual(["@singtaa/lightning 1.2.0 → 1.3.0.", `Next: ${COMMAND} run`])
        expect(json(root, "oj.json").dependencies).toEqual({ "@singtaa/lightning": "1.3.0" })
        expect(exists(root, ".oj/carts/@singtaa/lightning@1.3.0/bolt.tsx")).toBe(true)
        // The old one goes: nothing reaches it now.
        expect(exists(root, ".oj/carts/@singtaa/lightning@1.2.0")).toBe(false)
        expect(await update(root, undefined)).toEqual(["@singtaa/lightning 1.3.0 is the newest 1.x; --major looks further.", `Next: ${COMMAND} run`])
        expect(await update(root, "@singtaa/lightning", { major: true })).toEqual(["@singtaa/lightning 1.3.0 → 2.0.0.", `Next: ${COMMAND} run`])
    })

    it("moves a # pin to the running build and says it by days", async () => {
        carts = { "@singtaa/portal": portal() }
        const root = folder("storm", CART({ "@singtaa/portal": "#aaaaaaaaaaaa" }))
        expect(await update(root, undefined)).toEqual(["@singtaa/portal updated (30 Sep → 1 Oct).", `Next: ${COMMAND} run`])
        expect(json(root, "oj.json").dependencies).toEqual({ "@singtaa/portal": "#bbbbbbbbbbbb" })
    })

    it("names what oj.json uses when asked about something else", async () => {
        carts = { "@singtaa/lightning": lightning(["1.2.0"]) }
        const root = folder("storm", CART({ "@singtaa/lightning": "1.2.0" }))
        await expect(update(root, "@koma/rain")).rejects.toThrow("@koma/rain is not in oj.json. It uses @singtaa/lightning.")
    })
})

describe("ojplay remove", () => {
    it("takes it out of oj.json and .oj/carts, naming the files that still import it", async () => {
        carts = { "@singtaa/lightning": lightning(["1.2.0"]) }
        const root = folder("storm", { ...CART({ "@singtaa/lightning": "1.2.0" }), "hud/top.tsx": `import { Bolt } from "@singtaa/lightning"\n`, "other.ts": "export {}\n" })
        await add(root, undefined)
        expect(await remove(root, "@singtaa/lightning")).toEqual([
            "Removed @singtaa/lightning from oj.json. hud/top.tsx still imports it.",
            `Next: take that import out, then ${COMMAND} run`,
        ])
        expect(json(root, "oj.json")).toEqual({ schema: 1, name: "Storm", entry: "index.tsx" })
        expect(exists(root, ".oj/carts/@singtaa")).toBe(false)
        await expect(remove(root, "@singtaa/lightning")).rejects.toThrow("@singtaa/lightning is not in oj.json, which uses no carts.")
    })
})

describe("ojplay add at a Unity project's root", () => {
    /** A Unity project with OneJS in the package cache, its templates reduced to what init --unity reads. */
    function unityProject(): string {
        const project = folder("Game", { "ProjectSettings/ProjectVersion.txt": "m_EditorVersion: 6000.5.2f1\n", "Assets/.keep": "" })
        const templates = path.join(project, "Library", "PackageCache", "com.singtaa.onejs@abc123", "Editor", "Templates")
        fs.mkdirSync(templates, { recursive: true })
        fs.writeFileSync(path.join(templates, "..", "..", "package.json"), JSON.stringify({ name: "com.singtaa.onejs" }))
        for (const [template, text] of Object.entries({
            "package.json.txt": JSON.stringify({ name: "onejs-app", dependencies: { "onejs-play": "^0.8.3" } }),
            "tsconfig.json.txt": "{ \"compilerOptions\": { \"paths\": { \"oj\": [\"./node_modules/onejs-play/src\"] } } }\n",
            "esbuild.config.mjs.txt": "const config = {\n    entryPoints: [\"index.tsx\"],\n    plugins: [\n        importTransformPlugin(),\n    ],\n}\n",
            "index.tsx.txt": "", "global.d.ts.txt": "", "main.uss.txt": "", "gitignore.txt": "", "AGENTS.md.txt": "",
        })) fs.writeFileSync(path.join(templates, template), text)
        return project
    }
    const npmCalls: string[] = []
    const npm = (dir: string, args: string[]) => { npmCalls.push(`${path.relative(path.dirname(path.dirname(path.dirname(dir))), dir)}: npm ${args.join(" ")}`); return 0 }

    it("takes somebody else's cart whole, pinned, with its prefab, and installs and builds it", async () => {
        carts = { "@singtaa/portal": portal() }
        const project = unityProject()
        npmCalls.length = 0
        expect(await add(project, "@singtaa/portal", { npm })).toEqual([
            "Took @singtaa/portal (1 Oct) into Assets/portal/~, pinned and read only. To change it, fork it on " + origin + " and add yours.",
            "Next: drag Assets/portal/portal.prefab into a scene.",
        ])
        const app = path.join(project, "Assets", "portal", "~")
        expect(read(app, "main.tsx")).toContain("portal two")
        expect(json(app, ".oj-kept.json")).toMatchObject({ address: "@singtaa/portal", commit: "b".repeat(40) })
        expect(json(app, "package.json").dependencies).toEqual({ [PACKAGE]: expect.stringMatching(/^\^0\./) })
        expect(read(app, "esbuild.config.mjs")).toContain(`entryPoints: ["main.tsx"]`)
        expect(exists(project, "Assets/portal/portal.prefab")).toBe(true)
        expect(npmCalls).toEqual(["Assets/portal/~: npm install --no-audit --no-fund", "Assets/portal/~: npm run build"])
        // Nothing left behind from the fetch.
        expect(fs.readdirSync(path.join(project, "Assets")).sort()).toEqual([".keep", "portal", "portal.meta"].filter((n) => exists(project, `Assets/${n}`)))
    })

    it("takes your own cart as a clone you push from, through the stored login", async () => {
        const home = path.join(path.dirname(folder("unused")), "git")
        fs.mkdirSync(home, { recursive: true })
        const gitEnv = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: path.join(home, "gitconfig"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
        fs.writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, "")
        const work = path.join(home, "work"), bare = path.join(home, "storm.git")
        fs.mkdirSync(work)
        fs.writeFileSync(path.join(work, "index.tsx"), "import { mount, View } from \"oj\"\nmount(<View />)\n")
        fs.writeFileSync(path.join(work, "oj.json"), JSON.stringify({ name: "Storm Chaser", entry: "index.tsx" }))
        for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "first"], ["clone", "-q", "--bare", work, bare]]) {
            expect(spawnSync("git", args, { cwd: work, env: gitEnv }).status).toBe(0)
        }
        carts = { "@singtaa/storm": { versions: {}, live: COMMIT("d"), builds: { [COMMIT("d")]: { files: { "oj.json": "{}" } } } } }
        mineList = [{ sid: "storm1234567", name: "Storm Chaser", public: false, url: `${origin}/@singtaa/storm`, clone: bare }]
        const project = unityProject()
        process.env.OJ_TOKEN = "the-owner"
        const saved = process.env.GIT_CONFIG_GLOBAL
        process.env.GIT_CONFIG_GLOBAL = gitEnv.GIT_CONFIG_GLOBAL
        try {
            expect(await add(project, "@singtaa/storm", { npm })).toEqual([
                "Took @singtaa/storm, yours, into Assets/Storm Chaser/~ as a clone: push from there and the site builds it.",
                "Next: drag Assets/Storm Chaser/StormChaser.prefab into a scene.",
            ])
        } finally {
            if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL
            else process.env.GIT_CONFIG_GLOBAL = saved
        }
        const app = path.join(project, "Assets", "Storm Chaser", "~")
        expect(spawnSync("git", ["remote", "get-url", "origin"], { cwd: app, encoding: "utf8", env: gitEnv }).stdout.trim()).toBe(bare)
        // init --unity's files stay out of the clone's git status.
        expect(spawnSync("git", ["status", "--porcelain"], { cwd: app, encoding: "utf8", env: gitEnv }).stdout).toBe("")
    })

    it("refuses to land on a folder already there, and says where to work instead", async () => {
        carts = { "@singtaa/portal": portal() }
        const project = unityProject()
        fs.mkdirSync(path.join(project, "Assets", "portal"))
        await expect(add(project, "@singtaa/portal", { npm })).rejects.toThrow(`Assets/portal is already there. Move or delete it to take the cart again, or work in it: cd "Assets/portal/~"`)
        expect(fs.readdirSync(path.join(project, "Assets")).sort()).toEqual([".keep", "portal"])
    })

    it("says where to run it from anywhere else in the project", async () => {
        const project = unityProject()
        fs.mkdirSync(path.join(project, "Assets", "Art"))
        await expect(add(path.join(project, "Assets", "Art"), "@singtaa/portal", { npm })).rejects.toThrow(`Run ${COMMAND} add at the Unity project's root, where Assets and ProjectSettings are`)
    })
})
