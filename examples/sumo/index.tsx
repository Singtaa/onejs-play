
import { useEffect, useMemo, useRef, useState } from "react"
import {
    View, Text, mount, useFrame, useRoom, usePhysics, input, isOnline,
    Painter, batchedVisualContent, type BodyConfig,
} from "oj"
import {
    platformRadius, isOff, spawnAt, steer, advance, leashVelocity, leashDelta,
    beginRound, applyFall, standing, isOver, winnerOf, credit,
    syncClock, Slots,
    ARENA_W, ARENA_H, CENTER_X, CENTER_Y, BLOB_RADIUS,
    THRUST, DRAG, DASH_SPEED, DASH_COOLDOWN, BOUNCE, SYNC_HZ, SNAP_DISTANCE,
    MAX_BLOBS, REST, SETTLE, type Round, type Track,
} from "./arena"

const TONES: [number, number, number][] = [
    [0.36, 0.72, 1.0], [1.0, 0.55, 0.30], [0.45, 0.86, 0.52],
    [0.94, 0.45, 0.62], [0.98, 0.82, 0.35], [0.66, 0.55, 0.98],
    [0.36, 0.88, 0.82], [0.96, 0.62, 0.86],
]
const toneOf = (id: number) => TONES[Math.abs(id) % TONES.length]!
const cssOf = (tone: [number, number, number], scale = 1) =>
    `rgb(${Math.round(tone[0] * 255 * scale)}, ${Math.round(tone[1] * 255 * scale)}, ${Math.round(tone[2] * 255 * scale)})`

const OFF_FIELD = -600

const BODIES: BodyConfig[] = []
for (let i = 0; i < MAX_BLOBS; i++) {
    BODIES.push({
        type: "dynamic",
        shape: "circle",
        radius: BLOB_RADIUS,
        x: OFF_FIELD,
        y: OFF_FIELD,
        friction: 0,
        restitution: BOUNCE,
        linearDamping: DRAG,
        angularDamping: 0.8,
    })
}

interface Snapshot {
    connected: boolean
    myId: number
    roundNumber: number
    playing: boolean
    iAmOut: boolean
    left: number
    inRoom: number
    dash: number
    winner: number | null
    resting: boolean
    dropped: string | null
    tally: Record<number, number>
    owners: (number | null)[]
    down: boolean[]
}

const EMPTY: Snapshot = {
    connected: false, myId: 0, roundNumber: 0, playing: false, iAmOut: false,
    left: 0, inRoom: 1, dash: 1, winner: null, resting: true, dropped: null, tally: {},
    owners: new Array(MAX_BLOBS).fill(null), down: new Array(MAX_BLOBS).fill(false),
}

function Sumo() {
    const field = useRef<any>(null)
    const canvas = useRef<any>(null)

    const slots = useRef(new Slots(MAX_BLOBS)).current
    const tracks = useRef(new Map<number, Track>()).current

    const round = useRef<Round | null>(null)
    const live = useRef(false)
    const elapsed = useRef(0)
    const rest = useRef(1.2)
    const overSince = useRef<number | null>(null)
    const nextRound = useRef(1)
    const winner = useRef<number | null>(null)
    const tally = useRef<Record<number, number>>({})

    const mine = useRef({ x: CENTER_X, y: CENTER_Y })
    const drawn = useRef(Number.NaN)
    const dropped = useRef<string | null>(null)
    const sinceSync = useRef(0)
    const sinceTick = useRef(0)
    const dashLeft = useRef(0)
    const fallen = useRef(false)

    const [snap, setSnap] = useState<Snapshot>(EMPTY)

    const world = usePhysics(field, {
        gravity: [0, 0],
        bounds: false,
        bodies: BODIES,
    })

    const blobs = useRef<any[]>([]).current

    const room = useRoom("ring", {
        onDropped: (reason, detail) => {
            dropped.current = `${reason}: ${detail}`
            console.warn(`[sumo] the relay dropped a message, ${reason}: ${detail}`)
            beat()
        },
        onOpen: () => {
            beat()
        },
        onLeave: (id) => {
            const slot = slots.release(id)
            tracks.delete(id)
            if (slot !== null && world !== null) {
                world.setPosition(slot, OFF_FIELD, OFF_FIELD)
                world.setBodyEnabled(slot, false)
            }
            beat()
        },
        onMessage: (from, raw) => {
            const data = raw as any
            if (data === null || typeof data !== "object") return

            if (data.k === "at") {
                const track = tracks.get(from)
                if (track === undefined) {
                    tracks.set(from, { x: data.x, y: data.y, vx: data.vx, vy: data.vy, sinceReport: 0 })
                } else {
                    track.x = data.x
                    track.y = data.y
                    track.vx = data.vx
                    track.vy = data.vy
                    track.sinceReport = 0
                }
                return
            }

            if (data.k === "out") {
                const current = round.current
                if (current === null) return
                round.current = applyFall(current, from, data)
                const slot = slots.slotOf(from)
                if (slot !== null && world !== null) world.setBodyEnabled(slot, false)
                return
            }

            if (from !== room.hostId) return

            if (data.k === "go" && Array.isArray(data.s)) {
                if (data.n < nextRound.current) return
                startRound(data.n, data.s)
                return
            }

            if (data.k === "tick") {
                const current = round.current
                if (current !== null && live.current && data.n === current.n) {
                    elapsed.current = syncClock(elapsed.current, data.t)
                } else {
                    elapsed.current = data.t
                    nextRound.current = data.n + 1
                }
            }
        },
    })

    const startRound = (n: number, starters: number[]) => {
        if (world === null) return
        round.current = beginRound(n, starters)
        live.current = true
        overSince.current = null
        nextRound.current = n + 1
        elapsed.current = 0
        winner.current = null
        fallen.current = false
        dashLeft.current = 0

        // Switch on before moving. A body that is not simulating drops the position.
        const place = (body: number, index: number) => {
            const at = spawnAt(index, starters.length)
            world.setBodyEnabled(body, true)
            world.setPosition(body, at.x, at.y)
            world.setVelocity(body, 0, 0)
            return at
        }

        const park = (body: number) => {
            world.setPosition(body, OFF_FIELD, OFF_FIELD)
            world.setBodyEnabled(body, false)
        }

        const seat = starters.indexOf(room.id)
        if (seat >= 0) {
            const at = place(0, seat)
            mine.current = { x: at.x, y: at.y }
        } else {
            park(0)
        }

        for (const peer of starters) {
            if (peer === room.id) continue
            const slot = slots.take(peer)
            if (slot === null) continue
            const at = place(slot, starters.indexOf(peer))
            tracks.set(peer, { x: at.x, y: at.y, vx: 0, vy: 0, sinceReport: 0 })
        }
        for (const [peer, slot] of slots.entries()) {
            if (starters.includes(peer)) continue
            park(slot)
        }
        beat()
    }

    const finishRound = () => {
        const current = round.current
        if (current === null) return
        winner.current = winnerOf(current)
        tally.current = credit(tally.current, winner.current)
        rest.current = REST
        live.current = false
        beat()
    }

    useFrame((dt) => {
        if (world === null) return
        const step = Math.min(dt, 1 / 20)

        if (live.current && round.current !== null) {
            elapsed.current += step
            if (isOver(round.current, elapsed.current)) {
                // Wait, so a fall already in flight lands before this is decided.
                if (overSince.current === null) overSince.current = elapsed.current
                if (elapsed.current - overSince.current >= SETTLE) finishRound()
            }
        }

        if (live.current && round.current !== null && room.isHost
            && !round.current.starters.includes(room.id)) {
            finishRound()
        }

        const current = live.current ? round.current : null
        const iAmIn = current !== null && current.starters.includes(room.id) && !fallen.current

        const knowsWhoItIs = room.connected || !isOnline()

        if (current === null && room.isHost && knowsWhoItIs) {
            rest.current -= step
            if (rest.current <= 0) {
                const starters = [room.id, ...room.peers].sort((a, b) => a - b)
                const n = nextRound.current
                room.send({ k: "go", n, s: starters })
                startRound(n, starters)
            }
        }

        const ring = platformRadius(elapsed.current)

        if (iAmIn) {
            const keys = input.keyboard.axis2D({
                up: ["W", "UpArrow"], down: ["S", "DownArrow"],
                left: ["A", "LeftArrow"], right: ["D", "RightArrow"],
            })
            let aimX = keys.x
            // Stage y counts down, so up on the keyboard is negative here.
            let aimY = -keys.y

            let pointing: { x: number; y: number } | null = null
            if (input.mouse.leftButton) pointing = { x: input.mouse.position.x, y: input.mouse.position.y }
            for (const touch of input.touches) {
                if (touch.phase === "ended" || touch.phase === "canceled") continue
                pointing = { x: touch.position.x, y: touch.position.y }
            }
            if (aimX === 0 && aimY === 0 && pointing !== null) {
                aimX = pointing.x - mine.current.x
                aimY = pointing.y - mine.current.y
            }

            const push = steer(aimX, aimY)
            if (push.x !== 0 || push.y !== 0) {
                world.impulse(0, push.x * THRUST * step, push.y * THRUST * step)
            }

            dashLeft.current = Math.max(0, dashLeft.current - step)
            let dashing = input.keyboard.wasKeyPressed("Space") || input.mouse.wasLeftPressed
            for (const touch of input.touches) if (touch.phase === "began") dashing = true
            if (dashing && dashLeft.current === 0 && (push.x !== 0 || push.y !== 0)) {
                world.impulse(0, push.x * DASH_SPEED, push.y * DASH_SPEED)
                dashLeft.current = DASH_COOLDOWN
            }
        }

        if (current !== null && room.isHost) {
            sinceTick.current -= step
            if (sinceTick.current <= 0) {
                sinceTick.current = 0.25
                room.send({ k: "tick", n: current.n, t: Math.round(elapsed.current * 100) / 100 })
            }
        }

        sinceSync.current -= step
        if (sinceSync.current <= 0) {
            const tick = 1 / SYNC_HZ
            sinceSync.current = tick
            const transforms = world.readTransforms()

            if (transforms.length >= MAX_BLOBS * 3) {
                if (iAmIn && current !== null) {
                    const x = transforms[0]!
                    const y = transforms[1]!
                    const vx = (x - mine.current.x) / tick
                    const vy = (y - mine.current.y) / tick
                    mine.current = { x, y }
                    room.send({
                        k: "at",
                        x: Math.round(x), y: Math.round(y),
                        vx: Math.round(vx), vy: Math.round(vy),
                    })
                    if (isOff(x, y, ring)) {
                        fallen.current = true
                        world.setBodyEnabled(0, false)
                        room.send({ k: "out", n: current.n })
                        round.current = applyFall(current, room.id, { n: current.n })
                        beat()
                    }
                }

                for (const [peer, slot] of slots.entries()) {
                    const track = tracks.get(peer)
                    if (track === undefined) continue
                    advance(track, tick)
                    if (track.sinceReport > 8) {
                        tracks.delete(peer)
                        slots.release(peer)
                        world.setPosition(slot, OFF_FIELD, OFF_FIELD)
                        world.setBodyEnabled(slot, false)
                        continue
                    }
                    const x = transforms[slot * 3]!
                    const y = transforms[slot * 3 + 1]!
                    if (leashDelta(x, y, track) > SNAP_DISTANCE) {
                        world.setPosition(slot, track.x, track.y)
                        world.setVelocity(slot, track.vx, track.vy)
                    } else {
                        const v = leashVelocity(x, y, track)
                        world.setVelocity(slot, v.x, v.y)
                    }
                }
            }
        }

        if (ring !== drawn.current) {
            drawn.current = ring
            canvas.current?.MarkDirtyRepaint()
        }
    }, [world])

    const beat = () => {
        const current = round.current
        const owners: (number | null)[] = new Array(MAX_BLOBS).fill(null)
        const down: boolean[] = new Array(MAX_BLOBS).fill(false)
        owners[0] = room.id
        down[0] = fallen.current || current === null || !current.starters.includes(room.id)
        for (const [peer, slot] of slots.entries()) {
            owners[slot] = peer
            down[slot] = current === null || !current.starters.includes(peer) || current.fallen.includes(peer)
        }
        setSnap({
            connected: room.connected,
            myId: room.id,
            roundNumber: current?.n ?? nextRound.current - 1,
            playing: live.current && current !== null && current.starters.includes(room.id) && !fallen.current,
            iAmOut: fallen.current,
            left: current === null ? 0 : standing(current).length,
            inRoom: room.peers.length + 1,
            dash: 1 - dashLeft.current / DASH_COOLDOWN,
            winner: winner.current,
            resting: !live.current,
            dropped: dropped.current,
            tally: tally.current,
            owners,
            down,
        })
    }

    useEffect(() => {
        if (world === null) return
        for (let slot = 0; slot < MAX_BLOBS; slot++) {
            if (blobs[slot]) world.bind(slot, blobs[slot])
            world.setPosition(slot, OFF_FIELD, OFF_FIELD)
            world.setBodyEnabled(slot, false)
        }
    }, [world])

    useEffect(() => {
        const timer = setInterval(beat, 250)
        return () => clearInterval(timer)
    }, [])

    const paint = useMemo(() => batchedVisualContent((p: Painter) => {
        const ring = platformRadius(elapsed.current)

        p.fillColor(0.035, 0.045, 0.065, 1)
        p.beginPath()
        p.moveTo(0, 0)
        p.lineTo(ARENA_W, 0)
        p.lineTo(ARENA_W, ARENA_H)
        p.lineTo(0, ARENA_H)
        p.closePath()
        p.fill()

        const soon = platformRadius(elapsed.current + 3)
        if (soon < ring - 1) {
            p.fillColor(0.42, 0.16, 0.20, 0.55)
            p.beginPath()
            p.arc(CENTER_X, CENTER_Y, ring, 0, Math.PI * 2)
            p.fill()
        }

        p.fillColor(0.10, 0.13, 0.18, 1)
        p.beginPath()
        p.arc(CENTER_X, CENTER_Y, soon < ring - 1 ? soon : ring, 0, Math.PI * 2)
        p.fill()

        p.strokeColor(0.36, 0.46, 0.60, 0.9)
        p.lineWidth(3)
        p.beginPath()
        p.arc(CENTER_X, CENTER_Y, ring, 0, Math.PI * 2)
        p.stroke()

        p.strokeColor(0.30, 0.38, 0.50, 0.22)
        p.lineWidth(1)
        for (const fraction of [0.66, 0.33]) {
            p.beginPath()
            p.arc(CENTER_X, CENTER_Y, ring * fraction, 0, Math.PI * 2)
            p.stroke()
        }
    }), [])

    const board = Object.entries(snap.tally)
        .map(([id, wins]) => ({ id: Number(id), wins }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 6)

    const status = () => {
        if (snap.resting) {
            if (snap.winner !== null) {
                return snap.winner === snap.myId ? "You had the ring to yourself." : `Blob ${snap.winner} took that one.`
            }
            return snap.inRoom > 1 ? "Next round in a moment." : "Practising alone. Someone else joining makes it a match."
        }
        if (snap.iAmOut) return "Off the edge. Watching until the next round."
        if (!snap.playing) return "Watching this one out. You are in the next."
        return snap.inRoom > 1 ? `${snap.left} still standing.` : "Nobody to shove yet. Try not to slide off."
    }

    return (
        <View style={{ width: ARENA_W, height: ARENA_H, backgroundColor: "rgb(9, 11, 16)" }}>
            <View ref={canvas} onGenerateVisualContent={paint} pickingMode="Ignore"
                style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />

            <View ref={field} pickingMode="Ignore"
                style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
                {BODIES.map((_, slot) => {
                    const owner = snap.owners[slot]
                    const tone = toneOf(owner ?? 0)
                    return (
                        <View
                            key={`blob-${slot}`}
                            ref={(el: any) => { blobs[slot] = el }}
                            pickingMode="Ignore"
                            style={{
                                position: "absolute",
                                width: BLOB_RADIUS * 2,
                                height: BLOB_RADIUS * 2,
                                borderRadius: BLOB_RADIUS,
                                backgroundColor: cssOf(tone, 0.5),
                                borderWidth: slot === 0 ? 3 : 2,
                                borderColor: cssOf(tone),
                                opacity: owner === null ? 0 : snap.down[slot] ? 0.22 : 1,
                            }}
                        >
                            <View pickingMode="Ignore" style={{
                                position: "absolute", left: BLOB_RADIUS * 1.25, top: BLOB_RADIUS - 3,
                                width: 6, height: 6, borderRadius: 3, backgroundColor: cssOf(tone),
                            }} />
                        </View>
                    )
                })}
            </View>

            <View style={{ position: "absolute", left: 22, top: 18 }} pickingMode="Ignore">
                <Text style={{ fontSize: 21, color: "rgb(228, 236, 248)" }}>SUMO</Text>
                <Text style={{ fontSize: 11, marginTop: 3, color: "rgba(142, 168, 200, 0.85)" }}>
                    {snap.connected ? `Round ${snap.roundNumber}, ${snap.inRoom} in the room` : "Alone in the ring, looking for the room"}
                </Text>
                <Text style={{ fontSize: 11, marginTop: 1, color: "rgba(142, 168, 200, 0.6)" }}>{status()}</Text>
                {snap.dropped !== null && (
                    <Text style={{ fontSize: 11, marginTop: 1, color: "rgb(230, 130, 140)" }}>
                        {`The room refused a message (${snap.dropped}).`}
                    </Text>
                )}
            </View>

            <View style={{ position: "absolute", left: 22, bottom: 40, width: 128 }} pickingMode="Ignore">
                <Text style={{ fontSize: 10, color: "rgba(150, 175, 205, 0.7)", marginBottom: 4 }}>DASH</Text>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: "rgba(120, 150, 190, 0.18)" }}>
                    <View style={{
                        height: 5, borderRadius: 3,
                        width: `${Math.round(Math.min(1, snap.dash) * 100)}%`,
                        backgroundColor: snap.dash >= 1 ? "rgb(120, 200, 255)" : "rgba(120, 200, 255, 0.45)",
                    }} />
                </View>
            </View>

            {board.length > 0 && (
                <View style={{
                    position: "absolute", right: 20, top: 18, width: 156,
                    backgroundColor: "rgba(10, 14, 22, 0.72)", borderRadius: 8, padding: 10,
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 10, color: "rgba(150, 175, 205, 0.7)", marginBottom: 5 }}>ROUNDS WON</Text>
                    {board.map((entry) => (
                        <View key={entry.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <View style={{ flexDirection: "row", alignItems: "center" }}>
                                <View style={{
                                    width: 8, height: 8, borderRadius: 4, marginRight: 6,
                                    backgroundColor: cssOf(toneOf(entry.id)),
                                }} />
                                <Text style={{
                                    fontSize: 12,
                                    color: entry.id === snap.myId ? "rgb(255, 214, 120)" : "rgba(206, 224, 244, 0.85)",
                                }}>
                                    {entry.id === snap.myId ? "you" : `blob ${entry.id}`}
                                </Text>
                            </View>
                            <Text style={{ fontSize: 12, color: "rgba(160, 185, 215, 0.8)" }}>{String(entry.wins)}</Text>
                        </View>
                    ))}
                </View>
            )}

            <Text style={{ position: "absolute", left: 22, bottom: 14, fontSize: 11, color: "rgba(110, 140, 170, 0.7)" }}
                pickingMode="Ignore">
                Keys or pointer to move. Space or a click to dash. Push, do not fall.
            </Text>
        </View>
    )
}

mount(<Sumo />)
