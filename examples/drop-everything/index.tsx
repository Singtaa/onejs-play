/**
 * Drop Everything: a box of shapes and a floor, and nothing to achieve.
 *
 * A real rigid body simulation runs this, in C#, over Unity's 2D physics. What
 * this file does is describe the world once and then get out of the way: the
 * bodies fall, collide and settle without JavaScript being involved in any
 * frame of it. The only per-frame work here is asking whether a finger is down.
 *
 * THE SHAPE OF THE CONSTRAINT
 *
 * A world is built with all of its bodies at once, because they are created in
 * C# when the world is. There is no "add a body" that does not mean throwing the
 * simulation away and starting over, which would drop everything already on
 * screen every time something new arrived.
 *
 * So the sandbox is bottomless without ever growing: every shape it will ever
 * have exists from the first frame, switched off. Dropping one switches it on
 * where the pointer is, and running out means the oldest one makes way. pool.ts
 * is the bookkeeping for that, and it is the only part with a test, because it
 * is the only part that is not the physics engine's job.
 */

import { useEffect, useRef, useState } from "react"
import { View, Text, Button, mount, useFrame, usePhysics, input, random, type BodyConfig } from "oj"
import { Pool } from "./pool"

const WIDTH = 900
const HEIGHT = 600

/** How many droppable shapes exist, ever. */
const SHAPES = 90

/** The palette a dropped shape is coloured from, chosen when it is made. */
const TONES = [
    "rgb(122, 173, 255)", "rgb(255, 168, 108)", "rgb(126, 220, 168)",
    "rgb(232, 138, 196)", "rgb(246, 214, 120)", "rgb(160, 152, 246)",
]

interface Shape {
    kind: "circle" | "box"
    size: number
    tone: string
}

/**
 * The pool's shapes, decided once.
 *
 * A body's size cannot change after the world is built, so variety has to be
 * baked in here rather than chosen at the moment something is dropped. Cycling
 * through a short list gives a mixed pile without any randomness at all, which
 * also means the sandbox looks the same to everyone the first time they open it.
 */
const SHAPE_CYCLE: Shape[] = []
for (let i = 0; i < SHAPES; i++) {
    const kind = i % 3 === 0 ? "box" : "circle"
    const size = [16, 22, 28, 34][i % 4]!
    SHAPE_CYCLE.push({ kind, size, tone: TONES[i % TONES.length]! })
}

/** Ramps and ledges for things to land on and roll off. */
const SCENERY: { x: number; y: number; w: number; h: number; rotation: number }[] = [
    { x: 210, y: 300, w: 300, h: 16, rotation: 14 },
    { x: 660, y: 250, w: 260, h: 16, rotation: -18 },
    { x: 440, y: 452, w: 220, h: 16, rotation: 0 },
    { x: 120, y: 500, w: 150, h: 16, rotation: -26 },
    { x: 780, y: 470, w: 170, h: 16, rotation: 22 },
]

/** Scenery first, so a scenery index is also a body index. */
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
        // Parked off the top. A disabled body still has a position, and one
        // left in the middle of the field would flash into view for a frame
        // when it is switched on and before it is moved.
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
    /** Set while a finger or button is held, so a drag leaves a stream. */
    const nextDrop = useRef(0)

    const world = usePhysics(host, {
        gravity: [0, 980],
        bounds: true,
        boundsRestitution: 0.15,
        boundsFriction: 0.5,
        bodies: BODIES,
    })

    // Bodies are bound after mount, when the refs have something in them. The
    // scenery elements are bound too, so a rotated ramp is drawn at the angle
    // the simulation actually gave it rather than the one written above.
    useEffect(() => {
        if (world === null) return
        for (let i = 0; i < elements.length; i++) {
            if (elements[i]) world.bind(i, elements[i])
        }
        for (let slot = 0; slot < SHAPES; slot++) world.setBodyEnabled(shapeBody(slot), false)
    }, [world])

    const drop = (x: number, y: number) => {
        if (world === null) return
        // The recycled body and the one handed out are the same body, so a
        // recycle needs no extra handling here: it is moved and re-thrown like
        // any other, and the shape simply reappears at the pointer.
        const { body: slot } = pool.take()

        world.setBodyEnabled(shapeBody(slot), true)
        world.setPosition(shapeBody(slot), x, y)
        // A little sideways drift, so a held finger produces a pile rather than
        // a single tower that topples the moment it is tall enough.
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
        // Rate limited rather than one per frame: a held pointer at 144 frames a
        // second would empty the whole pool in well under a second.
        if (holding !== null && nextDrop.current <= 0) {
            nextDrop.current = 0.08
            drop(holding.x, holding.y)
        }
    }, [world])

    return (
        <View style={{ width: WIDTH, height: HEIGHT, backgroundColor: "rgb(16, 19, 26)" }}>
            {/* The physics world is bounded by this element, so it is the field
                rather than a container: walls sit on its edges. */}
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
