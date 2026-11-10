import { useEffect, useState } from "react"
import { mount, useScene, ShaderProgram, type Scene } from "oj"
import check from "./check.sl"

// A wall 10 m ahead across the left half of the view and the sky to its right, read through
// scene.depth by check.sl, which paints a pixel green where the depth is the distance along its
// ray (or the far distance for the sky) and red where it is not. scene-depth.playtest.mjs counts
// the colours: alone, with scene.texture read beside it, and with the expected wall moved a metre
// (`off`), which must turn the left half red, so the check is shown able to fail.
const FOV = 60

function wall(scene: Scene) {
    const model = scene.mesh({
        positions: new Float32Array([-100, -100, 10, -100, 100, 10, 0, 100, 10, 0, -100, 10]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        color: "#808080",
    })
    scene.spawn(model, { static: true })
}

function Depth() {
    const scene = useScene({ camera: { position: [0, 0, 0], lookAt: [0, 0, 1], fov: FOV }, sun: { shadows: false } })
    const [mode, setMode] = useState({ withScene: false, off: 0 })
    useEffect(() => {
        if (!scene) return
        wall(scene)
        ;(globalThis as any).sceneDepth = { mode: (m: { withScene: boolean, off: number }) => setMode(m) }
    }, [scene])
    if (!scene) return null
    const textures = mode.withScene ? { depth: scene.depth, scene: scene.texture } : { depth: scene.depth, scene: "noise" }
    return <ShaderProgram key={mode.withScene ? "with" : "alone"} program={check} textures={textures}
        uniforms={{ wall: 10 + mode.off, tanY: Math.tan(FOV * Math.PI / 360), withScene: mode.withScene ? 1 : 0 }}
        style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
}

mount(<Depth />)
