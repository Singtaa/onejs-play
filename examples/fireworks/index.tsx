/**
 * Fireworks: tap the sky, or watch.
 *
 * The screen is React, drawn by Unity rather than by a browser, and the sparks
 * are not React at all. Every shell throws a few hundred particles, and asking
 * React to place a few thousand elements sixty times a second would be the
 * wrong tool by two orders of magnitude. Instead one particle system lives in
 * C#, and this file only ever tells it where to put a burst.
 *
 * That is the shape worth taking away: React draws what changes when a person
 * does something, and the particle system draws what changes every frame.
 *
 * WHY EIGHT EMITTERS
 *
 * An emitter is a recipe, not a place: the position comes with each burst. Six
 * of them are shells that differ only in colour, so a burst picks one and every
 * spark in that shell matches. A single emitter with a random palette would
 * give one multicoloured shell, which is confetti rather than a firework. The
 * last two are the trail behind a climbing shell and the bright flecks that go
 * with a burst.
 *
 * The sound is generated, not sampled: see Tools/gen-sfx.mjs. It ships in this
 * game's own assets folder and loads over the game's origin, which is what
 * assetUrl works out.
 */

import { useEffect, useRef, useState } from "react"
import {
    View, Text, mount, useFrame, useStage, useParticles, input, random, audio, assetUrl,
    type ParticlesHandle, type EmitterConfig, type Sound,
} from "oj"

import { aim, advance, wander, type Rocket } from "./flight"

/** The six shells, in emitter order. A burst picks one and stays with it. */
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

/**
 * One shell's recipe.
 *
 * The speed range is narrow on purpose. A wide one fills a disc, which reads as
 * a puff of smoke; a narrow one puts most sparks near the same distance from
 * the centre, which is the shell shape a firework actually makes. Drag then
 * stops them and gravity takes over, and that hand-off is the droop.
 */
function shellEmitter({ core, body }: { core: string; body: string }): EmitterConfig {
    return {
        rate: 0,
        angle: [0, 360],
        speed: [200, 290],
        lifetime: [1.1, 2.0],
        size: [5, 9],
        gravity: [0, 130],
        drag: 1.35,
        // Pure additive: overlapping sparks should build toward white the way
        // real ones do, rather than compositing over each other.
        additiveness: 1,
        colorOverLife: [core, body, `${body.slice(0, 7)}00`],
        sizeOverLife: [1, 0.9, 0],
    }
}

const EMITTERS: EmitterConfig[] = [
    ...SHELLS.map(shellEmitter),
    {
        // The trail, emitted a few particles at a time as a shell climbs.
        rate: 0,
        angle: [0, 360],
        speed: [0, 26],
        lifetime: [0.22, 0.5],
        size: [3, 5],
        gravity: [0, 40],
        additiveness: 1,
        colorOverLife: ["#fff0c0ff", "#ff8a1eff", "#ff6a0000"],
        sizeOverLife: [1, 0],
    },
    {
        // The flecks: brighter, faster, gone almost at once. They are what
        // makes the instant of a burst read as an event rather than a bloom.
        rate: 0,
        angle: [0, 360],
        speed: [120, 520],
        lifetime: [0.2, 0.45],
        size: [2, 4],
        gravity: [0, 60],
        drag: 3,
        additiveness: 1,
        colorOverLife: ["#ffffffff", "#ffe9b0ff", "#ffd08000"],
        sizeOverLife: [1, 0],
    },
]

/** Sparks in a burst, and how many more a heavy shell gets. */
const SHELL_SPARKS = 190
const HEAVY_SPARKS = 320

function Fireworks() {
    const stage = useStage()
    const host = useRef(null)
    const rng = useRef(random()).current
    const rockets = useRef<Rocket[]>([]).current
    const [launched, setLaunched] = useState(0)

    const fx = useParticles(host, {
        // Roomy: several shells can be in the air at once and each leaves a
        // tail behind it. Running out mid-burst truncates a shell visibly.
        max: 4000,
        emitters: EMITTERS,
    }, [])

    /**
     * The sounds, loaded once.
     *
     * Held in a ref rather than in state because nothing on screen depends on
     * whether they have arrived: the game is playable in silence and simply
     * becomes louder a moment later.
     */
    const sounds = useRef<{ launch?: Sound; pop?: Sound; crackle?: Sound }>({}).current
    useEffect(() => {
        let live = true
        const load = async (name: string) => {
            const sound = await audio.load(assetUrl(name))
            return live ? sound : (sound.unload(), undefined)
        }
        Promise.all([load("launch.wav"), load("pop.wav"), load("crackle.wav")]).then(
            ([launch, pop, crackle]) => {
                if (!live) return
                sounds.launch = launch
                sounds.pop = pop
                sounds.crackle = crackle
            },
            (error) => console.warn("[fireworks] no sound:", error),
        )
        return () => {
            live = false
            audio.stopAll()
        }
    }, [])

    /** Sends a shell at a point, with a colour and a size picked for it. */
    const launch = (targetX: number, targetY: number) => {
        // A shell leaves from under its target rather than from the middle, so
        // several at once do not all climb the same line.
        const fromX = targetX + rng.range(-stage.width * 0.08, stage.width * 0.08)
        const heavy = rng.bool(0.28)
        rockets.push(aim(fromX, stage.height + 12, targetX, targetY, rng.int(0, SHELLS.length), heavy))
        // Pitched down a little for a heavy shell, which is enough to make the
        // two read as different sizes without a second recording.
        sounds.launch?.play({ volume: 0.5, pitch: heavy ? 0.86 : 1 + rng.range(-0.06, 0.06) })
        setLaunched((n) => n + 1)
    }

    const burst = (rocket: Rocket, handle: ParticlesHandle) => {
        const count = rocket.heavy ? HEAVY_SPARKS : SHELL_SPARKS
        handle.burst({ x: rocket.x, y: rocket.y, count, emitter: rocket.shell })
        handle.burst({ x: rocket.x, y: rocket.y, count: Math.round(count / 5), emitter: SPARK })
        sounds.pop?.play({ volume: rocket.heavy ? 0.9 : 0.62, pitch: rocket.heavy ? 0.85 : 1.05 })
        if (rocket.heavy) sounds.crackle?.play({ volume: 0.45 })
    }

    /** When the next unattended shell goes up, in seconds from now. */
    const idle = useRef(1.2)

    useFrame((dt) => {
        const pointer = input.mouse
        if (pointer.wasLeftPressed) launch(pointer.position.x, pointer.position.y)
        for (const touch of input.touches) {
            if (touch.phase === "began") launch(touch.position.x, touch.position.y)
        }

        // Something is always happening, so an idle page is still worth
        // looking at. The gap is random, because a shell every two seconds
        // exactly reads as a machine rather than a display.
        idle.current -= dt
        if (idle.current <= 0) {
            idle.current = rng.range(0.7, 2.1)
            const where = wander(stage.width, stage.height, () => rng.next())
            launch(where.x, where.y)
        }

        // Backwards, so removing a shell does not skip the one after it.
        for (let i = rockets.length - 1; i >= 0; i--) {
            const rocket = rockets[i]!
            if (advance(rocket, dt)) {
                burst(rocket, fx)
                rockets.splice(i, 1)
                continue
            }
            fx.burst({ x: rocket.x, y: rocket.y, count: 2, emitter: TRAIL })
        }
    }, [stage.width, stage.height])

    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "rgb(8, 10, 16)" }}>
            {/* The particle system draws into this element, so it has to be the
                size of the sky rather than of whatever it happens to contain. */}
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
