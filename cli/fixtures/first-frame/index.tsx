import { useEffect } from "react"
import { mount, useScene, type Scene } from "oj"

// A see-through sheet scattered over a black floor, softened by the depth behind it, made only when
// first-frame.playtest.mjs asks, so the first frame that draws it is the first that uses its
// pipeline. The floor is deep under one half, where the sheet keeps its alpha, and a quarter metre
// down under the other, where `soften` fades it. In the Unity editor on Direct3D 12 the first render
// after a fresh compile drew this sheet over white; the playtest compares the first frames here.
function quad(x0: number, x1: number, y: number) {
    const h = 20
    return {
        positions: new Float32Array([x0, y, -h, x1, y, -h, x1, y, h, x0, y, h]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    }
}

function show(scene: Scene) {
    scene.spawn(scene.mesh({ ...quad(-20, 0, -2), color: "#000000" }), { static: true })
    scene.spawn(scene.mesh({ ...quad(0, 20, -0.25), color: "#000000" }), { static: true })
    const water = scene.mesh({ ...quad(-20, 20, 0), color: "#ffffff80", soften: 1 })
    scene.scatter(water, [{ x: 0, z: 0 }])
}

function FirstFrame() {
    const scene = useScene({
        camera: { position: [0, 10, 0.001], lookAt: [0, 0, 0] },
        sun: { direction: [0.05, -1, 0.05], color: "#ffffff", intensity: 1, shadows: false },
        ambient: { sky: "#808080", ground: "#808080", intensity: 1 },
        background: "#000000",
    })
    useEffect(() => {
        if (!scene) return
        ;(globalThis as any).firstFrame = { show: () => show(scene) }
    }, [scene])
    return null
}

mount(<FirstFrame />)
