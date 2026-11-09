import { useEffect } from "react"
import { mount, useScene, loadTexture, type Scene, type Actor, type Model } from "oj"

// One flat quad filling the view from straight above, near (out of the fog) or
// far (half into it): plain, under a texture, or a splat of the same grey (its
// layer read at the uvs, or projected from above as a triplanar one), for
// ground-fog.playtest.mjs to read the middle pixel of. Fog is 20 to 60 m, so the
// near quad (10 m below the camera) has none and the far one (40 m) is half fog.
// Then a ground 600 m across, plain or a splat, seen straight down or slanting
// to a point 120 m off, under each law of fog the playtest gives it.
const CAMERA = 40
type Vec3 = [number, number, number]
const VIEWS: Record<"down" | "slant", { position: Vec3, lookAt: Vec3 }> = {
    down: { position: [0, CAMERA, 0.001], lookAt: [0, 0, 0] },
    slant: { position: [0, CAMERA, 0], lookAt: [0, 0, 120] },
}

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

type Kind = "plain" | "texture" | "splat" | "triplanar"
type At = boolean | "ground"

async function show(scene: Scene, kind: Kind, at: At) {
    live?.actor.destroy()
    live?.model.destroy()
    const grey = await loadTexture("grey.png")
    const shape = at === "ground" ? quad(600, 0) : at ? quad(160, 0) : quad(40, CAMERA - 10)
    const look = kind === "plain" ? { color: "#808080" }
        : kind === "texture" ? { texture: grey }
        // No variation, which would shade the splat's grey by where it lies (by 0.89 at the origin)
        // where the plain quad stays the same grey everywhere.
        : kind === "splat" ? { splat: { layers: [grey], weights: new Float32Array([1, 1, 1, 1]), variation: 0 } }
        : { splat: { layers: [{ picture: grey, triplanar: 4 }], weights: new Float32Array([1, 1, 1, 1]), variation: 0 } }
    const model = scene.mesh({ ...shape, ...look })
    live = { model, actor: scene.spawn(model, { static: true }) }
}

function Fog() {
    const scene = useScene({ sky: {}, camera: { position: [0, CAMERA, 0.001], lookAt: [0, 0, 0] }, fog: { color: "#ff0000", near: 20, far: 60 } })
    useEffect(() => {
        if (!scene) return
        ;(globalThis as any).groundFog = {
            show: (kind: Kind, at: At) => show(scene, kind, at),
            view: (name: keyof typeof VIEWS) => scene.camera(VIEWS[name]),
            fog: (o: Parameters<Scene["fog"]>[0]) => scene.fog(o),
        }
    }, [scene])
    return null
}

mount(<Fog />)
