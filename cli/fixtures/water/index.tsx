import { useEffect } from "react"
import { mount, useScene, type MeshModel, type MeshWater, type Scene } from "oj"

// A pool in a dark room with no sun, the case water's options are for: seen from 3 m up and 8 m
// back, across 14 m of water to a wall that stands in it. water.playtest.mjs sets the water
// (globalThis.water.set) and reads it near, far, and in the band where it meets the wall.
// The playtest projects its points through the same camera: keep its CAMERA in step with this one.
const CAMERA = { position: [0, 3, -8] as [number, number, number], lookAt: [0, 0, 2] as [number, number, number], fov: 40 }
const WALL_Z = 4

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

// A flat grid at height 0 from x0, z0 to x1, z1, `n` squares a side, uvs in metres: enough
// vertices for a swell to move.
function grid(x0: number, z0: number, x1: number, z1: number, n: number) {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = []
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * j / n
        positions.push(x, 0, z)
        uvs.push(x, z)
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i
        indices.push(a, a + n + 1, a + n + 2, a, a + n + 2, a + 1)
    }
    return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) }
}

function build(scene: Scene): MeshModel {
    scene.spawn(scene.mesh({ ...box([-12, -2.2, -12], [12, -2, 12]), color: "#5a5a5a" }), { static: true })
    scene.spawn(scene.mesh({ ...box([-12, -2, WALL_Z], [12, 2, WALL_Z + 0.5]), color: "#807060" }), { static: true })
    const pool = scene.mesh({
        ...grid(-12, -12, 12, WALL_Z + 0.2, 48),
        color: "#336650b8",
        deepColor: { color: "#0a1712f2", metres: 4 },
    })
    scene.spawn(pool)
    return pool
}

function Pool() {
    const scene = useScene({
        camera: CAMERA,
        sun: false,
        ambient: { sky: "#6f8aa8", ground: "#2a2a2a", intensity: 1 },
        background: "#000000",
    })
    useEffect(() => {
        if (!scene) return
        const pool = build(scene)
        ;(globalThis as any).water = { set: (w: boolean | MeshWater) => { pool.water = w } }
    }, [scene])
    return null
}

mount(<Pool />)
