import { useEffect } from "react"
import { mount, useScene, type Scene, type Actor, type MeshModel } from "oj"

// One flat grey quad filling the view from straight above, with the sun nearly
// behind the camera, so the middle pixel sees the sun's mirror image: a glossy
// quad is bright there and a rough one is not. mesh-material.playtest.mjs makes
// it with a surface, or changes the live one's, and reads the middle pixel.
type Surface = { color?: string, roughness?: number, metallic?: number }

let live: { model: MeshModel, actor: Actor } | null = null

function show(scene: Scene, made: Surface) {
    live?.actor.destroy()
    live?.model.destroy()
    const h = 40
    const model = scene.mesh({
        positions: new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        color: "#808080",
        ...made,
    })
    live = { model, actor: scene.spawn(model, { static: true }) }
}

function change(changed: Surface) {
    const model = live!.model
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
