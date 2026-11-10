import { useEffect } from "react"
import { mount, useScene, type Scene, type Actor, type MeshModel } from "oj"

// A chrome ball seen side on under a blue sky with an orange horizon, so its middle reflects the
// horizon and its upper part the sky once the sky is asked to reflect, and both read the ambient's
// flat average when it is not. sky-reflect.playtest.mjs turns reflect on and off and reads pixels.
let live: { model: MeshModel, actor: Actor } | null = null

function ball(rings = 48, segments = 96) {
    const positions: number[] = [], indices: number[] = []
    for (let i = 0; i <= rings; i++) {
        const v = Math.PI * i / rings
        for (let j = 0; j <= segments; j++) {
            const u = 2 * Math.PI * j / segments
            positions.push(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u))
        }
    }
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segments; j++) {
            const a = i * (segments + 1) + j, b = a + segments + 1
            indices.push(a, a + 1, b, a + 1, b + 1, b)
        }
    }
    const p = new Float32Array(positions)
    return { positions: p, normals: p, indices: new Uint32Array(indices) }
}

function show(scene: Scene, reflect: boolean) {
    if (live === null) {
        const model = scene.mesh({ ...ball(), color: "#f2f2f2", roughness: 0.02, metallic: 1 })
        live = { model, actor: scene.spawn(model, { static: true }) }
    }
    // Named only when asked, so the unasked scene makes exactly the calls an older runtime makes.
    scene.sky(reflect ? { reflect: true } : { reflect: false })
}

function Reflect() {
    const scene = useScene({
        camera: { position: [0, 0, -2.6], lookAt: [0, 0, 0], fov: 50 },
        sun: { direction: [0.3, -0.5, 0.8], color: "#ffffff", intensity: 1, shadows: false },
        ambient: { sky: "#606060", ground: "#606060", intensity: 0.8 },
        sky: { top: "#1a4dff", horizon: "#ff8019", sun: false },
    })
    useEffect(() => {
        if (!scene) return
        ;(globalThis as any).skyReflect = { show: (reflect: boolean) => show(scene, reflect) }
    }, [scene])
    return null
}

mount(<Reflect />)
