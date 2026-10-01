import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { BIN, PACKAGE } from "../build/command.mjs"

/**
 * What this package says to people, held to the site's words.
 *
 * The site's own gate (PlaySite src/vocabulary.test.ts) sweeps the site and
 * not this package, so the CLI's help and output, the README and the starter
 * a new cart is made from could keep the old word after the site moved on.
 * "Sketch" became "cart" on 30 Sep 2026 (PlaySite docs/carts.md).
 *
 * And one command spelling, everywhere: `ojp <command>` for a person, who
 * installs it once (`npm install -g ojp`), and `npx ojp <command>` where an
 * agent reads, since it needs no install (Sai and Tachi, 1 Oct 2026). Never
 * `npx oj`: before `npm install` that is not this package but an unrelated
 * npm package called "oj" (Mac 003's sample port, 30 Sep; a Koma bot ran
 * `npx -y oj --help` on 1 Oct and fetched it). And never the former name:
 * `npx onejs-play` installs onejs-play 0.8.9, frozen for the OneJS projects
 * that pin it, without any of what came after.
 */

const ROOT = path.join(import.meta.dirname, "..")
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")

/** What a person or an agent reads: the CLI's sources, the README, the starter, every example's oj.json and playtest. */
const FILES = [
    ...fs.readdirSync(path.join(ROOT, "cli")).filter((f) => f.endsWith(".mjs")).map((f) => `cli/${f}`),
    "README.md",
    ...fs.readdirSync(path.join(ROOT, "examples/starter")).map((f) => `examples/starter/${f}`),
    ...fs.readdirSync(path.join(ROOT, "examples"))
        .filter((d) => fs.existsSync(path.join(ROOT, "examples", d, "oj.json")))
        .map((d) => `examples/${d}/oj.json`),
    ...fs.readdirSync(path.join(ROOT, "examples"))
        .filter((d) => fs.existsSync(path.join(ROOT, "examples", d, "playtest.mjs")))
        .map((d) => `examples/${d}/playtest.mjs`),
]

const OLD_WORD = /\b[Ss]ketch(?:es)?\b/
/** Any command spelled through the bare name. */
const BARE = /\bnpx (?:-y )?oj\b/
/**
 * The command run through npx by its bin's name, when the package is named
 * otherwise (a scoped name): npx would fetch whatever is published under the
 * bare name, which is not this package.
 */
const BIN_THROUGH_NPX = PACKAGE === BIN ? null : new RegExp(`\\bnpx (?:-y )?${BIN}\\b`)
/** Any command or install spelled through the former name. */
const FORMER = /\bnpx (?:-y )?onejs-play\b|\bnpm (?:install|i)(?: -[gD])? onejs-play\b/

const offenders = (pattern: RegExp) => FILES.flatMap((rel) =>
    read(rel).split("\n").flatMap((line, i) => pattern.test(line) ? [`${rel}:${i + 1}: ${line.trim()}`] : []))

describe("what ojp says", () => {
    it("says cart, not sketch", () => {
        expect(offenders(OLD_WORD)).toEqual([])
    })

    it("writes every command as ojp or npx ojp", () => {
        expect(offenders(BARE)).toEqual([])
        expect(offenders(FORMER)).toEqual([])
        if (BIN_THROUGH_NPX !== null) expect(offenders(BIN_THROUGH_NPX)).toEqual([])
    })

    it("would catch either", () => {
        expect(OLD_WORD.test("every sketch on the account")).toBe(true)
        expect(OLD_WORD.test("a sketchbook")).toBe(false)
        expect(BARE.test("then: npx oj init")).toBe(true)
        expect(BARE.test("npm install, then npx oj run")).toBe(true)
        expect(BARE.test("npx -y oj --help")).toBe(true)
        expect(BARE.test("npx ojp run")).toBe(false)
        expect(FORMER.test("then npx onejs-play run")).toBe(true)
        expect(FORMER.test("npm install -g onejs-play")).toBe(true)
        expect(FORMER.test("npx ojp run")).toBe(false)
        expect(FORMER.test("onejs-play stays frozen at 0.8.9")).toBe(false)
    })
})
