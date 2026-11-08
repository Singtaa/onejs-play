/**
 * How a world's actors are drawn frame by frame: at the step they took when
 * frames come once a step, and between the last two steps when frames come
 * faster, so a 120 Hz screen sees motion on every frame, never inside a wall
 * the engine has not put them in and never pulled back by the next step.
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

/**
 * Where each frame drew the actor, x only, after `frames` frames of `hz`,
 * each frame off by up to `jitter` of its length, alternately long and short.
 */
async function drawn(hz: number, frames: number, during?: (w: any, b: any, i: number) => void, jitter = 0) {
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
            w.frame((1 + (i % 2 === 0 ? jitter : -jitter)) / hz)
            perFrame.push(xs.length > before ? xs[xs.length - 1]! : NaN)
        }
        w.dispose()
        return perFrame
    } finally {
        setActorPlacer((list) => { for (const p of list) p.actor.position = p.at })
    }
}

/** Where each frame drew `actor`, x only, NaN when it was not placed. */
function tracking(actor: object): { last: number } {
    const seen = { last: NaN }
    setActorPlacer((list: readonly ActorPlacement[]) => { for (const p of list) if (p.actor === actor) seen.last = p.at[0] })
    return seen
}
const restorePlacer = () => setActorPlacer((list) => { for (const p of list) p.actor.position = p.at })

/** How far the drawing moved each frame, skipping the warm-up while the frame length settles. */
const moves = (xs: number[]) => xs.slice(60).map((x, i, a) => i === 0 ? NaN : x - a[i - 1]!).slice(1)

describe("drawing between steps", () => {
    it("moves an actor on every frame at 120 Hz, the same distance each", async () => {
        const m = moves(await drawn(120, 240))
        expect(m.every((d) => Number.isFinite(d))).toBe(true)
        // 6 m/s over a 120th of a second.
        for (const d of m) expect(d).toBeCloseTo(0.05, 3)
    })

    it("draws a 60 Hz frame exactly where the step it took left the body, as it always has, with frames 2 ms off", async () => {
        const at: number[] = []
        const xs = await drawn(60, 120, (_w, b, i) => { if (i > 0) at.push(b.position[0]) }, 0.12)
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
        // The rewind jumps it 5 m back in one frame, less the step the frame
        // before was drawn behind; anything shorter backwards is a slide.
        expect(m.filter((d) => d < -0.01 && d > -4.8)).toEqual([])
    })

    it("draws it between the last two steps: never past the last, never more than a step behind", async () => {
        const at: number[] = []
        const xs = await drawn(120, 240, (_w, b, i) => { if (i > 0) at.push(b.position[0]) })
        let behind = 0
        for (let i = 60; i < 239; i++) {
            // Drawn after frame i; the body as it stood before frame i + 1. A step is 10 cm at 6 m/s.
            expect(xs[i]!).toBeLessThanOrEqual(at[i]! + 1e-5)
            expect(xs[i]!).toBeGreaterThanOrEqual(at[i]! - 0.1 - 1e-5)
            if (xs[i]! < at[i]! - 0.01) behind++
        }
        expect(behind).toBeGreaterThan(50)
    })

    it("never draws a ball deeper into a thin wall than either of the last two steps put it", async () => {
        // 6 m/s at 120 Hz is 5 cm a frame; the wall is 2 cm. Twenty distances,
        // so the frames fall at every phase of the approach.
        const actor = {}
        const seen = tracking(actor)
        try {
            let extra = 0, near = 0
            for (let k = 0; k < 20; k++) {
                const w = await createWorld({ gravity: [0, 0, 0] }) as any
                const face = 3 + k * 0.0123
                w.box({ at: [face + 0.01, 0, 0], size: [0.02, 4, 4] })
                const b = w.sphere({ dynamic: true, actor, radius: 0.5 })
                b.velocity = [6, 0, 0]
                // How deep each of the last two steps left it.
                const depths = [0, 0]
                for (let i = 0; i < 90; i++) {
                    seen.last = NaN
                    const was = b.position[0]
                    w.frame(1 / 120)
                    if (b.position[0] !== was) depths.push(Math.max(0, b.position[0] + 0.5 - face))
                    if (!Number.isFinite(seen.last)) continue
                    const body = Math.max(...depths.slice(-2))
                    const drawnIn = seen.last + 0.5 - face
                    if (drawnIn > -0.05) near++
                    extra = Math.max(extra, drawnIn - body)
                }
                w.dispose()
            }
            expect(near).toBeGreaterThan(20)
            expect(extra).toBeLessThan(1e-4)
        } finally {
            restorePlacer()
        }
    })

    it("slides a box along the floor it rests on every frame, rather than stopping it at the floor", async () => {
        const actor = {}
        const xs: number[] = []
        setActorPlacer((list: readonly ActorPlacement[]) => { for (const p of list) if (p.actor === actor) xs.push(p.at[0]) })
        try {
            const w = await createWorld() as any
            w.box({ at: [0, -0.5, 0], size: [400, 1, 400], friction: 0 })
            const b = w.box({ dynamic: true, actor, at: [0, 0.5, 0], friction: 0 })
            for (let i = 0; i < 60; i++) w.frame(1 / 120)
            b.velocity = [6, 0, 0]
            for (let i = 0; i < 30; i++) w.frame(1 / 120)
            xs.length = 0
            for (let i = 0; i < 30; i++) w.frame(1 / 120)
            for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(0.05, 3)
            w.dispose()
        } finally {
            restorePlacer()
        }
    })

    it("slides a kinematic box set a centimetre into the floor along it, which keeps no contact with it", async () => {
        const actor = {}
        const xs: number[] = []
        setActorPlacer((list: readonly ActorPlacement[]) => { for (const p of list) if (p.actor === actor) xs.push(p.at[0]) })
        try {
            const w = await createWorld() as any
            w.box({ at: [0, -0.5, 0], size: [400, 1, 400] })
            const b = w.box({ kinematic: true, actor, at: [0, 0.49, 0] })
            b.velocity = [6, 0, 0]
            for (let i = 0; i < 60; i++) w.frame(1 / 120)
            xs.length = 0
            for (let i = 0; i < 30; i++) w.frame(1 / 120)
            for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(0.05, 3)
            w.dispose()
        } finally {
            restorePlacer()
        }
    })

    it("keeps a box that lands on the floor while it slides moving on every frame, the one after it lands too", async () => {
        // The step that lands it is not the one that finds the contact: the
        // frame after it sweeps from touching the floor.
        for (const drop of [0.03, 0.05, 0.08, 0.13]) {
            const actor = {}
            const xs: number[] = []
            setActorPlacer((list: readonly ActorPlacement[]) => { for (const p of list) if (p.actor === actor) xs.push(p.at[0]) })
            try {
                const w = await createWorld() as any
                w.box({ at: [0, -0.5, 0], size: [400, 1, 400], friction: 0 })
                const b = w.box({ dynamic: true, actor, at: [0, 0.5 + drop, 0], friction: 0 })
                b.velocity = [6, 0, 0]
                for (let i = 0; i < 60; i++) w.frame(1 / 120)
                // From the third frame: until the first step, it is drawn where it began.
                for (let i = 3; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(0.05, 3)
                w.dispose()
            } finally {
                restorePlacer()
            }
        }
    })

    it("draws a ball its cart keeps pushing into or along a wall never inside it, and sliding along it", async () => {
        // Straight into a short wall, and along a long one without friction:
        // each meets the wall on a frame the engine has no contact for yet.
        for (const [along, friction, wide] of [[0, undefined, 4], [6, 0, 400]] as const) {
            const actor = {}
            const zs: number[] = []
            let last = NaN
            setActorPlacer((list: readonly ActorPlacement[]) => { for (const p of list) if (p.actor === actor) { last = p.at[0]; zs.push(p.at[2]) } })
            try {
                const w = await createWorld({ gravity: [0, 0, 0] }) as any
                w.box({ at: [3.5, 0, 0], size: [1, 4, wide], friction })
                const b = w.sphere({ dynamic: true, actor, radius: 0.5, friction })
                let deepest = -Infinity, pressed = 0
                for (let i = 0; i < 120; i++) {
                    // A cart driving it: the same speed, every frame, wall or not.
                    b.velocity = [6, 0, along]
                    last = NaN
                    w.frame(1 / 120)
                    if (!Number.isFinite(last)) continue
                    if (b.position[0] > 2.4) pressed++
                    deepest = Math.max(deepest, last + 0.5 - 3 - Math.max(0, b.position[0] + 0.5 - 3))
                }
                expect(pressed).toBeGreaterThan(60)
                expect(deepest).toBeLessThan(1e-4)
                // Along the wall it is drawn moving on every frame, the one after it meets it too.
                // From the third frame: until the first step, it is drawn where it began.
                for (let i = 3; i < zs.length; i++) expect(zs[i]! - zs[i - 1]!).toBeCloseTo(along / 120, 3)
                w.dispose()
            } finally {
                restorePlacer()
            }
        }
    })

    it("shows a character's walk pressed or let go within two 120 Hz frames, and never pulls it back", async () => {
        const actor = {}
        const seen = tracking(actor)
        try {
            for (const press of [true, false]) for (const change of [200, 201]) {
                const w = await createWorld() as any
                w.box({ at: [0, -0.5, 0], size: [400, 1, 400] })
                const c = w.character({ actor })
                const drawnAt: number[] = [], body: number[] = []
                for (let i = 0; i < 210; i++) {
                    c.walk((i < change) !== press ? [6, 0, 0] : [0, 0, 0])
                    seen.last = NaN
                    w.frame(1 / 120)
                    drawnAt.push(seen.last)
                    body.push(c.position[0])
                }
                // The step after the change takes the new walk, and the frame
                // after that step draws it: within two frames at 120 Hz.
                const moves = drawnAt.slice(change).map((x, i, a) => i === 0 ? x - drawnAt[change - 1]! : x - a[i - 1]!)
                if (press) {
                    expect(Math.max(moves[0]!, moves[1]!, moves[2]!)).toBeGreaterThan(0.04)
                    for (let i = 3; i < moves.length; i++) expect(moves[i]!).toBeCloseTo(0.05, 3)
                } else {
                    // Let go, it slows to a stop on its own path: no frame
                    // draws it back toward where it was.
                    for (const m of moves) expect(m).toBeGreaterThanOrEqual(-1e-9)
                    for (let i = 3; i < moves.length; i++) expect(moves[i]!).toBeCloseTo(0, 6)
                }
                w.dispose()
            }
        } finally {
            restorePlacer()
        }
    })
})
