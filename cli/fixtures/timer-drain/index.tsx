// Gap 10's repro: timer callbacks due together run back to back, and an
// await in one resumes only after all of them. Results go on
// globalThis.__drain for the test script to read.
import { useEffect, useState } from "react"
import { View, Text, mount } from "oj"

const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { } }
const tick = () => new Promise<void>((r) => setTimeout(r, 50))

// Case A: one callback awaits, an 8 ms callback is due beside it.
function awaitBeside(): Promise<number> {
    return new Promise((done) => {
        setTimeout(async () => {
            const t0 = performance.now()
            await Promise.resolve()
            done(performance.now() - t0)
        }, 20)
        setTimeout(() => busy(8), 20)
    })
}

// Case B: an await chain three deep, same neighbour.
function chainBeside(): Promise<number> {
    return new Promise((done) => {
        setTimeout(async () => {
            const t0 = performance.now()
            await (async () => { await (async () => { await null })() })()
            done(performance.now() - t0)
        }, 20)
        setTimeout(() => busy(8), 20)
    })
}

// Case C: ten 2 ms jobs due in the same frame; the longest frame gap seen.
function sliced(): Promise<{ longest: number, jobsInOneFrame: number }> {
    return new Promise((done) => {
        let last = performance.now(), longest = 0, frame = 0
        const perFrame = new Map<number, number>()
        const raf = () => {
            const now = performance.now()
            longest = Math.max(longest, now - last)
            last = now
            frame++
            if (frame < 30) requestAnimationFrame(raf)
            else done({ longest, jobsInOneFrame: Math.max(...perFrame.values()) })
        }
        requestAnimationFrame(raf)
        for (let i = 0; i < 10; i++) setTimeout(() => { busy(2); perFrame.set(frame, (perFrame.get(frame) ?? 0) + 1) }, 100)
    })
}

function Repro() {
    const [line, setLine] = useState("running")
    useEffect(() => {
        (async () => {
            await tick(); await tick()
            const a: number[] = [], b: number[] = []
            for (let i = 0; i < 5; i++) { a.push(await awaitBeside()); await tick() }
            for (let i = 0; i < 5; i++) { b.push(await chainBeside()); await tick() }
            const c = await sliced()
            const r = { awaitBeside: a, chainBeside: b, sliced: c }
            ;(globalThis as any).__drain = r
            console.log("DRAIN " + JSON.stringify(r))
            setLine(JSON.stringify(r))
        })()
    }, [])
    return <View className="p-4"><Text className="text-white">{line}</Text></View>
}

mount(<Repro />)
