#!/usr/bin/env node
/**
 * Writes oj's copy of Recast and Detour (recast-navigation) from the pinned npm packages.
 *
 *     node scripts/vendor-recast.mjs
 *
 * The same arrangement as vendor-rapier.mjs, for the same reasons: the glue
 * is vendored as one ES module that never fetches its own .wasm (src/wasm.ts
 * hands it the module through Emscripten's instantiateWasm hook), and the
 * module ships as assets/@ojplay/wasm/recast-<version>.wasm.
 *
 * Writes src/nav/recast.vendor.js, src/nav/recast.version.ts and the .wasm.
 * nav.test.ts fails when they and the installed packages disagree.
 */

import * as esbuild from "esbuild"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const pkg = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8"))
const version = pkg("@recast-navigation/wasm").version
for (const name of ["@recast-navigation/core", "@recast-navigation/generators"]) {
    if (pkg(name).version !== version) throw new Error(`${name} is ${pkg(name).version}, the wasm is ${version}: pin all three to one release`)
}
const glueFile = path.join(ROOT, "node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm.js")
const wasmBytes = fs.readFileSync(path.join(ROOT, "node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm.wasm"))
const sha256 = createHash("sha256").update(wasmBytes).digest("hex")
const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasmBytes))

const result = await esbuild.build({
    stdin: {
        contents: [
            `export * from "@recast-navigation/core"`,
            `export { generateSoloNavMesh } from "@recast-navigation/generators"`,
            `export { default as recastFactory } from ${JSON.stringify(glueFile)}`,
        ].join("\n"),
        resolveDir: ROOT,
        loader: "js",
    },
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    legalComments: "inline",
    // The glue names its own address to find its .wasm beside it. It never
    // looks, since oj always hands it the module, but the address must parse.
    define: { "import.meta.url": JSON.stringify("https://oj.invalid/recast/") },
    plugins: [{
        name: "one-glue",
        setup(build) {
            // core's init() would import the base64 build when given no module; send it to the same glue.
            build.onResolve({ filter: /^@recast-navigation\/wasm$/ }, () => ({ path: glueFile }))
        },
    }],
})
const glue = freeComputePath(result.outputFiles[0].text)
if (/base64,AGFzbQ/.test(glue)) throw new Error("the vendored glue carries an inline .wasm")

/**
 * NavMeshQuery.computePath frees findPath's polys and findStraightPath's three arrays only on its one success return;
 * each early return (an end off the floor, a failed findPath or findStraightPath) keeps them, in the wasm heap and in
 * the bindings' cache, for good: a world that asks for paths it cannot have runs out of memory. Upstream's main
 * (8a2ece9f, its 0.44.0 release) has the same shape. The patch runs the method's body in a try whose finally frees
 * whatever it made.
 * Every edit must match exactly once, so a release that changes the method stops this script instead of shipping a
 * half patch: drop the patch when upstream frees them itself.
 * Upstream has not been told, by the maintainer's decision (25 Nov 2026): do not file it there unless he asks.
 */
function freeComputePath(text) {
    const once = (s, find, put, what) => {
        const n = s.split(find).length - 1
        if (n !== 1) throw new Error(`computePath patch: ${what} matched ${n} times, not once: has upstream changed computePath?`)
        return s.replace(find, () => put)
    }
    const head = "  computePath(start, end, options) {\n"
    const start = text.indexOf(head)
    const stop = text.indexOf("\n  findPath(", start)
    if (start < 0 || stop < 0 || text.indexOf(head, start + 1) >= 0) throw new Error("computePath patch: the method is not where it was")
    let m = text.slice(start, stop)
    m = once(m, head, `${head}    const made = [];\n    try {\n`, "the head")
    m = once(m, "      maxPathPolys\n    });\n", "      maxPathPolys\n    });\n    made.push(findPathResult.polys);\n", "findPath's call")
    m = once(m, "      maxStraightPathPoints\n    });\n", "      maxStraightPathPoints\n    });\n    made.push(findStraightPathResult.straightPath, findStraightPathResult.straightPathFlags, findStraightPathResult.straightPathRefs);\n", "findStraightPath's call")
    m = once(m, [
        "    findPathResult.polys.destroy();",
        "    findStraightPathResult.straightPath.destroy();",
        "    findStraightPathResult.straightPathFlags.destroy();",
        "    findStraightPathResult.straightPathRefs.destroy();",
        "",
    ].join("\n"), "", "the success return's frees")
    m = once(m, "      path: points\n    };\n  }\n", "      path: points\n    };\n    } finally {\n      for (const a of made) a.destroy();\n    }\n  }\n", "the method's end")
    return text.slice(0, start) + m + text.slice(stop)
}

const header = `// Generated by scripts/vendor-recast.mjs from @recast-navigation/*@${version} (MIT; Recast and Detour, zlib). Do not edit.\n`
const out = path.join(ROOT, "src/nav")
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, "recast.vendor.js"), header + "/* eslint-disable */\n// @ts-nocheck\n" + glue)
const wasmDir = path.join(ROOT, "assets/@ojplay/wasm")
fs.mkdirSync(wasmDir, { recursive: true })
for (const old of fs.readdirSync(wasmDir)) if (old.startsWith("recast-")) fs.rmSync(path.join(wasmDir, old))
fs.writeFileSync(path.join(wasmDir, `recast-${version}.wasm`), wasmBytes)
fs.writeFileSync(path.join(out, "recast.version.ts"), `${header.trim()}

/** The recast-navigation release oj runs. */
export const RECAST_VERSION = ${JSON.stringify(version)}

/** The sha256 of the module, which a native link is checked against. */
export const RECAST_WASM_SHA256 = ${JSON.stringify(sha256)}

/** What the module imports, as module and name: what a native link is made against. */
export const RECAST_WASM_IMPORTS: readonly string[] = ${JSON.stringify(imports.map((i) => `${i.module}.${i.name}`), null, 4)}
`)
console.log(`vendored recast-navigation@${version}: glue ${glue.length} bytes, wasm ${wasmBytes.length} bytes, sha256 ${sha256}, ${imports.length} imports`)
