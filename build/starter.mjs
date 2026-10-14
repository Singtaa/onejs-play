/**
 * The starter a cart begins from, one source for both places that make one:
 * the site's New (PlaySite's gen-starter.mjs embeds the files, its repo.ts
 * names them) and `ojplay new`, which writes them on a machine with no
 * account. The files are examples/starter; this module says which of them a
 * cart carries and how a name goes into oj.json. Nothing here reads a disk,
 * so the site's Worker can import it.
 */

/**
 * Whether a file in the starter's folder belongs to a new cart. html is for a
 * cover.html, md for an AGENTS.md, mjs for a playtest.mjs, .gitignore itself:
 * what a clone should carry. Generated .module.uss.d.ts siblings and tests do not.
 */
export function isStarterFile(name) {
    return (/\.(tsx?|uss|json|html|md|mjs)$/.test(name) || name === ".gitignore")
        && !name.endsWith(".module.uss.d.ts") && !/\.test\./.test(name)
}

/**
 * A starter file's text as a cart gets it: LF line endings, since git checks
 * the sources out as CRLF on Windows and the text is embedded, not only
 * parsed (41 escaped carriage returns once reached somebody's first sketch).
 */
export function starterText(text) {
    return text.replace(/\r\n/g, "\n")
}

/**
 * The starter's files with `name` as oj.json's name. JSON.stringify gives the
 * escaping, and replacing only the value keeps the file as it was written.
 */
export function starterWithName(files, name) {
    return files.map((f) => {
        if (f.name.toLowerCase() !== "oj.json") return f
        const quoted = JSON.stringify(name)
        return { ...f, text: f.text.replace(/"name":\s*"(?:[^"\\]|\\.)*"/, `"name": ${quoted}`) }
    })
}
