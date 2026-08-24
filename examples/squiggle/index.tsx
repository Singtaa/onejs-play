import { useEffect, useMemo, useRef, useState } from "react"
import {
    View, Text, mount, useFrame, useStage, useRoom, useLeaderboard, scores,
    input, random, Painter, batchedVisualContent,
} from "oj"
import {
    makeSnake, steer, advance, resetTrail, radiusOf, grow, hitsBody,
    insideWorld, canBoost, boostDrain, scatterOrbs, orbsEaten, corpseOrbs, spawnPoint,
    WORLD_W, WORLD_H, SPEED, BOOST_SPEED, START_LENGTH, MAX_LENGTH, NODE_GAP,
    ORB_COUNT, ORB_SIZE, ORB_VALUE,
    type Snake, type Orb,
} from "./snake"

// The same in every copy, so every client lays the same orb field with
// nothing sent and nobody waiting.
const FIELD_SEED = 20260823

const BROADCAST_HZ = 15
const CATCHUP = 5
const RESPAWN_JUMP = 260
const SILENCE_MS = 8000
const MAX_CORPSE = 30

const TONES: [number, number, number][] = [
    [0.36, 0.78, 1.0], [1.0, 0.58, 0.33], [0.47, 0.88, 0.55],
    [0.95, 0.47, 0.64], [0.98, 0.84, 0.38], [0.68, 0.57, 0.99],
    [0.38, 0.90, 0.84], [0.97, 0.64, 0.88],
]
const toneOf = (id: number) => TONES[id % TONES.length]!

const ORB_TONES: [number, number, number][] = [
    [0.58, 0.87, 1.0], [1.0, 0.80, 0.47], [0.62, 0.96, 0.68],
    [0.99, 0.64, 0.76], [0.87, 0.77, 1.0], [0.72, 0.99, 0.94],
]

interface Peer extends Snake {
    boosting: boolean
    markX: number
    markY: number
    lastSeen: number
}

function Squiggle() {
    const stage = useStage()
    const host = useRef<any>(null)
    const rng = useRef(random()).current

    const field = useRef<{ home: Orb[]; orbs: Orb[] } | null>(null)
    if (field.current === null) {
        const source = random(FIELD_SEED)
        const home = scatterOrbs(ORB_COUNT, () => source.next())
        field.current = { home, orbs: home.map((orb) => ({ ...orb })) }
    }
    const { home, orbs } = field.current

    const origin = useRef<{ x: number; y: number; angle: number } | null>(null)
    if (origin.current === null) origin.current = spawnPoint(() => rng.next())
    const me = useRef<Snake>(makeSnake(origin.current.x, origin.current.y, origin.current.angle)).current
    const peers = useRef(new Map<number, Peer>()).current
    const peak = useRef(START_LENGTH)
    const kills = useRef(0)
    const sinceBroadcast = useRef(0)
    const gotField = useRef(false)
    const eaten = useRef<number[]>([]).current
    const sinceTopUp = useRef(0)
    const boosting = useRef(false)
    // The mouse reads (0, 0) until it is first moved, and a snake that followed
    // that would turn for the corner before the player touched anything.
    const pointerMoved = useRef(false)
    const lastPointer = useRef({ x: 0, y: 0 })

    const [status, setStatus] = useState({
        length: START_LENGTH, best: START_LENGTH, kills: 0, players: 1, connected: false,
        host: null as number | null, mine: false, dropped: null as string | null,
    })
    const board = useLeaderboard({ limit: 5 })
    const submit = useRef(board.submit)
    submit.current = board.submit

    const num = (value: unknown, fallback = 0): number =>
        typeof value === "number" && Number.isFinite(value) ? value : fallback

    const fieldDelta = (): number[][] => {
        const out: number[][] = []
        for (let i = 0; i < orbs.length; i++) {
            const now = orbs[i]!
            const seeded = home[i]!
            if (now.alive === seeded.alive && now.x === seeded.x && now.y === seeded.y) continue
            out.push([i, Math.round(now.x), Math.round(now.y), now.tone, now.alive ? 1 : 0])
        }
        return out
    }

    const placeOrb = (index: number, x: number, y: number, tone: number): void => {
        const orb = orbs[index]
        if (orb === undefined) return
        orb.x = x
        orb.y = y
        orb.tone = tone
        orb.alive = true
    }

    const room = useRoom("field", {
        onOpen: (id, list) => {
            setStatus((s) => ({ ...s, connected: true, players: list.length + 1 }))
            if (!room.isHost) room.send({ k: "hi" })
        },
        onJoin: () => setStatus((s) => ({ ...s, players: room.peers.length + 1 })),
        onLeave: (id) => {
            peers.delete(id)
            setStatus((s) => ({ ...s, players: room.peers.length + 1 }))
        },
        onMessage: (from, raw) => {
            const data = raw as any
            if (data === null || typeof data !== "object") return

            if (data.k === "m" && Array.isArray(data.p)) {
                if (Array.isArray(data.e)) {
                    for (const index of data.e) {
                        const orb = orbs[num(index, -1)]
                        if (orb !== undefined) orb.alive = false
                    }
                }
                const [x, y, degrees, length, boost] = data.p
                const angle = (num(degrees) * Math.PI) / 180
                const existing = peers.get(from)
                if (existing === undefined) {
                    const fresh = makeSnake(num(x), num(y), angle) as Peer
                    fresh.length = Math.min(MAX_LENGTH, Math.max(0, num(length, START_LENGTH)))
                    fresh.boosting = boost === 1
                    fresh.markX = fresh.x
                    fresh.markY = fresh.y
                    fresh.lastSeen = Date.now()
                    peers.set(from, fresh)
                    return
                }
                existing.angle = angle
                existing.length = Math.min(MAX_LENGTH, Math.max(0, num(length, START_LENGTH)))
                existing.boosting = boost === 1
                existing.markX = num(x, existing.x)
                existing.markY = num(y, existing.y)
                existing.lastSeen = Date.now()
                if (Math.hypot(existing.markX - existing.x, existing.markY - existing.y) > RESPAWN_JUMP) {
                    existing.x = existing.markX
                    existing.y = existing.markY
                    resetTrail(existing)
                }
                return
            }

            if (data.k === "hi") {
                if (room.isHost) room.send({ k: "f", d: fieldDelta() }, from)
                return
            }

            if (data.k === "f" && Array.isArray(data.d)) {
                gotField.current = true
                for (let i = 0; i < orbs.length; i++) {
                    const seeded = home[i]!
                    const orb = orbs[i]!
                    orb.x = seeded.x
                    orb.y = seeded.y
                    orb.tone = seeded.tone
                    orb.alive = seeded.alive
                }
                for (const entry of data.d) {
                    if (!Array.isArray(entry)) continue
                    const [index, x, y, tone, alive] = entry
                    const orb = orbs[num(index, -1)]
                    if (orb === undefined) continue
                    orb.x = num(x, orb.x)
                    orb.y = num(y, orb.y)
                    orb.tone = num(tone, orb.tone)
                    orb.alive = alive === 1
                }
                return
            }

            if (data.k === "g" && Array.isArray(data.o)) {
                for (const entry of data.o) {
                    if (!Array.isArray(entry)) continue
                    placeOrb(num(entry[0], -1), num(entry[1]), num(entry[2]), num(entry[3]))
                }
                return
            }

            if (data.k === "d") {
                if (num(data.by, -1) === room.id) {
                    kills.current++
                }
                const victim = peers.get(from)
                if (victim !== undefined) {
                    victim.length = START_LENGTH
                    resetTrail(victim)
                }
                if (Array.isArray(data.o)) {
                    for (const entry of data.o) {
                        if (!Array.isArray(entry)) continue
                        placeOrb(num(entry[0], -1), num(entry[1]), num(entry[2]), num(entry[3]))
                    }
                }
            }
        },
        onHost: (mine, id) => {
            setStatus((s) => ({ ...s, host: id, mine }))
            if (!mine && !gotField.current) room.send({ k: "hi" })
        },
        onDropped: (reason) => setStatus((s) => ({ ...s, dropped: reason })),
        onClose: () => setStatus((s) => ({ ...s, connected: false })),
    })

    const die = (toWhom: number) => {
        const wanted = Math.max(0, Math.min(MAX_CORPSE, Math.round((me.length - START_LENGTH) / 40)))
        const slots: number[] = []
        for (let i = 0; i < orbs.length && slots.length < wanted; i++) {
            if (!orbs[i]!.alive) slots.push(i)
        }
        const points = corpseOrbs(me, slots.length)
        const dropped: number[][] = []
        for (let i = 0; i < slots.length; i++) {
            const point = points[i]!
            const tone = Math.floor(rng.next() * ORB_TONES.length)
            placeOrb(slots[i]!, point.x, point.y, tone)
            dropped.push([slots[i]!, Math.round(point.x), Math.round(point.y), tone])
        }
        room.send({ k: "d", by: toWhom, o: dropped })

        if (scores.available && peak.current > START_LENGTH + 40) {
            submit.current(Math.round(peak.current))
        }

        const where = spawnPoint(() => rng.next())
        me.x = where.x
        me.y = where.y
        me.angle = where.angle
        me.length = START_LENGTH
        peak.current = START_LENGTH
        resetTrail(me)
        sinceBroadcast.current = 0
    }

    useFrame((dt) => {
        const step = Math.min(dt, 1 / 20)
        const camera = cameraAt(me, stage.width, stage.height)

        const mouse = input.mouse
        if (mouse.position.x !== lastPointer.current.x || mouse.position.y !== lastPointer.current.y) {
            lastPointer.current = { x: mouse.position.x, y: mouse.position.y }
            pointerMoved.current = true
        }
        let aimX = pointerMoved.current ? mouse.position.x + camera.x : me.x
        let aimY = pointerMoved.current ? mouse.position.y + camera.y : me.y
        let aiming = pointerMoved.current
        let fingers = 0
        for (const touch of input.touches) {
            if (touch.phase === "ended" || touch.phase === "canceled") continue
            fingers++
            if (fingers === 1) {
                aimX = touch.position.x + camera.x
                aimY = touch.position.y + camera.y
                aiming = true
            }
        }
        if (aiming) me.angle = steer(me.angle, Math.atan2(aimY - me.y, aimX - me.x), step)

        const wants = input.mouse.leftButton || input.keyboard.isKeyDown("Space") || fingers >= 2
        boosting.current = wants && canBoost(me.length)
        if (boosting.current) me.length = boostDrain(me.length, step)

        advance(me, step, boosting.current)

        const now = Date.now()
        for (const [id, peer] of peers) {
            if (now - peer.lastSeen > SILENCE_MS) {
                peers.delete(id)
                continue
            }
            const pull = Math.min(1, step * CATCHUP)
            peer.x += (peer.markX - peer.x) * pull
            peer.y += (peer.markY - peer.y) * pull
            const drift = (peer.boosting ? BOOST_SPEED : SPEED) * step
            peer.markX += Math.cos(peer.angle) * drift
            peer.markY += Math.sin(peer.angle) * drift
            advance(peer, step, peer.boosting)
        }

        const radius = radiusOf(me.length)
        const swallowed = orbsEaten(me.x, me.y, radius, orbs)
        if (swallowed.length > 0) {
            for (const index of swallowed) {
                orbs[index]!.alive = false
                eaten.push(index)
            }
            me.length = grow(me.length, ORB_VALUE * swallowed.length)
            peak.current = Math.max(peak.current, me.length)
        }

        if (!insideWorld(me.x, me.y, radius)) {
            die(0)
        } else {
            for (const [id, peer] of peers) {
                if (hitsBody(me.x, me.y, radius, peer)) {
                    die(id)
                    break
                }
            }
        }

        if (room.isHost) {
            sinceTopUp.current -= step
            if (sinceTopUp.current <= 0) {
                sinceTopUp.current = 0.7
                const revived: number[][] = []
                for (let i = 0; i < orbs.length && revived.length < 6; i++) {
                    if (orbs[i]!.alive) continue
                    const seeded = home[i]!
                    placeOrb(i, seeded.x, seeded.y, seeded.tone)
                    revived.push([i, Math.round(seeded.x), Math.round(seeded.y), seeded.tone])
                }
                if (revived.length > 0) room.send({ k: "g", o: revived })
            }
        }

        sinceBroadcast.current -= step
        if (sinceBroadcast.current <= 0) {
            sinceBroadcast.current = 1 / BROADCAST_HZ
            room.send({
                k: "m",
                p: [
                    Math.round(me.x), Math.round(me.y),
                    Math.round((me.angle * 180) / Math.PI),
                    Math.round(me.length),
                    boosting.current ? 1 : 0,
                ],
                e: eaten.length > 0 ? eaten.slice() : undefined,
            })
            eaten.length = 0
        }

        host.current?.MarkDirtyRepaint()
    }, [stage.width, stage.height])

    useEffect(() => {
        const timer = setInterval(() => setStatus((s) => ({
            ...s,
            length: Math.round(me.length),
            best: Math.round(peak.current),
            kills: kills.current,
            players: room.peers.length + 1,
            connected: room.connected,
        })), 250)
        return () => clearInterval(timer)
    }, [])

    const paint = useMemo(() => batchedVisualContent((p: Painter) => {
        const camera = cameraAt(me, stage.width, stage.height)

        p.fillColor(0.045, 0.055, 0.075, 1)
        p.beginPath()
        p.moveTo(0, 0)
        p.lineTo(stage.width, 0)
        p.lineTo(stage.width, stage.height)
        p.lineTo(0, stage.height)
        p.closePath()
        p.fill()

        p.strokeColor(0.42, 0.18, 0.24, 1)
        p.lineWidth(3)
        p.beginPath()
        p.moveTo(-camera.x, -camera.y)
        p.lineTo(WORLD_W - camera.x, -camera.y)
        p.lineTo(WORLD_W - camera.x, WORLD_H - camera.y)
        p.lineTo(-camera.x, WORLD_H - camera.y)
        p.closePath()
        p.stroke()

        for (const orb of orbs) {
            if (!orb.alive) continue
            const x = orb.x - camera.x
            const y = orb.y - camera.y
            if (x < -ORB_SIZE || y < -ORB_SIZE || x > stage.width + ORB_SIZE || y > stage.height + ORB_SIZE) continue
            const tone = ORB_TONES[orb.tone % ORB_TONES.length]!
            p.fillColor(tone[0], tone[1], tone[2], 0.9)
            p.beginPath()
            p.arc(x, y, ORB_SIZE, 0, Math.PI * 2)
            p.fill()
        }

        for (const [id, peer] of peers) drawSnake(p, peer, camera, stage, toneOf(id), false, peer.boosting)
        drawSnake(p, me, camera, stage, toneOf(room.id), true, boosting.current)
    }), [stage.width, stage.height])

    const ranking = [...peers.entries()]
        .map(([id, peer]) => ({ id, length: Math.round(peer.length), me: false }))
        .concat([{ id: room.id, length: status.length, me: true }])
        .sort((a, b) => b.length - a.length)
        .slice(0, 8)

    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "rgb(8, 10, 14)" }}>
            <View ref={host} onGenerateVisualContent={paint}
                style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

            <View style={{ position: "absolute", left: 20, top: 16 }} pickingMode="Ignore">
                <Text style={{ fontSize: 20, color: "rgba(226, 238, 250, 0.95)" }}>SQUIGGLE</Text>
                <Text style={{ fontSize: 11, marginTop: 2, color: "rgba(140, 170, 200, 0.8)" }}>
                    {status.connected
                        ? `${status.players} on the field`
                        : "alone out here, looking for the field"}
                </Text>
                <Text style={{ fontSize: 11, marginTop: 1, color: "rgba(140, 170, 200, 0.6)" }}>
                    {`length ${status.length}, best this life ${status.best}, ${status.kills} run into you`}
                </Text>
                <Text style={{ fontSize: 10, marginTop: 3, color: "rgba(120, 150, 185, 0.5)" }}>
                    {status.mine
                        ? "the field is yours to keep stocked"
                        : status.host === null
                            ? "waiting for the field"
                            : `player ${status.host} keeps the field stocked`}
                </Text>
                {status.dropped !== null && (
                    <Text style={{ fontSize: 10, marginTop: 3, color: "rgb(240, 170, 90)" }}>
                        {`the room dropped a message (${status.dropped})`}
                    </Text>
                )}
            </View>

            <View style={{
                position: "absolute", right: 18, top: 16, width: 150,
                backgroundColor: "rgba(10, 14, 20, 0.72)", borderRadius: 8, padding: 10,
            }} pickingMode="Ignore">
                <Text style={{ fontSize: 10, color: "rgba(150, 175, 205, 0.7)", marginBottom: 5 }}>ON THE FIELD</Text>
                {ranking.map((entry) => (
                    <View key={entry.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{
                            fontSize: 12,
                            color: entry.me ? "rgb(255, 214, 120)" : "rgba(206, 224, 244, 0.85)",
                        }}>
                            {entry.me ? "you" : `player ${entry.id}`}
                        </Text>
                        <Text style={{ fontSize: 12, color: "rgba(160, 185, 215, 0.8)" }}>{String(entry.length)}</Text>
                    </View>
                ))}
            </View>

            {board.entries.length > 0 && (
                <View style={{
                    position: "absolute", right: 18, bottom: 16, width: 150,
                    backgroundColor: "rgba(10, 14, 20, 0.72)", borderRadius: 8, padding: 10,
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 10, color: "rgba(150, 175, 205, 0.7)", marginBottom: 5 }}>LONGEST EVER</Text>
                    {board.entries.map((entry, i) => (
                        <View key={`${entry.name}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ fontSize: 12, color: "rgba(206, 224, 244, 0.85)" }}>{entry.name}</Text>
                            <Text style={{ fontSize: 12, color: "rgba(160, 185, 215, 0.8)" }}>{String(entry.score)}</Text>
                        </View>
                    ))}
                </View>
            )}

            <Text style={{ position: "absolute", left: 20, bottom: 14, fontSize: 11, color: "rgba(110, 140, 170, 0.7)" }}
                pickingMode="Ignore">
                Steer with the pointer. Hold to go faster, at the cost of length.
                Cross somebody else's line and you are the one who dies.
            </Text>
        </View>
    )
}

function cameraAt(snake: Snake, viewW: number, viewH: number): { x: number; y: number } {
    return {
        x: Math.max(0, Math.min(WORLD_W - viewW, snake.x - viewW / 2)),
        y: Math.max(0, Math.min(WORLD_H - viewH, snake.y - viewH / 2)),
    }
}

function drawSnake(
    p: Painter, snake: Snake, camera: { x: number; y: number },
    view: { width: number; height: number }, tone: [number, number, number],
    mine: boolean, boosting: boolean,
): void {
    const radius = radiusOf(snake.length)
    const margin = radius + NODE_GAP * 8

    p.lineCap(Painter.LineCap.Round)
    p.lineJoin(Painter.LineJoin.Round)

    for (const pass of [0, 1] as const) {
        const width = pass === 0 ? radius * 2 + 3 : radius * 2
        if (pass === 0) p.strokeColor(0.03, 0.04, 0.06, 0.9)
        else if (boosting) p.strokeColor(Math.min(1, tone[0] + 0.25), Math.min(1, tone[1] + 0.25), Math.min(1, tone[2] + 0.25), 1)
        else p.strokeColor(tone[0] * 0.75, tone[1] * 0.75, tone[2] * 0.75, 1)
        p.lineWidth(width)

        let open = false
        let drawing = false
        for (let i = 0; i < snake.nodes.length; i++) {
            const node = snake.nodes[i]!
            const x = node.x - camera.x
            const y = node.y - camera.y
            if (x < -margin || y < -margin || x > view.width + margin || y > view.height + margin) {
                open = false
                continue
            }
            if (!open) {
                if (!drawing) { p.beginPath(); drawing = true }
                p.moveTo(x, y)
                open = true
            } else {
                p.lineTo(x, y)
            }
        }
        if (drawing) p.stroke()
    }

    const hx = snake.x - camera.x
    const hy = snake.y - camera.y
    if (hx < -margin || hy < -margin || hx > view.width + margin || hy > view.height + margin) return

    p.fillColor(tone[0], tone[1], tone[2], 1)
    p.beginPath()
    p.arc(hx, hy, radius + (mine ? 1.5 : 0.5), 0, Math.PI * 2)
    p.fill()

    const side = Math.max(1.6, radius * 0.34)
    const out = radius * 0.45
    const along = Math.cos(snake.angle)
    const across = Math.sin(snake.angle)
    p.fillColor(0.96, 0.99, 1, 0.95)
    // One path each: arc joins to the current point, so two in one path are
    // wired together by a line across the face.
    for (const turn of [1, -1] as const) {
        p.beginPath()
        p.arc(hx + along * out - across * out * turn, hy + across * out + along * out * turn,
            side, 0, Math.PI * 2)
        p.fill()
    }
}

mount(<Squiggle />)
