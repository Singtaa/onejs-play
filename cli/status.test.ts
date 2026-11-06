import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { currentBranch, describeBranchPush, describePush, describeStatus, uncommitted } from "./site.mjs"
import { COMMAND } from "../build/command.mjs"

/**
 * `ojplay status` printed the site's raw JSON. It now says it in sentences, and
 * `--json` keeps the object for a script. The site answers a repo: main's
 * build, and its carts, each on a branch, version or commit with who can play
 * it (PlaySite docs/carts-and-repos.md).
 */
const address = "https://play.onejs.com/@me/tuner"
const first = (live: string | null, buildError: string | null = null) =>
    ({ cart: "aaaaaaaaaaaa", address, ref: { kind: "branch", name: "main" }, visibility: "public", live, buildError })
const repo = (head: string | null, built: string | null, buildError: string | null = null, carts = [first(built, buildError)]) =>
    ({ url: address, repoPublic: true, head, main: { built, buildError }, carts })

describe("ojplay status, read aloud", () => {
    it("says when the tip of main is what main built, and what each cart runs", () => {
        expect(describeStatus(repo("3f2a91c0aa", "3f2a91c0aa"))).toEqual([
            `${address} (public repo)`,
            "main: 3f2a91c, its tip",
            `cart ${address}: branch main, public, runs 3f2a91c`,
        ])
    })

    it("says why the tip is not what main built", () => {
        expect(describeStatus({ ...repo("4b1c0de111", "3f2a91c0aa", "index.tsx:3:9: Expected \";\""), repoPublic: false })).toEqual([
            `${address} (private repo)`,
            "main: 3f2a91c",
            "tip of main: 4b1c0de did not build:",
            "  index.tsx:3:9: Expected \";\"",
            `cart ${address}: branch main, public, runs 3f2a91c`,
        ])
    })

    it("says when a newer tip is still building, and when nothing has built yet", () => {
        expect(describeStatus(repo("4b1c0de111", "3f2a91c0aa"))[2]).toBe("tip of main: 4b1c0de is still building")
        expect(describeStatus(repo("4b1c0de111", null))[1]).toBe("main: nothing built yet")
        expect(describeStatus(repo("4b1c0de111", null)).at(-1)).toBe(`cart ${address}: branch main, public, runs nothing yet`)
    })

    it("says when nothing was ever pushed: a repo made empty for a first push from ojplay new", () => {
        expect(describeStatus(repo(null, null))[1]).toBe(`main: nothing pushed yet, ${COMMAND} push sends main`)
    })

    it("names a cart on a version or a commit, and a branch cart that did not build", () => {
        const carts = [
            first("3f2a91c0aa"),
            { cart: "bbbbbbbbbbbb", address: `${address}@1.2.0`, ref: { kind: "version", name: "1.2.0" }, visibility: "unlisted", live: "1111111aaa", buildError: null },
            { cart: "cccccccccccc", address: `${address}@2222222aaaaa`, ref: { kind: "commit", name: "2222222aaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, visibility: "private", live: "2222222aaa", buildError: null },
            { cart: "dddddddddddd", address: `${address}@night`, ref: { kind: "branch", name: "night" }, visibility: "unlisted", live: null, buildError: "index.tsx:1:1: nope\nmore" },
        ]
        expect(describeStatus(repo("3f2a91c0aa", "3f2a91c0aa", null, carts)).slice(2)).toEqual([
            `cart ${address}: branch main, public, runs 3f2a91c`,
            `cart ${address}@1.2.0: version 1.2.0, unlisted, runs 1111111`,
            `cart ${address}@2222222aaaaa: commit 2222222aaaaa, private, runs 2222222`,
            `cart ${address}@night: branch night, unlisted, runs nothing yet`,
            "  did not build: index.tsx:1:1: nope",
        ])
    })
})

/**
 * `ojplay push` with edits nobody had committed ran `git push`, which said
 * "Everything up-to-date", and then printed the old commit as live: it read
 * as a push that worked (Ghost Hunt test, 5 Oct 2026).
 */
describe("ojplay push, read aloud", () => {
    const after = repo("4b1c0de111", "4b1c0de111")

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
        expect(describePush("4b1c0de111", after, [])).toEqual({ lines: [`nothing new to push; live: 4b1c0de at ${address}`], code: 0 })
    })

    it("passes a push that went live, and still names what it left behind", () => {
        const said = describePush("3f2a91c0aa", after, ["cover.png"])
        expect(said.code).toBe(0)
        expect(said.lines[0]).toBe(`live: 4b1c0de at ${address}`)
        expect(said.lines[1]).toBe("not committed, so not pushed: cover.png")
    })

    it("names every cart that follows main, and says so when none does", () => {
        const two = repo("4b1c0de111", "4b1c0de111", null, [first("4b1c0de111"), { ...first("4b1c0de111"), cart: "bbbbbbbbbbbb", address: `${address}@main` }])
        expect(describePush("3f2a91c0aa", two, []).lines).toEqual([`live: 4b1c0de at ${address}`, `live: 4b1c0de at ${address}@main`])
        expect(describePush("3f2a91c0aa", repo("4b1c0de111", "4b1c0de111", null, []), [])).toEqual({ lines: ["main: 4b1c0de; no cart runs main"], code: 0 })
    })

    it("fails a pushed tip that did not build, with the reason", () => {
        const said = describePush("3f2a91c0aa", repo("4b1c0de111", "3f2a91c0aa", "index.tsx:3:9: Expected \";\""), [])
        expect(said).toEqual({ lines: ["the tip did not build; main still runs 3f2a91c", "index.tsx:3:9: Expected \";\""], code: 1 })
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

/**
 * A push of any branch but main builds it once and moves the carts that
 * follow it; a branch with none gets one, Unlisted, made by the push
 * (PlaySite docs/carts-and-repos.md). It reads the way main's does, and
 * fails the same way when the tip did not build.
 */
describe("ojplay push on a branch, read aloud", () => {
    const tip = "9e1d2b7aaa"
    const url = `${address}@night-level`
    const site = (cart: Record<string, unknown> | null) => repo("4b1c0de111", "4b1c0de111", null, [
        first("4b1c0de111"),
        ...(cart === null ? [] : [{ cart: "bbbbbbbbbbbb", address: url, ref: { kind: "branch", name: "night-level" }, visibility: "unlisted", ...cart }]),
    ])

    it("says where its cart is and that main did not move", () => {
        expect(describeBranchPush("night-level", null, tip, site({ live: tip, buildError: null }), [])).toEqual({
            lines: [`night-level: 9e1d2b7 at ${url}`, "main is unchanged, at 4b1c0de"], code: 0,
        })
    })

    it("fails when the tip did not build, and says what its cart still runs", () => {
        const said = describeBranchPush("night-level", "1111111aaa", tip, site({ live: "1111111aaa", buildError: "index.tsx:3:9: Expected \";\"" }), [])
        expect(said.code).toBe(1)
        expect(said.lines).toEqual(["the tip of night-level did not build; its cart still runs 1111111", "index.tsx:3:9: Expected \";\""])
        expect(describeBranchPush("night-level", null, tip, site({ live: null, buildError: "nope" }), []).lines[0]).toBe("the tip of night-level did not build; its cart runs nothing yet")
    })

    it("says when the branch got no cart", () => {
        expect(describeBranchPush("night-level", null, tip, site(null), [])).toEqual({
            lines: ["pushed night-level; it has no cart (the site said why above)"], code: 0,
        })
    })

    it("fails when nothing was committed, and is quiet when nothing is new", () => {
        expect(describeBranchPush("night-level", tip, tip, site({ live: tip, buildError: null }), ["index.tsx"]).code).toBe(1)
        expect(describeBranchPush("night-level", tip, tip, site({ live: tip, buildError: null }), [])).toEqual({
            lines: [`nothing new to push; night-level runs at ${url}`], code: 0,
        })
    })

    it("lists each branch cart in status", () => {
        expect(describeStatus(site({ live: tip, buildError: null })).at(-1)).toBe(`cart ${url}: branch night-level, unlisted, runs 9e1d2b7`)
    })

    it("knows which branch a clone is on", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-branch-"))
        spawnSync("git", ["init", "-q", "-b", "night-level", dir])
        expect(currentBranch(dir)).toBe("night-level")
        fs.rmSync(dir, { recursive: true, force: true })
    })
})
