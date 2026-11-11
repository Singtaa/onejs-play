import { useEffect } from "react"
import { mount, useScene, tex, type Scene, type Actor, type MeshModel, type MeshModelOptions } from "oj"

// A scene with no light at all: no sun, no ambient, a black background. A flat quad fills the
// view from straight above, so the middle pixel is what the quad draws. mesh-effects.playtest.mjs
// makes it lit (black here), lit with a flash, unlit, textured with a picture from bytes, and
// additive over a grey floor, with and without fog, and reads the middle pixel.
type Shown = {
    look?: Partial<MeshModelOptions>
    // An unlit floor of this colour a metre under the quad.
    floor?: string
    // Fog of this colour, whole well before the quad; none when left out.
    fog?: string
    // A red picture from bytes, tex.pixels, as the quad's texture.
    pixels?: boolean
    // The floor alone, with no quad over it.
    bare?: boolean
    // A colour added to the quad's actor after its light (actor.flash).
    flash?: string
}

let live: { model: MeshModel, actor: Actor }[] = []

function quad(scene: Scene, y: number, look: Partial<MeshModelOptions>, flash?: string) {
    const h = 40
    const model = scene.mesh({
        positions: new Float32Array([-h, y, -h, h, y, -h, h, y, h, -h, y, h]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        ...look,
    })
    live.push({ model, actor: scene.spawn(model, flash === undefined ? { static: true } : { static: true, flash }) })
}

function red(): Uint8Array {
    const bytes = new Uint8Array(64 * 64 * 4)
    for (let i = 0; i < bytes.length; i += 4) { bytes[i] = 255; bytes[i + 3] = 255 }
    return bytes
}

function show(scene: Scene, { look = {}, floor, fog, pixels, bare, flash }: Shown) {
    for (const l of live) { l.actor.destroy(); l.model.destroy() }
    live = []
    scene.fog(fog === undefined ? false : { color: fog, near: 0, far: 2 })
    if (floor !== undefined) quad(scene, -1, { color: floor, unlit: true })
    if (bare === true) return
    const texture = pixels ? { texture: tex.pixels(64, 64, red()).texture() } : {}
    quad(scene, 0, { color: "#ffffff", ...texture, ...look }, flash)
}

function Effects() {
    const scene = useScene({
        camera: { position: [0, 10, 0.001], lookAt: [0, 0, 0] },
        sun: false,
        ambient: { sky: "#000000", ground: "#000000", intensity: 0 },
        background: "#000000",
    })
    useEffect(() => {
        if (!scene) return
        ;(globalThis as any).meshEffects = { show: (s: Shown) => show(scene, s) }
    }, [scene])
    return null
}

mount(<Effects />)
