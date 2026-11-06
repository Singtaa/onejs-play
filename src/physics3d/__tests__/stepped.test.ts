/**
 * A world on the frame clock steps after the cart's frame callbacks, however
 * late it loaded: what a frame callback sets moves the body on that frame.
 */
import fs from "node:fs"
import path from "node:path"
import * as api from "../../index"
import { createRuntime } from "../../runtime"
import { stepOn } from "../../physics/use-stepped"
import { setWasmModule } from "../../wasm"
import { RAPIER_VERSION } from "../rapier.version"
import { createWorld } from "../world"

const WA = (globalThis as any).WebAssembly

beforeAll(() => {
    setWasmModule("rapier3d", new WA.Module(fs.readFileSync(path.resolve(import.meta.dirname, `../../../assets/@ojplay/wasm/rapier3d-${RAPIER_VERSION}.wasm`))))
})

describe("a world on the frame clock", () => {
    it("steps after a frame callback added once it had loaded, so the velocity set there moves the body that frame", async () => {
        const r = createRuntime({ api, root: { fake: "root" }, version: "1.3.0" })
        const w = await createWorld({ gravity: [0, 0, 0] })
        const b = w.sphere({ dynamic: true })
        const stop = stepOn(r.oj, w as any)
        // The cart's own callback, mounted after the world loaded.
        let moving = false
        const off = r.oj.onFrame(() => { if (moving) b.velocity = [6, 0, 0] })
        r.beginFrame(1 / 60)
        moving = true
        r.beginFrame(1 / 60)
        expect(b.position[0]).toBeCloseTo(0.1, 6)
        off()
        stop()
        w.dispose()
    })
})
