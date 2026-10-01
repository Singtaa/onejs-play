import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * What this package says to people, held to the site's words.
 *
 * The site's own gate (PlaySite src/vocabulary.test.ts) sweeps the site and
 * not this package, so the CLI's help and output, the README and the starter
 * a new cart is made from could keep the old word after the site moved on.
 * "Sketch" became "cart" on 30 Sep 2026 (PlaySite docs/carts.md).
 *
 * And one command spelling, everywhere: `npx onejs-play <command>`. Before
 * `npm install`, `npx oj` is not this package: it resolves to an unrelated
 * npm package called "oj" (Mac 003's sample port, 30 Sep), and a Koma bot ran
 * `npx -y oj --help` on 1 Oct, fetching it. `npx onejs-play` works in both
 * places, since npx runs the local install when there is one, so it is the
 * only spelling (Tachi, 1 Oct).
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

const offenders = (pattern: RegExp) => FILES.flatMap((rel) =>
    read(rel).split("\n").flatMap((line, i) => pattern.test(line) ? [`${rel}:${i + 1}: ${line.trim()}`] : []))

describe("what onejs-play says", () => {
    it("says cart, not sketch", () => {
        expect(offenders(OLD_WORD)).toEqual([])
    })

    it("writes every command as npx onejs-play", () => {
        expect(offenders(BARE)).toEqual([])
    })

    it("would catch either", () => {
        expect(OLD_WORD.test("every sketch on the account")).toBe(true)
        expect(OLD_WORD.test("a sketchbook")).toBe(false)
        expect(BARE.test("then: npx oj init")).toBe(true)
        expect(BARE.test("npm install, then npx oj run")).toBe(true)
        expect(BARE.test("npx -y oj --help")).toBe(true)
        expect(BARE.test("npx onejs-play run")).toBe(false)
    })
})
