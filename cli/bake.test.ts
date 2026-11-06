import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { bake, nameProblem } from "./bake.mjs"
import { LIGHT_RECORDER, serve } from "./local.mjs"

/*
 * `ojplay bake` against a page that is the real one in every part but the
 * container: the page's light recorder (LIGHT_RECORDER) runs in a context of
 * its own, the test plays the container by calling the light host it
 * installs, and the command reads the page through the same expressions it
 * sends Chrome.
 */

/** A page with the recorder, and the light host the container would be handed. */
function page({ hosting = true, onReady = (_host: any) => {} } = {}) {
    const context = vm.createContext({ performance, btoa })
    vm.runInContext(`${LIGHT_RECORDER}
var __ojLocal = { lights: lightsSaid, lightFile: lightFileSaid }
${hosting ? "var __ojContainer = { setLightHost() {} }" : ""}`, context)
    const host = vm.runInContext("lightHost", context)
    const game = {
        root,
        manifest: { runtime: "9.9.9" },
        errors: [] as string[],
        ready: async () => { onReady(host); return 12 },
        eval: async (expression: string) => vm.runInContext(expression, context),
        browser: { close: vi.fn() },
        server: { close: vi.fn() },
    }
    // The parts of run.mjs's Game the command uses.
    return { host, game, start: vi.fn(async () => game as any) }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

// The cart sits in a folder of the test's own, so a write that escapes it lands where the test looks.
let parent: string
let root: string
let said: string[]
beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "oj-bake-"))
    root = path.join(parent, "cart")
    fs.mkdirSync(root)
    said = []
})
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }))

const run = (p: ReturnType<typeof page>, options: { script?: string, seconds?: number } = {}) =>
    bake(root, { ...options, say: (line: string) => said.push(line), start: p.start })

describe("ojplay bake", () => {
    it("exits 1 when a named bake never finishes, says so, writes nothing and closes the browser", async () => {
        const p = page({ onReady: (host) => host.begun("room.light.png") })
        expect(await run(p, { seconds: 0.4 })).toBe(1)
        expect(said).toContain("room.light.png: not finished within 0.4 s (--for to wait longer)")
        expect(fs.readdirSync(root)).toEqual([])
        expect(p.game.browser.close).toHaveBeenCalledOnce()
    })

    it("writes a file baked here under its name, and prints its size and how long it took", async () => {
        const p = page({
            onReady: (host) => {
                host.begun("light/room.png")
                host.baked({ name: "light/room.png", line: "[oj] light/room.png is not in the cart yet: baked here.", bytes: PNG })
                host.ended("light/room.png", { how: "baked" })
            },
        })
        expect(await run(p)).toBe(0)
        expect(new Uint8Array(fs.readFileSync(path.join(root, "light/room.png")))).toEqual(PNG)
        expect(said.at(-1)).toMatch(/^light\/room\.png: wrote 0\.0 KB, baked in \d+\.\d s$/)
        expect(p.start).toHaveBeenCalledWith(root, expect.objectContaining({ gpu: true, light: true }))
    })

    it("leaves a current file as it is and exits 0", async () => {
        fs.writeFileSync(path.join(root, "room.light.png"), PNG)
        const p = page({ onReady: (host) => { host.begun("room.light.png"); host.ended("room.light.png", { how: "current" }) } })
        expect(await run(p)).toBe(0)
        expect(said.at(-1)).toMatch(/^room\.light\.png \(0\.0 KB\): current, shown in \d+\.\d s, left as it is$/)
        expect(new Uint8Array(fs.readFileSync(path.join(root, "room.light.png")))).toEqual(PNG)
    })

    it("exits 1 for a bake that failed or was stopped, with what the cart said, and still writes the one that baked", async () => {
        const p = page({
            onReady: (host) => {
                host.begun("a.png")
                host.ended("a.png", { how: "failed", why: "nothing in the scene is static" })
                host.begun("b.png")
                host.ended("b.png", { how: "stopped" })
                host.begun("c.png")
                host.baked({ name: "c.png", line: "", bytes: PNG })
                host.ended("c.png", { how: "baked" })
            },
        })
        expect(await run(p)).toBe(1)
        expect(said).toContain("a.png: failed: nothing in the scene is static")
        expect(said).toContain("b.png: stopped before it finished, by a later scene.bake or the scene going")
        expect(fs.existsSync(path.join(root, "c.png"))).toBe(true)
    })

    it("keeps only the newest bake of a name, so one baked again after a stop counts as baked", async () => {
        const p = page({
            onReady: (host) => {
                host.begun("room.png")
                host.ended("room.png", { how: "stopped" })
                host.begun("room.png")
                host.baked({ name: "room.png", line: "", bytes: PNG })
                host.ended("room.png", { how: "baked" })
            },
        })
        expect(await run(p)).toBe(0)

        // Begun again, it is baking again: the stop before it is over.
        said = []
        const again = page({ onReady: (host) => { host.begun("room.png"); host.ended("room.png", { how: "stopped" }); host.begun("room.png") } })
        expect(await run(again, { seconds: 0.4 })).toBe(1)
        expect(said.at(-1)).toBe("room.png: not finished within 0.4 s (--for to wait longer)")
    })

    it("exits 3 when the cart names no light file", async () => {
        expect(await run(page(), { seconds: 0.3 })).toBe(3)
        expect(said.at(-1)).toBe("the cart named no light file: no scene.bake(name) began within 0.3 s, so nothing was written")
    })

    it("exits 1 on a container that cannot tell a host about its bakes, rather than reporting no file", async () => {
        expect(await run(page({ hosting: false }), { seconds: 0.3 })).toBe(1)
        expect(said.at(-1)).toMatch(/^runtime 9\.9\.9 cannot tell a host about its bakes/)
    })

    it("refuses to write outside the cart, into .oj/ or assets/, or anything but a PNG", async () => {
        for (const name of ["../out.png", ".oj/room.png", "assets/room.png", "room.jpg", "/abs/room.png"]) {
            expect(nameProblem(name), name).not.toBeNull()
        }
        expect(nameProblem("light/room.png")).toBeNull()
        const p = page({
            onReady: (host) => {
                host.begun("../out.png")
                host.baked({ name: "../out.png", line: "", bytes: PNG })
                host.ended("../out.png", { how: "baked" })
            },
        })
        expect(await run(p)).toBe(1)
        expect(fs.readdirSync(parent)).toEqual(["cart"])
        expect(said.at(-1)).toMatch(/^\.\.\/out\.png: baked in .*, not written: /)
    })

    it("drives the cart with the script first, and waits for the bake it starts", async () => {
        const script = path.join(root, "menu.mjs")
        fs.writeFileSync(script, `export default async (cart) => { cart.pressed = true }`)
        const p = page()
        const started = p.game as any
        // The bake begins only once the script has pressed its way to the level.
        const evaluate = started.eval
        started.eval = async (e: string) => {
            if (started.pressed && !started.begun) {
                started.begun = true
                const host = await evaluate("lightHost")
                host.begun("level.png")
                host.baked({ name: "level.png", line: "", bytes: PNG })
                host.ended("level.png", { how: "baked" })
            }
            return evaluate(e)
        }
        expect(await run(p, { script: "menu.mjs" })).toBe(0)
        expect(fs.existsSync(path.join(root, "level.png"))).toBe(true)
    })

    it("exits 1 on a console error, as run and test do, and writes nothing from that run", async () => {
        const p = page({
            onReady: (host) => {
                host.begun("a.png")
                host.baked({ name: "a.png", line: "", bytes: PNG })
                host.ended("a.png", { how: "baked" })
            },
        })
        p.game.errors.push("Texture Readback is not supported by WebGPU. Use AsyncGPUReadback Instead.")
        expect(await run(p)).toBe(1)
        expect(fs.readdirSync(root)).toEqual([])
        expect(said.at(-1)).toBe("1 console error(s), so nothing was written:")
    })
})

describe("the page ojplay bake serves", () => {
    it("carries the light recorder and hands it to the container only when asked", async () => {
        const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "oj-runtime-"))
        const pageOf = async (light: boolean) => {
            const server = await serve({ runtime, root, manifest: { name: "Room" }, bundle: () => "", light })
            try {
                return await (await fetch(server.url)).text()
            } finally {
                server.close()
            }
        }
        try {
            const baking = await pageOf(true)
            expect(baking).toContain("const lightHost = {")
            expect(baking).toContain("lights: lightsSaid")
            const running = await pageOf(false)
            expect(running).toContain("const lightHost = null")
            expect(running).not.toContain("lightsSaid")
        } finally {
            fs.rmSync(runtime, { recursive: true, force: true })
        }
    })
})
