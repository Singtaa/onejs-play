/**
 * Sumo: everyone is a blob on a shrinking platform, and the platform is small.
 *
 * Two systems at once, and the interesting part is where they meet. Rooms give
 * this several real people; the physics engine gives it a shove worth landing.
 * Neither was built with the other in mind, so this file is mostly the answer
 * to one question: what does a collision mean when every client is running its
 * own copy of the simulation and the server is running none of it.
 *
 * WHO DECIDES WHAT
 *
 * You are the authority on your own blob and on nothing else. You broadcast
 * where it is; you say when it fell off. Nobody can push you out by sending a
 * message, because "you are out" is not a message anybody can send. Everybody
 * else's blob is on a leash here: a real physics body, so a collision hands
 * you the right share of the impact, corrected every tick to the position its
 * owner reported. The reasoning, and what that compromise costs, is the header
 * of arena.ts, which is worth reading before changing anything in here.
 *
 * The ring is the exception, because a ring that each client shrank on its own
 * clock would put two players on two different platforms. That needs one
 * owner, and the room names it: `room.isHost` is the earliest joined socket
 * that is still answering, and it broadcasts the clock four times a second
 * while everybody else converges on it.
 *
 * This game used to work that out for itself, by taking the lowest peer id
 * present. The rule is sound and the input was not: the relay never reaped a
 * socket nobody was behind, so a closed tab stayed in the peer list and every
 * client dutifully elected it. The corpse broadcast nothing, so each client
 * ran its own clock and two screens showed two different rings. The lesson is
 * worth keeping even though the code is gone: a rule evaluated from shared
 * state is only as true as the state, and liveness is not something a peer can
 * observe about another peer. The room can, so the room decides.
 *
 * THE SHAPE THE PHYSICS ENGINE FORCES
 *
 * A physics world is built with all of its bodies at once and cannot grow, so
 * every body that will ever exist is created on the first frame and handed out
 * to people as they arrive. There are as many bodies as the relay allows
 * sockets in one room, so nobody can turn up and find no blob left. Body 0 is
 * always this client: the one body whose position it believes.
 *
 * The platform is not a body at all. It could not be: a collider cannot be
 * resized after the world is built, and this one shrinks all round. So the
 * physics simulates blob against blob, and standing on the ring is a distance
 * from the middle, checked in JavaScript. The player cannot tell, and the ring
 * gets to be any shape it likes.
 */

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

/** Blob colours, picked from the peer id so everyone agrees who is who. */
const TONES: [number, number, number][] = [
    [0.36, 0.72, 1.0], [1.0, 0.55, 0.30], [0.45, 0.86, 0.52],
    [0.94, 0.45, 0.62], [0.98, 0.82, 0.35], [0.66, 0.55, 0.98],
    [0.36, 0.88, 0.82], [0.96, 0.62, 0.86],
]
const toneOf = (id: number) => TONES[Math.abs(id) % TONES.length]!
const cssOf = (tone: [number, number, number], scale = 1) =>
    `rgb(${Math.round(tone[0] * 255 * scale)}, ${Math.round(tone[1] * 255 * scale)}, ${Math.round(tone[2] * 255 * scale)})`

/** Where a body is parked while nobody is using it. */
const OFF_FIELD = -600

/**
 * Every body the game will ever have, described once.
 *
 * They are identical because everybody is: a sumo match where one blob is
 * heavier is a different game, and mass here is Unity's default of 1 for every
 * body, which is what makes an impulse in arena.ts a plain change of speed.
 */
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

/** What the panel draws, gathered four times a second rather than every frame. */
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

    /** Which body belongs to which peer. Body 0 is never handed out. */
    const slots = useRef(new Slots(MAX_BLOBS)).current
    /** Where each peer says they are, carried forward between their reports. */
    const tracks = useRef(new Map<number, Track>()).current

    const round = useRef<Round | null>(null)
    /**
     * Whether the round in `round` is still being played.
     *
     * Kept apart from the round itself so that a finished round is still there
     * to be looked at: the winner's blob stays lit and everybody who fell stays
     * dimmed, rather than the whole ring going blank the instant it is decided.
     */
    const live = useRef(false)
    /** Seconds into the round, owned by the host and converged on by the rest. */
    const elapsed = useRef(0)
    /** The gap between rounds. Only the host acts on it. */
    const rest = useRef(1.2)
    /** When this round started looking finished, or null. See SETTLE. */
    const overSince = useRef<number | null>(null)
    const nextRound = useRef(1)
    const winner = useRef<number | null>(null)
    const tally = useRef<Record<number, number>>({})

    /** This client's blob, as of the last tick. Stale by design: see below. */
    const mine = useRef({ x: CENTER_X, y: CENTER_Y })
    /** The ring size the painter last drew, so it is not asked to draw it twice. */
    const drawn = useRef(Number.NaN)
    /** The last thing the relay refused to carry, if it ever has. */
    const dropped = useRef<string | null>(null)
    const sinceSync = useRef(0)
    const sinceTick = useRef(0)
    const dashLeft = useRef(0)
    const fallen = useRef(false)

    const [snap, setSnap] = useState<Snapshot>(EMPTY)

    const world = usePhysics(field, {
        // Nothing falls: this is a view from above, and the only thing pulling
        // a blob anywhere is another blob.
        gravity: [0, 0],
        // No walls either. Being thrown out of the world is the point, and a
        // wall to bounce off would give every player a free save.
        bounds: false,
        bodies: BODIES,
    })

    const blobs = useRef<any[]>([]).current

    const room = useRoom("ring", {
        // A message that went nowhere used to be invisible from in here, and a
        // game quietly missing positions looks like a game with bad physics.
        // Sumo sends about nineteen messages a second against a limit of
        // sixty, so seeing this at all means something is wrong rather than
        // busy, and it says so on screen instead of only in a console nobody
        // has open.
        onDropped: (reason, detail) => {
            dropped.current = `${reason}: ${detail}`
            console.warn(`[sumo] the relay dropped a message, ${reason}: ${detail}`)
            beat()
        },
        onOpen: () => {
            // Nothing to do beyond letting the panel know: the round starts
            // from the rest timer, and whether this client owns that timer is
            // decided by the peer list rather than by anything sent.
            beat()
        },
        onLeave: (id) => {
            const slot = slots.release(id)
            tracks.delete(id)
            if (slot !== null && world !== null) {
                // Position before disable: see place() in startRound.
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
                    tracks.set(from, { x: data.x, y: data.y, vx: data.vx, vy: data.vy, quiet: 0 })
                } else {
                    track.x = data.x
                    track.y = data.y
                    track.vx = data.vx
                    track.vy = data.vy
                    track.quiet = 0
                }
                return
            }

            if (data.k === "out") {
                // Believed, because it is a claim about the sender and nothing
                // else. applyFall reads the sender the relay stamped on the
                // message and never a field inside it.
                const current = round.current
                if (current === null) return
                round.current = applyFall(current, from, data)
                const slot = slots.slotOf(from)
                if (slot !== null && world !== null) world.setBodyEnabled(slot, false)
                return
            }

            // The two messages about the round itself are the only ones with a
            // trusted sender, and the trust is thin: they are accepted only
            // from the peer the room named host, so nobody else can start a
            // round or wind the clock. Everything above this line is a claim
            // about the sender and needs no such check.
            if (from !== room.hostId) return

            if (data.k === "go" && Array.isArray(data.s)) {
                // A round this client has already played, or is playing, is not
                // started again. The room names the earliest joined socket, so
                // a host has been present for every round the room has had and
                // cannot rewind it by starting one anybody has already seen.
                if (data.n < nextRound.current) return
                startRound(data.n, data.s)
                return
            }

            if (data.k === "tick") {
                const current = round.current
                if (current !== null && live.current && data.n === current.n) {
                    elapsed.current = syncClock(elapsed.current, data.t)
                } else {
                    // A round this client is not in, because it arrived in the
                    // middle of one. The clock still matters: the ring has to be
                    // drawn at the size everybody else is standing on.
                    elapsed.current = data.t
                    nextRound.current = data.n + 1
                }
            }
        },
    })

    /**
     * Puts everybody where the roster says, and starts the clock.
     *
     * Every client works out every blob's starting place from the same roster,
     * so a round opens with the blobs already spread out rather than sliding in
     * from wherever they were when the last one ended.
     */
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

        /**
         * Puts a blob on the ring, in the one order that works.
         *
         * Switched on FIRST, then moved. A Rigidbody2D that is not simulating
         * does not take a position: the write is accepted and thrown away, and
         * the body wakes up wherever it was parked. This game parks bodies off
         * the field at minus six hundred, so every blob in every round started
         * its life a long way outside the ring, reported itself off the edge on
         * the first tick, and the round ended before anybody saw a player.
         *
         * The symptom was three separate things that did not look related: no
         * blob on screen, rounds lasting four seconds instead of twenty, and a
         * ring that never shrank. All three are this line being in the wrong
         * order. drop-everything had it right and this did not, which is the
         * argument for reading the example next door before writing the one
         * after it.
         */
        const place = (body: number, index: number) => {
            const at = spawnAt(index, starters.length)
            world.setBodyEnabled(body, true)
            world.setPosition(body, at.x, at.y)
            world.setVelocity(body, 0, 0)
            return at
        }

        /** Parks a body out of the way, in the same order for the same reason. */
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
            tracks.set(peer, { x: at.x, y: at.y, vx: 0, vy: 0, quiet: 0 })
        }
        // Anybody in the room but not in the round watches this one out.
        for (const [peer, slot] of slots.entries()) {
            if (starters.includes(peer)) continue
            park(slot)
        }
        beat()
    }

    /** Ends the round this client is watching and banks the result. */
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

        // The clock first, and the round read only after it. Ending a round
        // stops it being live, and a copy taken before that would still look
        // playable: this client would go on steering a blob in a round that
        // was over and report a fall into it.
        if (live.current && round.current !== null) {
            elapsed.current += step
            /**
             * A round that looks over is given a moment to actually be over.
             *
             * This client hears about its own fall instantly and about
             * everybody else's a round trip later. Resolving the moment one
             * player is left standing therefore hands the win to whoever this
             * client has not heard from yet, and two clients in a double fall
             * each credit the other. Waiting lets the fall that was already in
             * flight land, so both sides resolve the same round from the same
             * facts. See SETTLE in arena.ts, which has the numbers it cost.
             */
            if (isOver(round.current, elapsed.current)) {
                if (overSince.current === null) overSince.current = elapsed.current
                if (elapsed.current - overSince.current >= SETTLE) finishRound()
            }
        }

        /**
         * A host that is not in its own round ends it.
         *
         * This client's id changes if the socket drops and reconnects, and the
         * round it is in the middle of still names the old one. Nobody in that
         * roster can report a fall, so for a solo host the round would sit
         * there until the cap. Ending it costs one round, and the next one has
         * everybody in it, which is the shortest way back to a game.
         */
        if (live.current && round.current !== null && room.isHost
            && !round.current.starters.includes(room.id)) {
            finishRound()
        }

        const current = live.current ? round.current : null
        const iAmIn = current !== null && current.starters.includes(room.id) && !fallen.current

        /**
         * A round cannot be opened before this client knows who it is.
         *
         * The roster is built from room.id, which is 0 until the relay sends
         * the welcome. Open a round in that window and the roster names a
         * player who does not exist: seconds later the id arrives, this client
         * is not in the round it started itself, and because nobody in that
         * roster can ever report a fall the round runs to its forty five second
         * cap with a dimmed blob standing on a ring that has closed to nothing.
         * That is what a player saw as "the game did not start".
         *
         * An ejected copy has no site, never gets an id, and must not wait for
         * one, which is what the second half of this says.
         */
        const knowsWhoItIs = room.connected || !isOnline()

        if (current === null && room.isHost && knowsWhoItIs) {
            // Only the host counts down to the next round, and it announces the
            // roster it saw so that everybody spawns from the same list.
            rest.current -= step
            if (rest.current <= 0) {
                const starters = [room.id, ...room.peers].sort((a, b) => a - b)
                const n = nextRound.current
                room.send({ k: "go", n, s: starters })
                startRound(n, starters)
            }
        }

        const ring = platformRadius(elapsed.current)

        // Steering runs every frame, because a control that answered fifteen
        // times a second would feel like a control that was broken.
        if (iAmIn) {
            const keys = input.keyboard.axis2D({
                up: ["W", "UpArrow"], down: ["S", "DownArrow"],
                left: ["A", "LeftArrow"], right: ["D", "RightArrow"],
            })
            // The stage measures y downward and the key says which way the
            // player wants to go, so up on the keyboard is negative here.
            let aimX = keys.x
            let aimY = -keys.y

            let pointing: { x: number; y: number } | null = null
            if (input.mouse.leftButton) pointing = { x: input.mouse.position.x, y: input.mouse.position.y }
            for (const touch of input.touches) {
                if (touch.phase === "ended" || touch.phase === "canceled") continue
                pointing = { x: touch.position.x, y: touch.position.y }
            }
            if (aimX === 0 && aimY === 0 && pointing !== null) {
                // Toward the pointer from where this blob was at the last tick.
                // Sixty milliseconds stale, which a direction does not notice.
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

        // The ring is a function of this number, so the client that owns it
        // says what it is. Four times a second is enough: everybody advances
        // their own copy every frame and only converges on this one, so it
        // corrects drift rather than driving the ring.
        if (current !== null && room.isHost) {
            sinceTick.current -= step
            if (sinceTick.current <= 0) {
                sinceTick.current = 0.25
                room.send({ k: "tick", n: current.n, t: Math.round(elapsed.current * 100) / 100 })
            }
        }

        // Everything that needs to know where the bodies actually are happens
        // on one cadence, and it is the same cadence positions go out on:
        // reading the world costs a crossing and a parse, and there is nothing
        // to learn from reading it faster than the news travels.
        sinceSync.current -= step
        if (sinceSync.current <= 0) {
            const tick = 1 / SYNC_HZ
            sinceSync.current = tick
            const transforms = world.readTransforms()

            if (transforms.length >= MAX_BLOBS * 3) {
                if (iAmIn && current !== null) {
                    const x = transforms[0]!
                    const y = transforms[1]!
                    // Velocity is measured here rather than inferred by the
                    // receiver, because the interval between two reads is known
                    // exactly and the interval between two arrivals is not.
                    // Sending it costs two numbers and saves everybody else
                    // from dividing by a guess.
                    const vx = (x - mine.current.x) / tick
                    const vy = (y - mine.current.y) / tick
                    mine.current = { x, y }
                    room.send({
                        k: "at",
                        x: Math.round(x), y: Math.round(y),
                        vx: Math.round(vx), vy: Math.round(vy),
                    })
                    if (isOff(x, y, ring)) {
                        // The only elimination in this game, and it is this
                        // client eliminating itself.
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
                    if (track.quiet > 8) {
                        // Gone without saying goodbye.
                        tracks.delete(peer)
                        slots.release(peer)
                        world.setPosition(slot, OFF_FIELD, OFF_FIELD)
                        world.setBodyEnabled(slot, false)
                        continue
                    }
                    const x = transforms[slot * 3]!
                    const y = transforms[slot * 3 + 1]!
                    if (leashDelta(x, y, track) > SNAP_DISTANCE) {
                        // Too far behind to slide back without ploughing through
                        // whoever is in between, so it goes straight there.
                        world.setPosition(slot, track.x, track.y)
                        world.setVelocity(slot, track.vx, track.vy)
                    } else {
                        const v = leashVelocity(x, y, track)
                        world.setVelocity(slot, v.x, v.y)
                    }
                }
            }
        }

        // The painter draws the ring and the floor under it, and nothing else:
        // the blobs are elements that C# moves, so they are already on screen
        // without JavaScript redrawing anything. That means a repaint is only
        // worth asking for while the ring is actually changing size, which is
        // not most of a round: it holds still through the grace period, again
        // once it reaches its smallest, and through the whole gap between
        // rounds. Measured because it mattered: one of these containers under a
        // software rasteriser was taking five and a half cores, which is what
        // made a second browser on the same machine stop answering at all.
        if (ring !== drawn.current) {
            drawn.current = ring
            canvas.current?.MarkDirtyRepaint()
        }
    }, [world])

    /** Gathers what the panel shows. Called on events and four times a second. */
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

    // Bodies are bound to their elements after mount, which is when the refs
    // have something in them, and every one of them starts switched off: a
    // blob only exists once somebody is standing in it.
    useEffect(() => {
        if (world === null) return
        for (let slot = 0; slot < MAX_BLOBS; slot++) {
            if (blobs[slot]) world.bind(slot, blobs[slot])
            // Parked while it is still simulating, then switched off, because
            // the other order writes a position that is quietly discarded.
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

        // Where the ring will be in three seconds, so the closing edge is
        // something a player can plan around rather than something that
        // arrives. Drawn under the platform, so it only shows on the part
        // that is about to go.
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

        // A few rings inward, so the middle reads as the middle and a player
        // can see how far from the edge they are without measuring.
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

            {/* The physics host. Its children are laid out at the origin and
                moved by the simulation, so nothing in here has a left or a top. */}
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
                            {/* Rides the body's rotation, which is the only way
                                to see that a blob is spinning after a hit. */}
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
                {/* Its own line rather than in place of the status, so what the
                    round is doing stays readable while something is wrong with
                    what this client is sending. */}
                {snap.dropped !== null && (
                    <Text style={{ fontSize: 11, marginTop: 1, color: "rgb(230, 130, 140)" }}>
                        {`The room refused a message (${snap.dropped}).`}
                    </Text>
                )}
            </View>

            {/* The dash, which is the whole of the offence in this game. */}
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
