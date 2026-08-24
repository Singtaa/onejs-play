import { useMemo, useRef, useState } from "react"
import {
    View, Text, mount, useFrame, input, random, Painter, batchedVisualContent,
    useLeaderboard, scores,
} from "oj"
import {
    wrap, shortest, touching, shatter, outlineFor, edgeSpawn, SIZES, VALUES, sizeOf,
    type Rock, type Field,
} from "./space"

const FIELD: Field = { width: 900, height: 600 }

const TURN = 3.4
const THRUST = 280
const DRAG = 0.55
const MAX_SPEED = 430
const SHOT_SPEED = 540
const SHOT_LIFE = 1.05
const RELOAD = 0.17
const MAX_SHOTS = 5
const SHIP_RADIUS = 11
const RESPAWN_PAUSE = 1.1
const MERCY = 2.2

interface Shot { x: number; y: number; vx: number; vy: number; life: number }

interface World {
    ship: { x: number; y: number; vx: number; vy: number; angle: number; thrusting: boolean }
    rocks: Rock[]
    shots: Shot[]
    debris: { x: number; y: number; vx: number; vy: number; life: number }[]
    reload: number
    respawnIn: number
    mercy: number
    lives: number
    score: number
    wave: number
    over: boolean
}

function newWorld(rng: { next(): number }): World {
    const world: World = {
        ship: { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2, thrusting: false },
        rocks: [], shots: [], debris: [],
        reload: 0, respawnIn: 0, mercy: MERCY, lives: 3, score: 0, wave: 0, over: false,
    }
    startWave(world, rng)
    return world
}

function startWave(world: World, rng: { next(): number }): void {
    world.wave++
    const count = Math.min(3 + world.wave, 11)
    for (let i = 0; i < count; i++) {
        const at = edgeSpawn(FIELD, () => rng.next())
        const angle = rng.next() * Math.PI * 2
        const speed = 26 + rng.next() * 34 + world.wave * 3
        world.rocks.push({
            x: at.x, y: at.y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            radius: SIZES[0]!,
            angle: rng.next() * Math.PI * 2,
            spin: (rng.next() - 0.5) * 1.1,
            outline: outlineFor(9 + Math.floor(rng.next() * 4), () => rng.next()),
        })
    }
}

function scatter(world: World, x: number, y: number, count: number, rng: { next(): number }): void {
    for (let i = 0; i < count; i++) {
        const angle = rng.next() * Math.PI * 2
        const speed = 40 + rng.next() * 180
        world.debris.push({
            x, y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 0.3 + rng.next() * 0.5,
        })
    }
}

function SpaceJunk() {
    const rng = useRef(random()).current
    const host = useRef<any>(null)
    const world = useRef<World>(newWorld(rng)).current
    const [hud, setHud] = useState({ score: 0, lives: 3, wave: 1, over: false })

    const board = useLeaderboard({ limit: 6 })
    const submitted = useRef(false)
    const submit = useRef(board.submit)
    submit.current = board.submit

    // Anything straddling an edge is in two places at once, and in four at a corner.
    const wrapped = (x: number, y: number, radius: number, draw: (x: number, y: number) => void) => {
        const xs = [x]
        const ys = [y]
        if (x < radius) xs.push(x + FIELD.width)
        if (x > FIELD.width - radius) xs.push(x - FIELD.width)
        if (y < radius) ys.push(y + FIELD.height)
        if (y > FIELD.height - radius) ys.push(y - FIELD.height)
        for (const px of xs) for (const py of ys) draw(px, py)
    }

    const drawShip = (p: Painter, x: number, y: number, angle: number) => {
        const nose = 15
        const tail = 9
        const spread = 2.5
        const point = (dist: number, spin: number) => [
            x + Math.cos(angle + spin) * dist,
            y + Math.sin(angle + spin) * dist,
        ] as const
        const [ax, ay] = point(nose, 0)
        const [bx, by] = point(tail, spread)
        const [cx, cy] = point(6, Math.PI)
        const [dx, dy] = point(tail, -spread)

        p.beginPath()
        p.moveTo(ax, ay)
        p.lineTo(bx, by)
        p.lineTo(cx, cy)
        p.lineTo(dx, dy)
        p.closePath()
        p.stroke()

        if (world.ship.thrusting) {
            // Random on purpose: the flame flickers so held thrust does not look frozen.
            const reach = 8 + rng.next() * 9
            const [fx, fy] = point(6 + reach, Math.PI)
            p.strokeColor(1, 0.62, 0.2, 0.95)
            p.beginPath()
            p.moveTo(bx * 0.35 + cx * 0.65, by * 0.35 + cy * 0.65)
            p.lineTo(fx, fy)
            p.lineTo(dx * 0.35 + cx * 0.65, dy * 0.35 + cy * 0.65)
            p.stroke()
            p.strokeColor(0.87, 0.93, 1, 1)
        }
    }

    const drawRock = (p: Painter, rock: Rock, x: number, y: number) => {
        const points = rock.outline.length
        p.beginPath()
        for (let i = 0; i < points; i++) {
            const a = rock.angle + (i / points) * Math.PI * 2
            const r = rock.radius * rock.outline[i]!
            const px = x + Math.cos(a) * r
            const py = y + Math.sin(a) * r
            if (i === 0) p.moveTo(px, py)
            else p.lineTo(px, py)
        }
        p.closePath()
        p.stroke()
    }

    // Built once. A new delegate every render would churn a native callback slot.
    const paint = useMemo(() => batchedVisualContent((p: Painter) => {
        p.lineWidth(1.6)
        p.lineCap(Painter.LineCap.Round)
        p.lineJoin(Painter.LineJoin.Round)

        p.strokeColor(0.55, 0.62, 0.75, 1)
        for (const rock of world.rocks) {
            wrapped(rock.x, rock.y, rock.radius, (x, y) => drawRock(p, rock, x, y))
        }

        p.fillColor(1, 0.95, 0.72, 1)
        for (const shot of world.shots) {
            wrapped(shot.x, shot.y, 3, (x, y) => {
                p.beginPath()
                p.arc(x, y, 2.1, 0, Math.PI * 2)
                p.fill()
            })
        }

        for (const bit of world.debris) {
            p.fillColor(1, 0.85, 0.6, Math.min(1, bit.life * 2.4))
            p.beginPath()
            p.arc(wrap(bit.x, FIELD.width), wrap(bit.y, FIELD.height), 1.6, 0, Math.PI * 2)
            p.fill()
        }

        if (world.respawnIn <= 0 && !world.over) {
            const blink = world.mercy > 0 && Math.floor(world.mercy * 9) % 2 === 0
            p.strokeColor(0.87, 0.93, 1, blink ? 0.35 : 1)
            wrapped(world.ship.x, world.ship.y, 18, (x, y) => drawShip(p, x, y, world.ship.angle))
        }
    }), [])

    const fire = () => {
        if (world.reload > 0 || world.respawnIn > 0 || world.over) return
        if (world.shots.length >= MAX_SHOTS) return
        world.reload = RELOAD
        const { ship } = world
        world.shots.push({
            x: ship.x + Math.cos(ship.angle) * 15,
            y: ship.y + Math.sin(ship.angle) * 15,
            vx: ship.vx + Math.cos(ship.angle) * SHOT_SPEED,
            vy: ship.vy + Math.sin(ship.angle) * SHOT_SPEED,
            life: SHOT_LIFE,
        })
    }

    const restart = () => {
        const fresh = newWorld(rng)
        Object.assign(world, fresh)
        submitted.current = false
        setHud({ score: 0, lives: 3, wave: 1, over: false })
    }

    useFrame((dt) => {
        const keys = input.keyboard
        const { ship } = world

        if (world.over) {
            if (keys.wasKeyPressed("R") || input.touches.some((t) => t.phase === "began")) restart()
        }

        let turn = 0
        let thrusting = false
        if (keys.isKeyDown("LeftArrow") || keys.isKeyDown("A")) turn -= 1
        if (keys.isKeyDown("RightArrow") || keys.isKeyDown("D")) turn += 1
        if (keys.isKeyDown("UpArrow") || keys.isKeyDown("W")) thrusting = true
        if (keys.wasKeyPressed("Space")) fire()
        if (keys.wasKeyPressed("R")) restart()

        for (const touch of input.touches) {
            if (touch.phase === "began") fire()
            if (touch.phase === "ended" || touch.phase === "canceled") continue
            const want = Math.atan2(
                shortest(ship.y, touch.position.y, FIELD.height),
                shortest(ship.x, touch.position.x, FIELD.width),
            )
            // The short way round the circle, or the ship spins most of a turn
            // to reach a heading just behind it.
            let delta = want - ship.angle
            while (delta > Math.PI) delta -= Math.PI * 2
            while (delta < -Math.PI) delta += Math.PI * 2
            turn = Math.abs(delta) < TURN * dt ? 0 : Math.sign(delta)
            if (Math.abs(delta) < 0.5) thrusting = true
            if (turn === 0) ship.angle = want
        }

        world.reload = Math.max(0, world.reload - dt)
        world.mercy = Math.max(0, world.mercy - dt)

        if (world.respawnIn > 0) {
            world.respawnIn -= dt
            if (world.respawnIn <= 0) {
                ship.x = FIELD.width / 2
                ship.y = FIELD.height / 2
                ship.vx = 0
                ship.vy = 0
                ship.angle = -Math.PI / 2
                world.mercy = MERCY
            }
        } else if (!world.over) {
            ship.angle += turn * TURN * dt
            ship.thrusting = thrusting
            if (thrusting) {
                ship.vx += Math.cos(ship.angle) * THRUST * dt
                ship.vy += Math.sin(ship.angle) * THRUST * dt
            }
            // A fraction of speed per second, so the ship coasts to a stop
            // instead of reversing through zero.
            const shed = Math.max(0, 1 - DRAG * dt)
            ship.vx *= shed
            ship.vy *= shed
            const speed = Math.hypot(ship.vx, ship.vy)
            if (speed > MAX_SPEED) {
                ship.vx = (ship.vx / speed) * MAX_SPEED
                ship.vy = (ship.vy / speed) * MAX_SPEED
            }
            ship.x = wrap(ship.x + ship.vx * dt, FIELD.width)
            ship.y = wrap(ship.y + ship.vy * dt, FIELD.height)
        } else {
            ship.thrusting = false
        }

        for (const rock of world.rocks) {
            rock.x = wrap(rock.x + rock.vx * dt, FIELD.width)
            rock.y = wrap(rock.y + rock.vy * dt, FIELD.height)
            rock.angle += rock.spin * dt
        }

        for (let i = world.shots.length - 1; i >= 0; i--) {
            const shot = world.shots[i]!
            shot.life -= dt
            if (shot.life <= 0) {
                world.shots.splice(i, 1)
                continue
            }
            shot.x = wrap(shot.x + shot.vx * dt, FIELD.width)
            shot.y = wrap(shot.y + shot.vy * dt, FIELD.height)
        }

        for (let i = world.debris.length - 1; i >= 0; i--) {
            const bit = world.debris[i]!
            bit.life -= dt
            if (bit.life <= 0) {
                world.debris.splice(i, 1)
                continue
            }
            bit.x += bit.vx * dt
            bit.y += bit.vy * dt
        }

        let changed = false

        // Backwards through both, so a splice never skips the entry that
        // shuffled into the hole it left.
        for (let s = world.shots.length - 1; s >= 0; s--) {
            const shot = world.shots[s]!
            for (let r = world.rocks.length - 1; r >= 0; r--) {
                const rock = world.rocks[r]!
                if (!touching(FIELD, shot.x, shot.y, 2, rock.x, rock.y, rock.radius)) continue
                world.shots.splice(s, 1)
                world.rocks.splice(r, 1)
                world.rocks.push(...shatter(rock, () => rng.next()))
                scatter(world, rock.x, rock.y, 8 + Math.round(rock.radius / 4), rng)
                world.score += VALUES[sizeOf(rock.radius)] ?? 0
                changed = true
                break
            }
        }

        if (world.respawnIn <= 0 && world.mercy <= 0 && !world.over) {
            for (const rock of world.rocks) {
                if (!touching(FIELD, ship.x, ship.y, SHIP_RADIUS, rock.x, rock.y, rock.radius)) continue
                scatter(world, ship.x, ship.y, 26, rng)
                world.lives--
                world.respawnIn = RESPAWN_PAUSE
                world.over = world.lives <= 0
                changed = true
                break
            }
        }

        if (world.rocks.length === 0 && !world.over) {
            startWave(world, rng)
            changed = true
        }

        if (changed) {
            setHud({ score: world.score, lives: world.lives, wave: world.wave, over: world.over })
        }

        if (world.over && !submitted.current && scores.available && world.score > 0) {
            submitted.current = true
            submit.current(world.score)
        }
        host.current?.MarkDirtyRepaint()
    }, [])

    return (
        <View style={{ width: FIELD.width, height: FIELD.height, backgroundColor: "rgb(7, 9, 14)" }}>
            <View ref={host} onGenerateVisualContent={paint}
                style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

            <View style={{ position: "absolute", left: 18, top: 14, flexDirection: "row" }} pickingMode="Ignore">
                <Text style={{ fontSize: 22, color: "rgb(222, 232, 248)" }}>{String(hud.score)}</Text>
                <Text style={{ fontSize: 13, marginLeft: 18, marginTop: 6, color: "rgb(122, 138, 166)" }}>
                    {`WAVE ${hud.wave}`}
                </Text>
                <Text style={{ fontSize: 13, marginLeft: 14, marginTop: 6, color: "rgb(122, 138, 166)" }}>
                    {`SHIPS ${Math.max(0, hud.lives)}`}
                </Text>
            </View>

            <Text style={{ position: "absolute", left: 18, bottom: 12, fontSize: 11, color: "rgb(84, 96, 120)" }}
                pickingMode="Ignore">
                Arrows to fly, space to fire, R to restart. On a phone, hold to steer and tap to shoot.
            </Text>

            {hud.over && (
                <View style={{
                    position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: "rgba(7, 9, 14, 0.82)",
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 40, color: "rgb(226, 234, 247)" }}>Out of ships</Text>
                    <Text style={{ fontSize: 15, marginTop: 8, color: "rgb(150, 162, 184)" }}>
                        {`${hud.score} points, wave ${hud.wave}`}
                    </Text>
                    {board.entries.length > 0 && (
                        <View style={{ marginTop: 22, width: 220 }}>
                            <Text style={{ fontSize: 10, color: "rgb(110, 122, 146)", marginBottom: 5 }}>
                                BEST EVER
                            </Text>
                            {board.entries.map((entry, i) => (
                                <View key={`${entry.name}-${i}`}
                                    style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                    <Text style={{
                                        fontSize: 12,
                                        color: entry.score === hud.score ? "rgb(255, 214, 120)" : "rgb(176, 190, 214)",
                                    }}>
                                        {entry.name}
                                    </Text>
                                    <Text style={{ fontSize: 12, color: "rgb(140, 155, 180)" }}>
                                        {String(entry.score)}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}
                    <Text style={{ fontSize: 12, marginTop: 22, color: "rgb(122, 134, 156)" }}>
                        Press R, or tap, to go again
                    </Text>
                </View>
            )}
        </View>
    )
}

mount(<SpaceJunk />)
