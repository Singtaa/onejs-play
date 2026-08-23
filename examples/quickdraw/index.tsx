/**
 * Quickdraw: everybody waits, the signal comes, and the fastest hand takes the
 * round.
 *
 * THE PROBLEM THIS GAME IS ACTUALLY ABOUT
 *
 * There is no server clock. The site passes messages between players and runs
 * nothing, so there is no authority to say when the signal fired or whose hand
 * moved first. Two players' wall clocks can be seconds apart, and a handshake
 * that estimated the difference would carry the error of the round trip it was
 * measured over, which is the same size as the thing being measured. A
 * reaction is a fifth of a second; so is a bad ping.
 *
 * So this game does not try to have a shared clock. It does not need one:
 *
 * A REACTION IS A DIFFERENCE BETWEEN TWO EVENTS ON ONE MACHINE. The frame the
 * signal was drawn here, and the frame the key went down here. Both stamped by
 * the same local frame clock, so the difference is exact and carries no
 * network error at all. A slow connection moves when your signal appears; it
 * does not change how fast you answered it. Nobody is punished for living
 * further from the relay, which is the whole reason to measure it this way.
 *
 * "FIRST" THEREFORE MEANS "FASTEST", NOT "WHOSE PACKET LANDED FIRST". Racing
 * arrival times would hand every round to whoever is nearest the data centre,
 * and it would need the shared clock that does not exist. Fastest reaction is
 * both the fairer question and the answerable one.
 *
 * THE ROOM AGREES BECAUSE THE ANSWER IS COMPUTED, NOT ANNOUNCED. Every player
 * reports their own time; nobody reports anybody else's. Each client then
 * applies the same rule to the same claims: fastest counted time, ties to the
 * lower peer id. The host says when the round is closed, because somebody has
 * to start and stop the clock, but it has no say in who won it. resolve in
 * duel.ts is that rule, and its two tests are the two things that could go
 * wrong: order dependence, and believing an impossible time.
 *
 * WHY THE FRAME CLOCK RATHER THAN A WALL CLOCK, EVEN LOCALLY
 *
 * The browser hands over a websocket message whenever it likes, including
 * between frames, but the player cannot see the signal until the next frame is
 * drawn and cannot answer before the frame after that. Measuring from the
 * frame that drew the signal measures what the player actually experienced.
 * It also quantises both ends the same way for everybody, since every client
 * is the same container running the same loop. That is why the signal is
 * applied in the frame callback rather than in the message handler, and why
 * input is read before the signal is applied: a key that went down in the
 * frame the signal appeared went down before the player could have seen it.
 *
 * WHAT IT COSTS
 *
 * A client can claim any time it likes, and no amount of arithmetic here can
 * stop it. The floor in duel.ts refuses the impossible, which is the cheat
 * somebody bored tries first, and the rest is the same bargain every game on
 * this site makes: the boards are for bragging, and the alternative is running
 * the rules on a server, which is a different product.
 */

import { useEffect, useRef, useState } from "react"
import { View, Text, mount, useFrame, useRoom, useLeaderboard, scores, input, random } from "oj"
import {
    classify, addClaim, resolve, scoreOf, msOf, submittable, holdFor, credit,
    isHost, hostOf,
    REACTION_WINDOW, REST, STALE, CEILING_MS,
    type Claim, type Outcome,
} from "./duel"

/** Player colours, picked from the peer id so everyone agrees who is who. */
const TONES = [
    "rgb(92, 184, 255)", "rgb(255, 140, 77)", "rgb(115, 220, 133)",
    "rgb(240, 114, 158)", "rgb(250, 209, 89)", "rgb(168, 140, 250)",
    "rgb(92, 224, 210)", "rgb(245, 158, 219)",
]
const toneOf = (id: number) => TONES[Math.abs(id) % TONES.length]!

/** Where this client is in the round. */
type Phase = "idle" | "set" | "now" | "answered" | "early" | "shown"

/** What the panel draws. Rebuilt on every change, which is a few a round. */
interface Snapshot {
    phase: Phase
    connected: boolean
    myId: number
    inRoom: number
    round: number
    roster: number[]
    claims: Claim[]
    outcome: Outcome | null
    myMs: number | null
    best: number | null
    tally: Record<number, number>
}

const EMPTY: Snapshot = {
    phase: "idle", connected: false, myId: 0, inRoom: 1, round: 0,
    roster: [], claims: [], outcome: null, myMs: null, best: null, tally: {},
}

function Quickdraw() {
    const rng = useRef(random()).current

    const phase = useRef<Phase>("idle")
    const roundNumber = useRef(0)
    const roster = useRef<number[]>([])
    const claims = useRef<Claim[]>([])
    const outcome = useRef<Outcome | null>(null)
    const tally = useRef<Record<number, number>>({})
    const myMs = useRef<number | null>(null)
    const best = useRef<number | null>(null)

    /**
     * The signal, waiting for a frame.
     *
     * Set by the message handler and applied by the frame loop, so that the
     * moment the clock starts is the moment the signal is drawn. See the
     * header: this is the whole of the timing argument in one field.
     */
    const pendingSignal = useRef<number | null>(null)
    const sinceSignal = useRef(0)

    /** The round clock, which only the host acts on. */
    const hostPhase = useRef<"rest" | "hold" | "window">("rest")
    const hostTimer = useRef(2)
    const wasHost = useRef(false)
    /** Seconds since anything about the round happened, for a lost host. */
    const quiet = useRef(0)

    /** The round this client has already posted a score for. */
    const submitted = useRef(0)

    const [snap, setSnap] = useState<Snapshot>(EMPTY)
    const board = useLeaderboard({ limit: 6 })
    const submit = useRef(board.submit)
    submit.current = board.submit

    const room = useRoom("saloon", {
        onOpen: () => beat(),
        onJoin: () => beat(),
        onLeave: () => beat(),
        onMessage: (from, raw) => {
            const data = raw as any
            if (data === null || typeof data !== "object") return

            if (data.k === "hit" || data.k === "early") {
                // A claim about the sender and nobody else. The id is the one
                // the relay stamped on the message, never a field inside it,
                // so nobody can answer on somebody else's behalf.
                if (data.n !== roundNumber.current) return
                // And only somebody who was in the round may claim one. This
                // is also what keeps the room in agreement: a claim from
                // outside the roster is refused by every client rather than by
                // whichever ones happened to see it after the round closed.
                if (!roster.current.includes(from)) return
                claims.current = addClaim(claims.current, {
                    id: from,
                    ms: data.k === "hit" ? Number(data.ms) : 0,
                    jumped: data.k === "early",
                })
                quiet.current = 0
                beat()
                return
            }

            // The clock is the host's, and only the host's. Accepted from
            // whoever this client's own election picked, so a peer cannot fire
            // the signal unless it genuinely holds the lowest id in the room.
            if (from !== hostOf(room.id, room.peers)) return

            if (data.k === "set" && Array.isArray(data.s)) {
                if (data.n <= roundNumber.current) return
                arm(data.n, data.s)
                return
            }

            if (data.k === "now") {
                if (data.n !== roundNumber.current) return
                // Only somebody who is actually in this round gets a signal to
                // answer. A client that arrived after the roster was fixed is
                // watching, and a watcher pressing a key is not a draw.
                if (phase.current !== "set") return
                pendingSignal.current = data.n
                quiet.current = 0
                return
            }

            if (data.k === "close") {
                if (data.n !== roundNumber.current) return
                closeRound()
            }
        },
    })

    /** Arms a round: everybody in the roster is now watching for the signal. */
    const arm = (n: number, list: number[]) => {
        roundNumber.current = n
        roster.current = list
        claims.current = []
        outcome.current = null
        myMs.current = null
        sinceSignal.current = 0
        pendingSignal.current = null
        quiet.current = 0
        // Somebody who arrived mid round is not in this one. They watch it,
        // because a round they cannot answer is still worth seeing, and they
        // are in the roster of the next one.
        phase.current = list.includes(room.id) ? "set" : "idle"
        beat()
    }

    /**
     * Says what this client did, once, and remembers it locally.
     *
     * A time under the floor is reported as a false start rather than as a
     * very fast draw, because that is what it is: nobody sees a word and
     * answers inside a frame or two. Slower than the ceiling is still an
     * answer and still goes out; it simply cannot win a round or reach a
     * board.
     */
    const answer = (ms: number | null) => {
        const early = ms === null || classify(ms) === "early"
        myMs.current = early ? null : ms
        phase.current = early ? "early" : "answered"
        claims.current = addClaim(claims.current, { id: room.id, ms: ms ?? 0, jumped: early })
        room.send(early
            ? { k: "early", n: roundNumber.current }
            : { k: "hit", n: roundNumber.current, ms: Math.round((ms as number) * 10) / 10 })
        beat()
    }

    /** Works out who won, banks it, and posts this client's own time. */
    const closeRound = () => {
        const result = resolve(claims.current)
        outcome.current = result
        tally.current = credit(tally.current, result.winner)
        phase.current = "shown"
        quiet.current = 0

        const mine = myMs.current
        if (mine !== null && submittable(mine) && (best.current === null || mine < best.current)) best.current = mine
        // One round posts one score, and only a time that is a real time.
        if (mine !== null && submittable(mine) && scores.available && submitted.current !== roundNumber.current) {
            submitted.current = roundNumber.current
            // submit holds its own errors: a board that cannot be reached is a
            // reason to show less, not to interrupt a round that is still on.
            submit.current(scoreOf(mine))
        }
        beat()
    }

    /** The round clock. Only whoever holds the lowest id in the room runs it. */
    const runClock = (dt: number) => {
        hostTimer.current -= dt
        // A round is over when everybody has answered, which is usually about a
        // second in. Waiting out the rest of the window would make every round
        // as slow as its slowest possible answer, and this game is meant to be
        // quick. The window is the cap for somebody who never answers at all.
        const everybodyIn = hostPhase.current === "window"
            && roster.current.length > 0
            && claims.current.length >= roster.current.length
        if (hostTimer.current > 0 && !everybodyIn) return

        if (hostPhase.current === "rest") {
            const n = roundNumber.current + 1
            const list = [room.id, ...room.peers].sort((a, b) => a - b)
            room.send({ k: "set", n, s: list })
            arm(n, list)
            hostPhase.current = "hold"
            hostTimer.current = holdFor(() => rng.next())
            return
        }

        if (hostPhase.current === "hold") {
            room.send({ k: "now", n: roundNumber.current })
            // Queued for the frame loop exactly like a peer's, so the host
            // starts its own clock when its own signal is drawn rather than
            // when it sent the message. Otherwise it would be timing itself
            // from a moment nobody else shares.
            pendingSignal.current = roundNumber.current
            hostPhase.current = "window"
            hostTimer.current = REACTION_WINDOW
            return
        }

        room.send({ k: "close", n: roundNumber.current })
        closeRound()
        hostPhase.current = "rest"
        hostTimer.current = REST
    }

    useFrame((dt) => {
        // The clock first, so a press this frame is measured against the
        // signal that was already on screen.
        if (phase.current === "now") sinceSignal.current += dt

        let pressed = input.keyboard.anyKeyPressed || input.mouse.wasLeftPressed
        for (const touch of input.touches) if (touch.phase === "began") pressed = true

        if (pressed) {
            if (phase.current === "now") answer(sinceSignal.current * 1000)
            // A key that went down before the signal was drawn is a false
            // start, and one that went down in the same frame is too: the
            // player could not have seen anything yet.
            else if (phase.current === "set") answer(null)
        }

        // Applied after the input check, which is what makes the line above
        // true, and inside the frame that draws it, which is what makes the
        // measurement honest.
        if (pendingSignal.current !== null && pendingSignal.current === roundNumber.current) {
            pendingSignal.current = null
            phase.current = "now"
            sinceSignal.current = 0
            beat()
        }

        const host = isHost(room.id, room.peers)
        if (host) {
            if (!wasHost.current) {
                // Just inherited the clock, which happens the moment the peer
                // list changes and without anybody being told. Any round the
                // old host left half finished is abandoned rather than
                // guessed at: the next one starts in a moment.
                hostPhase.current = "rest"
                hostTimer.current = 1.5
            }
            runClock(dt)
        } else {
            quiet.current += dt
            if (quiet.current > STALE && phase.current !== "idle") {
                // The host went away mid round and the new one has not started
                // its first yet. Back to waiting rather than stuck on a signal
                // that is never coming.
                phase.current = "idle"
                beat()
            }
        }
        wasHost.current = host
    }, [])

    const beat = () => {
        setSnap({
            phase: phase.current,
            connected: room.connected,
            myId: room.id,
            inRoom: room.peers.length + 1,
            round: roundNumber.current,
            roster: roster.current,
            claims: claims.current,
            outcome: outcome.current,
            myMs: myMs.current,
            best: best.current,
            tally: tally.current,
        })
    }

    // The panel is event driven, because everything it shows changes when a
    // message arrives rather than every frame. This is the one thing that does
    // not: the number of people in the room, which nothing else asks about.
    useEffect(() => {
        const timer = setInterval(beat, 500)
        return () => clearInterval(timer)
    }, [])

    const card = cardFor(snap)
    const ranking = Object.entries(snap.tally)
        .map(([id, wins]) => ({ id: Number(id), wins }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 6)

    return (
        <View style={{
            width: "100%", height: "100%", backgroundColor: "rgb(8, 10, 14)",
            paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 16,
        }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <View>
                    <Text style={{ fontSize: 21, color: "rgb(230, 238, 250)" }}>QUICKDRAW</Text>
                    <Text style={{ fontSize: 11, marginTop: 2, color: "rgba(140, 168, 200, 0.75)" }}>
                        Wait for the word. First hand takes the round.
                    </Text>
                </View>
                <Text style={{ fontSize: 11, color: "rgba(140, 168, 200, 0.7)" }}>
                    {snap.connected ? `round ${snap.round}, ${snap.inRoom} in the room` : "drawing alone, looking for the room"}
                </Text>
            </View>

            {/* No transition on this: an animated change would put its own
                delay in front of the thing the player is being timed on. */}
            <View style={{
                flexGrow: 1, marginTop: 14, marginBottom: 14, borderRadius: 14,
                backgroundColor: card.background, borderWidth: 1, borderColor: card.border,
                alignItems: "center", justifyContent: "center",
            }}>
                <Text style={{ fontSize: card.size, color: card.color, letterSpacing: 4 }}>{card.word}</Text>
                <Text style={{ fontSize: 13, marginTop: 10, color: card.sub }}>{card.note}</Text>
            </View>

            <View style={{ flexDirection: "row", height: 116 }}>
                <Panel title="THIS ROUND" grow={1.3}>
                    {snap.roster.length === 0 && (
                        <Text style={{ fontSize: 12, color: "rgba(150, 175, 205, 0.55)" }}>Waiting for a round.</Text>
                    )}
                    {snap.roster.slice(0, 5).map((id) => {
                        const claim = snap.claims.find((entry) => entry.id === id)
                        const said = claim === undefined ? "..." : claim.jumped ? "too soon" : `${Math.round(claim.ms)} ms`
                        return (
                            <Row key={id} id={id} mine={id === snap.myId}
                                right={said} dim={claim !== undefined && claim.jumped} />
                        )
                    })}
                </Panel>

                <Panel title="ROUNDS WON" grow={1}>
                    {ranking.length === 0 && (
                        <Text style={{ fontSize: 12, color: "rgba(150, 175, 205, 0.55)" }}>Nobody yet.</Text>
                    )}
                    {ranking.map((entry) => (
                        <Row key={entry.id} id={entry.id} mine={entry.id === snap.myId} right={String(entry.wins)} />
                    ))}
                </Panel>

                <Panel title="FASTEST EVER" grow={1.2} last>
                    {board.entries.length === 0 && (
                        <Text style={{ fontSize: 12, color: "rgba(150, 175, 205, 0.55)" }}>
                            {scores.available ? "No times yet." : "Offline, so no board."}
                        </Text>
                    )}
                    {board.entries.map((entry, i) => (
                        <View key={`${entry.name}-${i}`}
                            style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
                            <Text style={{ fontSize: 12, color: "rgba(206, 224, 244, 0.85)" }}>{entry.name}</Text>
                            {/* Stored as the time left on the clock, so a board
                                that sorts downward puts the fastest on top.
                                Printed back as the time it was made from. */}
                            <Text style={{ fontSize: 12, color: "rgba(160, 185, 215, 0.8)" }}>{`${msOf(entry.score)} ms`}</Text>
                        </View>
                    ))}
                </Panel>
            </View>
        </View>
    )
}

/** One of the three boxes along the bottom. */
function Panel({ title, grow, last, children }: {
    title: string; grow: number; last?: boolean; children?: any
}) {
    return (
        <View style={{
            flexGrow: grow, flexBasis: 0, marginRight: last === true ? 0 : 10,
            backgroundColor: "rgba(14, 19, 28, 0.9)", borderRadius: 10, padding: 10,
        }}>
            <Text style={{ fontSize: 10, color: "rgba(150, 175, 205, 0.65)", marginBottom: 5 }}>{title}</Text>
            {children}
        </View>
    )
}

/** A player, their colour, and whatever number is theirs in this box. */
function Row({ id, mine, right, dim }: { id: number; mine: boolean; right: string; dim?: boolean }) {
    return (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, marginRight: 6, backgroundColor: toneOf(id) }} />
                <Text style={{ fontSize: 12, color: mine ? "rgb(255, 214, 120)" : "rgba(206, 224, 244, 0.85)" }}>
                    {mine ? "you" : `player ${id}`}
                </Text>
            </View>
            <Text style={{ fontSize: 12, color: dim === true ? "rgba(230, 130, 140, 0.8)" : "rgba(160, 185, 215, 0.8)" }}>
                {right}
            </Text>
        </View>
    )
}

/** What the big box in the middle says, which is the whole of the game. */
function cardFor(snap: Snapshot): {
    word: string; note: string; size: number; color: string; sub: string; background: string; border: string
} {
    const quiet = { size: 30, color: "rgba(206, 224, 244, 0.9)", sub: "rgba(140, 168, 200, 0.7)" }
    switch (snap.phase) {
        case "set":
            return {
                word: "WAIT", note: "Move early and you sit the round out.", ...quiet,
                background: "rgb(28, 20, 24)", border: "rgb(74, 46, 54)",
            }
        case "now":
            return {
                word: "NOW", note: "", size: 76, color: "rgb(10, 26, 18)", sub: "rgba(10, 26, 18, 0.6)",
                background: "rgb(74, 222, 148)", border: "rgb(120, 240, 178)",
            }
        case "answered":
            return {
                word: `${Math.round(snap.myMs ?? 0)} ms`,
                note: (snap.myMs ?? 0) >= CEILING_MS
                    ? `Over ${CEILING_MS} ms, so it does not count for the round.`
                    : snap.best !== null && snap.myMs === snap.best ? "Your best yet." : "Waiting for the rest of them.",
                size: 46, color: "rgb(226, 238, 250)", sub: "rgba(140, 168, 200, 0.7)",
                background: "rgb(18, 24, 34)", border: "rgb(46, 60, 82)",
            }
        case "early":
            return {
                word: "TOO SOON", note: "Out for this round. The next one is along shortly.",
                size: 40, color: "rgb(255, 190, 196)", sub: "rgba(230, 150, 160, 0.75)",
                background: "rgb(58, 22, 30)", border: "rgb(104, 40, 52)",
            }
        case "shown": {
            const result = snap.outcome
            if (result === null || result.winner === null) {
                return {
                    word: "NOBODY", note: `Nothing under ${CEILING_MS} ms, so the round goes to nobody.`, ...quiet,
                    background: "rgb(16, 20, 28)", border: "rgb(42, 54, 72)",
                }
            }
            const mine = result.winner === snap.myId
            return {
                word: mine ? "YOU WIN" : `PLAYER ${result.winner}`,
                note: `${Math.round(result.ms ?? 0)} ms${mine ? "" : ", and you were slower"}`,
                size: 40,
                color: mine ? "rgb(255, 224, 150)" : "rgba(206, 224, 244, 0.9)",
                sub: "rgba(140, 168, 200, 0.7)",
                background: "rgb(16, 20, 28)", border: mine ? "rgb(120, 96, 40)" : "rgb(42, 54, 72)",
            }
        }
        default:
            return {
                word: "READY", note: "The next round starts in a moment.", ...quiet,
                background: "rgb(12, 16, 22)", border: "rgb(34, 44, 60)",
            }
    }
}

mount(<Quickdraw />)
