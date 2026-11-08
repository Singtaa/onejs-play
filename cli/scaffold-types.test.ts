import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
import { cartTsconfig, writeHostTypes } from "./init.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

/**
 * oj's source as a cart made by `ojplay new` compiles it: the cart's tsconfig
 * reaches src/index.ts through `paths` and checks it under the cart's lib,
 * ES2020 (build/cart-types.mjs), not this package's ES2022. 0.15.0's nav.ts
 * passed Error a `cause`, and every new cart's typecheck failed while this
 * package's own two passed.
 */
function cartDiagnostics(files: string[]): string[] {
    const { paths: _paths, ...compilerOptions } = cartTsconfig().compilerOptions
    const { options, errors } = ts.convertCompilerOptionsFromJson(compilerOptions, ROOT)
    expect(errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n"))).toEqual([])
    const host = fs.mkdtempSync(path.join(os.tmpdir(), "oj-cart-types-"))
    dirs.push(host)
    const program = ts.createProgram([...files, writeHostTypes(host)], options)
    return ts.getPreEmitDiagnostics(program).map((d) => {
        const where = d.file ? `${path.relative(ROOT, d.file.fileName)}(${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1})` : ""
        return `${where}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
    })
}

describe("oj under a new cart's tsconfig", () => {
    it("compiles oj's source", () => {
        expect(cartDiagnostics([path.join(ROOT, "src/index.ts")])).toEqual([])
    }, 120_000)

    it("refuses what the cart's lib lacks, so a clean answer above means something", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-cart-cause-"))
        dirs.push(dir)
        const file = path.join(dir, "cause.ts")
        fs.writeFileSync(file, "export const e = new Error(\"x\", { cause: 1 })\n")
        expect(cartDiagnostics([file]).join("\n")).toMatch(/Expected 0-1 arguments, but got 2/)
    }, 120_000)
})
