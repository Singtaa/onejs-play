/**
 * Squiggle: you are a line, and the only thing that can end you is somebody
 * else's.
 *
 * Steer with the pointer, hold to go faster, eat the orbs. Running into another
 * player's body kills you. Running into your own does not, because a game where
 * a tight turn is fatal is a game about being careful and this one is meant to
 * be about other people.
 *
 * NOBODY CAN KILL YOU BUT YOU
 *
 * The site passes messages between players and knows nothing about what they
 * mean, so every client is the authority on itself and on nothing else. A head
 * touching a line is noticed by the client the head belongs to, and that client
 * says it died. There is no message that means "you are dead", so there is
 * nothing for a liar to send. The reasoning is at the top of snake.ts.
 *
 * WHAT GOES ON THE WIRE, WHICH IS THE INTERESTING PART OF THIS GAME
 *
 * A body is hundreds of points and none of them are ever sent. Fifteen times a
 * second a player broadcasts five numbers: where the head is, which way it
 * points, how long it is, and whether it is boosting. Everybody else runs the
 * same movement rules from that and lays the same trail behind it themselves,
 * so a snake of any length costs the same forty bytes as a new one.
 *
 * Orbs eaten since the last one ride along in that same message rather than
 * going out as they happen. Swimming through the food a dead snake left behind
 * would otherwise be a message a frame for as long as it took to cross, and a
 * room allows sixty a second. Fifteen a second is what this game costs while it
 * is being played, whatever is happening in it.
 *
 * That is a stronger version of what Big Fish does. A fish is a dot, so it can
 * be snapped to each new position and nobody notices. A snake is a record of
 * where it has been, and a snapped head writes the correction into the body as
 * a permanent kink, so instead the reported position is a mark that the drawn
 * head is pulled toward over the following frames. A player who has stopped
 * sending coasts rather than freezing, and a player who has jumped further than
 * they could have swum (which means they died and came back) is snapped
 * outright and their old body thrown away, because interpolating across a
 * respawn would draw a line across the field that killed everybody it crossed.
 *
 * THE FIELD OF ORBS IS NOT A MESSAGE
 *
 * It is a seed, written down in this file, so every client lays exactly the same
 * field on startup with nobody sending anything and nobody waiting. What does
 * get sent is only the difference: which orbs have been eaten, and which ones a
 * dead snake dropped somewhere new.
 *
 * One client owns that difference, so that a late arrival has somebody to ask,
 * and the relay says which one. This game used to work it out for itself as the
 * lowest peer id present, which was wrong in a way no client could see: a socket
 * whose player had gone was still in the peer list, so every client agreed on a
 * host that was never going to answer, and the field quietly stopped being
 * topped up. Deciding it on the server is the only place the question can be
 * answered, because only the server knows which sockets are still alive.
 */

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

/**
 * The field, written down rather than agreed.
 *
 * Any fixed number would do. What matters is that it is the same one in every
 * copy of the game, so that scattering the orbs is something each client does
 * for itself on startup instead of something the room has to be told.
 */
const FIELD_SEED = 20260823

/** Position updates a second. Everything else is an event. */
const BROADCAST_HZ = 15

/** How fast a drawn head closes the gap to where its owner says it is. */
const CATCHUP = 5

/**
 * A jump this big is not swimming.
 *
 * The fastest a snake can travel is a few hundred units a second, so a report
 * this far from where the body is means the player died and came back. Filling
 * that in as movement would lay a line straight across the field, and every
 * player it crossed would run into a body that was never there.
 */
const RESYNC = 260

/** A player who has said nothing for this long has gone without saying goodbye. */
const SILENCE_MS = 8000

/** Orbs a corpse leaves behind, at most. */
const MAX_CORPSE = 30

/** Snake colours, picked from the peer id so everyone agrees who is who. */
const TONES: [number, number, number][] = [
    [0.36, 0.78, 1.0], [1.0, 0.58, 0.33], [0.47, 0.88, 0.55],
    [0.95, 0.47, 0.64], [0.98, 0.84, 0.38], [0.68, 0.57, 0.99],
    [0.38, 0.90, 0.84], [0.97, 0.64, 0.88],
]
const toneOf = (id: number) => TONES[id % TONES.length]!

/** Orb colours, by the tone the seed gave them. */
const ORB_TONES: [number, number, number][] = [
    [0.58, 0.87, 1.0], [1.0, 0.80, 0.47], [0.62, 0.96, 0.68],
    [0.99, 0.64, 0.76], [0.87, 0.77, 1.0], [0.72, 0.99, 0.94],
]

interface Peer extends Snake {
    boosting: boolean
    /** Where their client last said the head was, kept moving the way they said. */
    markX: number
    markY: number
    lastSeen: number
}

function Squiggle() {
    const stage = useStage()
    const host = useRef<any>(null)
    const rng = useRef(random()).current

    /**
     * `home` is the field as the seed laid it and is never touched again.
     * `orbs` is the field as it is now. The difference between the two is
     * exactly what a late arrival has to be told, so it never has to be
     * tracked: it can be read off whenever it is wanted.
     */
    const field = useRef<{ home: Orb[]; orbs: Orb[] } | null>(null)
    if (field.current === null) {
        const source = random(FIELD_SEED)
        const home = scatterOrbs(ORB_COUNT, () => source.next())
        field.current = { home, orbs: home.map((orb) => ({ ...orb })) }
    }
    const { home, orbs } = field.current

    /**
     * Where this snake starts, drawn once rather than on every render.
     *
     * It matters that it is drawn at all: two players who both opened the game
     * at the middle of the field would be inside each other before either had
     * touched a key, and each would correctly report running into the other.
     */
    const origin = useRef<{ x: number; y: number; angle: number } | null>(null)
    if (origin.current === null) origin.current = spawnPoint(() => rng.next())
    const me = useRef<Snake>(makeSnake(origin.current.x, origin.current.y, origin.current.angle)).current
    const peers = useRef(new Map<number, Peer>()).current
    /** The longest this life has been, which is what a run is worth. */
    const peak = useRef(START_LENGTH)
    const kills = useRef(0)
    const sinceBroadcast = useRef(0)
    /** Orbs swallowed since the last broadcast, waiting to ride along with it. */
    const eaten = useRef<number[]>([]).current
    const sinceTopUp = useRef(0)
    const boosting = useRef(false)
    /**
     * Whether a pointer has actually been used.
     *
     * The mouse reports (0, 0) until it moves. A snake that steered toward that
     * would turn for the top left corner before the player had touched
     * anything, so until the pointer moves it simply keeps going straight.
     */
    const steered = useRef(false)
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

    /** The orbs that are not where the seed put them, which is the whole handoff. */
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

    /** Puts an orb somewhere, whether that is its old home or a fresh corpse. */
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
            // Nothing to ask for when the relay has named this client the host,
            // and nothing to wait for either: the field is already laid, from
            // the seed.
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
                // Too far to have swum, so they died and came back somewhere
                // else. Interpolating across that would draw a body along a
                // path they never took.
                if (Math.hypot(existing.markX - existing.x, existing.markY - existing.y) > RESYNC) {
                    existing.x = existing.markX
                    existing.y = existing.markY
                    resetTrail(existing)
                }
                return
            }

            if (data.k === "hi") {
                // Somebody arrived with a field laid from the seed and no idea
                // what has happened to it since. Only the host answers, and it
                // answers them alone: this is the largest message the game has,
                // and everybody else already knows what is in it.
                if (room.isHost) room.send({ k: "f", d: fieldDelta() }, from)
                return
            }

            if (data.k === "f" && Array.isArray(data.d)) {
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
                // They are telling us they ran into something, and whose line
                // it was. Believed about them alone: if they say it was ours,
                // that is a number beside our own name and nothing more.
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
        onHost: (mine, id) => setStatus((s) => ({ ...s, host: id, mine })),
        /**
         * The relay refused to pass something on.
         *
         * It used to drop silently, which meant a game that oversent looked
         * like a game with a mysterious desync. The runtime already writes it
         * to the console; putting it on screen as well costs a line that a
         * working game never shows, and turns the next version of that bug
         * into something a player can report without opening devtools.
         */
        onDropped: (reason) => setStatus((s) => ({ ...s, dropped: reason })),
        onClose: () => setStatus((s) => ({ ...s, connected: false })),
    })

    /** Ends a life: leaves the body behind as food, reports it, and starts again. */
    const die = (toWhom: number) => {
        // A corpse fills whatever room the field has, which is however much of
        // it has been eaten. A long snake ate a hundred orbs to get that way,
        // so by the time one dies there is always somewhere to put it.
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

        // submit never rejects: it holds its own errors, because a leaderboard
        // that cannot be reached is a reason to show less, not to interrupt a
        // game that is still going.
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
        // Sent at once rather than on the next tick, so nobody spends a
        // sixteenth of a second steering around a body that is not there.
        sinceBroadcast.current = 0
    }

    useFrame((dt) => {
        const step = Math.min(dt, 1 / 20)
        const camera = cameraAt(me, stage.width, stage.height)

        // Steering. The pointer is in stage units and the field is far larger
        // than the stage, so it goes through the same camera the drawing uses.
        // Without that the snake turns toward a point on the screen rather than
        // a point on the field, which is only the same thing at the centre.
        const mouse = input.mouse
        if (mouse.position.x !== lastPointer.current.x || mouse.position.y !== lastPointer.current.y) {
            lastPointer.current = { x: mouse.position.x, y: mouse.position.y }
            steered.current = true
        }
        let aimX = steered.current ? mouse.position.x + camera.x : me.x
        let aimY = steered.current ? mouse.position.y + camera.y : me.y
        let aiming = steered.current
        let fingers = 0
        for (const touch of input.touches) {
            if (touch.phase === "ended" || touch.phase === "canceled") continue
            fingers++
            // The first finger steers. A second one is the boost, which is the
            // only gesture left on a screen with no buttons on it.
            if (fingers === 1) {
                aimX = touch.position.x + camera.x
                aimY = touch.position.y + camera.y
                aiming = true
            }
        }
        if (aiming) me.angle = steer(me.angle, Math.atan2(aimY - me.y, aimX - me.x), step)

        // Boosting spends length. It is not paid for in dropped orbs the way
        // the arcade original does it, because an orb moving is a message and a
        // boost is continuous: that would put traffic on the wire every few
        // frames for as long as a finger was down.
        const wants = input.mouse.leftButton || input.keyboard.isKeyDown("Space") || fingers >= 2
        boosting.current = wants && canBoost(me.length)
        if (boosting.current) me.length = boostDrain(me.length, step)

        advance(me, step, boosting.current)

        // Everybody else moves the way they said they were moving, then is
        // pulled toward where they said they were. The mark keeps travelling on
        // its own, so the pull is toward where they are now rather than toward
        // where they were when the message left.
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
            // advance lays the trail itself, and it does so from wherever the
            // head has ended up, so the correction above is recorded as body
            // rather than being skipped over.
            advance(peer, step, peer.boosting)
        }

        // Eating, which is the only thing this client asserts about the world
        // beyond itself, and it is safe because an orb belongs to nobody.
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

        // Dying, decided here and nowhere else. The wall first, because it is
        // the cheaper question.
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

        // The owner puts eaten orbs back where the seed had them, a few at a
        // time. Back home rather than somewhere new, so that the field drifts
        // toward the layout every client already has rather than away from it.
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
                // Left out entirely when nothing was eaten, because a field
                // that is only sometimes there costs nothing when it is not.
                e: eaten.length > 0 ? eaten.slice() : undefined,
            })
            eaten.length = 0
        }

        host.current?.MarkDirtyRepaint()
    }, [stage.width, stage.height])

    // The panel changes a few times a second, not sixty, so it is the one part
    // that goes through React.
    useEffect(() => {
        const timer = setInterval(() => setStatus((s) => ({
            ...s,
            length: Math.round(me.length),
            best: Math.round(peak.current),
            kills: kills.current,
            // From the room rather than from the map of peers, so somebody who
            // has joined but not yet said anything is still counted.
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

        // The wall, which is fatal, so it is drawn as one.
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
                {/* One client keeps the orb field stocked and answers arrivals
                    with what has changed since the seed. The relay picks which,
                    and saying so out loud is what makes it obvious when nobody
                    is doing it. */}
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

            {/* Who is longest, right now, on this field. */}
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

            {/* All time, across everybody who has ever played. */}
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

/**
 * The top left of the view, in field coordinates.
 *
 * Centred on the head and clamped to the field, so a player never looks at
 * ground that is not there. A view wider than the field pins to zero rather
 * than going negative, which cannot happen at today's numbers but would leave a
 * strange bug behind if the field were ever made smaller.
 */
function cameraAt(snake: Snake, viewW: number, viewH: number): { x: number; y: number } {
    return {
        x: Math.max(0, Math.min(WORLD_W - viewW, snake.x - viewW / 2)),
        y: Math.max(0, Math.min(WORLD_H - viewH, snake.y - viewH / 2)),
    }
}

/**
 * A snake: one wide stroked line through its points, and a head on the end.
 *
 * One path rather than a circle per point, because a full field is a couple of
 * dozen bodies of a couple of hundred points each and that many separate fills
 * would be the whole frame. The run is broken wherever it leaves the view, so a
 * long body costs only the part of it somebody can actually see. Round joins
 * and caps are what make a chain of straight segments read as a curve.
 */
function drawSnake(
    p: Painter, snake: Snake, camera: { x: number; y: number },
    view: { width: number; height: number }, tone: [number, number, number],
    mine: boolean, boosting: boolean,
): void {
    const radius = radiusOf(snake.length)
    // Generous enough that a segment leaving the view is already well outside
    // it, so breaking the run there cannot clip anything a player would see.
    const margin = radius + NODE_GAP * 8

    p.lineCap(Painter.LineCap.Round)
    p.lineJoin(Painter.LineJoin.Round)

    // A darker underline slightly wider than the body, which is what stops two
    // snakes of similar colours reading as one shape where they cross.
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

    // Eyes, which are what turn a circle on the end of a line into something
    // that is facing a direction. Two paths rather than one: an arc continues
    // the path it is added to, so a second one in the same path would be joined
    // to the first by a line across the face.
    const side = Math.max(1.6, radius * 0.34)
    const out = radius * 0.45
    const along = Math.cos(snake.angle)
    const across = Math.sin(snake.angle)
    p.fillColor(0.96, 0.99, 1, 0.95)
    for (const turn of [1, -1] as const) {
        p.beginPath()
        p.arc(hx + along * out - across * out * turn, hy + across * out + along * out * turn,
            side, 0, Math.PI * 2)
        p.fill()
    }
}

mount(<Squiggle />)
