import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import { createServer, type Server } from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { BIN, PACKAGE } from "../build/command.mjs"

/**
 * ojplay as people get it (Sai, 1 Oct 2026): `npm install -g ojplay`, from this
 * package packed the way npm publishes it, into a throwaway prefix with its
 * own HOME. Then `ojplay --help`, `ojplay add` in an empty folder (against a
 * stand-in site, with no login anywhere), and the hand-off to a cart's own
 * copy. What a unit test cannot see: the files list, the bin, and that the
 * dependencies a global install brings are enough to build.
 *
 * Needs the network once per run (npm fetches esbuild and the peers).
 */

const ROOT = path.resolve(import.meta.dirname, "..")
const OWN = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { name: string, version: string }
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-global-e2e-"))
const prefix = path.join(work, "prefix")
/**
 * Where npm puts a global install's commands: prefix/bin, except on Windows,
 * where they are prefix itself and the command is a .cmd shim. Node spawns a
 * .cmd only through a shell, npm's own included.
 */
const WINDOWS = process.platform === "win32"
const binDir = WINDOWS ? prefix : path.join(prefix, "bin")
const bin = path.join(binDir, WINDOWS ? `${BIN}.cmd` : BIN)
const NPM = WINDOWS ? "npm.cmd" : "npm"
let server: Server
let origin = ""

/** The environment of someone at a terminal: their own HOME, the global bin on PATH, nothing npm set. */
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const out: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("npm_") && k !== "OJ_TOKEN" && k !== "OJ_SITE" && k !== "OJ_HOME") out[k] = v
    return {
        ...out,
        HOME: path.join(work, "home"),
        // The real cache, read-only in effect, so a run does not download the world.
        npm_config_cache: path.join(os.homedir(), ".npm"),
        npm_config_prefix: prefix,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        GIT_CONFIG_GLOBAL: path.join(work, "gitconfig"),
        ...extra,
    }
}

function ojplay(args: string[], cwd: string, extra: Record<string, string> = {}): Promise<{ code: number, out: string }> {
    return new Promise((resolve) => {
        const child = spawn(bin, args, { cwd, env: env(extra), shell: WINDOWS })
        let out = ""
        child.stdout.on("data", (d) => { out += d })
        child.stderr.on("data", (d) => { out += d })
        child.on("close", (code) => resolve({ code: code ?? 1, out }))
    })
}

const PORTAL = "a".repeat(40)

beforeAll(async () => {
    fs.mkdirSync(path.join(work, "home"), { recursive: true })
    fs.writeFileSync(path.join(work, "gitconfig"), "")
    const packed = spawnSync(NPM, ["pack", "--silent", "--pack-destination", work], { cwd: ROOT, encoding: "utf8", env: env(), shell: WINDOWS })
    expect(packed.status, packed.stderr).toBe(0)
    const tarball = path.join(work, packed.stdout.trim().split("\n").pop()!)
    const installed = spawnSync(NPM, ["install", "-g", "--no-audit", "--no-fund", tarball], { cwd: work, encoding: "utf8", env: env(), shell: WINDOWS })
    expect(installed.status, installed.stderr).toBe(0)

    server = createServer((req, res) => {
        const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
        if (req.headers.authorization !== undefined) return send(400, { error: "nobody should be signed in here" })
        if (req.url === "/api/carts/@singtaa/portal/pin") return send(200, { address: "@singtaa/portal", version: null, commit: PORTAL, builtAt: Date.UTC(2026, 9, 1, 9) / 1000 })
        if (req.url === "/api/carts/@singtaa/portal/kept/aaaaaaaaaaaa") {
            return send(200, {
                address: "@singtaa/portal", version: null, commit: PORTAL, builtAt: Date.UTC(2026, 9, 1, 9) / 1000, assets: {},
                files: [
                    { name: "oj.json", text: JSON.stringify({ schema: 1, name: "portal", entry: "main.tsx", controls: ["keyboard"] }) },
                    { name: "main.tsx", text: "import { mount, View } from \"oj\"\nglobalThis.said = \"the portal\"\nmount(<View />)\n" },
                ],
            })
        }
        send(404, { error: "No cart at that address." })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const at = server.address()
    origin = `http://127.0.0.1:${typeof at === "object" && at !== null ? at.port : 0}`
}, 240_000)

afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
    fs.rmSync(work, { recursive: true, force: true })
})

describe(`npm install -g ${PACKAGE}`, () => {
    it("puts one command on the PATH, ojplay, and no oj", () => {
        expect(fs.existsSync(bin)).toBe(true)
        expect(fs.existsSync(path.join(binDir, WINDOWS ? "oj.cmd" : "oj"))).toBe(false)
    })

    it("answers --help with its own name, version and the hand-off line", async () => {
        const help = await ojplay(["--help"], work)
        expect(help.code).toBe(0)
        expect(help.out).toContain(`usage: ${BIN} <command> [options]`)
        expect(help.out).toContain("add <@handle/name>")
        expect(help.out).toContain(`Inside a cart with its own ${PACKAGE} in node_modules, ${BIN} runs that copy, so the version matches the cart.`)
        expect(help.out).toContain(`${BIN} ${OWN.version}`)
    })

    it("starts a cart in an empty folder with ojplay add, no account, and builds it", async () => {
        const folder = path.join(work, "my-portal")
        fs.mkdirSync(folder)
        const added = await ojplay(["add", "@singtaa/portal"], folder, { OJ_SITE: origin })
        expect(added.out.trim().split("\n")).toEqual([
            `[${BIN}] Started a cart here that runs @singtaa/portal (1 Oct): index.tsx imports it, oj.json lists it.`,
            `[${BIN}] Next: ${BIN} run`,
        ])
        expect(added.code).toBe(0)
        const built = await ojplay(["build"], folder, { OJ_SITE: origin })
        expect(built.code, built.out).toBe(0)
        expect(fs.readFileSync(path.join(folder, ".oj", "bundle.js"), "utf8")).toContain("the portal")
    }, 60_000)

    it("hands off to the cart's own ojplay, from anywhere inside the cart", async () => {
        const cart = path.join(work, "pinned")
        const own = path.join(cart, "node_modules", ...PACKAGE.split("/"))
        fs.mkdirSync(path.join(own, "cli"), { recursive: true })
        fs.mkdirSync(path.join(cart, "hud"), { recursive: true })
        fs.writeFileSync(path.join(own, "package.json"), JSON.stringify({ name: PACKAGE, version: "0.9.0-pinned" }))
        fs.writeFileSync(path.join(own, "cli", "oj.mjs"), "console.log(`the cart's own ojplay: ${process.argv.slice(2).join(\" \")}`)\n")
        const ran = await ojplay(["build", "--for", "1"], path.join(cart, "hud"))
        expect(ran.out.trim()).toBe("the cart's own ojplay: build --for 1")
        expect(ran.code).toBe(0)
    })
})
