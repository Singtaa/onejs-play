import { afterEach, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { longPath, makeTemp, tempRoot } from "./temp.mjs"

const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
const temp = (prefix: string) => { const dir = makeTemp(prefix); made.push(dir); return dir }

/** The 8.3 form Windows gives `p`, as cmd's %~s prints it. */
const shortForm = (p: string) => execFileSync("cmd", ["/d", "/c", `for %I in ("${p}") do @echo %~sI`], { encoding: "utf8" }).trim()

describe("a temp path", () => {
    it.runIf(process.platform === "win32")("given in its 8.3 form, is the long one", () => {
        const long = temp("oj-temp-long-name-")
        const short = shortForm(long)
        expect(short, "this volume makes no 8.3 names, so no short path was fed").not.toBe(long)
        expect(short).toContain("~")
        expect(longPath(short)).toBe(long)
    })

    it.runIf(process.platform !== "win32")("given through a link, is the real one", () => {
        const real = temp("oj-temp-real-")
        const link = path.join(temp("oj-temp-link-"), "alias")
        fs.symlinkSync(real, link)
        expect(longPath(link)).toBe(real)
    })

    it("holds a script vitest can import", async () => {
        const file = path.join(temp("oj-temp-import-"), "t.mjs")
        fs.writeFileSync(file, "export const answer = 42\n")
        expect(tempRoot()).not.toContain("~")
        expect((await import(pathToFileURL(file).href)).answer).toBe(42)
    })

    it("comes from cli/temp.mjs and nowhere else", () => {
        const root = path.resolve(import.meta.dirname, "..")
        const asked: string[] = []
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (/\.(mjs|js|ts)$/.test(entry.name) && !/^temp\.(mjs|test\.ts)$/.test(entry.name)) {
                    fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
                        if (/\btmpdir\(/.test(line)) asked.push(`${path.relative(root, full)}:${i + 1}`)
                    })
                }
            }
        }
        for (const dir of ["cli", "scripts", "src", "build", "host", "examples"]) if (fs.existsSync(path.join(root, dir))) walk(path.join(root, dir))
        expect(asked, "make temp folders with makeTemp or tempRoot from cli/temp.mjs").toEqual([])
    })
})
