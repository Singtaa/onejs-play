import { useEffect } from "react"
import { mount, useScene, loadTexture, type Scene } from "oj"

// Two faces 48 m tall rising at 70 degrees, side by side, each a one-layer splat
// of horizontal bands, red and green: on the left the layer is read at uvs laid flat (x and z
// over 4, as a terrain's are), on the right it is projected from the sides,
// repeating every 4 m. triplanar.playtest.mjs counts the bands up a column of
// each. Seen square on from 90 m, so a count is all it needs, not a scale.
const HEIGHT = 48
const SLOPE = 70 * Math.PI / 180

function face(x0: number, x1: number) {
    const top = HEIGHT / Math.tan(SLOPE)
    const ny = Math.cos(SLOPE), nz = -Math.sin(SLOPE)
    const positions = new Float32Array([x0, 0, 0, x1, 0, 0, x1, HEIGHT, top, x0, HEIGHT, top])
    // Both windings, so one of each pair faces the camera whichever way the engine winds a front face.
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2])
    const uvs = new Float32Array([x0 / 4, 0, x1 / 4, 0, x1 / 4, top / 4, x0 / 4, top / 4])
    const normals = new Float32Array([0, ny, nz, 0, ny, nz, 0, ny, nz, 0, ny, nz])
    return { positions, indices, uvs, normals }
}

async function build(scene: Scene) {
    const bands = await loadTexture("bands.png")
    const weights = new Float32Array([1, 1, 1, 1])
    scene.spawn(scene.mesh({ ...face(-120, -2), splat: { layers: [bands], weights } }), { static: true })
    scene.spawn(scene.mesh({ ...face(2, 120), splat: { layers: [{ picture: bands, triplanar: 4 }], weights } }), { static: true })
    ;(globalThis as any).triplanarReady = true
}

function Faces() {
    const scene = useScene({ sky: {}, camera: { position: [0, HEIGHT / 2, -90], lookAt: [0, HEIGHT / 2, 9] } })
    useEffect(() => { if (scene) void build(scene) }, [scene])
    return null
}

mount(<Faces />)
