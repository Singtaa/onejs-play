import { useEffect } from "react"
import { mount, useScene, loadTexture, type Scene, type Actor, type Model } from "oj"

// One flat quad filling the view from straight above, near (out of the fog) or
// far (half into it): plain, under a texture, or a splat of the same grey, for
// ground-fog.playtest.mjs to read the middle pixel of. Fog is 20 to 60 m, so the
// near quad (10 m below the camera) has none and the far one (40 m) is half fog.
const CAMERA = 40

function quad(size: number, y: number) {
    const h = size / 2
    return {
        positions: new Float32Array([-h, y, -h, h, y, -h, h, y, h, -h, y, h]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    }
}

let live: { model: Model, actor: Actor } | null = null

async function show(scene: Scene, kind: "plain" | "texture" | "splat", far: boolean) {
    live?.actor.destroy()
    live?.model.destroy()
    const grey = await loadTexture("grey.png")
    const shape = far ? quad(160, 0) : quad(40, CAMERA - 10)
    const look = kind === "plain" ? { color: "#808080" }
        : kind === "texture" ? { texture: grey }
        : { splat: { layers: [grey], weights: new Float32Array([1, 1, 1, 1]) } }
    const model = scene.mesh({ ...shape, ...look })
    live = { model, actor: scene.spawn(model, { static: true }) }
}

function Fog() {
    const scene = useScene({ sky: {}, camera: { position: [0, CAMERA, 0.001], lookAt: [0, 0, 0] }, fog: { color: "#ff0000", near: 20, far: 60 } })
    useEffect(() => {
        if (!scene) return
        ;(globalThis as any).groundFog = { show: (kind: "plain" | "texture" | "splat", far: boolean) => show(scene, kind, far) }
    }, [scene])
    return null
}

mount(<Fog />)
