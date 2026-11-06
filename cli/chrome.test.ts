import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Browser, CALL_MS, CAPTURE_MS } from "./chrome.mjs"

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
})
