import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { handOff, localCopy, newer, unknownToCopy, updateNotice } from "./global.mjs"
import { BIN, INSTALL, PACKAGE } from "../build/command.mjs"

/**
 * The global ojplay (Sai, 1 Oct 2026): the hand-off to a cart's own copy, and
 * the update line, at most once a day and never when npm cannot be reached.
 */

const OWN = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version
const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
const scratch = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-global-"))
    made.push(dir)
    return dir
}

describe("the hand-off", () => {
    it("finds the cart's own ojplay from any folder inside it, and not this one", () => {
        const cart = scratch()
        const own = path.join(cart, "node_modules", ...PACKAGE.split("/"), "cli", "oj.mjs")
        fs.mkdirSync(path.dirname(own), { recursive: true })
        fs.writeFileSync(own, "")
        fs.mkdirSync(path.join(cart, "hud", "bits"), { recursive: true })
        expect(localCopy(path.join(cart, "hud", "bits"))).toBe(fs.realpathSync(own))
        expect(localCopy(scratch())).toBeNull()
        // This package, run from its own folder, is not handed to itself.
        expect(localCopy(path.resolve(import.meta.dirname, ".."))).toBeNull()
    })
})

/**
 * A cart's own copy that predates a flag: learn Mac's `push --unlisted` handed
 * to a 0.14.0 (6 Nov 2026). The flag is judged here, against the copy's own
 * reader, before the copy runs, so a push meant Unlisted never runs as one that
 * is not.
 */
describe("a flag the cart's copy does not know", () => {
    /** A cart whose copy reads only `knows`, and leaves a mark when it runs. */
    function cartWith(version: string, knows: string[] | null) {
        const cart = scratch()
        const own = path.join(cart, "node_modules", ...PACKAGE.split("/"))
        fs.mkdirSync(path.join(own, "cli"), { recursive: true })
        fs.writeFileSync(path.join(own, "package.json"), JSON.stringify({ name: PACKAGE, version }))
        fs.writeFileSync(path.join(own, "cli", "oj.mjs"), `import fs from "node:fs"\nfs.writeFileSync(${JSON.stringify(path.join(cart, "ran"))}, process.argv.slice(2).join(" "))\n`)
        if (knows !== null) {
            fs.writeFileSync(path.join(own, "cli", "args.mjs"), `const KNOWS = ${JSON.stringify(knows)}
export function parse(argv) {
    const flags = {}
    for (const w of argv) if (w.startsWith("--")) { if (!KNOWS.includes(w.slice(2))) throw new Error("unknown flag " + w); flags[w.slice(2)] = true }
    return { flags }
}
`)
        }
        return { cart, ran: () => fs.existsSync(path.join(cart, "ran")) }
    }

    afterEach(() => { delete process.env.OJPLAY_HANDED_OFF; process.exitCode = undefined })

    it("is refused before the copy runs, naming both versions and the update, so push --unlisted never pushes", async () => {
        const { cart, ran } = cartWith("0.13.0", ["private", "json"])
        const said: string[] = []
        expect(await handOff(cart, ["push", "--unlisted"], { say: (l) => said.push(l) })).toBe(true)
        expect(ran()).toBe(false)
        expect(process.exitCode).toBe(1)
        expect(said).toHaveLength(1)
        expect(said[0]).toBe(`this cart's ${PACKAGE} is 0.13.0, which has no --unlisted (this ${BIN} is ${OWN}). Nothing ran: update it with npm install ${PACKAGE}@latest in the cart, or leave the flag out`)
    })

    it("hands off as before when the copy knows every flag given", async () => {
        const { cart, ran } = cartWith("0.14.0", ["private"])
        expect(await handOff(cart, ["push", "--private"], { say: () => {} })).toBe(true)
        expect(ran()).toBe(true)
        expect(process.exitCode).toBeUndefined()
    })

    it("refuses any flag to a copy that cannot say which it knows, and none without flags", async () => {
        const { cart } = cartWith("0.9.0", null)
        const local = localCopy(cart)!
        expect(await unknownToCopy(local, ["push", "--unlisted"])).toMatch(/is 0\.9\.0, which cannot say whether it knows --unlisted\. Nothing ran/)
        expect(await unknownToCopy(local, ["push"])).toBeNull()
    })
})

describe("the update line", () => {
    const DAY = 24 * 60 * 60 * 1000
    const T = Date.UTC(2026, 9, 1)

    it("compares versions part by part", () => {
        expect(newer("0.9.10", "0.9.2")).toBe(true)
        expect(newer("0.9.2", "0.9.2")).toBe(false)
        expect(newer("0.8.12", "0.9.0")).toBe(false)
        expect(newer("1.0.0-beta.1", "0.9.0")).toBe(false)
        expect(newer(undefined, "0.9.0")).toBe(false)
    })

    it("checks once a day, tells once a day, and only of a newer one", async () => {
        const file = path.join(scratch(), "update.json")
        const said: string[] = []
        let asked = 0
        const run = async (now: number, latest: string | null) => {
            const n = updateNotice("0.9.0", { now, file, print: (l) => said.push(l), fetchLatest: async () => { asked++; return latest } })
            await n.checking
            n.tell()
        }
        await run(T, "0.9.0")
        expect([asked, said]).toEqual([1, []])
        await run(T + DAY / 2, "0.9.1")
        expect([asked, said]).toEqual([1, []])
        await run(T + DAY, "0.9.1")
        expect([asked, said]).toEqual([2, [`[${BIN}] ${PACKAGE} 0.9.1 is out (this is 0.9.0): ${INSTALL}`]])
        await run(T + DAY + 1000, "0.9.1")
        expect(said).toHaveLength(1)
        await run(T + 2 * DAY + 1000, "0.9.1")
        expect(said).toHaveLength(2)
    })

    it("says nothing when npm cannot be reached, or home cannot be written", async () => {
        const said: string[] = []
        const offline = updateNotice("0.9.0", { now: T, file: path.join(scratch(), "update.json"), print: (l) => said.push(l), fetchLatest: async () => null })
        await offline.checking
        offline.tell()
        const throwing = updateNotice("0.9.0", { now: T, file: path.join(scratch(), "update.json"), print: (l) => said.push(l), fetchLatest: () => Promise.reject(new Error("ENOTFOUND")) })
        await throwing.checking
        throwing.tell()
        const readOnly = path.join(scratch(), "file")
        fs.writeFileSync(readOnly, "")
        const blocked = updateNotice("0.9.0", { now: T, file: path.join(readOnly, "update.json"), print: (l) => said.push(l), fetchLatest: async () => "0.9.1" })
        await blocked.checking
        blocked.tell()
        expect(said).toEqual([`[${BIN}] ${PACKAGE} 0.9.1 is out (this is 0.9.0): ${INSTALL}`])
    })
})
