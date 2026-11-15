import { describe, it, expect } from "vitest"
import check, { gpuFootprintMiB, judgeRound } from "./tex-forget.playtest.mjs"

/** A cart whose tex has `forget` or not, and of whose forgotten looks Unity still holds `still`. */
function fake({ has = true, held = 40, forgot = 40, still = 0 } = {}) {
    return {
        browser: { child: { pid: 1 } },
        wait: async () => {},
        until: async (f: () => Promise<boolean>) => { if (!(await f())) throw new Error("never") },
        eval: async (code: string) => {
            if (code === "typeof globalThis.texForget") return "object"
            if (code.includes(".has")) return String(has)
            if (code.includes(".make(")) return JSON.stringify({ looks: 40, held, ms: 1 })
            if (code.includes(".forget()")) return JSON.stringify({ forgot: has ? forgot : 0, of: 40 })
            if (code.includes(".stillHeld()")) return String(still)
            throw new Error(`unexpected eval: ${code.slice(0, 60)}`)
        },
    }
}

describe("the tex.forget playtest", () => {
    it("passes looks that are each forgotten and that Unity no longer holds", async () => {
        await expect(check(fake() as any)).resolves.toBeUndefined()
    })

    it("fails a runtime without tex.forget, a forget that took fewer, and looks still held after", async () => {
        await expect(check(fake({ has: false }) as any)).rejects.toThrow("this runtime's tex has no forget")
        await expect(check(fake({ forgot: 39 }) as any)).rejects.toThrow("tex.forget took 39 of 40 looks it made")
        await expect(check(fake({ still: 40 }) as any)).rejects.toThrow("Unity still holds 40 of the 40 looks forgotten")
        await expect(check(fake({ held: 0 }) as any)).rejects.toThrow("0 of 40 looks held their pixels once baked")
    })

    it("judges a round's footprint: memory that stays is red, and so is a round that measured nothing", () => {
        expect(judgeRound(1, { before: 300, made: 480, after: 320 }, 300).error).toBeNull()
        // What runtime 1.10.1 measured with the looks only dropped.
        expect(judgeRound(1, { before: 306, made: 647, after: 640 }, 300).error).toBe("round 1: forgetting 300 looks gave back 7 of the 341 MiB they added: 334 MiB stayed")
        expect(judgeRound(1, { before: 300, made: 310, after: 300 }, 300).error).toMatch(/under a quarter MiB a look, so the footprint measured nothing/)
    })

    it("reads the GPU process under the run's Chrome, and says when there is none", () => {
        const run = (cmd: string) => cmd === "ps"
            ? "  7  1 /Chrome Helper --type=renderer\n  8  1 /Chrome Helper (GPU) --type=gpu-process --flag\n  9  2 /Chrome Helper --type=gpu-process\n"
            : "Footprint: 1.5 GB\n"
        expect(gpuFootprintMiB(1, run as any)).toBe(1536)
        expect(() => gpuFootprintMiB(5, run as any)).toThrow("no GPU process under Chrome 5")
    })
})
