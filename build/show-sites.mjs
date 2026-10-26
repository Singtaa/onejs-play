/**
 * Each call to oj's show, tagged with the file and line it was written on.
 *
 * The editor draws a show call's value at the end of its line (src/show.ts),
 * so each call has to know its line. This rewrites
 *
 *     (0,import_oj.show)(x)    into    (0,import_oj.show.$)("A.ts:9",x)
 *
 * in the bundle, after esbuild has built it, and moves the source map to
 * match.
 *
 * WHY THE BUNDLE AND NOT THE SOURCE. Which `show` is oj's is a question of
 * binding: an alias (`import { show as s }`), a namespace (`oj.show`), a
 * re-export through another file, or a cart's own function named show that
 * shadows nothing or shadows the import. esbuild has already answered it. In
 * its output every import from oj reads off a variable initialised from oj's
 * module, and with identifiers unminified it renames any local that would
 * shadow one (a parameter named `oj` becomes `oj2`). So `import_oj.show` in
 * the bundle IS oj's show, everywhere, and scanning the source for the word
 * would have to rebuild that answer and get the corners wrong.
 *
 * WHAT IT COSTS A CART THAT DOES NOT USE IT: nothing. `mentionsShow` gates the
 * whole of it on the cart's own text, and a cart that never imports show
 * from oj builds exactly as it always did, minified, byte for byte. A cart
 * that does is built with identifiers unminified (whitespace and syntax are
 * still minified), which is what makes the binding readable. Its bundle is
 * larger by its identifiers' length and runs the same.
 *
 * The one thing this cannot see is text inside a string that spells a tagged
 * call, `"(0,import_oj.show)("`, which nobody writes.
 */

/**
 * Whether the cart's own files can call oj's show at all: a cheap gate,
 * generous by design. A false yes costs an unminified build; a false no
 * would only lose the line, never the value.
 */
export function mentionsShow(files) {
    return files.some(({ text }) => /\bshow\b/.test(text) && (
        /\{[^}]*\bshow\b[^}]*\}\s*from\s*["']oj["']/.test(text)
        || /\*\s*as\s+[\w$]+\s+from\s*["']oj["']/.test(text)
    ))
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** mappings, per generated line, as absolute [column, source, line, column, name?] segments. */
function decode(mappings) {
    const lines = []
    const state = [0, 0, 0, 0]
    for (const row of mappings.split(";")) {
        const segments = []
        let column = 0
        for (const chunk of row.split(",")) {
            if (chunk === "") continue
            const values = []
            let value = 0, shift = 0
            for (const ch of chunk) {
                const digit = BASE64.indexOf(ch)
                value += (digit & 31) << shift
                if (digit & 32) { shift += 5; continue }
                values.push(value & 1 ? -(value >>> 1) : value >>> 1)
                value = 0
                shift = 0
            }
            column += values[0]
            const segment = [column]
            for (let i = 1; i < values.length; i++) {
                state[i - 1] += values[i]
                segment.push(state[i - 1])
            }
            segments.push(segment)
        }
        lines.push(segments)
    }
    return lines
}

function vlq(n) {
    let value = n < 0 ? (-n << 1) | 1 : n << 1
    let out = ""
    do {
        let digit = value & 31
        value >>>= 5
        if (value > 0) digit |= 32
        out += BASE64[digit]
    } while (value > 0)
    return out
}

function encode(lines) {
    const state = [0, 0, 0, 0]
    return lines.map((segments) => {
        let column = 0
        return segments.map((segment) => {
            let out = vlq(segment[0] - column)
            column = segment[0]
            for (let i = 1; i < segment.length; i++) {
                out += vlq(segment[i] - state[i - 1])
                state[i - 1] = segment[i]
            }
            return out
        }).join(",")
    }).join(";")
}

const escape = (name) => name.replace(/\$/g, "\\$")

/**
 * The bundle with each call to oj's show tagged, and its map moved to match.
 * `mapText` is esbuild's own map, with its `src:` sources; untouched when
 * the bundle never reads oj.
 */
export function tagShowSites(code, mapText) {
    // oj's module: `var require_oj=__commonJS({"ext:oj"(exports,module){...`
    const module = /([\w$]+)=[\w$]+\(\{"ext:oj"\(/.exec(code)
    if (module === null) return { code, map: mapText }
    // Every variable that holds it: `import_oj=__toESM(require_oj())`, one per importing file.
    const holders = [...code.matchAll(new RegExp(`([\\w$]+)=[\\w$]+\\(${escape(module[1])}\\(\\)(?:,1)?\\)`, "g"))].map((m) => m[1])
    if (holders.length === 0) return { code, map: mapText }
    const names = holders.map(escape).join("|")
    // A call, plain or optional: `(0,import_oj.show)(` from a named import,
    // `oj.show(` from a namespace one. A read that is not called is left.
    const call = new RegExp(`(?<![\\w$.])(?:\\(0,(?:${names})\\.show\\)|(?:${names})\\.show)(?:\\?\\.)?\\(`, "g")

    const map = JSON.parse(mapText)
    const lines = decode(map.mappings)
    const starts = [0]
    for (let i = code.indexOf("\n"); i >= 0; i = code.indexOf("\n", i + 1)) starts.push(i + 1)
    const lineOf = (at) => {
        let lo = 0, hi = starts.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (starts[mid] <= at) lo = mid
            else hi = mid - 1
        }
        return lo
    }

    /** Insertions, in the order they appear: [offset, text]. */
    const inserts = []
    for (const m of code.matchAll(call)) {
        const open = m.index + m[0].length - 1
        const line = lineOf(open)
        const column = open - starts[line]
        // The segment the call's callee maps from: the line `show` was written on.
        let origin = null
        for (const segment of lines[line] ?? []) {
            if (segment[0] > column) break
            if (segment.length >= 4) origin = segment
        }
        if (origin === null) continue
        const source = map.sources[origin[1]]
        // Only the cart's files: the tree's ("src:/lib/rules.ts", a used
        // cart's under its key folder) and the entry, which esbuild reads as
        // stdin and names bare. Any other namespace is something the build made.
        if (typeof source !== "string") continue
        const file = source.startsWith("src:") ? source.slice(4).replace(/^\/+/, "") : /^[a-z][a-z-]*:/.test(source) ? null : source
        if (file === null) continue
        const site = `${file}:${origin[2] + 1}`
        inserts.push([m.index + m[0].lastIndexOf("show") + 4, ".$"])
        inserts.push([open + 1, JSON.stringify(site) + ","])
    }
    if (inserts.length === 0) return { code, map: mapText }

    let out = ""
    let from = 0
    for (const [at, text] of inserts) {
        out += code.slice(from, at) + text
        from = at
    }
    out += code.slice(from)

    // Every segment moves right by the insertions at or before its column on
    // its line, all measured in the columns esbuild wrote.
    const byLine = new Map()
    for (const [at, text] of inserts) {
        const line = lineOf(at)
        if (!byLine.has(line)) byLine.set(line, [])
        byLine.get(line).push([at - starts[line], text.length])
    }
    for (const [line, here] of byLine) {
        for (const segment of lines[line] ?? []) {
            let shift = 0
            for (const [column, length] of here) if (column <= segment[0]) shift += length
            segment[0] += shift
        }
    }
    map.mappings = encode(lines)
    return { code: out, map: JSON.stringify(map) }
}
