import { describe, expect, it } from "vitest"
import path from "node:path"
import * as esbuild from "esbuild"
import { buildGame, cartKey } from "./game.mjs"
import { ANYWHERE } from "./command.mjs"

/** The native esbuild judges absWorkingDir by the host's rules: "/" is not absolute on Windows (cli/game.mjs passes the same). */
const WORKING_DIR = path.parse(process.cwd()).root || "/"

/**
 * Carts using carts (PlaySite docs/carts.md §3, step 4).
 *
 * A used cart is built into the using cart's bundle from its kept build's
 * files, under its key (`@singtaa/lightning@1.2.0`). Inside it, `oj` is a
 * scoped oj: the six loaders that take a file name see that cart's files, so
 * Storm's glow.png and Lightning's glow.png never meet. Each test runs the
 * bundle against a recording fake of the container's `oj`.
 */

type Files = Array<{ name: string, text: string }>

/** What the container's oj does with a name, recorded rather than fetched. */
const fakeOj = () => {
    const seen: string[] = []
    const take = (what: string) => (name: string) => { seen.push(`${what} ${name}`); return `${what}:${name}` }
    return {
        seen,
        oj: {
            assetUrl: take("assetUrl"), loadTexture: take("loadTexture"), useTexture: take("useTexture"),
            loadSheet: take("loadSheet"), useFlipbook: (_ref: unknown, name: string) => take("useFlipbook")(name),
            audio: { load: take("audio.load"), play: () => "played" },
            View: "the View",
        },
    }
}

const run = async (files: Files, carts: Parameters<typeof buildGame>[3]["carts"], entry = "index.tsx") => {
    const built = await buildGame(esbuild, files, entry, { workingDir: WORKING_DIR, carts })
    const { seen, oj } = fakeOj()
    const exports = new Function("__ojExternals", `${built.code}; return __exports`)({ oj, react: {}, "react/jsx-runtime": {} })
    return { exports, seen, code: built.code }
}

const LIGHTNING = cartKey("@singtaa/lightning", "1.2.0")
const lightning = (over: Record<string, unknown> = {}) => ({
    exports: "bolt.tsx",
    uses: {},
    files: [
        { name: "bolt.tsx", text: `import { assetUrl, loadTexture, useTexture, loadSheet, useFlipbook, audio, View } from "oj"
export const bolt = () => [assetUrl("glow.png"), loadTexture("glow.png"), useTexture("./glow.png"), loadSheet("sheet.png"),
    useFlipbook(null, "sheet.png"), audio.load("assets/zap.wav"), audio.play(), View, assetUrl("https://x.test/a.png"), assetUrl("/rooted.png")]
export { spark } from "./fx/spark"` },
        { name: "fx/spark.ts", text: `import { assetUrl } from "oj"\nexport const spark = () => assetUrl("fx/spark.png")` },
        { name: "oj.json", text: "{}" },
    ],
    ...over,
})

/** A whole cart: no `exports`, an entry that mounts itself through its own oj. */
const whole = () => lightning({
    exports: null,
    entry: "main.tsx",
    files: [
        { name: "main.tsx", text: `import { useTexture } from "oj"\nglobalThis.__mounted = useTexture("hud.png")` },
        { name: "oj.json", text: "{}" },
    ],
})

describe("a cart using a cart", () => {
    /** Tachi, 1 Oct: adding a sample and seeing it run is the first thing a new user tries. */
    it("runs a whole cart's entry on a bare import, its art still its own", async () => {
        const { seen } = await run([{ name: "index.tsx", text: `import "@singtaa/lightning"` }], {
            uses: { "@singtaa/lightning": LIGHTNING }, carts: { [LIGHTNING]: whole() },
        })
        expect(seen).toEqual(["useTexture @singtaa/lightning@1.2.0/hud.png"])
    })

    it("keys a version and a commit pin the way URLs and folders can carry them", () => {
        expect(cartKey("@singtaa/lightning", "1.2.0")).toBe("@singtaa/lightning@1.2.0")
        expect(cartKey("@koma/rain", "#3f2a91c07b44")).toBe("@koma/rain@3f2a91c07b44")
    })

    it("imports the used cart's exports file, and scopes every loader that takes a name to its files", async () => {
        const { exports, seen } = await run([
            { name: "index.tsx", text: `import { bolt, spark } from "@singtaa/lightning"\nimport { assetUrl } from "oj"\nexport const out = [bolt(), spark(), assetUrl("glow.png")]` },
        ], { uses: { "@singtaa/lightning": LIGHTNING }, carts: { [LIGHTNING]: lightning() } })
        expect(exports.out[0]).toEqual([
            "assetUrl:@singtaa/lightning@1.2.0/glow.png", "loadTexture:@singtaa/lightning@1.2.0/glow.png",
            "useTexture:@singtaa/lightning@1.2.0/glow.png", "loadSheet:@singtaa/lightning@1.2.0/sheet.png",
            "useFlipbook:@singtaa/lightning@1.2.0/sheet.png", "audio.load:@singtaa/lightning@1.2.0/zap.wav",
            "played", "the View", "assetUrl:https://x.test/a.png", "assetUrl:/rooted.png",
        ])
        // A file in a folder of the used cart, and the using cart's own glow.png, untouched.
        expect(exports.out[1]).toBe("assetUrl:@singtaa/lightning@1.2.0/fx/spark.png")
        expect(exports.out[2]).toBe("assetUrl:glow.png")
        expect(seen).toContain("assetUrl glow.png")
    })

    it("imports a file inside the used cart by subpath", async () => {
        const { exports } = await run([
            { name: "index.tsx", text: `import { spark } from "@singtaa/lightning/fx/spark"\nexport const out = spark()` },
        ], { uses: { "@singtaa/lightning": LIGHTNING }, carts: { [LIGHTNING]: lightning() } })
        expect(exports.out).toBe("assetUrl:@singtaa/lightning@1.2.0/fx/spark.png")
    })

    it("follows each used cart's own dependencies, keeps two versions of one cart apart, and shares one copy of the same", async () => {
        const RAIN1 = cartKey("@koma/rain", "1.0.0"), RAIN2 = cartKey("@koma/rain", "2.0.0")
        const rain = (v: string) => ({
            exports: "rain.ts", uses: {},
            files: [{ name: "rain.ts", text: `import { assetUrl } from "oj"\nexport const drop = () => "rain ${v} " + assetUrl("drop.png")` }],
        })
        const { exports, code } = await run([
            { name: "index.tsx", text: `import { storm } from "@singtaa/lightning"\nimport { drop } from "@koma/rain"\nexport const out = [storm(), drop()]` },
        ], {
            uses: { "@singtaa/lightning": LIGHTNING, "@koma/rain": RAIN2 },
            carts: {
                [LIGHTNING]: { exports: "bolt.ts", uses: { "@koma/rain": RAIN1 }, files: [{ name: "bolt.ts", text: `import { drop } from "@koma/rain"\nexport const storm = () => drop()` }] },
                [RAIN1]: rain("1"), [RAIN2]: rain("2"),
            },
        })
        expect(exports.out).toEqual(["rain 1 assetUrl:@koma/rain@1.0.0/drop.png", "rain 2 assetUrl:@koma/rain@2.0.0/drop.png"])
        expect(code.split("rain 1").length - 1).toBe(1)
    })

    describe("refuses, saying what to do", () => {
        const refusal = async (files: Files, carts: Parameters<typeof buildGame>[3]["carts"]) => {
            try {
                await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, carts })
            } catch (error) {
                return (error as { errors: Array<{ text: string }> }).errors.map((e) => e.text).join("\n")
            }
            throw new Error("it built")
        }

        it("an import of a cart that oj.json does not list", async () => {
            expect(await refusal([{ name: "index.tsx", text: `import "@singtaa/lightning"` }], { uses: {}, carts: {} }))
                .toBe(`@singtaa/lightning is not in this cart's oj.json dependencies. Add it with: ${ANYWHERE} add @singtaa/lightning`)
        })

        it("an import inside a used cart of a cart its own oj.json does not list", async () => {
            expect(await refusal([{ name: "index.tsx", text: `import "@singtaa/lightning"` }], {
                uses: { "@singtaa/lightning": LIGHTNING },
                carts: { [LIGHTNING]: lightning({ files: [{ name: "bolt.tsx", text: `import "@koma/rain"` }] }) },
            })).toBe("@singtaa/lightning 1.2.0 imports @koma/rain, which its oj.json does not list. Its author has to add it; or pin a different version of @singtaa/lightning.")
        })

        it("a named import from a whole cart, naming the bare import that runs it", async () => {
            expect(await refusal([{ name: "index.tsx", text: `import { Hud } from "@singtaa/lightning"\nexport const out = Hud` }], {
                uses: { "@singtaa/lightning": LIGHTNING }, carts: { [LIGHTNING]: whole() },
            })).toBe(`@singtaa/lightning 1.2.0 is a whole cart: it exports nothing, so Hud cannot come from it. import "@singtaa/lightning" runs it.`)
        })

        it("a relative import that would leave the used cart", async () => {
            expect(await refusal([{ name: "index.tsx", text: `import "@singtaa/lightning"\nexport const secret = 1` }], {
                uses: { "@singtaa/lightning": LIGHTNING },
                carts: { [LIGHTNING]: lightning({ files: [{ name: "bolt.tsx", text: `import "../../../index"` }] }) },
            })).toContain("cannot resolve ../../../index")
        })
    })
})
