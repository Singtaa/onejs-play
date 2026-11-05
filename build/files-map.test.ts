import { describe, expect, it } from "vitest"
import path from "node:path"
import * as esbuild from "esbuild"
import { buildGame, startupFiles } from "./game.mjs"

const WORKING_DIR = path.parse(process.cwd()).root || "/"

/**
 * A build that carries its file map (PlaySite's, docs/refs-and-assets.md)
 * hands it to the container's oj before any of the game's code runs, so the
 * first name a game resolves already resolves by hash.
 */

const FILES = [
    { name: "index.tsx", text: `import { assetUrl } from "oj"\nimport { glow } from "./lib/art"\nexport const seen = [assetUrl("glow.png"), glow]\n` },
    { name: "lib/art.ts", text: `import { assetUrl } from "oj"\nexport const glow = assetUrl("fx/glow.png")\n` },
]

/** Runs a bundle against a fake container oj that records what it was told. */
function run(code: string, oj: Record<string, unknown>) {
    const evaluate = new Function("__ojExternals", `${code}\nreturn __exports`)
    return evaluate({ oj }) as { seen: string[] }
}

describe("a build's file map", () => {
    const assets = { "glow.png": ["a".repeat(64), 10], "fx/glow.png": ["b".repeat(64), 20] } as const

    it("reaches oj before the game's first line, from whichever file asks first", async () => {
        const built = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR, assets })
        let map: Record<string, unknown> | null = null
        const oj = {
            setAssetMap: (m: Record<string, unknown>) => { map = m },
            assetUrl: (name: string) => map === null ? `no map yet: ${name}` : `${(map[name] as [string] | undefined)?.[0] ?? "?"}/${name}`,
        }
        const out = run(built.code, oj)
        expect(map).toEqual(assets)
        expect(out.seen).toEqual([`${"a".repeat(64)}/glow.png`, `${"b".repeat(64)}/fx/glow.png`])
    })

    it("runs on a container without setAssetMap, whose names resolve as before", async () => {
        const built = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR, assets })
        const out = run(built.code, { assetUrl: (name: string) => `/assets/${name}` })
        expect(out.seen).toEqual(["/assets/glow.png", "/assets/fx/glow.png"])
    })

    it("hands over the store with the map when the site names one", async () => {
        const built = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR, assets, store: "https://store.example" })
        let options: unknown = null
        run(built.code, { setAssetMap: (_: unknown, o: unknown) => { options = o }, assetUrl: (n: string) => n })
        expect(options).toEqual({ store: "https://store.example" })
    })

    it("is not in a build that was not given one", async () => {
        const plain = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR })
        expect(plain.code).not.toContain("setAssetMap")
    })
})

/**
 * oj.json's preload list: the files that load before the cart appears. The
 * builder opens its folders against what the build ships and hands the files
 * to setAssetMap as `startup`; an entry that names nothing is a warning.
 */
describe("oj.json's preload list", () => {
    const names = ["glow.png", "music/theme.ogg", "music/win.wav", "models/ship.glb"]
    const withOj = (oj: Record<string, unknown>) => [...FILES, { name: "oj.json", text: JSON.stringify({ name: "Storm", ...oj }) }]

    it("opens folders into their files, once each, and takes a web habit's ./ and assets/", () => {
        expect(startupFiles({ preload: ["music/", "./glow.png", "assets/glow.png", "music/win.wav"] }, names))
            .toEqual({ files: ["music/theme.ogg", "music/win.wav", "glow.png"], warnings: [] })
    })

    it("warns about an entry that names nothing, and starts the cart anyway", () => {
        expect(startupFiles({ preload: ["ships.png", "levels/", "glow.png"] }, names)).toEqual({
            files: ["glow.png"],
            warnings: ["oj.json preloads ships.png, which this cart does not have", "oj.json preloads levels/, and this cart has no files in that folder"],
        })
        expect(startupFiles({ preload: "glow.png" }, names).warnings).toEqual(['"preload" in oj.json should be a list of file names, like ["music/theme.ogg", "levels/"]'])
        expect(startupFiles({}, names)).toEqual({ files: [], warnings: [] })
    })

    it("reaches setAssetMap with the map on the site, and its warnings reach the push", async () => {
        const assets = { "glow.png": ["a".repeat(64), 10], "music/theme.ogg": ["c".repeat(64), 30] } as const
        const built = await buildGame(esbuild, withOj({ preload: ["music/", "ships.png"] }), "index.tsx", { workingDir: WORKING_DIR, assets })
        let options: unknown = null
        run(built.code, { setAssetMap: (_: unknown, o: unknown) => { options = o }, assetUrl: (n: string) => n })
        expect(options).toEqual({ startup: ["music/theme.ogg"] })
        expect(built.warnings).toEqual(["oj.json preloads ships.png, which this cart does not have"])
    })

    it("reaches setAssetMap with no map when ojplay builds, from the cart's own file names", async () => {
        const built = await buildGame(esbuild, withOj({ preload: ["glow.png"] }), "index.tsx", { workingDir: WORKING_DIR, assetNames: names })
        let given: unknown[] = []
        run(built.code, { setAssetMap: (...args: unknown[]) => { given = args }, assetUrl: (n: string) => n })
        expect(given).toEqual([null, { startup: ["glow.png"], names }])
    })

    it("hands an ojplay build with no list only the cart's file names, for a folder to open", async () => {
        const built = await buildGame(esbuild, withOj({}), "index.tsx", { workingDir: WORKING_DIR, assetNames: names })
        let given: unknown[] = []
        run(built.code, { setAssetMap: (...args: unknown[]) => { given = args }, assetUrl: (n: string) => n })
        expect(given).toEqual([null, { names }])
        expect(built.warnings).toEqual([])
    })
})
