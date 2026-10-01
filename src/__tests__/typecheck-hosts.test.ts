import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * oj is type-checked from source wherever it is used: a OneJS app's tsconfig
 * maps "oj" to ./node_modules/ojplay/src, and the site and the browser tests
 * compile the same files against the DOM. This package's own typecheck has
 * Node's types loaded, which declare fetch and the rest whatever the host, so
 * it cannot see either. Each host's settings are checked here instead.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..")
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc")

/**
 * OneJS's template types/global.d.ts, byte for byte from OneJS 3.9.3
 * (Editor/Templates/global.d.ts.txt). It is the one place a OneJS app's
 * globals are typed: console, the timers, and its own WebSocket. It types no
 * fetch, Response or URLSearchParams, so oj cannot lean on those names.
 */
const ONEJS_GLOBALS = path.join(import.meta.dirname, "fixtures", "onejs-3.9.3-global.d.ts")

/** tsc over src/index.ts, plus `extra` files, with these compiler options. tsc's output, empty when clean. */
function check(options: Record<string, unknown>, extra: string[] = []): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-typecheck-"))
    try {
        const config = {
            compilerOptions: {
                target: "ES2022",
                module: "ESNext",
                moduleResolution: "Bundler",
                jsx: "react-jsx",
                strict: true,
                skipLibCheck: true,
                isolatedModules: true,
                esModuleInterop: true,
                resolveJsonModule: true,
                noEmit: true,
                typeRoots: [path.join(ROOT, "node_modules"), path.join(ROOT, "node_modules", "@types")],
                ...options,
            },
            files: [path.join(ROOT, "src", "index.ts"), ...extra],
        }
        fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
        const result = spawnSync(process.execPath, [TSC, "-p", dir], { encoding: "utf8" })
        return (result.stdout + result.stderr).split(path.join(ROOT, "")).join("").trim()
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

describe("oj type-checks from source", () => {
    it("in a OneJS app: ES2022 and Unity's types, no DOM and no Node", () => {
        // OneJS's template tsconfig and global.d.ts, as `ojplay add` and init --unity write them.
        expect(check({ lib: ["ES2022"], types: ["unity-types", "react"] }, [ONEJS_GLOBALS])).toBe("")
    }, 60_000)

    it("in a DOM build: the site and the browser tests", () => {
        expect(check({ lib: ["ES2022", "DOM", "DOM.Iterable"], types: ["react"] })).toBe("")
    }, 60_000)
})
