import { useMemo, useRef, useState } from "react"
import { View, Text, mount, useFrame, useStage, input, random, Painter, batchedVisualContent } from "oj"
import { Grid, step, DEFAULTS, type Boid, type Predator } from "./flock"

const FLOCK = 280
const SCARE_RADIUS = 130
const SCARE_FORCE = 2600

const SLOW = [0.29, 0.42, 0.72] as const
const FAST = [0.93, 0.95, 1.0] as const

function Murmuration() {
    const stage = useStage()
    const host = useRef<any>(null)
    const rng = useRef(random()).current
    const boids = useRef<Boid[]>([]).current
    const grid = useRef(new Grid(stage.width, stage.height, DEFAULTS.range))
    const predator = useRef<Predator | null>(null)
    const [scattering, setScattering] = useState(false)

    if (boids.length === 0) {
        for (let i = 0; i < FLOCK; i++) {
            const angle = rng.next() * Math.PI * 2
            const speed = DEFAULTS.minSpeed + rng.next() * (DEFAULTS.maxSpeed - DEFAULTS.minSpeed)
            boids.push({
                x: rng.range(0, stage.width),
                y: rng.range(0, stage.height),
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
            })
        }
    }

    const paint = useMemo(() => batchedVisualContent((p: Painter) => {
        const span = DEFAULTS.maxSpeed - DEFAULTS.minSpeed
        for (const bird of boids) {
            const speed = Math.hypot(bird.vx, bird.vy)
            if (speed < 0.001) continue
            const heat = Math.min(1, Math.max(0, (speed - DEFAULTS.minSpeed) / span))
            p.fillColor(
                SLOW[0] + (FAST[0] - SLOW[0]) * heat,
                SLOW[1] + (FAST[1] - SLOW[1]) * heat,
                SLOW[2] + (FAST[2] - SLOW[2]) * heat,
                0.5 + heat * 0.45,
            )

            const ux = bird.vx / speed
            const uy = bird.vy / speed
            const px = -uy
            const py = ux
            const nose = 7.5
            const back = 3.4
            const flare = 2.6
            p.beginPath()
            p.moveTo(bird.x + ux * nose, bird.y + uy * nose)
            p.lineTo(bird.x - ux * back + px * flare, bird.y - uy * back + py * flare)
            p.lineTo(bird.x - ux * back * 0.35, bird.y - uy * back * 0.35)
            p.lineTo(bird.x - ux * back - px * flare, bird.y - uy * back - py * flare)
            p.closePath()
            p.fill()
        }
    }), [])

    useFrame((dt) => {
        if (grid.current.width !== stage.width || grid.current.height !== stage.height) {
            grid.current = new Grid(stage.width, stage.height, DEFAULTS.range)
        }

        let scare: Predator | null = null
        if (input.mouse.leftButton) {
            scare = { x: input.mouse.position.x, y: input.mouse.position.y, radius: SCARE_RADIUS, strength: SCARE_FORCE }
        }
        for (const touch of input.touches) {
            if (touch.phase === "ended" || touch.phase === "canceled") continue
            scare = { x: touch.position.x, y: touch.position.y, radius: SCARE_RADIUS, strength: SCARE_FORCE }
        }
        predator.current = scare
        if ((scare !== null) !== scattering) setScattering(scare !== null)

        // Clamped: one long frame at the real dt teleports the flock and unravels it.
        step(boids, grid.current, DEFAULTS, Math.min(dt, 1 / 30), scare)
        host.current?.MarkDirtyRepaint()
    }, [stage.width, stage.height, scattering])

    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "rgb(9, 12, 20)" }}>
            <View ref={host} onGenerateVisualContent={paint}
                style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

            <View style={{ position: "absolute", left: 22, top: 18 }} pickingMode="Ignore">
                <Text style={{ fontSize: 20, color: "rgba(226, 234, 247, 0.92)" }}>Murmuration</Text>
                <Text style={{ fontSize: 12, marginTop: 2, color: "rgba(150, 165, 195, 0.7)" }}>
                    {scattering ? "scattering" : `${FLOCK} birds, three rules`}
                </Text>
            </View>

            <Text style={{ position: "absolute", left: 22, bottom: 16, fontSize: 11, color: "rgba(110, 126, 158, 0.75)" }}
                pickingMode="Ignore">
                Hold anywhere to scatter them
            </Text>
        </View>
    )
}

mount(<Murmuration />)
