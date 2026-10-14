import { describe, it, expect, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { init } from "./init.mjs"
import { NAMES_CS, namesCS, typecheck } from "./game.mjs"

/**
 * Sai, 14 Oct 2026: CS, Unity's C# API, is allowed in a cart as the one door
 * to the host, and `ojplay typecheck` says once that such a cart runs only on
 * a Unity host (Specs/ROOT_CARTS.md §10 in the OneJS container).
 */
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe("typecheck and CS", () => {
    it("names a cart's use of CS once, with the file", () => {
        expect(namesCS([{ name: "a.tsx", text: "const x = 1\n" }, { name: "b.ts", text: "CS.UnityEngine.Debug.Log(1)\nCS.UnityEngine.Debug.Log(2)\n" }])).toBe("b.ts")
    })

    it("does not count CS in a comment, or as a member of something else", () => {
        expect(namesCS([{ name: "a.tsx", text: "// CS.UnityEngine is how\n/* CS.X */ const DOCS = 1\nobj.CS.foo()\n" }])).toBeNull()
    })

    it("ignores files that are not code", () => {
        expect(namesCS([{ name: "notes.md", text: "CS.UnityEngine" }])).toBeNull()
    })

    it("says it under typecheck, once, after tsc, and not when asked to be quiet", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "oj-typecheck-cs-"))
        dirs.push(root)
        init(root)
        fs.symlinkSync(path.resolve(import.meta.dirname, "../node_modules"), path.join(root, "node_modules"), "junction")
        fs.writeFileSync(path.join(root, "index.tsx"), "declare const CS: any\nCS.UnityEngine.Debug.Log(1)\nCS.UnityEngine.Debug.Log(2)\nexport {}\n")
        const said: string[] = []
        const error = console.error
        console.error = (line: string) => { said.push(line) }
        try {
            typecheck(root, { quiet: true })
            expect(said).toEqual([])
            typecheck(root)
        } finally {
            console.error = error
        }
        expect(said).toEqual([`[ojplay] ${NAMES_CS} (index.tsx)`])
    })
})
