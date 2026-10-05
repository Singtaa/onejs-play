import { describe, expect, it } from "vitest"
import path from "node:path"
import * as esbuild from "esbuild"
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping"
import { buildGame } from "./game.mjs"

const WORKING_DIR = path.parse(process.cwd()).root || "/"

/**
 * A source map, on request (PlaySite's editor maps a runtime error's stack
 * back to the cart's files with it: the new-user test of 1 Oct 2026, U4).
 *
 * Off by default, so every caller that does not ask gets the bytes it always
 * got. On, the map names the cart's files as the tree does and points a
 * throw back at its own line.
 */

const FILES = [
    { name: "index.tsx", text: `import { points } from "./lib/rules"\nexport function onPlay() {\n    return points(3)\n}\n` },
    { name: "lib/rules.ts", text: `export function points(n: number) {\n    if (n > 2) throw new TypeError("too many points")\n    return n\n}\n` },
    { name: "oj.json", text: "{}" },
]

describe("buildGame's source map", () => {
    it("is not made unless asked for, and the code is what it always was", async () => {
        const plain = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR })
        expect((plain as { map?: unknown }).map).toBeUndefined()
        expect(plain.code).not.toContain("sourceMappingURL")
        const asked = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR, sourcemap: true })
        expect(asked.code).toBe(plain.code)
    })

    it("names the cart's files and points a throw at its own line", async () => {
        const built = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR, sourcemap: true })
        expect(typeof built.map).toBe("string")
        const map = JSON.parse(built.map!)
        expect([...map.sources].sort()).toEqual(["index.tsx", "lib/rules.ts"])
        expect(map.sourcesContent).toBeUndefined()

        // The throw site, found in the minified output by its message.
        const lines = built.code.split("\n")
        const line = lines.findIndex((l) => l.includes("too many points"))
        const column = lines[line]!.lastIndexOf("throw", lines[line]!.indexOf("too many points"))
        const at = originalPositionFor(new TraceMap(built.map!), { line: line + 1, column })
        expect([at.source, at.line]).toEqual(["lib/rules.ts", 2])
    })

    it("keeps the namespace on what the build made, so it never reads as a cart file", async () => {
        const files = [{ name: "index.tsx", text: `import { useState } from "react"\nexport const n = () => useState(1)\n` }]
        const built = await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, sourcemap: true })
        expect(JSON.parse(built.map!).sources).toEqual(["ext:react", "index.tsx"])
    })
})
