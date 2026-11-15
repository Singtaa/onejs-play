// tex.forget gives a look back. The cart bakes looks of 512 by 256 from bytes,
// as a game dressing characters makes one per outfit, hands each to
// tex.forget and drops it: every one must be one tex made and still held, and
// once its release has run Unity must hold none of them.
//
// With OJ_TEX_MEMORY=1 (macOS, `oj test --gpu`) it also reads the GPU
// process's memory footprint, where a texture's memory is and RSS is not:
// ROUNDS rounds of LOOKS looks must each add at least a quarter MiB a look
// (or nothing was measured), and forgetting them must give back at least
// 80% of what they added, round after round. On a runtime before tex.forget
// the looks are only dropped, which is what a cart could do before, and the
// footprint says what that kept.
import { execFileSync } from "node:child_process"

const memory = process.env.OJ_TEX_MEMORY === "1"
const LOOKS = Number(process.env.LOOKS) || (memory ? 300 : 40)
const ROUNDS = memory ? 2 : 1

/** The footprint of the run's Chrome GPU process, MiB, from macOS `footprint`. */
export function gpuFootprintMiB(chromePid, run = execFileSync) {
    const rows = run("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 1 << 26 })
        .split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    const gpu = rows.find((r) => Number(r[2]) === chromePid && r[3].includes("--type=gpu-process"))
    if (!gpu) throw new Error(`no GPU process under Chrome ${chromePid}, so there is no footprint to read`)
    const f = run("footprint", ["-p", gpu[1]], { encoding: "utf8" }).match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/)
    if (!f) throw new Error("footprint printed no Footprint line")
    return Number(f[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[f[2]]
}

/** The verdict on one round's footprints: what LOOKS looks added and what forgetting them gave back. */
export function judgeRound(round, { before, made, after }, looks = LOOKS) {
    const added = made - before, back = made - after
    const line = `round ${round}: ${before.toFixed(0)} MiB, ${made.toFixed(0)} with ${looks} looks (+${added.toFixed(0)}, ${(added * 1024 / looks).toFixed(0)} KiB a look), ${after.toFixed(0)} after forgetting them (${back.toFixed(0)} back, ${(after - before).toFixed(0)} stayed)`
    if (added < looks * 0.25) return { line, error: `round ${round}: ${looks} looks added ${added.toFixed(1)} MiB, under a quarter MiB a look, so the footprint measured nothing` }
    if (back < added * 0.8) return { line, error: `round ${round}: forgetting ${looks} looks gave back ${back.toFixed(0)} of the ${added.toFixed(0)} MiB they added: ${(after - before).toFixed(0)} MiB stayed` }
    return { line, error: null }
}

export default async function (cart) {
    await cart.until(async () => (await cart.eval("typeof globalThis.texForget")) === "object", { timeoutMs: 30000, what: "the cart" })
    const has = (await cart.eval("String(globalThis.texForget.has)")) === "true"
    if (!has && !memory) throw new Error("this runtime's tex has no forget")
    const footprint = () => gpuFootprintMiB(cart.browser.child.pid)
    if (memory) {
        if (process.platform !== "darwin") throw new Error("OJ_TEX_MEMORY reads macOS footprint; this is " + process.platform)
        console.log(has ? "tex.forget: each look forgotten" : "BEFORE: this runtime's tex has no forget, so each look is only dropped")
    }
    const errors = []
    for (let round = 1; round <= ROUNDS; round++) {
        await cart.wait(1500)
        const before = memory ? footprint() : 0
        const made = JSON.parse(await cart.eval(`globalThis.texForget.make(${LOOKS})`))
        if (made.held !== LOOKS) errors.push(`round ${round}: ${made.held} of ${LOOKS} looks held their pixels once baked`)
        await cart.wait(1500)
        const madeMiB = memory ? footprint() : 0
        const forgot = JSON.parse(await cart.eval("globalThis.texForget.forget()"))
        if (has && forgot.forgot !== LOOKS) errors.push(`round ${round}: tex.forget took ${forgot.forgot} of ${LOOKS} looks it made`)
        // Released once each bake is done, and destroyed at the end of that frame.
        await cart.wait(1500)
        const still = Number(await cart.eval("globalThis.texForget.stillHeld()"))
        if (has && still !== 0) errors.push(`round ${round}: Unity still holds ${still} of the ${LOOKS} looks forgotten`)
        console.log(`round ${round}: ${LOOKS} looks baked (${made.ms} ms each), ${forgot.forgot} forgotten, ${still} still held`)
        if (memory) {
            await cart.wait(1500)
            const v = judgeRound(round, { before, made: madeMiB, after: footprint() })
            console.log(v.line)
            if (v.error) errors.push(v.error)
        }
    }
    if (errors.length) throw new Error(errors.join("; "))
}
