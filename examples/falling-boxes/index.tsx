import { useEffect, useRef, useState } from "react"
import { mount, useScene, useModel, useWorld, useFrame, input, random, Text, View, type Body } from "oj"

/** How many crates fall, and how many a second until they have. */
const CRATES = 60
const PER_SECOND = 6

/**
 * Crates rain onto a floor and pile up. Space, or a tap, throws every one of
 * them into the air. The world moves each crate's model from its body, so
 * nothing here places a model by hand.
 */
function FallingBoxes() {
    const scene = useScene({ camera: { position: [0, 8, -14], lookAt: [0, 1, 0] } })
    const crate = useModel("crate.glb")
    const floor = useModel("floor.glb")
    const world = useWorld()
    const crates = useRef<Body[]>([]).current
    const due = useRef(0)
    const [count, setCount] = useState(0)

    useEffect(() => {
        if (!scene || !floor || !world) return
        // The floor: static, the default. Its top is at y = 0.
        world.box({ at: [0, -0.5, 0], size: [12, 1, 12], actor: scene.spawn(floor) })
    }, [scene, floor, world])

    useFrame((dt) => {
        if (!scene || !crate || !world) return
        due.current += dt * PER_SECOND
        while (due.current >= 1 && crates.length < CRATES) {
            due.current -= 1
            crates.push(world.box({
                at: [random.range(-2.5, 2.5), 8, random.range(-2.5, 2.5)],
                rotation: { yaw: random.range(0, 90), pitch: random.range(-20, 20) },
                size: [0.5, 0.5, 0.5],
                dynamic: true,
                bounce: 0.2,
                actor: scene.spawn(crate, { scale: 0.5 }),
            }))
            setCount(crates.length)
        }
        // One that went over the edge falls in again from the top.
        for (const c of crates) {
            if (c.position[1] > -10) continue
            c.position = [random.range(-2.5, 2.5), 8, random.range(-2.5, 2.5)]
            c.velocity = [0, 0, 0]
        }
        let tapped = false
        for (const touch of input.touches) if (touch.phase === "began") tapped = true
        if (input.keyboard.wasKeyPressed("Space") || input.mouse.wasLeftPressed || tapped) {
            // A change of speed, whatever a crate weighs: 6 m/s up, and a little to one side.
            for (const c of crates) c.addVelocity([random.range(-1, 1), 6, random.range(-1, 1)])
        }
    }, [scene, crate, world])

    return (
        <View style={{ padding: 16 }}>
            <Text style={{ color: "white", fontSize: 18 }}>{`${count} crates`}</Text>
            <Text style={{ color: "rgb(170, 180, 195)", fontSize: 14, marginTop: 4 }}>Space or a tap throws them</Text>
        </View>
    )
}

mount(<FallingBoxes />)
