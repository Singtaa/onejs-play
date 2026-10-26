import { describe, expect, it } from "vitest"
import path from "node:path"
import * as esbuild from "esbuild"
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping"
import { buildGame } from "./game.mjs"
import { mentionsShow } from "./show-sites.mjs"

const WORKING_DIR = path.parse(process.cwd()).root || "/"

/**
 * Each call to oj's show carries its file and line into the bundle, so the
 * editor can put the value beside that line (src/show.ts).
 *
 * The build does the binding, not a scan of the source: esbuild has already
 * decided which `show` is oj's and renamed any local that shadows it, so a
 * cart's own function named show is never touched, and a cart that does not
 * import oj's builds to exactly the bytes it always did.
 */

/** Runs a bundle against an oj that records what reached show, tagged or not. */
function run(code: string) {
    const calls: Array<{ site: string | null, values: unknown[] }> = []
    const show = (...values: unknown[]) => { calls.push({ site: null, values }) }
    Object.defineProperty(show, "$", { value: (site: string, ...values: unknown[]) => { calls.push({ site, values }) } })
    const exports = new Function("__ojExternals", `${code}\nreturn __exports`)({ oj: { show, mount: () => {} } }) as Record<string, unknown>
    return { calls, exports }
}

const LESSON = [
    { name: "A.ts", text: [
        `import { show } from "oj"`,
        `import { show as s } from "oj"`,
        `import * as oj from "oj"`,
        `import { again } from "./util"`,
        `const f = (x: number) => 3 * x ** 2 - 4 * x + 5`,
        `show(f(3.0))`,
        `s(1, 2)`,
        `oj.show(3)`,
        `again(4)`,
        `show?.(5)`,
        `show()`,
        `;[6].forEach(show)`,
        `show(`,
        `    7,`,
        `)`,
        ``,
    ].join("\n") },
    { name: "util.ts", text: `export { show as again } from "oj"\n` },
    { name: "index.tsx", text: `import "./A"\n` },
]

describe("show sites", () => {
    it("tags each call to oj's show with its file and line", async () => {
        const built = await buildGame(esbuild, LESSON, "index.tsx", { workingDir: WORKING_DIR, showSites: true })
        expect(run(built.code).calls).toEqual([
            { site: "A.ts:6", values: [20] },
            { site: "A.ts:7", values: [1, 2] },
            { site: "A.ts:8", values: [3] },
            { site: "A.ts:9", values: [4] },
            { site: "A.ts:10", values: [5] },
            { site: "A.ts:11", values: [] },
            // Passed as a value: no call to tag, so it shows without a line.
            { site: null, values: [6, 0, [6]] },
            { site: "A.ts:13", values: [7] },
        ])
    })

    it("tags a call the minifier writes straight after a keyword: return(, else(, throw(", async () => {
        const files = [
            { name: "index.tsx", text: [
                `import { show } from "oj"`,
                `export function back(n: number) {`,
                `    return show(n)`,
                `}`,
                `export function pick(n: number) {`,
                `    if (n > 1) show("big")`,
                `    else show("small")`,
                `}`,
                `export function choose(n: number) {`,
                `    if (n > 1) { for (const k of [n]) show(k) } else show("none")`,
                `}`,
                `export function fail(n: number) {`,
                `    throw show(n)`,
                `}`,
                ``,
            ].join("\n") },
        ]
        const built = await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, showSites: true })
        // The shapes this is about, as the minifier writes them.
        for (const keyword of ["return", "else", "throw"]) expect(built.code).toMatch(new RegExp(`${keyword}\\(0,`))
        const { calls, exports } = run(built.code)
        const cart = exports as Record<string, (n: number) => unknown>
        cart.back!(1)
        cart.pick!(2)
        cart.pick!(0)
        cart.choose!(0)
        expect(() => cart.fail!(5)).toThrow()
        expect(calls).toEqual([
            { site: "index.tsx:3", values: [1] },
            { site: "index.tsx:6", values: ["big"] },
            { site: "index.tsx:7", values: ["small"] },
            { site: "index.tsx:10", values: ["none"] },
            { site: "index.tsx:13", values: [5] },
        ])
    })

    it("leaves show passed to a call alone, which minified reads like one after a keyword", async () => {
        const files = [
            { name: "index.tsx", text: [
                `import { show } from "oj"`,
                `export function pair(a: number, f: (n: number) => void) { return a > 0 ? null : f }`,
                `export function use(n: number) {`,
                `    pair(0, show)!(n)`,
                `}`,
                ``,
            ].join("\n") },
        ]
        const built = await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, showSites: true })
        expect(built.code).toMatch(/pair\(0,[\w$]+\.show\)\(n\)/)
        const { calls, exports } = run(built.code)
        ;(exports as Record<string, (n: number) => void>).use!(8)
        expect(calls).toEqual([{ site: null, values: [8] }])
    })

    it("leaves a cart's own function named show alone", async () => {
        const files = [
            { name: "index.tsx", text: `import { show } from "oj"\nimport { mine } from "./mine"\nshow(mine())\n` },
            { name: "mine.ts", text: `function show(x: number) { return x * 2 }\nexport const mine = () => show(21)\nexport const twice = { show: (x: number) => x + x }\nexport const four = twice.show(2)\n` },
        ]
        const built = await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, showSites: true })
        expect(run(built.code).calls).toEqual([{ site: "index.tsx:3", values: [42] }])
        expect(built.code.match(/\.show\.\$/g)).toHaveLength(1)
    })

    it("builds a cart that does not import oj's show to exactly the bytes it always did", async () => {
        const files = [
            { name: "index.tsx", text: `import { mount } from "oj"\nfunction show(n: number) { return n }\nexport const shown = show(3)\nmount(() => null)\n` },
        ]
        const plain = await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, sourcemap: true })
        const tagged = await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, sourcemap: true, showSites: true })
        expect(tagged.code).toBe(plain.code)
        expect(tagged.map).toBe(plain.map)
        expect(mentionsShow(files)).toBe(false)
    })

    it("keeps the source map true past a tagged call on the same line", async () => {
        const files = [
            { name: "index.tsx", text: `import { show } from "oj"\nexport function onPlay(n: number) {\n    show(n)\n    if (n > 2) throw new TypeError("too many points")\n}\n` },
        ]
        const built = await buildGame(esbuild, files, "index.tsx", { workingDir: WORKING_DIR, sourcemap: true, showSites: true })
        expect(built.code).toContain(`.show.$)("index.tsx:3",`)
        const lines = built.code.split("\n")
        const line = lines.findIndex((l) => l.includes("too many points"))
        const column = lines[line]!.lastIndexOf("throw", lines[line]!.indexOf("too many points"))
        const at = originalPositionFor(new TraceMap(built.map!), { line: line + 1, column })
        expect([at.source, at.line, at.column]).toEqual(["index.tsx", 4, 15])
    })

    it("tags without handing back a map nobody asked for", async () => {
        const built = await buildGame(esbuild, LESSON, "index.tsx", { workingDir: WORKING_DIR, showSites: true })
        expect((built as { map?: unknown }).map).toBeUndefined()
        expect(built.code).toContain(`"A.ts:6"`)
    })
})
