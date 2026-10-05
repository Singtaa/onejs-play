import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { describePush, describeStatus, uncommitted } from "./site.mjs"

/**
 * `ojplay status` printed the site's raw JSON. It now says it in sentences, and
 * `--json` keeps the object for a script.
 */
const base = { url: "https://play.onejs.com/@me/tuner", public: true }

describe("ojplay status, read aloud", () => {
    it("says when the tip of main is what runs", () => {
        expect(describeStatus({ ...base, head: "3f2a91c0aa", live: "3f2a91c0aa", buildError: null })).toEqual([
            "https://play.onejs.com/@me/tuner (public)",
            "live: 3f2a91c, the tip of main",
        ])
    })

    it("says why the tip is not what runs", () => {
        expect(describeStatus({ ...base, public: false, head: "4b1c0de111", live: "3f2a91c0aa", buildError: "index.tsx:3:9: Expected \";\"" })).toEqual([
            "https://play.onejs.com/@me/tuner (private)",
            "live: 3f2a91c",
            "tip of main: 4b1c0de did not build:",
            "  index.tsx:3:9: Expected \";\"",
        ])
    })

    it("says when a newer tip is still building, and when nothing has built yet", () => {
        expect(describeStatus({ ...base, head: "4b1c0de111", live: "3f2a91c0aa", buildError: null })[2]).toBe("tip of main: 4b1c0de is still building")
        expect(describeStatus({ ...base, head: "4b1c0de111", live: null, buildError: null })[1]).toBe("live: nothing yet")
    })
})

/**
 * `ojplay push` with edits nobody had committed ran `git push`, which said
 * "Everything up-to-date", and then printed the old commit as live: it read
 * as a push that worked (Ghost Hunt test, 5 Oct 2026).
 */
describe("ojplay push, read aloud", () => {
    const after = { ...base, head: "4b1c0de111", live: "4b1c0de111", buildError: null }

    it("fails and names the files when nothing was pushed because nothing was committed", () => {
        const said = describePush("4b1c0de111", after, ["index.tsx", "ghost.glb"])
        expect(said.code).toBe(1)
        expect(said.lines).toEqual([
            "nothing was pushed",
            "not committed, so not pushed: index.tsx, ghost.glb",
            "commit them, then push again: git add -A && git commit -m \"<what changed>\"",
        ])
    })

    it("says there was nothing new when the clone is clean and already on the site", () => {
        expect(describePush("4b1c0de111", after, [])).toEqual({ lines: ["nothing new to push; live: 4b1c0de at https://play.onejs.com/@me/tuner"], code: 0 })
    })

    it("passes a push that went live, and still names what it left behind", () => {
        const said = describePush("3f2a91c0aa", after, ["cover.png"])
        expect(said.code).toBe(0)
        expect(said.lines[0]).toBe("live: 4b1c0de at https://play.onejs.com/@me/tuner")
        expect(said.lines[1]).toBe("not committed, so not pushed: cover.png")
    })

    it("fails a pushed tip that did not build, with the reason", () => {
        const said = describePush("3f2a91c0aa", { ...after, live: "3f2a91c0aa", buildError: "index.tsx:3:9: Expected \";\"" }, [])
        expect(said).toEqual({ lines: ["the tip did not build; still running 3f2a91c", "index.tsx:3:9: Expected \";\""], code: 1 })
    })

    it("names at most eight files", () => {
        const left = Array.from({ length: 11 }, (_, i) => `f${i}.png`)
        expect(describePush("4b1c0de111", after, left).lines[1]).toBe("not committed, so not pushed: f0.png, f1.png, f2.png, f3.png, f4.png, f5.png, f6.png, f7.png, and 3 more")
    })
})

describe("what a push leaves behind", () => {
    it("lists changed and new files, and never ignored ones", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "oj-uncommitted-"))
        try {
            const git = (...args: string[]) => expect(spawnSync("git", ["-C", root, ...args]).status).toBe(0)
            git("init", "-q")
            fs.writeFileSync(path.join(root, "index.tsx"), "a")
            fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n")
            git("add", "-A")
            git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "start")
            expect(uncommitted(root)).toEqual([])
            fs.writeFileSync(path.join(root, "index.tsx"), "b")
            fs.writeFileSync(path.join(root, "ghost.glb"), "g")
            fs.mkdirSync(path.join(root, "node_modules"))
            fs.writeFileSync(path.join(root, "node_modules", "x.js"), "x")
            expect(uncommitted(root).sort()).toEqual(["ghost.glb", "index.tsx"])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
