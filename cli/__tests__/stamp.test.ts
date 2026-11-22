import { describe, expect, it } from "vitest"
import { stamper } from "./stamp"

describe("a stamped run's output", () => {
    it("puts the seconds since the run began before each line", () => {
        let t = 1000
        const stamp = stamper(1000, () => t)
        t = 1500
        const first = stamp("[ojplay] runtime 1.10.1\n[ojplay] serving\n")
        t = 175_200
        expect(first + stamp("[ojplay] passed\n")).toBe("[0.5 s] [ojplay] runtime 1.10.1\n[0.5 s] [ojplay] serving\n[174.2 s] [ojplay] passed\n")
    })

    it("stamps a line split across chunks once, at the time it began", () => {
        let t = 0
        const stamp = stamper(0, () => t)
        t = 2000
        const head = stamp("[ojplay] cart sta")
        t = 9000
        expect(head + stamp("rted in 236 ms\nOCC")).toBe("[2.0 s] [ojplay] cart started in 236 ms\n[9.0 s] OCC")
    })

    it("leaves what the sweep reads out of a line still readable", () => {
        const out = stamper(0, () => 600)("[ojplay] chrome headless 480x270 (chrome.exe), port after 0.5 s, page after 0.5 s\n")
        expect(/page after ([\d.]+) s/.exec(out)?.[1]).toBe("0.5")
        expect(/port after ([\d.]+) s/.exec(out)?.[1]).toBe("0.5")
    })
})
