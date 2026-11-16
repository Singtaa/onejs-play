// What a seen crowd costs the main thread, a person: COUNTS people stand before the camera, each
// playing Walk, holding it at speed 0, or playing nothing, and Unity's main thread time a frame is
// read for each count against an empty scene. Run it on the GPU, with the runtime under test:
//
//   ojplay test cli/fixtures/crowd/crowd.bench.mjs --gpu --window 1600,900 --runtime <x.y.z>
//
// BENCH_COUNTS (default 250,500,1000) and BENCH_CLIPS (default play,hold,none) choose the rows.
// BENCH_GPU (default "as is") runs each row with skins on the graphics card ("on"), on the CPU
// ("off"), or both ("on,off"), on a runtime with OneJS's ModelBridge.GpuSkinning; the fixture
// prints GPUSKIN with what the runtime reports, so a runtime without the switch is seen to be one.
// Prints a ROW line per reading and a FIT line per clip mode: the slope over the counts in us a
// person. Not a check: it decides nothing about speed. It throws, so the run exits non-zero, when
// a reading has too few frames or the crowd was not made, since a row without either measured
// nothing.
const COUNTS = (process.env.BENCH_COUNTS ?? "250,500,1000").split(",").map(Number)
const CLIPS = (process.env.BENCH_CLIPS ?? "play,hold,none").split(",")
const GPU = (process.env.BENCH_GPU ?? "as is").split(",")
const WARM_MS = 2000
const READ_MS = 3000
const LEAST_FRAMES = 20

async function read(game, what) {
    await game.wait(WARM_MS)
    await game.eval("JSON.stringify(globalThis.crowd.frames())")
    await game.wait(READ_MS)
    const f = JSON.parse(await game.eval("JSON.stringify(globalThis.crowd.frames())"))
    if (!(f.mainCount >= LEAST_FRAMES) || !(f.main >= 0)) throw new Error(`bench: ${what} read ${f.mainCount} frames of main thread time (${f.main}): nothing was measured`)
    return f
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.crowd")) === "object", { what: "the crowd cart", timeoutMs: 30000 })
    const set = async (setup) => {
        const made = Number(await game.eval(`globalThis.crowd.set(${JSON.stringify(setup)})`))
        if (made !== setup.count) throw new Error(`bench: asked for ${setup.count} people and ${made} were made`)
    }
    await set({ count: 0, seen: 0, clips: "none", move: false, shadows: false })
    const empty = (await read(game, "empty")).main
    console.log(`ROW empty main ${empty.toFixed(3)} ms`)
    for (const gpu of GPU) {
        const on = gpu === "on" ? true : gpu === "off" ? false : undefined
        for (const clips of CLIPS) {
            const points = []
            for (const count of COUNTS) {
                await set({ count, seen: count, clips, move: false, shadows: false, gpu: on })
                const skins = await game.eval("String(CS.OneJS.Models.ModelBridge.GpuSkinCount)")
                const f = await read(game, `${count} ${clips}`)
                const us = (f.main - empty) * 1000 / count
                points.push([count, f.main])
                console.log(`ROW gpu=${gpu} ${clips} ${count} main ${f.main.toFixed(3)} ms, frame ${f.mean.toFixed(2)} ms, ${us.toFixed(2)} us a person over empty (GPUSKIN ${skins})`)
            }
            if (points.length >= 2) {
                const n = points.length
                const mx = points.reduce((s, p) => s + p[0], 0) / n
                const my = points.reduce((s, p) => s + p[1], 0) / n
                const slope = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / points.reduce((s, p) => s + (p[0] - mx) ** 2, 0)
                console.log(`FIT gpu=${gpu} ${clips} ${(slope * 1000).toFixed(2)} us a person`)
            }
        }
    }
    await set({ count: 0, seen: 0, clips: "none", move: false, shadows: false })
}
