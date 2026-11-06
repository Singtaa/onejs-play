import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer, type Server } from "node:http"
import { droppedConnection, git, status } from "./site.mjs"

/**
 * A connection the site dropped while ojplay was not looking.
 *
 * `git` runs under spawnSync, so a push holds the event loop for as long as it
 * takes, and fetch cannot see the site close an idle keep-alive connection in
 * the meantime. The next request reuses that connection and dies on it. On
 * Windows the request loses the race outright and reads ECONNRESET: the first
 * ojplay push failed that way in CI on 6 Nov 2026, the status after a push
 * that outlasted the test server's 5 s keep-alive (onejs-play run 42170217154).
 *
 * The stand-in resets the first request that arrives on a connection it has
 * already answered on, which is what such a connection does, on every system.
 */
let server: Server
let site = ""
let reset = 0

beforeEach(async () => {
    reset = 0
    server = createServer((req, res) => {
        const socket = req.socket as typeof req.socket & { answered?: boolean }
        if (socket.answered && reset === 0) {
            reset++
            socket.resetAndDestroy()
            return
        }
        socket.answered = true
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ head: "abc", carts: [] }))
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    site = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    vi.stubEnv("OJ_SITE", site)
})

afterEach(() => {
    server.close()
    vi.unstubAllEnvs()
})

describe("a site connection that went stale", () => {
    it("is asked again on a fresh connection, for a read", async () => {
        expect((await status("abcdefabcdef")).head).toBe("abc")
        // Let the first connection go back to the pool, as it does between a
        // push's requests.
        await new Promise((r) => setTimeout(r, 50))
        expect((await status("abcdefabcdef")).head).toBe("abc")
        expect(reset).toBe(1)
    })

    it("is not asked again when the site is simply not there", async () => {
        vi.stubEnv("OJ_SITE", "http://127.0.0.1:9")
        await expect(status("abcdefabcdef")).rejects.toThrow(/fetch failed/)
        expect(droppedConnection(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }))).toBe(false)
        expect(droppedConnection(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))).toBe(true)
    })
})

/**
 * The cause of the failure above, removed. git ran under spawnSync, which
 * holds the event loop for a whole push, so nothing could see a connection
 * close meanwhile. A timer that keeps ticking through a slow git says the
 * loop is running.
 */
describe("git", () => {
    it("leaves the event loop running while it works", async () => {
        let ticks = 0
        const timer = setInterval(() => ticks++, 50)
        try {
            expect(await git(["-c", "alias.wait=!sleep 1", "wait"])).toBe(0)
        } finally {
            clearInterval(timer)
        }
        expect(ticks).toBeGreaterThanOrEqual(5)
    })

    it("answers git's exit code", async () => {
        expect(await git(["-c", "alias.fail=!exit 3", "fail"])).toBe(3)
    })
})

