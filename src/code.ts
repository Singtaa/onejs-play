/**
 * Syntax highlighting for TypeScript and JavaScript, in the runtime.
 *
 * Here rather than in a game because every game that shows code wants it and
 * none of them should write it. A shader demo, a tutorial, a level editor
 * printing the script it just ran: the same handful of colours each time.
 *
 * This is a TOKENIZER, not a parser. It knows strings from comments from
 * keywords, and stops there. Highlighting that is right about `"// not a
 * comment"` and wrong about whether a name is a type is the correct trade for
 * something drawing 20 lines in a panel: the failures a parser would fix are
 * invisible at this size, and the failures it would not are the ones that make
 * code unreadable.
 */

export type TokenKind =
    | "plain" | "keyword" | "string" | "number" | "comment" | "punct" | "call" | "type"

export interface Token { text: string; kind: TokenKind }

const KEYWORDS = new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while", "do",
    "break", "continue", "new", "class", "extends", "import", "export", "from", "as",
    "default", "async", "await", "yield", "typeof", "instanceof", "in", "of", "this",
    "true", "false", "null", "undefined", "void", "delete", "try", "catch", "finally",
    "throw", "switch", "case", "interface", "type", "enum", "implements", "readonly",
    "public", "private", "protected", "static", "abstract", "declare", "satisfies",
])

/** Identifiers that read as types by convention, so PascalCase. */
const looksLikeType = (word: string) => /^[A-Z][A-Za-z0-9_]*$/.test(word)

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdent = (c: string) => /[A-Za-z0-9_$]/.test(c)
const isDigit = (c: string) => c >= "0" && c <= "9"

/**
 * One line, as coloured pieces.
 *
 * Line at a time on purpose: a panel lays out one row per line, and a
 * tokenizer that spans lines would have to hand back where it got to. The one
 * construct that genuinely spans lines is a block comment, so the caller
 * passes what it knows and gets back what is still open.
 */
export function tokenizeLine(line: string, inBlockComment = false):
    { tokens: Token[]; inBlockComment: boolean } {
    const tokens: Token[] = []
    let i = 0
    let block = inBlockComment
    const push = (text: string, kind: TokenKind) => {
        if (text.length === 0) return
        const last = tokens[tokens.length - 1]
        // Merged so a run of plain characters is one element rather than forty.
        if (last !== undefined && last.kind === kind) last.text += text
        else tokens.push({ text, kind })
    }

    while (i < line.length) {
        if (block) {
            const end = line.indexOf("*/", i)
            if (end === -1) { push(line.slice(i), "comment"); i = line.length; break }
            push(line.slice(i, end + 2), "comment")
            i = end + 2
            block = false
            continue
        }

        const c = line[i]!
        const next = line[i + 1]

        if (c === "/" && next === "/") { push(line.slice(i), "comment"); break }
        if (c === "/" && next === "*") { block = true; continue }

        if (c === '"' || c === "'" || c === "`") {
            let j = i + 1
            while (j < line.length) {
                if (line[j] === "\\") { j += 2; continue }
                if (line[j] === c) { j++; break }
                j++
            }
            push(line.slice(i, j), "string")
            i = j
            continue
        }

        if (isDigit(c) || (c === "." && next !== undefined && isDigit(next))) {
            let j = i
            while (j < line.length && /[0-9._eExXa-fA-F]/.test(line[j]!)) j++
            push(line.slice(i, j), "number")
            i = j
            continue
        }

        if (isIdentStart(c)) {
            let j = i
            while (j < line.length && isIdent(line[j]!)) j++
            const word = line.slice(i, j)
            // A name followed by "(" is being called, which is worth seeing:
            // it is how you read what a snippet DOES at a glance.
            const called = line[j] === "("
            push(word,
                KEYWORDS.has(word) ? "keyword"
                    : called ? "call"
                        : looksLikeType(word) ? "type" : "plain")
            i = j
            continue
        }

        push(c, /[{}()[\].,;:]/.test(c) ? "punct" : "plain")
        i++
    }

    return { tokens, inBlockComment: block }
}

/** Every line of a snippet, carrying block comment state between them. */
export function tokenize(source: string | readonly string[]): Token[][] {
    const lines = typeof source === "string" ? source.split("\n") : source
    let block = false
    return lines.map((line) => {
        const out = tokenizeLine(line, block)
        block = out.inBlockComment
        return out.tokens
    })
}

/** A colour per kind, dark background. Override any of them per use. */
export type CodeTheme = Record<TokenKind, string>

export const CODE_THEME: CodeTheme = {
    plain: "#c9d3e0",
    keyword: "#c792ea",
    string: "#a8e6a3",
    number: "#f7c66b",
    comment: "#5f6b7d",
    punct: "#8b95a5",
    call: "#82b7ff",
    type: "#7ee0d0",
}
