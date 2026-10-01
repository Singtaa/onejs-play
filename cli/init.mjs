/**
 * The files a clone needs on a machine, and a game never ships.
 *
 * A game's repository is two files, index.tsx and oj.json: the site builds
 * it, so nothing about a build system belongs in it, and the editor's file
 * tree is the game and nothing else. What a terminal needs (a package.json
 * to install types and the oj command, a tsconfig, declarations for the
 * virtual modules) is local tooling, written here and excluded from git
 * through .git/info/exclude, so it is ignored like node_modules without a
 * .gitignore joining the two files. Run `npx onejs-play init` in a fresh clone; the package is
 * fetched for that one run and installed properly by the npm install after.
 *
 * Nothing here overwrites: a file the game already has is left alone and
 * reported, so init is safe to run twice and safe on a game that chose to
 * carry its own.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const SCAFFOLD = path.join(import.meta.dirname, "scaffold")

/** Writes what is missing under `root`. Returns one line per file, saying what happened. */
export function init(root) {
    const lines = []
    const put = (name, text) => {
        const file = path.join(root, name)
        if (fs.existsSync(file)) { lines.push(`${name}: already there, left alone`); return }
        fs.writeFileSync(file, text)
        lines.push(`${name}: written`)
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(SCAFFOLD, "package.json"), "utf8"))
    pkg.name = packageName(root)
    if (!fs.existsSync(path.join(root, "playtest.mjs"))) delete pkg.scripts.test
    put("package.json", JSON.stringify(pkg, null, 2) + "\n")
    put("tsconfig.json", fs.readFileSync(path.join(SCAFFOLD, "tsconfig.json"), "utf8"))
    put("env.d.ts", fs.readFileSync(path.join(SCAFFOLD, "env.d.ts"), "utf8"))

    lines.push(ignoreLocally(root, fs.readFileSync(path.join(SCAFFOLD, "gitignore"), "utf8")))
    return lines
}

/**
 * Adds `wanted`'s rules to what git ignores in `root` without committing them.
 *
 * The rules go in the repository's info/exclude, which git reads like a
 * .gitignore and never commits: the repository stays index.tsx and oj.json,
 * with no third file saying what this machine keeps beside them. A folder
 * that is not a repository yet gets a .gitignore instead, and either file is
 * appended rather than replaced. Returns the line init reports.
 */
export function ignoreLocally(root, wanted) {
    const excludes = excludeFile(root)
    const ignore = excludes ?? path.join(root, ".gitignore")
    const shown = path.relative(root, ignore).split(path.sep).join("/")
    // Lines are compared with their line endings stripped: a Windows checkout
    // or a Windows-authored .gitignore is CRLF, and comparing raw lines there
    // matched nothing and appended every entry twice.
    const linesOf = (text) => text.split(/\r?\n/).map((l) => l.trim())
    const have = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : ""
    const present = new Set(linesOf(have))
    const missing = linesOf(wanted).filter((l) => l !== "" && !l.startsWith("#") && !present.has(l))
    if (missing.length === 0) return `${shown}: already covers the tooling`
    if (excludes !== null) fs.mkdirSync(path.dirname(excludes), { recursive: true })
    fs.writeFileSync(ignore, (have === "" ? wanted : have.replace(/\n?$/, "\n") + missing.join("\n") + "\n"))
    return `${shown}: ${have === "" ? "written" : "added " + missing.join(", ")}`
}

/**
 * The info/exclude of the repository `root` is the top of, or null when it is
 * not the top of one.
 *
 * Asked of git rather than assumed to be .git/info/exclude, because a clone
 * added as a submodule has a .git FILE pointing into the parent's
 * .git/modules, and writing under it failed outright. And only for a
 * repository rooted here: a plain folder inside somebody's Unity project
 * repository would otherwise have its rules written into that project's
 * exclude, far from the folder they are about.
 */
function excludeFile(root) {
    const git = spawnSync("git", ["rev-parse", "--show-toplevel", "--git-path", "info/exclude"], { cwd: root, encoding: "utf8" })
    if (git.status === 0) {
        const [top, exclude] = git.stdout.split(/\r?\n/)
        if (top && exclude && samePath(top, root)) return path.resolve(root, exclude)
        return null
    }
    // No git on this machine, or a .git folder git does not recognise yet.
    const dotGit = path.join(root, ".git")
    return fs.existsSync(dotGit) && fs.statSync(dotGit).isDirectory() ? path.join(dotGit, "info", "exclude") : null
}

/**
 * Whether two paths name the same folder. The native realpath, because the JS
 * one keeps a Windows 8.3 name (`C:\Users\RUNNER~1`) where git prints the long
 * one, and the two compared unequal; and ignoring case on Windows, where paths
 * are not case-sensitive.
 */
function samePath(a, b) {
    const real = (p) => fs.realpathSync.native(p)
    return process.platform === "win32" ? real(a).toLowerCase() === real(b).toLowerCase() : real(a) === real(b)
}

/** The game's name from oj.json, as npm allows it, else the folder's. */
export function packageName(root) {
    let name = path.basename(root)
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, "oj.json"), "utf8"))
        if (typeof manifest.name === "string" && manifest.name.trim() !== "") name = manifest.name
    } catch { /* no manifest, or not JSON: the folder name will do */ }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return slug === "" ? "cart" : slug
}
