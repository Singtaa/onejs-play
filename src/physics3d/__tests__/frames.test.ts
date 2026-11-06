/**
 * How a world's actors are drawn frame by frame: at the step they took when
 * frames come once a step, and between the last two steps when frames come
 * faster, so a 120 Hz screen sees motion on every frame.
 */
import fs from "node:fs"
import path from "node:path"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { createWorld } from "../world"
import { setActorPlacer, type ActorPlacement } from "../actors"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

/** Where each frame drew the actor, x only, after `frames` frames of `hz`. */
async function drawn(hz: number, frames: number, during?: (w: any, b: any, i: number) => void) {
    const xs: number[] = []
    const actor = {} as any
    setActorPlacer((list: readonly ActorPlacement[]) => { for (const p of list) if (p.actor === actor) xs.push(p.at[0]) })
    try {
        const w = await createWorld({ gravity: [0, 0, 0] }) as any
        const b = w.sphere({ dynamic: true, actor })
        b.velocity = [6, 0, 0]
        xs.length = 0
        const perFrame: number[] = []
        for (let i = 0; i < frames; i++) {
            const before = xs.length
            during?.(w, b, i)
            w.frame(1 / hz)
            perFrame.push(xs.length > before ? xs[xs.length - 1]! : NaN)
        }
        w.dispose()
        return perFrame
    } finally {
        setActorPlacer((list) => { for (const p of list) p.actor.position = p.at })
    }
}

/** How far the drawing moved each frame, skipping the warm-up while the frame length settles. */
const moves = (xs: number[]) => xs.slice(60).map((x, i, a) => i === 0 ? NaN : x - a[i - 1]!).slice(1)

describe("drawing between steps", () => {
    it("moves an actor on every frame at 120 Hz, the same distance each", async () => {
        const m = moves(await drawn(120, 240))
        expect(m.every((d) => Number.isFinite(d))).toBe(true)
        // 6 m/s over a 120th of a second.
        for (const d of m) expect(d).toBeCloseTo(0.05, 3)
    })

    it("draws a 60 Hz frame exactly where the step it took left the body, as it always has", async () => {
        const at: number[] = []
        const xs = await drawn(60, 120, (_w, b, i) => { if (i > 0) at.push(b.position[0]) })
        for (let i = 60; i < 119; i++) expect(xs[i]).toBe(at[i])
    })

    it("draws a body put somewhere by hand there, rather than sliding it across", async () => {
        const xs = await drawn(120, 240, (w, b, i) => { if (i === 200) b.position = [100, 0, 0] })
        const m = moves(xs)
        // No frame shows it partway: every move is a frame's travel or the jump itself.
        const partway = m.filter((d) => d > 0.06 && d < 90)
        expect(partway).toEqual([])
    })

    it("draws a rewound body where the rewind put it, rather than sliding it back", async () => {
        let saved: Uint8Array | null = null
        const xs = await drawn(120, 240, (w, _b, i) => {
            if (i === 100) saved = w.snapshot()
            if (i === 200) w.restore(saved!)
        })
        const m = moves(xs)
        // The rewind jumps it 5 m back in one frame; anything shorter backwards is a slide.
        expect(m.filter((d) => d < -0.01 && d > -4.9)).toEqual([])
    })
})
