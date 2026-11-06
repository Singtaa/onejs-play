import { useEffect, useMemo, useRef, useState } from "react"
import { View, Text, Button, mount, useFrame, useStage, useWorld2D, input, random, type Body2D } from "oj"
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

const WALL = 100

/**
 * The stage, and the one thing about a world that is not obvious.
 *
 * The walls are built from the stage's size once, when the world is made, so
 * a fluid cart that only resized would reflow visually while the simulation
 * kept the walls it was born with, and shapes would pile against an edge
 * nobody can see. Keying on the size is what makes a resize reach the
 * simulation, at the honest cost of restarting the box. See /docs/stage.
 */
function DropEverything() {
    const stage = useStage()
    const width = Math.max(320, Math.round(stage.width))
    const height = Math.max(320, Math.round(stage.height))
    return <World key={`${width}x${height}`} width={width} height={height} />
}

function World({ width, height }: { width: number; height: number }) {
    const scenery = useMemo(() => sceneryFor(width, height), [width, height])
    const rng = useRef(random()).current
    const pool = useRef(new Pool(SHAPES)).current
    const sceneryElements = useRef<any[]>([]).current
    const shapeElements = useRef<any[]>([]).current
    /** A slot's body, made the first time its shape is dropped. */
    const shapes = useRef<(Body2D | null)[]>(SHAPE_CYCLE.map(() => null)).current
    const [dropped, setDropped] = useState(0)
    const [inverted, setInverted] = useState(false)
    const nextDrop = useRef(0)

    const world = useWorld2D()

    useEffect(() => {
        if (world === null) return
        // Four walls just outside the stage, then the ramps, which carry their elements.
        const edge = { friction: 0.5, bounce: 0.15 }
        world.box({ at: [width / 2, height + WALL / 2], size: [width + WALL * 2, WALL], ...edge })
        world.box({ at: [width / 2, -WALL / 2], size: [width + WALL * 2, WALL], ...edge })
        world.box({ at: [-WALL / 2, height / 2], size: [WALL, height], ...edge })
        world.box({ at: [width + WALL / 2, height / 2], size: [WALL, height], ...edge })
        scenery.forEach((piece, i) => {
            world.box({ at: [piece.x, piece.y], size: [piece.w, piece.h], rotation: piece.rotation, friction: 0.4, actor: sceneryElements[i] })
        })
    }, [world])

    const drop = (x: number, y: number) => {
        if (world === null) return
        const { body: slot } = pool.take()
        const shape = SHAPE_CYCLE[slot]!
        let body = shapes[slot]
        if (body === null || body === undefined) {
            const material = { at: [x, y] as [number, number], dynamic: true, friction: 0.35, bounce: 0.28, actor: shapeElements[slot] }
            body = shape.kind === "circle" ? world.circle({ ...material, radius: shape.size / 2 }) : world.box({ ...material, size: [shape.size, shape.size] })
            shapes[slot] = body
        } else {
            // The oldest shape, recycled: back to the top, as if dropped anew.
            body.position = [x, y]
            body.rotation = 0
        }
        body.velocity = [rng.range(-60, 60), 0]
        const element = shapeElements[slot]
        if (element) element.style.opacity = 1
        setDropped(pool.inUse)
    }

    const clear = () => {
        for (const slot of pool.clear()) {
            shapes[slot]?.destroy()
            shapes[slot] = null
            const element = shapeElements[slot]
            if (element) element.style.opacity = 0
        }
        setDropped(0)
    }

    const flip = () => {
        if (world === null) return
        const next = !inverted
        setInverted(next)
        world.gravity = [0, next ? -980 : 980]
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
            <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
                {scenery.map((piece, i) => (
                    <View
                        key={`scenery-${i}`}
                        ref={(el: any) => { sceneryElements[i] = el }}
                        style={{
                            position: "absolute", width: piece.w, height: piece.h,
                            backgroundColor: "rgb(58, 66, 82)", borderRadius: 4,
                        }}
                    />
                ))}

                {SHAPE_CYCLE.map((shape, slot) => (
                    <View
                        key={`shape-${slot}`}
                        ref={(el: any) => { shapeElements[slot] = el }}
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
