import { useEffect } from "react"
import { mount, useScene, loadTexture, type Scene, type Actor, type MeshModel } from "oj"

// One flat grey quad filling the view from straight above, with the sun nearly
// behind the camera, so the middle pixel sees the sun's mirror image: a glossy
// quad is bright there and a rough one is not. mesh-material.playtest.mjs makes
// it with a surface, or changes the live one's, and reads the middle pixel.
// Given a `floor`, a black floor lies that many metres below a see-through
// quad, for soften and deepColor to fade it by.
type Surface = { color?: string, roughness?: number, metallic?: number, soften?: number, deepColor?: { color: string, metres: number }, floor?: number, tilted?: boolean }

let live: { model: MeshModel, actor: Actor }[] = []

function quad(scene: Scene, y: number, look: object) {
    const h = 40
    const model = scene.mesh({
        positions: new Float32Array([-h, y, -h, h, y, -h, h, y, h, -h, y, h]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        ...look,
    })
    live.push({ model, actor: scene.spawn(model, { static: true }) })
}

// A normal tilted 0.8 toward +u everywhere, which turns the quad's mirror image of the sun away
// from the camera.
async function show(scene: Scene, { floor, tilted, ...made }: Surface) {
    const normalMap = tilted ? { normalMap: { picture: await loadTexture("tilted.png"), tiling: 4 } } : {}
    for (const l of live) { l.actor.destroy(); l.model.destroy() }
    live = []
    if (floor !== undefined) quad(scene, -floor, { color: "#000000" })
    quad(scene, 0, { color: "#808080", ...made, ...normalMap })
}

function change(changed: Surface) {
    const model = live.at(-1)!.model
    if (changed.color !== undefined) model.color = changed.color
    if (changed.roughness !== undefined) model.roughness = changed.roughness
    if (changed.metallic !== undefined) model.metallic = changed.metallic
}

function Material() {
    const scene = useScene({
        camera: { position: [0, 10, 0.001], lookAt: [0, 0, 0] },
        sun: { direction: [0.05, -1, 0.05], color: "#ffffff", intensity: 1, shadows: false },
        ambient: { sky: "#404040", ground: "#404040", intensity: 0.5 },
        background: "#000000",
    })
    useEffect(() => {
        if (!scene) return
        ;(globalThis as any).meshMaterial = { show: (s: Surface) => show(scene, s), change }
    }, [scene])
    return null
}

mount(<Material />)
