import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import path from "node:path"
import { Browser, CALL_MS, CAPTURE_MS, activePort, chromeArgs, chromeLog, cpuCost, cpuUsed } from "./chrome.mjs"
import { makeTemp, tempRoot } from "./temp.mjs"

/** A Browser on a socket that keeps what was sent and answers only when told. */
function browser() {
    const sent: any[] = []
    const b = new Browser(null, null, null)
    b.ws = { send: (text: string) => sent.push(JSON.parse(text)) } as any
    const answer = (method: string, result: object) => b.receive({ id: sent.find((m) => m.method === method).id, result })
    return { b, sent, answer }
}

describe("the CLI's CDP calls", () => {
    afterEach(() => { vi.useRealTimers() })

    // windows-latest took 15 to 26 s to capture the font fixture's 3x phone
    // (6 Nov 2026), and the 30 s every call gets refused it there.
    it("waits for a screenshot past the time a call gets", async () => {
        vi.useFakeTimers()
        const { b, answer } = browser()
        const file = path.join(makeTemp("oj-shot-"), "shot.png")
        const shot = b.screenshot(file)
        const settled = vi.fn()
        shot.then(settled, settled)
        // As long as the slowest capture measured there, and longer than any other call is given.
        await vi.advanceTimersByTimeAsync(26000)
        expect(settled).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(19000)
        expect(settled).not.toHaveBeenCalled()
        answer("Page.captureScreenshot", { data: Buffer.from("png").toString("base64") })
        await expect(shot).resolves.toBe(file)
        expect(fs.readFileSync(file, "utf8")).toBe("png")
    })

    // A playtest asks for its pixels itself, as eight fixtures do, so the
    // capture's time is the call's own: the occlusion fixture's at 30 s
    // failed windows-latest on 22 Nov, and the failed.png after it answered.
    it("waits as long for a screenshot a playtest asks for itself", async () => {
        vi.useFakeTimers()
        const { b, answer } = browser()
        const shot = b.send("Page.captureScreenshot", { format: "png" })
        const settled = vi.fn()
        shot.then(settled, settled)
        await vi.advanceTimersByTimeAsync(CALL_MS + 15000)
        expect(settled).not.toHaveBeenCalled()
        answer("Page.captureScreenshot", { data: "cG5n" })
        await expect(shot).resolves.toEqual({ data: "cG5n" })
    })

    it("still gives up on a screenshot that never comes, and on any other call at CALL_MS", async () => {
        vi.useFakeTimers()
        const { b } = browser()
        const shot = expect(b.screenshot(path.join(tempRoot(), "never.png"))).rejects.toThrow(`Page.captureScreenshot did not answer in ${CAPTURE_MS / 1000}s`)
        const call = expect(b.send("Runtime.evaluate", { expression: "1" })).rejects.toThrow(`Runtime.evaluate did not answer in ${CALL_MS / 1000}s`)
        await vi.advanceTimersByTimeAsync(CALL_MS)
        await call
        await vi.advanceTimersByTimeAsync(CAPTURE_MS - CALL_MS)
        await shot
    })
    // Page.navigate went unanswered on windows-latest's November image (6 Nov
    // 2026): what the page says afterwards is the only clue to which half hung.
    it("describes a page that answers, and one that does not, after a navigate that hung", async () => {
        vi.useFakeTimers()
        const { b, sent } = browser()
        b.stderr = () => "first line\nlast line\n"
        const answered = b.describe()
        // Each question is asked once the one before it is answered.
        const asked = async (method: string, nth: number) => {
            for (let i = 0; i < 20 && sent.filter((m) => m.method === method).length <= nth; i++) await vi.advanceTimersByTimeAsync(0)
            return sent.filter((m) => m.method === method)[nth].id
        }
        b.receive({ id: await asked("Runtime.evaluate", 0), result: { result: { value: "about:blank complete" } } })
        b.receive({ id: await asked("Page.getNavigationHistory", 0), result: { entries: [{ url: "about:blank" }] } })
        b.receive({ id: await asked("Runtime.evaluate", 1), result: { result: { value: "fetch 0.0 s, connect 31.2 s, request 31.2 s, response 31.3 s" } } })
        await expect(answered).resolves.toBe("the page is at about:blank complete; its navigation timing: fetch 0.0 s, connect 31.2 s, request 31.2 s, response 31.3 s; history about:blank; chrome's stderr ends: first line | last line")

        sent.length = 0
        b.stderr = () => ""
        const silent = b.describe()
        await vi.advanceTimersByTimeAsync(10000)
        await expect(silent).resolves.toBe("the page did not answer either (Runtime.evaluate did not answer in 5s); its history did not answer either (Page.getNavigationHistory did not answer in 5s)")
    })
    it("waits for a renderer that answers late, and says when it did", async () => {
        vi.useFakeTimers()
        const { b, sent } = browser()
        const ready = b.waitForRenderer(Date.now() + 60000)
        // Two questions go unanswered, as a renderer waiting on the GPU process leaves them.
        await vi.advanceTimersByTimeAsync(10000)
        expect(sent.filter((m) => m.method === "Runtime.evaluate")).toHaveLength(3)
        const asked = Date.now()
        b.receive({ id: sent[sent.length - 1].id, result: { result: { type: "number", value: 1 } } })
        await expect(ready).resolves.toBe(asked)
    })

    it("gives up on a renderer that never answers, at the start's deadline", async () => {
        vi.useFakeTimers()
        const { b } = browser()
        const stuck = expect(b.waitForRenderer(Date.now() + 12000)).rejects.toThrow(/renderer is stuck/)
        await vi.advanceTimersByTimeAsync(12000)
        await stuck
    })
})

// A stall on a runner is read from Chrome's own logs (Tachi 7e22a48c): asked
// for with OJ_CHROME_LOG, kept for a browser whose page did not answer.
describe("Chrome's own log", () => {
    it("is off unless a folder is named, and names two files after the profile", () => {
        expect(chromeLog("/tmp/oj-chrome-abc", "")).toBeNull()
        const folder = makeTemp("oj-log-")
        const log = chromeLog("/tmp/oj-chrome-abc", folder)!
        expect(log.file).toBe(path.join(folder, "oj-chrome-abc.log"))
        expect(log.netlog).toBe(path.join(folder, "oj-chrome-abc.netlog.json"))
        const args = chromeArgs({ headless: true, window: [960, 540], profile: "/tmp/p", log })
        expect(args).toEqual(expect.arrayContaining(["--enable-logging", `--log-file=${log.file}`, "--v=1", `--log-net-log=${log.netlog}`]))
        expect(args.at(-1)).toBe("about:blank")
        expect(chromeArgs({ headless: true, window: [960, 540], profile: "/tmp/p" }).some((a) => a.startsWith("--log"))).toBe(false)
    })

    it("says which kind of process used the CPU between two samples, busiest first", () => {
        const before = [{ type: "browser", id: 1, cpuTime: 3 }, { type: "GPU", id: 2, cpuTime: 10 }, { type: "renderer", id: 3, cpuTime: 4 }, { type: "renderer", id: 4, cpuTime: 1 }]
        const after = [{ type: "browser", id: 1, cpuTime: 3.1 }, { type: "GPU", id: 2, cpuTime: 11.9 }, { type: "renderer", id: 3, cpuTime: 4 }, { type: "renderer", id: 4, cpuTime: 1.25 }, { type: "utility", id: 9, cpuTime: 0.5 }]
        expect(cpuUsed(before, after, 2.04)).toBe("(5 of them) over 2.0 s, CPU used: GPU 1.90 s (11.9 s since it started), utility 0.50 s (0.5 s since it started), renderer 0.25 s (5.3 s since it started), browser 0.10 s (3.1 s since it started)")
        // An idle GPU process reads as idle, which is the answer that tells a wait from slow drawing.
        expect(cpuUsed(before, before, 2)).toContain("GPU 0.00 s")
    })

    // Tachi 1cf6bc60: whether software drawing starves a 4-core runner is read
    // from what each run's GPU process used, said in cores, for every run.
    it("says what each kind of process used over the browser's life, in cores, busiest first", () => {
        const list = [{ type: "browser", id: 1, cpuTime: 2 }, { type: "GPU", id: 2, cpuTime: 24.5 }, { type: "renderer", id: 3, cpuTime: 4 }, { type: "renderer", id: 4, cpuTime: 1 }]
        expect(cpuCost(list, 10)).toBe("chrome's CPU over its 10.0 s: GPU 24.5 s (2.45 cores), renderer 5.0 s (0.50 cores), browser 2.0 s (0.20 cores)")
        // The frame rate beside it says whether the cost is drawing: software drawing's cost follows the frames it draws.
        expect(cpuCost(list, 10, "12.4 frames a second")).toBe("chrome's CPU over its 10.0 s at 12.4 frames a second: GPU 24.5 s (2.45 cores), renderer 5.0 s (0.50 cores), browser 2.0 s (0.20 cores)")
    })

    it("starts every browser, headless or headed, without a fresh profile's first-run chores", () => {
        for (const headless of [true, false]) {
            const args = chromeArgs({ headless, window: [960, 540], profile: "/tmp/p" })
            expect(args).toEqual(expect.arrayContaining(["--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-sync"]))
            expect(args.filter((a: string) => a.startsWith("--disable-features="))).toHaveLength(1)
        }
    })

    it("is kept by keep() for any run that failed, and keep() says null with no log asked for", async () => {
        const folder = makeTemp("oj-log-")
        const log = chromeLog(path.join(folder, "oj-chrome-y"), folder)!
        fs.writeFileSync(log.file, "log")
        const b = new Browser(null, path.join(folder, "gone"), null, () => "", log)
        expect(b.keep()).toContain(log.file)
        await b.close()
        expect(fs.existsSync(log.file)).toBe(true)
        expect(new Browser(null, null, null).keep()).toBeNull()
    })

    async function closed(describeFirst: boolean) {
        const folder = makeTemp("oj-log-")
        const log = chromeLog(path.join(folder, "oj-chrome-x"), folder)!
        fs.writeFileSync(log.file, "log")
        fs.writeFileSync(log.netlog, "{")
        // No child: there is no Chrome to stop, and kill() finds no pid to signal.
        const b = new Browser(null, path.join(folder, "gone"), null, () => "", log)
        b.ws = { send: () => {}, close: () => {} } as any
        b.send = () => Promise.reject(new Error("no answer")) as any
        let said = ""
        if (describeFirst) said = await b.describe()
        await b.close()
        return { log, said }
    }

    it("is deleted with a browser that worked", async () => {
        const { log } = await closed(false)
        expect(fs.existsSync(log.file)).toBe(false)
        expect(fs.existsSync(log.netlog)).toBe(false)
    })

    it("is kept, and named, for a browser whose page did not answer", async () => {
        const { log, said } = await closed(true)
        expect(fs.existsSync(log.file)).toBe(true)
        expect(fs.existsSync(log.netlog)).toBe(true)
        expect(said).toContain(log.file)
    })
})

// Headless, the page lives in an off-the-record context of its own (launch):
// a permission granted from it has to be for that context, not the profile's.
describe("a page in a context of its own", () => {
    function inContext(context: string | null) {
        const sent: any[] = []
        const b = new Browser(null, null, null, () => "", null, context)
        b.ws = { send: (text: string) => sent.push(JSON.parse(text)) } as any
        return { b, sent }
    }

    it("grants a permission for the page's context unless the caller named one", () => {
        const { b, sent } = inContext("ctx-1")
        b.call("Browser.grantPermissions", { permissions: ["clipboardReadWrite"] })
        b.call("Browser.setPermission", { permission: { name: "midi" }, setting: "granted", browserContextId: "other" })
        b.call("Runtime.evaluate", { expression: "1" })
        expect(sent[0].params).toEqual({ permissions: ["clipboardReadWrite"], browserContextId: "ctx-1" })
        expect(sent[1].params.browserContextId).toBe("other")
        expect(sent[2].params).toEqual({ expression: "1" })
    })

    it("leaves every call alone in the profile's own context", () => {
        const { b, sent } = inContext(null)
        b.call("Browser.grantPermissions", { permissions: ["clipboardReadWrite"] })
        expect(sent[0].params).toEqual({ permissions: ["clipboardReadWrite"] })
    })
})

// Chrome creates DevToolsActivePort and then writes it, with no rename between,
// so a start that reads it early sees part of it (onejs-play #9).
describe("the port Chrome writes", () => {
    it("is read only from a whole file: the port, then the browser's path", () => {
        expect(activePort("54321\n/devtools/browser/0b5d1c8e-1f6a-4d3e-9a2b-7c4e5f6a7b8c")).toBe(54321)
    })

    it("is no port yet while the file is empty or partway written", () => {
        // The empty file is the one that cost a sweep: Number("") is 0.
        for (const text of ["", "5", "543", "54321", "54321\n"]) expect(activePort(text), JSON.stringify(text)).toBeNull()
    })

    it("is no port for a first line that is not one", () => {
        for (const text of ["0\n/devtools/browser/x", "65536\n/devtools/browser/x", "54 321\n/devtools/browser/x", "port\n/devtools/browser/x"]) {
            expect(activePort(text), JSON.stringify(text)).toBeNull()
        }
    })
})

/** A local server that takes each request and does what `answer` says, or nothing. */
async function endpoint(answer: (res: http.ServerResponse) => void) {
    const server = http.createServer((_req, res) => answer(res))
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
    const port = (server.address() as net.AddressInfo).port
    return { port, close: () => { server.closeAllConnections(); server.close() } }
}

const freePort = () => new Promise<number>((ok) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => ok(port)) })
})

// Twice on windows-latest (13 and 22 Nov) a stalled page's busy() came back
// empty and the CLI printed nothing, so neither stall said where its time went.
describe("the report on Chrome's processes for a call that did not answer", () => {
    it("says the browser's endpoint did not answer, and in how long, when it never does", async () => {
        const e = await endpoint(() => { /* never answers */ })
        try {
            const b = new Browser(null, null, null)
            b.page = { webSocketDebuggerUrl: `ws://127.0.0.1:${e.port}/devtools/page/X` }
            await expect(b.busy(100, 300)).resolves.toBe(`chrome's processes could not be asked: the browser's http://127.0.0.1:${e.port}/json/version did not answer in 0.3 s`)
        } finally { e.close() }
    })

    it("says which step failed and the error's text when the browser's socket cannot be opened", async () => {
        const gone = await freePort()
        const e = await endpoint((res) => res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${gone}/devtools/browser/Y` })))
        try {
            const b = new Browser(null, null, null)
            b.page = { webSocketDebuggerUrl: `ws://127.0.0.1:${e.port}/devtools/page/X` }
            const said = await b.busy(100, 2000)
            expect(said).toMatch(new RegExp(`^chrome's processes could not be asked: the browser's socket ws://127\\.0\\.0\\.1:${gone}/devtools/browser/Y did not open \\(.+\\)$`))
        } finally { e.close() }
    })

    it("says the version answer was not one when the endpoint sends something else", async () => {
        const e = await endpoint((res) => res.end("<html>"))
        try {
            const b = new Browser(null, null, null)
            b.page = { webSocketDebuggerUrl: `ws://127.0.0.1:${e.port}/devtools/page/X` }
            await expect(b.busy(100, 2000)).resolves.toMatch(/^chrome's processes could not be asked: the browser's http:\/\/127\.0\.0\.1:\d+\/json\/version answered with no socket \(.+\)$/)
        } finally { e.close() }
    })
})
