import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

/**
 * What `npm pack` puts in the tarball: the package's own files, and none of
 * its tests or their fixtures, which nothing outside the tests imports. Every
 * relative import in a packed file has to land on another packed file, so
 * leaving the tests out can't break what an install runs.
 */
const ROOT = path.join(import.meta.dirname, "..")
const TEST = /(^|\/)__tests__\/|\.test\.tsx?$|^cli\/fixtures\//
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g

function packed(): string[] {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm"
    const result = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: ROOT, encoding: "utf8", shell: process.platform === "win32",
    })
    if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr}`)
    return JSON.parse(result.stdout)[0].files.map((f: { path: string }) => f.path)
}

/** The packed file a relative import names, trying the extensions the package's sources leave off. */
function landsOn(files: Set<string>, from: string, spec: string): boolean {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
    const bare = target.replace(/\.(m?js)$/, "")
    return [target, `${bare}.ts`, `${bare}.tsx`, `${bare}.mjs`, `${bare}.js`, `${target}/index.ts`, `${target}/index.mjs`, `${target}/index.js`]
        .some((candidate) => files.has(candidate))
}

describe("the tarball", () => {
    const files = packed()

    it("leaves out the tests and their fixtures", () => {
        expect(files.length).toBeGreaterThan(20)
        expect(files.filter((f) => TEST.test(f))).toEqual([])
    })

    it("still holds everything its own files import", () => {
        const set = new Set(files)
        const missing: string[] = []
        let seen = 0
        for (const file of files.filter((f) => /\.(m?js|tsx?)$/.test(f))) {
            for (const [, spec] of fs.readFileSync(path.join(ROOT, file), "utf8").matchAll(IMPORT)) {
                seen++
                if (!landsOn(set, file, spec)) missing.push(`${file} imports ${spec}`)
            }
        }
        expect(seen).toBeGreaterThan(20)
        expect(missing).toEqual([])
    })
})
