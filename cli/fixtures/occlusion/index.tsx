import { useEffect } from "react"
import { mount, useScene, type AmbientOptions, type Scene } from "oj"

// A plastered wall lit by the ambient light alone, with four timbers standing 0.15 m proud of
// it, seen straight on: what ambient occlusion darkens most, in corners where two surfaces meet.
// occlusion.playtest.mjs sets the occlusion (globalThis.occlusion.set) and reads the wall beside
// a timber against the wall between them. The camera is 6 m back at a 30 degree field of view,
// so the wall at z = 0 spans 3.215 m from top to bottom of the screen.
const TIMBERS = [-1.5, -0.5, 0.5, 1.5]
const WIDE = 0.2, PROUD = 0.15

// A box from `min` to `max`, each face its own four corners so it shades flat.
function box(min: number[], max: number[]) {
    const [x0, y0, z0] = min as [number, number, number], [x1, y1, z1] = max as [number, number, number]
    const faces: [number[][], number[]][] = [
        [[[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1]],
        [[[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]], [0, 0, 1]],
        [[[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], [-1, 0, 0]],
        [[[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]],
        [[[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0]],
        [[[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [0, -1, 0]],
    ]
    const positions: number[] = [], normals: number[] = [], indices: number[] = []
    for (const [corners, n] of faces) {
        const at = positions.length / 3
        for (const c of corners) { positions.push(...c); normals.push(...n) }
        indices.push(at, at + 1, at + 2, at, at + 2, at + 3)
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) }
}

function build(scene: Scene) {
    const wall = scene.mesh({ ...box([-4, -3, 0], [4, 3, 0.2]), color: "#d9b896" })
    scene.spawn(wall, { static: true })
    const timber = scene.mesh({ ...box([-WIDE / 2, -3, -PROUD], [WIDE / 2, 3, 0]), color: "#4a3a2c" })
    for (const x of TIMBERS) scene.spawn(timber, { static: true, position: [x, 0, 0] })
}

function Wall() {
    const scene = useScene({
        camera: { position: [0, 0, -6], lookAt: [0, 0, 0], fov: 30 },
        sun: false,
        ambient: { sky: "#ffffff", ground: "#ffffff", intensity: 1 },
        background: "#000000",
    })
    useEffect(() => {
        if (!scene) return
        build(scene)
        ;(globalThis as any).occlusion = { set: (o: AmbientOptions["occlusion"]) => scene.ambient({ occlusion: o }) }
    }, [scene])
    return null
}

mount(<Wall />)
