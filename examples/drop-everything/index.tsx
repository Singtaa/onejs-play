import { useEffect, useMemo, useRef, useState } from "react"
import { View, Text, Button, mount, useFrame, useStage, usePhysics, input, random, type BodyConfig } from "oj"
import { Pool } from "./pool"

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

/**
 * The ramps, as FRACTIONS of the stage rather than in pixels.
 *
 * This was written as five absolute positions inside a 900 by 600 stage. The
 * stage is the window now, so pixels would put a ramp a third of the way
 * across on a phone and off the edge of nothing on a monitor. The thickness
 * stays 16: a ramp is a physical object, not a share of the screen.
 */
const SCENERY: { u: number; v: number; w: number; rotation: number }[] = [
    { u: 0.233, v: 0.500, w: 0.333, rotation: 14 },
    { u: 0.733, v: 0.417, w: 0.289, rotation: -18 },
    { u: 0.489, v: 0.753, w: 0.244, rotation: 0 },
    { u: 0.133, v: 0.833, w: 0.167, rotation: -26 },
    { u: 0.867, v: 0.783, w: 0.189, rotation: 22 },
]

const RAMP_THICKNESS = 16

/** The ramps in pixels, for a stage of this size. */
function sceneryFor(width: number, height: number) {
    return SCENERY.map((piece) => ({
        x: piece.u * width, y: piece.v * height,
        w: Math.round(piece.w * width), h: RAMP_THICKNESS,
        rotation: piece.rotation,
    }))
}

/** Scenery first, so a scenery index is also a body index. */
function bodiesFor(width: number, height: number): BodyConfig[] {
    return [
        ...sceneryFor(width, height).map((piece): BodyConfig => ({
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
}


/**
 * The stage, and the one thing about a world that is not obvious.
 *
 * usePhysics builds its walls from the host element ONCE, on mount, and never
 * rebuilds them: physics state lives in C# and a re-render must not throw it
 * away. So a fluid sketch that only resized its host would reflow visually
 * while the simulation kept the walls it was born with, and shapes would pile
 * against an edge nobody can see. Keying on the size is what makes a resize
 * reach the simulation, at the honest cost of restarting the box. See
 * /docs/stage.
 */
function DropEverything() {
    const stage = useStage()
    const width = Math.max(320, Math.round(stage.width))
    const height = Math.max(320, Math.round(stage.height))
    return <World key={`${width}x${height}`} width={width} height={height} />
}

function World({ width, height }: { width: number; height: number }) {
    const scenery = useMemo(() => sceneryFor(width, height), [width, height])
    const bodies = useMemo(() => bodiesFor(width, height), [width, height])
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
        bodies: bodies,
    })

    // Scenery came first in the body list, so the shapes are the ones after it.
    const shapes = world === null ? [] : world.bodies.slice(scenery.length)

    useEffect(() => {
        if (world === null) return
        world.bodies.forEach((body, i) => { if (elements[i]) body.bind(elements[i]) })
        for (const shape of shapes) shape.enabled = false
    }, [world])

    const drop = (x: number, y: number) => {
        if (world === null) return
        const { body: slot } = pool.take()
        const shape = shapes[slot]!

        // Enable first, then move. A position written to a body that is not
        // simulating is silently discarded.
        shape.enabled = true
        shape.moveTo(x, y)
        shape.setVelocity(rng.range(-60, 60), 0)
        const element = elements[shape.index]
        if (element) element.style.opacity = 1
        setDropped(pool.inUse)
    }

    const clear = () => {
        if (world === null) return
        for (const slot of pool.clear()) {
            const shape = shapes[slot]!
            shape.enabled = false
            shape.moveTo(-400, -400)
            const element = elements[shape.index]
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
        <View style={{ width: "100%", height: "100%", backgroundColor: "rgb(16, 19, 26)" }}>
            <View ref={host} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
                {scenery.map((piece, i) => (
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
                        ref={(el: any) => { elements[scenery.length + slot] = el }}
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
