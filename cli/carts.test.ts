import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { build, readUsedCarts } from "./game.mjs"
import { serve } from "./local.mjs"
import { unservableAssets } from "./assets.mjs"

/**
 * Used carts on a developer's machine (PlaySite docs/carts.md §3, step 4):
 * fetched into `.oj/carts/<key>/`, built from there, and their files served
 * at `/assets/<key>/<name>`, which is where a used cart's scoped oj asks.
 */

const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

/** A cart on disk: `files` relative to its root, text or bytes. */
const cart = (files: Record<string, string | Uint8Array>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oj-carts-"))
    made.push(root)
    for (const [name, data] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
        fs.writeFileSync(path.join(root, name), data)
    }
    return root
}
const oj = (fields: Record<string, unknown>) => JSON.stringify({ name: "Storm", ...fields })

describe("used carts, locally", () => {
    it("reads each used cart from .oj/carts, following their own dependencies", () => {
        const root = cart({
            "index.tsx": "export {}",
            "oj.json": oj({ dependencies: { "@Singtaa/Lightning": "1.2.0" } }),
            ".oj/carts/@singtaa/lightning@1.2.0/oj.json": oj({ exports: "bolt.tsx", dependencies: { "@koma/rain": "#3f2a91c07b44" } }),
            ".oj/carts/@singtaa/lightning@1.2.0/bolt.tsx": "export const bolt = 1",
            ".oj/carts/@singtaa/lightning@1.2.0/glow.png": new Uint8Array([1]),
            ".oj/carts/@koma/rain@3f2a91c07b44/oj.json": oj({ exports: "rain.ts" }),
            ".oj/carts/@koma/rain@3f2a91c07b44/rain.ts": "export const rain = 1",
        })
        const used = readUsedCarts(root, JSON.parse(fs.readFileSync(path.join(root, "oj.json"), "utf8")))
        expect(used.uses).toEqual({ "@singtaa/lightning": "@singtaa/lightning@1.2.0" })
        expect(used.carts["@singtaa/lightning@1.2.0"]).toMatchObject({ exports: "bolt.tsx", uses: { "@koma/rain": "@koma/rain@3f2a91c07b44" } })
        expect(used.carts["@singtaa/lightning@1.2.0"]!.files.map((f) => f.name)).toEqual(["bolt.tsx", "oj.json"])
        expect(Object.keys(used.carts)).toEqual(["@singtaa/lightning@1.2.0", "@koma/rain@3f2a91c07b44"])
    })

    it("builds a cart that imports one", async () => {
        const root = cart({
            "index.tsx": `import { bolt } from "@singtaa/lightning"\nexport const out = bolt`,
            "oj.json": oj({ dependencies: { "@singtaa/lightning": "1.2.0" } }),
            ".oj/carts/@singtaa/lightning@1.2.0/oj.json": oj({ exports: "bolt.tsx" }),
            ".oj/carts/@singtaa/lightning@1.2.0/bolt.tsx": `export const bolt = "a bolt"`,
        })
        expect((await build(root)).code).toContain("a bolt")
    })

    describe("refuses, saying what to do", () => {
        const refusal = (files: Record<string, string>) => {
            const root = cart(files)
            try {
                readUsedCarts(root, JSON.parse(files["oj.json"]!))
            } catch (error) {
                return (error as Error).message
            }
            throw new Error("it read")
        }

        it("a cart that is not fetched", () => {
            expect(refusal({ "oj.json": oj({ dependencies: { "@singtaa/lightning": "1.2.0" } }) }))
                .toBe("@singtaa/lightning 1.2.0 is not in .oj/carts. Fetch it with: npx onejs-play add @singtaa/lightning")
        })

        it("a range, naming the version to write", () => {
            expect(refusal({ "oj.json": oj({ dependencies: { "@singtaa/lightning": "^1.2.0" } }) }))
                .toBe("\"^1.2.0\" for @singtaa/lightning is a range. Use \"1.2.0\"; oj update moves it.")
        })

        it("a cart that ends up using itself", () => {
            expect(refusal({
                "oj.json": oj({ dependencies: { "@a/x": "1.0.0" } }),
                ".oj/carts/@a/x@1.0.0/oj.json": oj({ exports: "x.ts", dependencies: { "@b/y": "1.0.0" } }),
                ".oj/carts/@b/y@1.0.0/oj.json": oj({ exports: "y.ts", dependencies: { "@a/x": "1.0.0" } }),
            })).toBe("@a/x 1.0.0 uses @b/y 1.0.0, which uses @a/x 1.0.0: a cart cannot end up using itself.")
        })
    })

    it("leaves used carts' files out of this cart's own asset check", () => {
        const root = cart({ "index.tsx": "export {}", ".oj/carts/@singtaa/lightning@1.2.0/glow.png": new Uint8Array([1]) })
        expect(unservableAssets(root)).toEqual([])
    })

    it("serves a used cart's files where its scoped oj asks, and nothing outside them", async () => {
        const root = cart({
            "index.tsx": "export {}", "glow.png": new Uint8Array([9]),
            ".oj/carts/@singtaa/lightning@1.2.0/glow.png": new Uint8Array([1, 2, 3]),
        })
        const server = await serve({ runtime: root, root, manifest: {}, bundle: () => "" })
        try {
            const get = (p: string) => fetch(server.url + p.slice(1))
            expect(new Uint8Array(await (await get("/assets/@singtaa/lightning@1.2.0/glow.png")).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
            expect(new Uint8Array(await (await get("/assets/glow.png")).arrayBuffer())).toEqual(new Uint8Array([9]))
            expect((await get("/assets/@singtaa/lightning@1.2.0/nothing.png")).status).toBe(404)
            expect((await get("/assets/@singtaa/lightning@1.2.0/%2e%2e/%2e%2e/%2e%2e/glow.png")).status).toBe(404)
        } finally {
            server.close()
        }
    })
})
