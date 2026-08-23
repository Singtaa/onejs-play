/**
 * Big Fish: swim, eat what is smaller, avoid what is not.
 *
 * The first game here that other people are in. Everything about how it is
 * built follows from one fact: the site passes messages between players and
 * knows nothing about what they mean. There is no server simulating the pond,
 * because a game on this site is a JavaScript bundle and half of it living on a
 * server would end that.
 *
 * WHO IS ALLOWED TO DECIDE WHAT
 *
 * Every client owns itself. It broadcasts where it is and how big; it decides
 * when it has been eaten. Nobody can kill anybody else, because a kill is not a
 * message anybody can send. The worst a liar can do is refuse to die, which
 * makes them strange to watch and harms no one else's game. The reasoning is in
 * ocean.ts, and it is worth reading before changing anything here.
 *
 * The pellets need one owner, or every client would scatter its own field and
 * nobody would agree where the food was. The lowest peer id present is the
 * host: a rule everyone can evaluate from the peer list alone, with no election
 * and no message. When the host leaves, the next lowest id becomes host on the
 * same frame, without anybody being told.
 *
 * WHAT IS SENT, AND HOW OFTEN
 *
 * Position goes out fifteen times a second, not sixty. Everything else is an
 * event: a mouthful of pellets, a death, a fresh pellet. Peers are drawn where
 * they are heading rather than where they last were, so fifteen updates a
 * second still looks smooth.
 */

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

/** Fish colours, picked from the peer id so everyone agrees who is who. */
const TONES: [number, number, number][] = [
    [0.35, 0.72, 1.0], [1.0, 0.55, 0.30], [0.45, 0.86, 0.52],
    [0.94, 0.45, 0.62], [0.98, 0.82, 0.35], [0.66, 0.55, 0.98],
    [0.36, 0.88, 0.82], [0.96, 0.62, 0.86],
]
const toneOf = (id: number) => TONES[id % TONES.length]!

/** Pellet colours, by the tone the host scattered them with. */
const PELLET_TONES: [number, number, number][] = [
    [0.55, 0.85, 1.0], [1.0, 0.78, 0.45], [0.60, 0.95, 0.66],
    [0.98, 0.62, 0.74], [0.85, 0.75, 1.0], [0.70, 0.98, 0.92],
]

/** Position updates a second. Everything else is an event. */
const BROADCAST_HZ = 15

interface Peer extends Fish {
    /** Where they are heading, so the gap between updates can be filled in. */
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
    /** The largest this life has been, which is what a run is worth. */
    const peak = useRef(START_SIZE)
    const sinceBroadcast = useRef(0)
    const sinceTopUp = useRef(0)
    /**
     * Whether a pointer has actually been used.
     *
     * The mouse reports (0, 0) until it moves, and a fish that followed that
     * would swim into the top left corner and sit there before the player had
     * touched anything.
     */
    const steered = useRef(false)
    const lastPointer = useRef({ x: 0, y: 0 })

    const [status, setStatus] = useState({ size: START_SIZE, players: 1, connected: false, best: START_SIZE })
    const board = useLeaderboard({ limit: 5 })
    const submit = useRef(board.submit)
    submit.current = board.submit

    /** Lays a fresh field. Only the host ever calls this. */
    const scatter = () => {
        food.length = 0
        for (const pellet of scatterPellets(PELLET_COUNT, () => rng.next())) food.push(pellet)
    }

    const room = useRoom("pond", {
        onOpen: (id, list) => {
            setStatus((s) => ({ ...s, connected: true, players: list.length + 1 }))
            // The room says who owns the food. Alone in the pond that is this
            // client, so it lays the field immediately rather than waiting for
            // a host that is never going to answer.
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
                    // The velocity is inferred from the gap between updates
                    // rather than sent, which halves the message and cannot
                    // disagree with the positions it was derived from.
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
                // Somebody arrived and wants the field. Only the host answers,
                // and the host is whoever has the lowest id in the room.
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
                // They are telling us they were eaten, and by whom. Believed
                // about themselves only: if they say we ate them, we grow.
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

    /** Ends a life: reports it, banks the score, and starts again. */
    const die = (toWhom: number) => {
        room.send({ k: "died", by: toWhom })
        // submit never rejects: it holds its own errors, because a leaderboard
        // that cannot be reached is a reason to show less, not to interrupt a
        // game that is still going.
        if (scores.available && peak.current > START_SIZE + 2) submit.current(Math.round(peak.current))
        const where = spawnPoint(() => rng.next())
        me.x = where.x
        me.y = where.y
        me.size = START_SIZE
        peak.current = START_SIZE
    }

    useFrame((dt) => {
        const step = Math.min(dt, 1 / 20)

        // Steering. The pointer is in stage units and the pond is bigger than
        // the stage, so it is converted through the same camera the drawing
        // uses; otherwise the fish swims toward a point on the screen rather
        // than a point in the water.
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
        // A finger overrides the mouse for as long as it is down, so a laptop
        // with a touchscreen does not fight itself.
        if (steering) swim(me, aimX, aimY, step)

        // Peers drift along their last known heading between updates, which is
        // what turns fifteen messages a second into smooth motion. Damped, so a
        // peer that has gone quiet coasts to a stop instead of leaving the pond.
        const now = Date.now()
        for (const [id, peer] of peers) {
            peer.x += peer.vx * step
            peer.y += peer.vy * step
            peer.vx *= 0.92
            peer.vy *= 0.92
            contain(peer)
            // Somebody whose tab was closed without a clean disconnect.
            if (now - peer.lastSeen > 8000) peers.delete(id)
        }

        // Pellets. Eating them is the only thing this client asserts about the
        // world beyond itself, and it is safe because a pellet belongs to
        // nobody.
        const swallowed = pelletsEaten(me, food)
        if (swallowed.length > 0) {
            for (const index of swallowed) food[index]!.alive = false
            me.size = grow(me.size, PELLET_AREA * swallowed.length)
            peak.current = Math.max(peak.current, me.size)
            room.send({ k: "ate", i: swallowed })
        }

        // Being eaten. Checked from this side only: see the header.
        for (const [id, peer] of peers) {
            if (canEat(peer, me)) {
                die(id)
                break
            }
        }

        // The host tops the field back up so the pond does not empty out. A
        // handful at a time and in one message, because a pond of two hundred
        // pellets refilled one per tick would never catch up with a busy game.
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

    // The panel changes a few times a second, not sixty, so it is the one part
    // that goes through React.
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

        // The water, and the edge of it, so a player can tell where the wall is.
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

            {/* Who is winning, right now, in this pond. */}
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

            {/* All time, across everybody who has ever played. */}
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

/**
 * The top left of the view, in pond coordinates.
 *
 * Centred on the fish and clamped to the pond, so the player never looks at
 * water that is not there. A pond smaller than the view (which cannot happen
 * today, but could if the pond were ever shrunk) pins to zero rather than going
 * negative.
 */
function cameraAt(fish: Fish, viewW: number, viewH: number): { x: number; y: number } {
    return {
        x: Math.max(0, Math.min(POND_W - viewW, fish.x - viewW / 2)),
        y: Math.max(0, Math.min(POND_H - viewH, fish.y - viewH / 2)),
    }
}

/** A fish: a filled body, a rim, and an eye that says which way it is facing. */
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

    // Scaled with the fish so a big one does not look like a small one that was
    // zoomed, which is exactly what a plain circle looks like.
    const eye = Math.max(2, size * 0.16)
    p.fillColor(0.95, 0.98, 1, 0.9)
    p.beginPath()
    p.arc(x + size * 0.32, y - size * 0.22, eye, 0, Math.PI * 2)
    p.fill()
}

mount(<BigFish />)
