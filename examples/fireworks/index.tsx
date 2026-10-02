import { useRef, useState } from "react"
import {
    View, Text, mount, useFrame, useStage, useParticles, useSound, input, random,
    type ParticlesHandle, type EmitterConfig,
} from "oj"

import { aim, advance, wander, type Rocket } from "./flight"

const SHELLS: { core: string; body: string }[] = [
    { core: "#fff4c8ff", body: "#ff9a20ff" },
    { core: "#ffd8ccff", body: "#ff3b30ff" },
    { core: "#dcffd4ff", body: "#34d058ff" },
    { core: "#d2e9ffff", body: "#3b82f6ff" },
    { core: "#f2d6ffff", body: "#a855f7ff" },
    { core: "#ffffffff", body: "#9fd8ffff" },
]

const TRAIL = SHELLS.length
const SPARK = SHELLS.length + 1

function shellEmitter({ core, body }: { core: string; body: string }): EmitterConfig {
    return {
        rate: 0,
        angle: [0, 360],
        speed: [200, 290],
        lifetime: [1.1, 2.0],
        size: [5, 9],
        gravity: [0, 130],
        drag: 1.35,
        glow: 1,
        colorOverLife: [core, body, `${body.slice(0, 7)}00`],
        sizeOverLife: [1, 0.9, 0],
    }
}

const trailEmitter: EmitterConfig = {
    rate: 0,
    angle: [0, 360],
    speed: [0, 26],
    lifetime: [0.22, 0.5],
    size: [3, 5],
    gravity: [0, 40],
    glow: 1,
    colorOverLife: ["#fff0c0ff", "#ff8a1eff", "#ff6a0000"],
    sizeOverLife: [1, 0],
}

const sparkEmitter: EmitterConfig = {
    rate: 0,
    angle: [0, 360],
    speed: [120, 520],
    lifetime: [0.2, 0.45],
    size: [2, 4],
    gravity: [0, 60],
    drag: 3,
    glow: 1,
    colorOverLife: ["#ffffffff", "#ffe9b0ff", "#ffd08000"],
    sizeOverLife: [1, 0],
}

const EMITTERS: EmitterConfig[] = [...SHELLS.map(shellEmitter), trailEmitter, sparkEmitter]

const SHELL_SPARKS = 190
const HEAVY_SPARKS = 320

function Fireworks() {
    const stage = useStage()
    const host = useRef(null)
    const rockets = useRef<Rocket[]>([]).current
    const [launched, setLaunched] = useState(0)

    const fx = useParticles(host, { max: 4000, emitters: EMITTERS }, [])

    // Each is null until its file arrives, so a rocket fired before then is silent.
    const launchSound = useSound("launch.wav")
    const popSound = useSound("pop.wav")
    const crackleSound = useSound("crackle.wav")

    const launch = (targetX: number, targetY: number) => {
        const fromX = targetX + random.range(-stage.width * 0.08, stage.width * 0.08)
        const heavy = random.bool(0.28)
        rockets.push(aim(fromX, stage.height + 12, targetX, targetY, random.int(0, SHELLS.length), heavy))
        launchSound?.play({ volume: 0.5, pitch: heavy ? 0.86 : 1 + random.range(-0.06, 0.06) })
        setLaunched((n) => n + 1)
    }

    const burst = (rocket: Rocket, handle: ParticlesHandle) => {
        const count = rocket.heavy ? HEAVY_SPARKS : SHELL_SPARKS
        handle.burst({ x: rocket.x, y: rocket.y, count, emitter: rocket.shell })
        handle.burst({ x: rocket.x, y: rocket.y, count: Math.round(count / 5), emitter: SPARK })
        popSound?.play({ volume: rocket.heavy ? 0.9 : 0.62, pitch: rocket.heavy ? 0.85 : 1.05 })
        if (rocket.heavy) crackleSound?.play({ volume: 0.45 })
    }

    const untilNextAuto = useRef(1.2)

    useFrame((dt) => {
        const pointer = input.mouse
        if (pointer.wasLeftPressed) launch(pointer.position.x, pointer.position.y)
        for (const touch of input.touches) {
            if (touch.phase === "began") launch(touch.position.x, touch.position.y)
        }

        untilNextAuto.current -= dt
        if (untilNextAuto.current <= 0) {
            untilNextAuto.current = random.range(0.7, 2.1)
            const where = wander(stage.width, stage.height, () => random.next())
            launch(where.x, where.y)
        }

        // Backwards, so removing a shell does not skip the one after it.
        for (let i = rockets.length - 1; i >= 0; i--) {
            const rocket = rockets[i]!
            const reachedApex = advance(rocket, dt)
            if (reachedApex) {
                burst(rocket, fx)
                rockets.splice(i, 1)
                continue
            }
            fx.burst({ x: rocket.x, y: rocket.y, count: 2, emitter: TRAIL })
        }
    }, [stage.width, stage.height])

    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "rgb(8, 10, 16)" }}>
            <View ref={host} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

            <View style={{ position: "absolute", left: 22, top: 18 }} pickingMode="Ignore">
                <Text style={{ fontSize: 20, color: "rgba(232, 237, 247, 0.92)" }}>Fireworks</Text>
                <Text style={{ fontSize: 12, marginTop: 2, color: "rgba(160, 172, 196, 0.75)" }}>
                    {launched === 0 ? "Tap the sky" : `${launched} launched`}
                </Text>
            </View>
        </View>
    )
}

mount(<Fireworks />)
