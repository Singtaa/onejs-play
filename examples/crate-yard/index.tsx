import { useEffect, useRef, useState } from "react"
import { mount, useScene, useModel, useWorld, useFrame, useStick, Stick, input, Text, View, type Body, type Vec3 } from "oj"
import { CRATE, RAMP, STACKS, START, YARD, chase, crateSpots, knocked, overturned, readDrive, setUpright } from "./yard"

/** Seconds a car lies on its roof or side before it is set back on its wheels. */
const RIGHTING = 1.5

/**
 * A car in a walled yard of stacked crates, with a ramp. W A S D or the
 * arrows drive and Space brakes; a gamepad's triggers and left stick do the
 * same, and on a phone the stick on the left steers and drives. R, or the
 * gamepad's top button, sets the car back on its wheels.
 */
function CrateYard() {
    const scene = useScene({ camera: { position: [0, 5, -38], lookAt: START }, fog: { near: 30, far: 90 } })
    const models = {
        crate: useModel("crate.glb"),
        ground: useModel("ground.glb"),
        wall: useModel("wall.glb"),
        ramp: useModel("ramp.glb"),
        car: useModel("car.glb"),
        wheel: useModel("wheel.glb"),
    }
    const world = useWorld()
    const stick = useStick("left")
    const yard = useRef<{ car: ReturnType<NonNullable<typeof world>["car"]>, crates: { body: Body, from: Vec3 }[] } | null>(null)
    const camera = useRef<Vec3>([0, 5, -38])
    const lying = useRef(0)
    const [hud, setHud] = useState({ kmh: 0, knocked: 0, crates: 0 })

    const loaded = Object.values(models).every((m) => m !== null)
    useEffect(() => {
        if (!scene || !world || !loaded) return
        const m = models as { [K in keyof typeof models]: NonNullable<(typeof models)[K]> }
        world.box({ at: [0, -0.5, 0], size: [YARD, 1, YARD], actor: scene.spawn(m.ground) })
        for (const side of [-1, 1]) {
            world.box({ at: [0, 1, (side * YARD) / 2], size: [YARD, 2, 1], actor: scene.spawn(m.wall) })
            world.box({ at: [(side * YARD) / 2, 1, 0], size: [YARD, 2, 1], rotation: { yaw: 90 }, actor: scene.spawn(m.wall, { yaw: 90 }) })
        }
        world.box({ at: RAMP.at, size: RAMP.size, rotation: { pitch: RAMP.pitch }, actor: scene.spawn(m.ramp, { rotation: { pitch: RAMP.pitch } }) })
        const crates = STACKS.flatMap(crateSpots).map((at) => ({
            from: at,
            body: world.box({ at, size: [CRATE, CRATE, CRATE], dynamic: true, mass: 40, actor: scene.spawn(m.crate, { scale: CRATE }) }),
        }))
        const wheel = () => scene.spawn(m.wheel)
        const car = world.car({ at: START, actor: scene.spawn(m.car), wheels: [wheel(), wheel(), wheel(), wheel()] })
        yard.current = { car, crates }
        return () => {
            car.destroy()
            yard.current = null
        }
        // The models are loaded once and never change after.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scene, world, loaded])

    const hudDue = useRef(0)
    useFrame((dt) => {
        const y = yard.current
        if (!scene || y === null) return
        const pad = input.gamepad
        const drive = readDrive({
            key: (name) => input.keyboard.isKeyDown(name),
            pad: pad ? { stickX: pad.leftStick.x, rightTrigger: pad.rightTrigger, leftTrigger: pad.leftTrigger, south: pad.buttonSouth } : null,
            stick,
        })
        y.car.drive(drive.throttle, drive.steer, drive.brake)

        // On its roof or side, it is set back on its wheels after a moment,
        // or at once when asked.
        const body = y.car.body
        lying.current = overturned(body.rotation) ? lying.current + dt : 0
        if (lying.current > RIGHTING || input.keyboard.wasKeyPressed("R") || pad?.wasButtonPressed("north")) {
            setUpright(body)
            lying.current = 0
        }

        follow(y, dt)

        hudDue.current -= dt
        if (hudDue.current <= 0) {
            hudDue.current = 0.1
            setHud({
                kmh: Math.round(Math.abs(y.car.speed) * 3.6),
                knocked: y.crates.filter((c) => knocked(c.from, c.body.position)).length,
                crates: y.crates.length,
            })
        }
    }, [scene, stick])

    /**
     * The camera, from where the chassis is drawn. A cart's frame runs before
     * the step, so this is the frame before's drawing, a frame's travel
     * behind at speed. The world places the wheels itself, on the chassis.
     */
    function follow(y: NonNullable<typeof yard.current>, dt: number) {
        const drawn = y.car.body.actor?.position ?? y.car.body.position
        const view = chase(camera.current, drawn, y.car.body.rotation.yaw, dt)
        camera.current = view.position
        scene!.camera({ position: view.position, lookAt: view.lookAt })
    }

    const dim = "rgb(170, 180, 195)"
    return (
        <View style={{ width: "100%", height: "100%" }}>
            <View style={{ padding: 16 }}>
                <Text style={{ color: "white", fontSize: 28 }}>{`${hud.kmh} km/h`}</Text>
                <Text style={{ color: "white", fontSize: 16, marginTop: 4 }}>{`${hud.knocked} of ${hud.crates} crates knocked`}</Text>
                <Text style={{ color: dim, fontSize: 13, marginTop: 8 }}>W A S D or arrows, Space brakes, R rights the car</Text>
            </View>
            <Stick stick={stick} />
        </View>
    )
}

mount(<CrateYard />)
