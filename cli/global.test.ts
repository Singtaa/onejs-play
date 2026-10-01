import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { localCopy, newer, updateNotice } from "./global.mjs"

/**
 * The global ojp (Sai, 1 Oct 2026): the hand-off to a cart's own copy, and
 * the update line, at most once a day and never when npm cannot be reached.
 */

const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
const scratch = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojp-global-"))
    made.push(dir)
    return dir
}

describe("the hand-off", () => {
    it("finds the cart's own ojp from any folder inside it, and not this one", () => {
        const cart = scratch()
        const own = path.join(cart, "node_modules", "ojp", "cli", "oj.mjs")
        fs.mkdirSync(path.dirname(own), { recursive: true })
        fs.writeFileSync(own, "")
        fs.mkdirSync(path.join(cart, "hud", "bits"), { recursive: true })
        expect(localCopy(path.join(cart, "hud", "bits"))).toBe(fs.realpathSync(own))
        expect(localCopy(scratch())).toBeNull()
        // This package, run from its own folder, is not handed to itself.
        expect(localCopy(path.resolve(import.meta.dirname, ".."))).toBeNull()
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
        expect([asked, said]).toEqual([2, ["[ojp] ojp 0.9.1 is out (this is 0.9.0): npm install -g ojp"]])
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
        expect(said).toEqual(["[ojp] ojp 0.9.1 is out (this is 0.9.0): npm install -g ojp"])
    })
})
