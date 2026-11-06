import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Browser, CALL_MS, CAPTURE_MS, chromeArgs, chromeLog } from "./chrome.mjs"

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
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oj-shot-")), "shot.png")
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

    it("still gives up on a screenshot that never comes, and on any other call at CALL_MS", async () => {
        vi.useFakeTimers()
        const { b } = browser()
        const shot = expect(b.screenshot(path.join(os.tmpdir(), "never.png"))).rejects.toThrow(`Page.captureScreenshot did not answer in ${CAPTURE_MS / 1000}s`)
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
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "oj-log-"))
        const log = chromeLog("/tmp/oj-chrome-abc", folder)!
        expect(log.file).toBe(path.join(folder, "oj-chrome-abc.log"))
        expect(log.netlog).toBe(path.join(folder, "oj-chrome-abc.netlog.json"))
        const args = chromeArgs({ headless: true, window: [960, 540], profile: "/tmp/p", log })
        expect(args).toEqual(expect.arrayContaining(["--enable-logging", `--log-file=${log.file}`, "--v=1", `--log-net-log=${log.netlog}`]))
        expect(args.at(-1)).toBe("about:blank")
        expect(chromeArgs({ headless: true, window: [960, 540], profile: "/tmp/p" }).some((a) => a.startsWith("--log"))).toBe(false)
    })

    it("is kept by keep() for any run that failed, and keep() says null with no log asked for", () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "oj-log-"))
        const log = chromeLog(path.join(folder, "oj-chrome-y"), folder)!
        fs.writeFileSync(log.file, "log")
        const b = new Browser(null, path.join(folder, "gone"), null, () => "", log)
        expect(b.keep()).toContain(log.file)
        b.close()
        expect(fs.existsSync(log.file)).toBe(true)
        expect(new Browser(null, null, null).keep()).toBeNull()
    })

    async function closed(describeFirst: boolean) {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "oj-log-"))
        const log = chromeLog(path.join(folder, "oj-chrome-x"), folder)!
        fs.writeFileSync(log.file, "log")
        fs.writeFileSync(log.netlog, "{")
        // No child: there is no Chrome to stop, and kill() finds no pid to signal.
        const b = new Browser(null, path.join(folder, "gone"), null, () => "", log)
        b.ws = { send: () => {}, close: () => {} } as any
        b.send = () => Promise.reject(new Error("no answer")) as any
        let said = ""
        if (describeFirst) said = await b.describe()
        b.close()
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
