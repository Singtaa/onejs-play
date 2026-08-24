import { useEffect, useMemo, useRef, useState } from "react"
import {
    View, Text, mount, useFrame, useStage, useRoom, useLeaderboard, scores,
    input, random, Painter, batchedVisualContent,
} from "oj"
import {
    swim, canEat, grow, contain, scatterPellets, pelletsEaten, spawnPoint,
    POND_W, POND_H, START_SIZE, PELLET_SIZE, PELLET_AREA, PELLET_COUNT,
    type Fish, type Pellet,
} from "./ocean"

const TONES: [number, number, number][] = [
    [0.35, 0.72, 1.0], [1.0, 0.55, 0.30], [0.45, 0.86, 0.52],
    [0.94, 0.45, 0.62], [0.98, 0.82, 0.35], [0.66, 0.55, 0.98],
    [0.36, 0.88, 0.82], [0.96, 0.62, 0.86],
]
const toneOf = (id: number) => TONES[id % TONES.length]!

const PELLET_TONES: [number, number, number][] = [
    [0.55, 0.85, 1.0], [1.0, 0.78, 0.45], [0.60, 0.95, 0.66],
    [0.98, 0.62, 0.74], [0.85, 0.75, 1.0], [0.70, 0.98, 0.92],
]

const BROADCAST_HZ = 15

// A peer whose tab was closed without a clean disconnect.
const GONE_AFTER_MS = 8000

interface Peer extends Fish {
    vx: number
    vy: number
    lastSeen: number
}

function BigFish() {
    const stage = useStage()
    const host = useRef<any>(null)
    const rng = useRef(random()).current

    const me = useRef<Fish>({ ...spawnPoint(() => rng.next()), size: START_SIZE }).current
    const peers = useRef(new Map<number, Peer>()).current
    const food = useRef<Pellet[]>([]).current
    const peak = useRef(START_SIZE)
    const sinceBroadcast = useRef(0)
    const sinceTopUp = useRef(0)
    // The mouse reports (0, 0) until it is moved, and a fish that followed that
    // would sit in the top left corner before the player touched anything.
    const steered = useRef(false)
    const lastPointer = useRef({ x: 0, y: 0 })

    const [status, setStatus] = useState({ size: START_SIZE, players: 1, connected: false, best: START_SIZE })
    const board = useLeaderboard({ limit: 5 })
    const submit = useRef(board.submit)
    submit.current = board.submit

    const scatter = () => {
        food.length = 0
        for (const pellet of scatterPellets(PELLET_COUNT, () => rng.next())) food.push(pellet)
    }

    const room = useRoom("pond", {
        onOpen: (id, list) => {
            setStatus((s) => ({ ...s, connected: true, players: list.length + 1 }))
            if (room.isHost) scatter()
            else room.send({ k: "hello" })
        },
        onJoin: () => setStatus((s) => ({ ...s, players: peers.size + 1 })),
        onLeave: (id) => {
            peers.delete(id)
            setStatus((s) => ({ ...s, players: peers.size + 1 }))
        },
        onMessage: (from, raw) => {
            const data = raw as any
            if (data === null || typeof data !== "object") return

            if (data.k === "me") {
                const existing = peers.get(from)
                const now = Date.now()
                if (existing === undefined) {
                    peers.set(from, { x: data.x, y: data.y, size: data.s, vx: 0, vy: 0, lastSeen: now })
                } else {
                    const gap = Math.max(0.001, (now - existing.lastSeen) / 1000)
                    existing.vx = (data.x - existing.x) / gap
                    existing.vy = (data.y - existing.y) / gap
                    existing.x = data.x
                    existing.y = data.y
                    existing.size = data.s
                    existing.lastSeen = now
                }
                return
            }

            if (data.k === "hello") {
                if (room.isHost) room.send({ k: "field", p: food.map((f) => [Math.round(f.x), Math.round(f.y), f.tone, f.alive ? 1 : 0]) })
                return
            }

            if (data.k === "field" && Array.isArray(data.p)) {
                food.length = 0
                for (const [x, y, tone, alive] of data.p) {
                    food.push({ x, y, tone, alive: alive === 1 })
                }
                return
            }

            if (data.k === "ate" && Array.isArray(data.i)) {
                for (const index of data.i) {
                    const pellet = food[index]
                    if (pellet !== undefined) pellet.alive = false
                }
                return
            }

            if (data.k === "grew" && Array.isArray(data.p)) {
                for (const [index, x, y, tone] of data.p) {
                    const pellet = food[index]
                    if (pellet === undefined) continue
                    pellet.x = x
                    pellet.y = y
                    pellet.tone = tone
                    pellet.alive = true
                }
                return
            }

            if (data.k === "died") {
                const victim = peers.get(from)
                if (victim !== undefined) {
                    if (data.by === room.id) {
                        me.size = grow(me.size, victim.size * victim.size * 0.8)
                        peak.current = Math.max(peak.current, me.size)
                    }
                    victim.size = START_SIZE
                }
            }
        },
        onClose: () => setStatus((s) => ({ ...s, connected: false })),
    })

    const die = (toWhom: number) => {
        room.send({ k: "died", by: toWhom })
        if (scores.available && peak.current > START_SIZE + 2) submit.current(Math.round(peak.current))
        const where = spawnPoint(() => rng.next())
        me.x = where.x
        me.y = where.y
        me.size = START_SIZE
        peak.current = START_SIZE
    }

    useFrame((dt) => {
        const step = Math.min(dt, 1 / 20)

        // The pointer is in stage units and the pond is bigger than the stage, so
        // the aim goes through the same camera the drawing uses.
        const camera = cameraAt(me, stage.width, stage.height)
        let aimX = me.x
        let aimY = me.y
        let steering = false
        const mouse = input.mouse
        if (mouse.position.x !== lastPointer.current.x || mouse.position.y !== lastPointer.current.y) {
            lastPointer.current = { x: mouse.position.x, y: mouse.position.y }
            steered.current = true
        }
        if (steered.current) {
            aimX = mouse.position.x + camera.x
            aimY = mouse.position.y + camera.y
            steering = true
        }
        for (const touch of input.touches) {
            if (touch.phase === "ended" || touch.phase === "canceled") continue
            aimX = touch.position.x + camera.x
            aimY = touch.position.y + camera.y
            steering = true
        }
        if (steering) swim(me, aimX, aimY, step)

        // Peers coast along their last known heading between updates, which is what
        // turns fifteen messages a second into smooth motion. Damped, so one that
        // has gone quiet slows to a stop instead of leaving the pond.
        const now = Date.now()
        for (const [id, peer] of peers) {
            peer.x += peer.vx * step
            peer.y += peer.vy * step
            peer.vx *= 0.92
            peer.vy *= 0.92
            contain(peer)
            if (now - peer.lastSeen > GONE_AFTER_MS) peers.delete(id)
        }

        const swallowed = pelletsEaten(me, food)
        if (swallowed.length > 0) {
            for (const index of swallowed) food[index]!.alive = false
            me.size = grow(me.size, PELLET_AREA * swallowed.length)
            peak.current = Math.max(peak.current, me.size)
            room.send({ k: "ate", i: swallowed })
        }

        // Only ever your own death. A message that could kill somebody else would
        // let any client kill anybody, so the smaller fish reports being eaten
        // and the eater learns it grew from that report.
        for (const [id, peer] of peers) {
            if (canEat(peer, me)) {
                die(id)
                break
            }
        }

        if (room.isHost) {
            sinceTopUp.current -= step
            if (sinceTopUp.current <= 0) {
                sinceTopUp.current = 0.8
                const revived: number[][] = []
                for (let i = 0; i < food.length && revived.length < 8; i++) {
                    const pellet = food[i]!
                    if (pellet.alive) continue
                    const where = spawnPoint(() => rng.next())
                    pellet.x = where.x
                    pellet.y = where.y
                    pellet.tone = Math.floor(rng.next() * PELLET_TONES.length)
                    pellet.alive = true
                    revived.push([i, Math.round(pellet.x), Math.round(pellet.y), pellet.tone])
                }
                if (revived.length > 0) room.send({ k: "grew", p: revived })
            }
        }

        sinceBroadcast.current -= step
        if (sinceBroadcast.current <= 0) {
            sinceBroadcast.current = 1 / BROADCAST_HZ
            room.send({ k: "me", x: Math.round(me.x), y: Math.round(me.y), s: Math.round(me.size) })
        }

        host.current?.MarkDirtyRepaint()
    }, [stage.width, stage.height])

    useEffect(() => {
        const timer = setInterval(() => setStatus((s) => ({
            ...s,
            size: Math.round(me.size),
            best: Math.round(peak.current),
            players: peers.size + 1,
            connected: room.connected,
        })), 250)
        return () => clearInterval(timer)
    }, [])

    const paint = useMemo(() => batchedVisualContent((p: Painter) => {
        const camera = cameraAt(me, stage.width, stage.height)
        const onScreen = (x: number, y: number, r: number) =>
            x + r > camera.x && x - r < camera.x + stage.width &&
            y + r > camera.y && y - r < camera.y + stage.height

        p.fillColor(0.05, 0.09, 0.14, 1)
        p.beginPath()
        p.moveTo(0, 0)
        p.lineTo(stage.width, 0)
        p.lineTo(stage.width, stage.height)
        p.lineTo(0, stage.height)
        p.closePath()
        p.fill()

        p.strokeColor(0.16, 0.26, 0.36, 1)
        p.lineWidth(2)
        p.beginPath()
        p.moveTo(-camera.x, -camera.y)
        p.lineTo(POND_W - camera.x, -camera.y)
        p.lineTo(POND_W - camera.x, POND_H - camera.y)
        p.lineTo(-camera.x, POND_H - camera.y)
        p.closePath()
        p.stroke()

        for (const pellet of food) {
            if (!pellet.alive || !onScreen(pellet.x, pellet.y, PELLET_SIZE)) continue
            const tone = PELLET_TONES[pellet.tone % PELLET_TONES.length]!
            p.fillColor(tone[0], tone[1], tone[2], 0.9)
            p.beginPath()
            p.arc(pellet.x - camera.x, pellet.y - camera.y, PELLET_SIZE, 0, Math.PI * 2)
            p.fill()
        }

        for (const [id, peer] of peers) {
            if (!onScreen(peer.x, peer.y, peer.size)) continue
            drawFish(p, peer.x - camera.x, peer.y - camera.y, peer.size, toneOf(id), false)
        }
        drawFish(p, me.x - camera.x, me.y - camera.y, me.size, toneOf(room.id), true)
    }), [stage.width, stage.height])

    const ranking = [...peers.entries()]
        .map(([id, peer]) => ({ id, size: Math.round(peer.size), me: false }))
        .concat([{ id: room.id, size: status.size, me: true }])
        .sort((a, b) => b.size - a.size)
        .slice(0, 8)

    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "rgb(6, 12, 18)" }}>
            <View ref={host} onGenerateVisualContent={paint}
                style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

            <View style={{ position: "absolute", left: 20, top: 16 }} pickingMode="Ignore">
                <Text style={{ fontSize: 20, color: "rgba(226, 238, 250, 0.95)" }}>BIG FISH</Text>
                <Text style={{ fontSize: 11, marginTop: 2, color: "rgba(140, 170, 200, 0.8)" }}>
                    {status.connected
                        ? `${status.players} in the pond`
                        : "swimming alone, looking for the pond"}
                </Text>
                <Text style={{ fontSize: 11, marginTop: 1, color: "rgba(140, 170, 200, 0.6)" }}>
                    {`size ${status.size}, best this life ${status.best}`}
                </Text>
            </View>

            <View style={{
                position: "absolute", right: 18, top: 16, width: 150,
                backgroundColor: "rgba(8, 16, 24, 0.72)", borderRadius: 8, padding: 10,
            }} pickingMode="Ignore">
                <Text style={{ fontSize: 10, color: "rgba(150, 175, 205, 0.7)", marginBottom: 5 }}>IN THE POND</Text>
                {ranking.map((entry) => (
                    <View key={entry.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{
                            fontSize: 12,
                            color: entry.me ? "rgb(255, 214, 120)" : "rgba(206, 224, 244, 0.85)",
                        }}>
                            {entry.me ? "you" : `fish ${entry.id}`}
                        </Text>
                        <Text style={{ fontSize: 12, color: "rgba(160, 185, 215, 0.8)" }}>{String(entry.size)}</Text>
                    </View>
                ))}
            </View>

            {board.entries.length > 0 && (
                <View style={{
                    position: "absolute", right: 18, bottom: 16, width: 150,
                    backgroundColor: "rgba(8, 16, 24, 0.72)", borderRadius: 8, padding: 10,
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 10, color: "rgba(150, 175, 205, 0.7)", marginBottom: 5 }}>BIGGEST EVER</Text>
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
                Swim toward the pointer. Eat what is smaller than you.
            </Text>
        </View>
    )
}

function cameraAt(fish: Fish, viewW: number, viewH: number): { x: number; y: number } {
    return {
        x: Math.max(0, Math.min(POND_W - viewW, fish.x - viewW / 2)),
        y: Math.max(0, Math.min(POND_H - viewH, fish.y - viewH / 2)),
    }
}

function drawFish(
    p: Painter, x: number, y: number, size: number, tone: [number, number, number], mine: boolean,
): void {
    p.fillColor(tone[0] * 0.45, tone[1] * 0.45, tone[2] * 0.45, 0.92)
    p.beginPath()
    p.arc(x, y, size, 0, Math.PI * 2)
    p.fill()

    p.strokeColor(tone[0], tone[1], tone[2], mine ? 1 : 0.75)
    p.lineWidth(mine ? 3 : 2)
    p.beginPath()
    p.arc(x, y, size - 1, 0, Math.PI * 2)
    p.stroke()

    const eye = Math.max(2, size * 0.16)
    p.fillColor(0.95, 0.98, 1, 0.9)
    p.beginPath()
    p.arc(x + size * 0.32, y - size * 0.22, eye, 0, Math.PI * 2)
    p.fill()
}

mount(<BigFish />)
