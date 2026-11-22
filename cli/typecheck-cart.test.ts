import { afterEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/typecheck-cart.mjs")
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

function run(source: string | null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-typecheck-cart-"))
    dirs.push(dir)
    const file = path.join(dir, "cart.ts")
    if (source !== null) fs.writeFileSync(file, source)
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" })
    return { status: r.status, out: r.stdout + r.stderr }
}

describe("npm run typecheck's cart compile (scripts/typecheck-cart.mjs)", () => {
    it("exits 1 on what a cart's ES2020 lib refuses, naming the line and the form to use", () => {
        const r = run("export const e = Object.assign(new Error(\"x\"), { cause: 1 })\nexport const f = new Error(\"y\", { cause: 2 })\n")
        expect(r.status).toBe(1)
        expect(r.out).toMatch(/cart\.ts\(2\): Expected 0-1 arguments, but got 2/)
        expect(r.out).toContain("Object.assign(new Error(message), { cause: e })")
    }, 120_000)

    it("exits 0 on what it accepts", () => {
        expect(run("export const e = Object.assign(new Error(\"x\"), { cause: 1 })\n").status).toBe(0)
    }, 120_000)

    it("exits 3 with nothing to compile", () => {
        expect(run(null).status).toBe(3)
    })
})
