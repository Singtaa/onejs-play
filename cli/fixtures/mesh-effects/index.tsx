import { useEffect } from "react"
import { mount, useScene, tex, type Scene, type Actor, type MeshModel, type MeshModelOptions } from "oj"

// A scene with no light at all: no sun, no ambient, a black background. A flat quad fills the
// view from straight above, so the middle pixel is what the quad draws. mesh-effects.playtest.mjs
// makes it lit (black here), lit with a flash, unlit, textured with a picture from bytes, playing
// a red and a blue picture as a flipbook, additive over a grey floor, with and without fog,
// premultiplied over the floor at three alphas and under a clear red picture, and unlit under a red
// waterline, and reads the middle pixel.
type Shown = {
    look?: Partial<MeshModelOptions>
    // An unlit floor of this colour a metre under the quad.
    floor?: string
    // Fog of this colour, whole well before the quad; none when left out.
    fog?: string
    // A red picture from bytes, tex.pixels, as the quad's texture.
    pixels?: boolean
    // The same red at alpha 0: nothing, straight; red light, premultiplied.
    clearPixels?: boolean
    // A red and a blue picture from bytes as the quad's texture's frames, over two seconds.
    flipbook?: boolean
    // The floor alone, with no quad over it.
    bare?: boolean
    // A colour added to the quad's actor after its light (actor.flash).
    flash?: string
    // A red waterline at this height and strength (scene.waterline); none when left out.
    waterline?: { y: number, strength: number }
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

// A picture's bytes all of one channel at full, 0 red and 2 blue, at an alpha of `alpha` levels.
function solid(channel: number, alpha = 255): Uint8Array {
    const bytes = new Uint8Array(64 * 64 * 4)
    for (let i = 0; i < bytes.length; i += 4) { bytes[i + channel] = 255; bytes[i + 3] = alpha }
    return bytes
}

function show(scene: Scene, { look = {}, floor, fog, pixels, clearPixels, flipbook, bare, flash, waterline }: Shown) {
    for (const l of live) { l.actor.destroy(); l.model.destroy() }
    live = []
    scene.fog(fog === undefined ? false : { color: fog, near: 0, far: 2 })
    scene.waterline(waterline === undefined ? false : { color: "#ff0000", ...waterline })
    if (floor !== undefined) quad(scene, -1, { color: floor, unlit: true })
    if (bare === true) return
    const picture = (channel: number, alpha?: number) => tex.pixels(64, 64, solid(channel, alpha)).texture()
    const texture = pixels ? { texture: picture(0) } : clearPixels ? { texture: picture(0, 0) } : flipbook ? { texture: { frames: [picture(0), picture(2)], seconds: 2 } } : {}
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
        ;(globalThis as any).meshEffects = {
            show: (s: Shown) => show(scene, s),
            // The waterline a metre below, its colour and strength kept.
            lower: () => scene.waterline({ y: -1 }),
        }
    }, [scene])
    return null
}

mount(<Effects />)
