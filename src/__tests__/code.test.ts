import { describe, expect, it } from "vitest"
import { tokenize, tokenizeLine, CODE_THEME, type Token } from "../code"

const kinds = (line: string) => tokenizeLine(line).tokens.map((t) => `${t.kind}:${t.text}`)
const flat = (tokens: Token[]) => tokens.map((t) => t.text).join("")

describe("tokenizing a line", () => {
    /** The property that matters most: highlighting must not eat characters. */
    it("puts every character back exactly as it found it", () => {
        for (const line of [
            'const x = sl.uniform.float("warp", 0.5)',
            "  return sl.vec4(rgb, 1) // done",
            "if (a === b) { doThing() } else { /* nope */ }",
            "const s = `a ${b} c`",
            "",
            "        ",
            'const q = "he said \\"hi\\" loudly"',
        ]) {
            expect(flat(tokenizeLine(line).tokens)).toBe(line)
        }
    })

    it("finds keywords, calls, types, numbers and strings", () => {
        expect(kinds('const t = sl.vec4(Color, 1.5, "x")')).toEqual([
            "keyword:const", "plain: t = sl", "punct:.", "call:vec4", "punct:(",
            "type:Color", "punct:,", "plain: ", "number:1.5", "punct:,", "plain: ",
            "string:\"x\"", "punct:)",
        ])
    })

    /** A comment marker inside a string is not a comment. */
    it("does not start a comment inside a string", () => {
        const t = tokenizeLine('const u = "http://x.com" // real')
        expect(t.tokens.some((x) => x.kind === "string" && x.text.includes("//"))).toBe(true)
        expect(t.tokens.filter((x) => x.kind === "comment")).toHaveLength(1)
    })

    /** And a quote inside a comment does not open a string. */
    it("does not start a string inside a comment", () => {
        const t = tokenizeLine('// it said "hello')
        expect(t.tokens).toHaveLength(1)
        expect(t.tokens[0]!.kind).toBe("comment")
    })

    it("keeps an escaped quote inside its string", () => {
        const t = tokenizeLine('"a\\"b"')
        expect(t.tokens).toHaveLength(1)
        expect(t.tokens[0]!.text).toBe('"a\\"b"')
    })

    it("merges a run of the same kind into one token", () => {
        const t = tokenizeLine("abc def ghi")
        expect(t.tokens).toHaveLength(1)
    })

    it("survives an unterminated string rather than looping", () => {
        expect(flat(tokenizeLine('const a = "oops').tokens)).toBe('const a = "oops')
    })
})

describe("tokenizing a block", () => {
    it("carries a block comment across lines and closes it", () => {
        const lines = ["/* one", "still", "*/ const a = 1"]
        const out = tokenize(lines)
        expect(out[0]!.every((t) => t.kind === "comment")).toBe(true)
        expect(out[1]!.every((t) => t.kind === "comment")).toBe(true)
        expect(out[2]!.some((t) => t.kind === "keyword")).toBe(true)
    })

    it("accepts a string or an array of lines and agrees with itself", () => {
        const text = "const a = 1\n// two"
        expect(tokenize(text)).toEqual(tokenize(text.split("\n")))
    })

    it("returns one row per line, including empty ones", () => {
        expect(tokenize("a\n\nb")).toHaveLength(3)
    })
})

describe("the theme", () => {
    it("has a colour for every kind a token can be", () => {
        const seen = new Set(tokenize([
            'const A = f("s", 1) // c', "/* b */",
        ]).flat().map((t) => t.kind))
        for (const kind of seen) {
            expect(CODE_THEME[kind], `${kind} has a colour`).toMatch(/^#[0-9a-f]{6}$/i)
        }
    })
})
