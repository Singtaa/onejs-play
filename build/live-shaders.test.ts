import { describe, expect, it } from "vitest"
import path from "node:path"
import * as esbuild from "esbuild"
import { buildGame } from "./game.mjs"

const WORKING_DIR = path.parse(process.cwd()).root || "/"

/**
 * A preview whose `.sl` programs can be swapped while the cart runs.
 *
 * PlaySite's editor compiles a shader as it is edited and hands the program
 * to the running preview under the file's name as the file list shows it
 * (the Ghost Hunt dry run, 1 Oct 2026). Off unless asked: what a save
 * publishes is what it always was.
 */
const SHIMMER = "uniform float speed = 1.2;\nfloat4 main() { return float4(uv, speed, 1); }\n"
const FILES = [
    { name: "index.tsx", text: `import shimmer from "./fx/shimmer.sl"\nexport const current = () => shimmer\n` },
    { name: "fx/shimmer.sl", text: SHIMMER },
    { name: "oj.json", text: "{}" },
]

describe("buildGame's live shaders", () => {
    it("registers each program under the name the file list shows", async () => {
        const built = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR, liveShaders: true })
        const globals = {} as { __ojLiveShaders?: Record<string, (next: unknown) => void> }
        const run = new Function("globalThis", built.code + "\nreturn __exports")
        const exports = run(globals) as { current: () => unknown }
        const next = { hash: "next" }
        globals.__ojLiveShaders!["fx/shimmer.sl"]!(next)
        expect(exports.current()).toBe(next)
    })

    it("is not in a build that did not ask, and the code is what it always was", async () => {
        const plain = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR })
        expect(plain.code).not.toContain("__ojLiveShaders")
        const off = await buildGame(esbuild, FILES, "index.tsx", { workingDir: WORKING_DIR, liveShaders: false })
        expect(off.code).toBe(plain.code)
    })
})
