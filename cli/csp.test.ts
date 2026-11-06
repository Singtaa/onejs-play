import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gameCsp } from "../host/csp.mjs"
import { serve } from "./local.mjs"

const SITE = "https://play.onejs.com"
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `))!.split(" ").slice(1)

describe("the game origin's policy", () => {
    it("lets a game fetch the blob addresses it made, and nothing as data: or from elsewhere", () => {
        const connect = directive(gameCsp(SITE), "connect-src")
        expect(connect).toContain("blob:")
        expect(connect).not.toContain("data:")
        expect(connect).not.toContain("*")
    })

    it("adds the site's store and beacon where the site names them", () => {
        const csp = gameCsp(SITE, { store: "https://store.example", beacon: { script: "https://b.example", report: "https://r.example" } })
        expect(directive(csp, "connect-src")).toEqual(expect.arrayContaining(["https://r.example", "https://store.example"]))
        expect(directive(csp, "script-src")).toContain("https://b.example")
        expect(directive(csp, "frame-ancestors")).toEqual([SITE])
        expect(directive(gameCsp(SITE, { anywhere: true }), "frame-ancestors")).toEqual(["*"])
    })
})

describe("ojplay's local page", () => {
    // The page `ojplay run` and `ojplay test` open: refused what the site refuses
    // (cli/fixtures/csp/csp.playtest.mjs shows a browser keeping to it).
    it("carries the game origin's policy for the site it talks to", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-csp-"))
        const server = await serve({ runtime: root, root, manifest: { name: "t" }, bundle: () => "", site: "https://site.example" })
        try {
            const page = await fetch(server.url)
            expect(page.headers.get("content-security-policy")).toBe(gameCsp("https://site.example"))
        } finally {
            server.close()
        }
    })
})
