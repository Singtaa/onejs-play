// oj's source as a cart made by `ojplay new` compiles it: under the cart's own tsconfig
// (cli/init.mjs cartTsconfig, lib ES2020 from build/cart-types.mjs) with the host's globals,
// not this package's ES2022. Part of `npm run typecheck`, so a call the cart's lib refuses
// fails in seconds beside the other two configs. It bit twice: 0.15.0's nav.ts (bae1f1a) and
// 4850744's font and tex errors, each passing Error a second argument, { cause }, which ES2020
// has no overload for. cli/scaffold-types.test.ts asks the same question in the unit tests.
//
//     node scripts/typecheck-cart.mjs            src/index.ts
//     node scripts/typecheck-cart.mjs <file>...  those files instead
//
// Exit 0 clean, 1 with what the cart's compiler said, 3 when there was no file to compile.

import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { cartTsconfig, writeHostTypes } from "../cli/init.mjs"
import { makeTemp } from "../cli/temp.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => path.resolve(f)) : [path.join(ROOT, "src/index.ts")]
const missing = files.filter((f) => !fs.existsSync(f))
if (missing.length > 0) {
    console.error(`typecheck-cart: no file to compile: ${missing.join(", ")}`)
    process.exit(3)
}

// The cart reaches oj through `paths`; here the files are given, so its paths would only point back at them.
const { paths: _paths, ...compilerOptions } = cartTsconfig().compilerOptions
const { options, errors } = ts.convertCompilerOptionsFromJson(compilerOptions, ROOT)
const host = makeTemp("oj-cart-types-")
let said
try {
    const program = ts.createProgram([...files, writeHostTypes(host)], options)
    said = [...errors, ...ts.getPreEmitDiagnostics(program)].map((d) => {
        const where = d.file ? `${path.relative(ROOT, d.file.fileName)}(${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1})` : ""
        return `${where}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
    })
} finally {
    fs.rmSync(host, { recursive: true, force: true })
}
if (said.length > 0) {
    for (const line of said) console.error(line)
    console.error(`typecheck-cart: ${said.length} errors under a new cart's tsconfig (lib ${compilerOptions.lib.join(", ")}). For an error's cause write Object.assign(new Error(message), { cause: e }), not new Error(message, { cause: e }).`)
    process.exit(1)
}
console.log(`typecheck-cart: ${files.map((f) => path.relative(ROOT, f)).join(", ")} compile under a new cart's tsconfig (lib ${compilerOptions.lib.join(", ")})`)
