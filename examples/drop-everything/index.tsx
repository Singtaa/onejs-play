import { useEffect, useRef, useState } from "react"
import { View, Text, Button, mount, useFrame, usePhysics, input, random, type BodyConfig } from "oj"
import { Pool } from "./pool"

const WIDTH = 900
const HEIGHT = 600

const SHAPES = 90

// A held pointer at 144 frames a second would empty the pool in half a second.
const DROP_INTERVAL = 0.08

const TONES = [
    "rgb(122, 173, 255)", "rgb(255, 168, 108)", "rgb(126, 220, 168)",
    "rgb(232, 138, 196)", "rgb(246, 214, 120)", "rgb(160, 152, 246)",
]

interface Shape {
    kind: "circle" | "box"
    size: number
    tone: string
}

// A body's size is fixed when the world is built, so the variety is baked in
// here rather than chosen at the moment something is dropped.
const SHAPE_CYCLE: Shape[] = []
for (let i = 0; i < SHAPES; i++) {
    const kind = i % 3 === 0 ? "box" : "circle"
    const size = [16, 22, 28, 34][i % 4]!
    SHAPE_CYCLE.push({ kind, size, tone: TONES[i % TONES.length]! })
}

const SCENERY: { x: number; y: number; w: number; h: number; rotation: number }[] = [
    { x: 210, y: 300, w: 300, h: 16, rotation: 14 },
    { x: 660, y: 250, w: 260, h: 16, rotation: -18 },
    { x: 440, y: 452, w: 220, h: 16, rotation: 0 },
    { x: 120, y: 500, w: 150, h: 16, rotation: -26 },
    { x: 780, y: 470, w: 170, h: 16, rotation: 22 },
]

// Scenery first, so a scenery index is also a body index.
const BODIES: BodyConfig[] = [
    ...SCENERY.map((piece): BodyConfig => ({
        type: "static", shape: "box",
        size: [piece.w, piece.h], x: piece.x, y: piece.y, rotation: piece.rotation,
        friction: 0.4,
    })),
    ...SHAPE_CYCLE.map((shape): BodyConfig => ({
        type: "dynamic",
        shape: shape.kind,
        radius: shape.size / 2,
        size: [shape.size, shape.size],
        // Parked off screen: a disabled body still has a position, and one left
        // in the field would flash into view for a frame when it is switched on.
        x: -400, y: -400,
        density: 1, friction: 0.35, restitution: 0.28,
    })),
]

const shapeBody = (slot: number) => SCENERY.length + slot

function DropEverything() {
    const host = useRef<any>(null)
    const rng = useRef(random()).current
    const pool = useRef(new Pool(SHAPES)).current
    const elements = useRef<any[]>([]).current
    const [dropped, setDropped] = useState(0)
    const [inverted, setInverted] = useState(false)
    const nextDrop = useRef(0)

    const world = usePhysics(host, {
        gravity: [0, 980],
        bounds: true,
        boundsRestitution: 0.15,
        boundsFriction: 0.5,
        bodies: BODIES,
    })

    useEffect(() => {
        if (world === null) return
        for (let i = 0; i < elements.length; i++) {
            if (elements[i]) world.bind(i, elements[i])
        }
        for (let slot = 0; slot < SHAPES; slot++) world.setBodyEnabled(shapeBody(slot), false)
    }, [world])

    const drop = (x: number, y: number) => {
        if (world === null) return
        const { body: slot } = pool.take()

        // Enable first, then move. A position written to a body that is not
        // simulating is silently discarded.
        world.setBodyEnabled(shapeBody(slot), true)
        world.setPosition(shapeBody(slot), x, y)
        world.setVelocity(shapeBody(slot), rng.range(-60, 60), 0)
        const element = elements[shapeBody(slot)]
        if (element) element.style.opacity = 1
        setDropped(pool.inUse)
    }

    const clear = () => {
        if (world === null) return
        for (const slot of pool.clear()) {
            world.setBodyEnabled(shapeBody(slot), false)
            world.setPosition(shapeBody(slot), -400, -400)
            const element = elements[shapeBody(slot)]
            if (element) element.style.opacity = 0
        }
        setDropped(0)
    }

    const flip = () => {
        if (world === null) return
        const next = !inverted
        setInverted(next)
        world.setGravity(0, next ? -980 : 980)
    }

    useFrame((dt) => {
        nextDrop.current -= dt
        let holding: { x: number; y: number } | null = null
        if (input.mouse.leftButton) holding = { x: input.mouse.position.x, y: input.mouse.position.y }
        for (const touch of input.touches) {
            if (touch.phase === "ended" || touch.phase === "canceled") continue
            holding = { x: touch.position.x, y: touch.position.y }
        }
        if (holding !== null && nextDrop.current <= 0) {
            nextDrop.current = DROP_INTERVAL
            drop(holding.x, holding.y)
        }
    }, [world])

    return (
        <View style={{ width: WIDTH, height: HEIGHT, backgroundColor: "rgb(16, 19, 26)" }}>
            <View ref={host} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
                {SCENERY.map((piece, i) => (
                    <View
                        key={`scenery-${i}`}
                        ref={(el: any) => { elements[i] = el }}
                        style={{
                            position: "absolute", width: piece.w, height: piece.h,
                            backgroundColor: "rgb(58, 66, 82)", borderRadius: 4,
                        }}
                    />
                ))}

                {SHAPE_CYCLE.map((shape, slot) => (
                    <View
                        key={`shape-${slot}`}
                        ref={(el: any) => { elements[shapeBody(slot)] = el }}
                        pickingMode="Ignore"
                        style={{
                            position: "absolute", width: shape.size, height: shape.size,
                            backgroundColor: shape.tone,
                            borderRadius: shape.kind === "circle" ? shape.size / 2 : 5,
                            opacity: 0,
                        }}
                    />
                ))}
            </View>

            <View style={{ position: "absolute", left: 24, top: 20 }} pickingMode="Ignore">
                <Text style={{ fontSize: 21, color: "rgb(226, 234, 247)" }}>DROP EVERYTHING</Text>
                <Text style={{ fontSize: 11, marginTop: 3, color: "rgb(122, 134, 156)" }}>
                    {`Hold anywhere to pour shapes in. ${dropped} of ${SHAPES} in play.`}
                </Text>
            </View>

            <View style={{ position: "absolute", right: 24, top: 20, flexDirection: "row" }}>
                <Button text={inverted ? "Gravity down" : "Gravity up"} onClick={flip} style={{ marginRight: 8 }} />
                <Button text="Clear" onClick={clear} />
            </View>
        </View>
    )
}

mount(<DropEverything />)
