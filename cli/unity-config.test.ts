import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * What `ojplay init --unity` and `ojplay add` do to OneJS's esbuild.config.mjs
 * template is text in, text out, and the container's scaffold gate checks it
 * against every OneJS template in CI, where nothing is installed. onejs-unity
 * is only a peer of this package, so a module that reaches the build pipeline
 * (build/game.mjs imports onejs-unity's plugins) cannot even be loaded there:
 * that is how the gate went red after carts step 6. The edit lives in a module
 * that imports nothing but Node and the package's own names.
 */
describe("the esbuild.config.mjs edit", () => {
    const file = path.join(import.meta.dirname, "unity-config.mjs")

    it("imports only Node's modules and ../build/command.mjs, so it loads with nothing installed", () => {
        const source = fs.readFileSync(file, "utf8")
        const imports = [...source.matchAll(/^\s*(?:import|export)\s[^;\n]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1])
        expect(imports.length).toBeGreaterThan(0)
        expect(imports.filter((i) => !i.startsWith("node:") && i !== "../build/command.mjs")).toEqual([])
        expect(fs.readFileSync(path.join(import.meta.dirname, "..", "build", "command.mjs"), "utf8")).not.toMatch(/^\s*import\s/m)
    })

    it("is what ojplay/unity hands out as buildConfig and withCartsPlugin", async () => {
        const config = await import("./unity-config.mjs")
        const unity = await import("./unity-assets.mjs")
        expect(unity.buildConfig).toBe(config.buildConfig)
        expect(unity.withCartsPlugin).toBe(config.withCartsPlugin)
    })
})
