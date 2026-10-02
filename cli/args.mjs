/**
 * The command line, read strictly.
 *
 * Every flag is declared with what it takes. A switch never takes the next word,
 * so `test --headed play.mjs` keeps its script; the old reader handed every flag
 * the word after it, ran that test with no script and printed "passed". A flag
 * nobody declared is refused with the one probably meant, rather than dropped,
 * and a value that cannot mean what the flag means is refused with an example.
 */

/** "switch" takes nothing, "value" needs one, "optional" takes one when one follows. */
const FLAGS = {
    headed: "switch",
    watch: "switch",
    unity: "switch",
    json: "switch",
    help: "switch",
    version: "switch",
    "no-wait": "switch",
    site: "value",
    root: "value",
    window: "value",
    out: "value",
    for: "value",
    shot: "value",
    runtime: "value",
    sid: "value",
    name: "value",
    major: "optional",
    wait: "optional",
}

const SHORT = { h: "help", v: "version" }

/** What a value has to look like, and the sentence that says so. */
const CHECKS = {
    for: [(v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0, "--for is a number of seconds, like --for 10"],
    window: [(v) => /^\d+,\d+$/.test(v), "--window is width,height in pixels, like --window 960,540"],
    runtime: [(v) => /^\d+\.\d+\.\d+$/.test(v), "--runtime is a version, like --runtime 1.0.53"],
    sid: [(v) => /^[a-z0-9]{12}$/.test(v), "--sid is a cart's 12 character id, the one in its /c/<sid>.git clone URL"],
}

export function parse(argv) {
    const flags = {}
    const positional = []
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]
        let key
        let inline
        if (word.startsWith("--")) {
            const eq = word.indexOf("=")
            key = eq === -1 ? word.slice(2) : word.slice(2, eq)
            if (eq !== -1) inline = word.slice(eq + 1)
        } else if (/^-[A-Za-z]$/.test(word)) {
            key = SHORT[word[1]]
            if (key === undefined) throw new Error(`unknown flag ${word}${meant(word.slice(1), Object.keys(FLAGS))}`)
        } else {
            positional.push(word)
            continue
        }
        const kind = FLAGS[key]
        if (kind === undefined) throw new Error(`unknown flag --${key}${meant(key, Object.keys(FLAGS))}`)
        if (kind === "switch") {
            if (inline !== undefined) throw new Error(`--${key} takes no value`)
            flags[key] = true
            continue
        }
        const next = argv[i + 1]
        if (inline !== undefined) flags[key] = inline
        else if (next !== undefined && !next.startsWith("-")) { flags[key] = next; i++ }
        else if (kind === "optional") flags[key] = true
        else throw new Error(`--${key} needs a value${CHECKS[key] ? `: ${CHECKS[key][1].replace(/^--\S+ /, "")}` : ""}`)
        const check = CHECKS[key]
        if (check && typeof flags[key] === "string" && !check[0](flags[key])) throw new Error(check[1])
    }
    return { command: positional[0], args: positional.slice(1), flags }
}

/** " (did you mean --x?)" for the closest name within two edits, or nothing. */
export function meant(typed, names, prefix = "--") {
    let best = null
    let bestDistance = 3
    for (const name of names) {
        const d = distance(typed, name)
        if (d < bestDistance) { best = name; bestDistance = d }
    }
    return best === null ? "" : ` (did you mean ${prefix}${best}?)`
}

function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        let diagonal = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const above = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
            diagonal = above
        }
    }
    return row[b.length]
}
