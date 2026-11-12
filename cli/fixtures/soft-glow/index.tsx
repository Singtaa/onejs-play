import { useEffect } from "react"
import { mount, useScene, type Scene, type Actor, type MeshModel } from "oj"

// A glow quad standing upright through a grey floor, seen from 45 degrees above, as a spell's
// glow meets the ground. soft-glow.playtest.mjs shows it in one blend at a time, with or without
// `soften`, and reads the quad just above the line where it meets the floor against the floor
// just below it. The camera looks at that line's middle, so it crosses the middle of the screen.
type Blend = "alpha" | "add" | "premultiplied" | "premultipliedTexture"
type Glow = { blend: Blend, soften: number, layers?: number }

// The glow's colour in each blend. "alpha" and "premultiplied" cover 60% of the floor; "add" adds
// its colour; "premultipliedTexture" adds its colour (its picture is plain white) and covers 40%.
const LOOK: Record<Blend, object> = {
    alpha: { color: [1, 0.6, 0.2, 0.6] },
    add: { color: [0.6, 0.35, 0.1, 1], blend: "add" },
    premultiplied: { color: [1, 0.6, 0.2, 0.6], blend: "premultiplied" },
    premultipliedTexture: { color: [1, 0.7, 0.3, 0.4], blend: "premultipliedTexture" },
}

let live: { model: MeshModel, actors: Actor[] }[] = []

function clear() {
    for (const l of live) { for (const a of l.actors) a.destroy(); l.model.destroy() }
    live = []
}

// `layers` copies, each a little nearer the camera, for timing many glows over one another.
function show(scene: Scene, { blend, soften, layers = 1 }: Glow) {
    clear()
    const model = scene.mesh({
        positions: new Float32Array([-1.5, -1, 0, 1.5, -1, 0, 1.5, 2.5, 0, -1.5, 2.5, 0]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
        normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
        twoSided: true,
        unlit: true,
        ...(soften > 0 ? { soften } : {}),
        ...LOOK[blend],
    } as never)
    const actors: Actor[] = []
    for (let i = 0; i < layers; i++) actors.push(scene.spawn(model, { static: true, position: [0, 0, -i * 0.01] }))
    live.push({ model, actors })
}

function Ground() {
    const scene = useScene({
        camera: { position: [0, 4, -4], lookAt: [0, 0, 0], fov: 40 },
        sun: false,
        ambient: { sky: "#ffffff", ground: "#ffffff", intensity: 1 },
        background: "#000000",
    })
    useEffect(() => {
        if (!scene) return
        const h = 40
        const floor = scene.mesh({
            positions: new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]),
            indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
            normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
            color: "#606060",
        })
        scene.spawn(floor, { static: true })
        ;(globalThis as any).softGlow = { show: (g: Glow) => show(scene, g), clear }
    }, [scene])
    return null
}

mount(<Ground />)
