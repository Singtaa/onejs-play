import { useEffect } from "react"
import { mount, useScene, loadTexture, type Actor } from "oj"

// Two grey squares lit by a white ambient alone, before a camera on -z: the left one faces the
// camera, the right one is tilted back so it faces up and toward it. Both are given an "add"
// shine. The scene's add picture (top.png) is bright only in its top 40%, which is where a
// surface facing up as the camera sees it reads, so the right square shines and the left does
// not. shine.playtest.mjs reads both with no picture, with it, and with the right square's
// actor.shine at 0.
function Squares() {
    const scene = useScene({
        camera: { position: [0, 0, -5], lookAt: [0, 0, 0], fov: 40 },
        sun: false,
        ambient: { sky: "#ffffff", ground: "#ffffff", intensity: 1 },
        background: "#000000",
    })
    useEffect(() => {
        if (!scene) return
        let up: Actor | null = null
        const square = (normal: [number, number, number], side: [number, number, number]) => {
            // The square's other edge, across both its normal and its side.
            const [nx, ny, nz] = normal, [sx, sy, sz] = side
            const ex = ny * sz - nz * sy, ey = nz * sx - nx * sz, ez = nx * sy - ny * sx
            const h = 0.8
            const at = (a: number, b: number) => [sx * a * h + ex * b * h, sy * a * h + ey * b * h, sz * a * h + ez * b * h]
            return scene.mesh({
                positions: new Float32Array([...at(-1, -1), ...at(1, -1), ...at(1, 1), ...at(-1, 1)]),
                indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
                normals: new Float32Array([...normal, ...normal, ...normal, ...normal]),
                twoSided: true,
                color: "#808080",
                shine: { mode: "add" },
            })
        }
        scene.spawn(square([0, 0, -1], [1, 0, 0]), { static: true, position: [-1.2, 0, 0] })
        up = scene.spawn(square([0, 0.8, -0.6], [1, 0, 0]), { static: true, position: [1.2, 0, 0] })
        let picture: Awaited<ReturnType<typeof loadTexture>> | null = null
        ;(globalThis as any).shine = {
            show: async (state: "plain" | "shone" | "zero") => {
                picture ??= await loadTexture("top.png")
                scene.shine = state === "plain" ? null : { add: picture }
                up!.shine = state === "zero" ? 0 : 1
                return state
            },
        }
    }, [scene])
    return null
}

mount(<Squares />)
