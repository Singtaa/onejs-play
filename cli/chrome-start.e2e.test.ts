import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { findChrome, launch } from "./chrome.mjs"

/**
 * A start that reads DevToolsActivePort before Chrome has finished writing it
 * (onejs-play #9). Chrome creates the file and then writes it, with no rename
 * between; under a sweep's load a start read it empty, took the port to be 0,
 * and asked that port for the whole of STARTUP_MS before failing with "offered
 * no page", on whichever cart it happened to.
 *
 * Load only makes the window wide enough to land in, so this makes the read
 * land there every time: a wrapper named as OJ_CHROME leaves the file as an
 * early read finds it, then starts the real Chrome, which writes it whole a
 * moment later. Before the fix each case failed at 90 s with the sweep's own
 * line; a start waits for the whole file and is up in a second or two.
 *
 * Needs Chrome, as `ojplay run` does. The wrapper is a shell script, so not
 * on Windows.
 */

const PLANTED = ["", "5"]

describe.skipIf(process.platform === "win32")("a start that reads the port file early", () => {
    for (const planted of PLANTED) {
        it(`starts well inside the deadline when the file first reads ${JSON.stringify(planted)}`, async () => {
            const real = findChrome()
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-early-port-"))
            const wrapper = path.join(dir, "chrome")
            fs.writeFileSync(wrapper, [
                "#!/bin/sh",
                `for a in "$@"; do case "$a" in --user-data-dir=*) profile="\${a#--user-data-dir=}";; esac; done`,
                `printf '%s' '${planted}' > "$profile/DevToolsActivePort"`,
                `exec '${real.replaceAll("'", "'\\''")}' "$@"`,
                "",
            ].join("\n"), { mode: 0o755 })
            const before = process.env.OJ_CHROME
            process.env.OJ_CHROME = wrapper
            const began = Date.now()
            try {
                const browser = await launch({ profilePrefix: "oj-chrome-early-port-" })
                browser.close()
                expect(Date.now() - began).toBeLessThan(30_000)
            } finally {
                if (before === undefined) delete process.env.OJ_CHROME
                else process.env.OJ_CHROME = before
                fs.rmSync(dir, { recursive: true, force: true })
            }
        }, 120_000)
    }
})
