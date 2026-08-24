
import { useEffect, useRef, useState } from "react"
import { View, Text, mount, useFrame, useStage, useRoom, useLeaderboard, scores, input, isOnline, random } from "oj"
import {
    classify, addClaim, resolve, scoreOf, msOf, submittable, holdFor, credit,
    REACTION_WINDOW, REST, STALE, CEILING_MS,
    type Claim, type Outcome,
} from "./duel"

const TONES = [
    "rgb(92, 184, 255)", "rgb(255, 140, 77)", "rgb(115, 220, 133)",
    "rgb(240, 114, 158)", "rgb(250, 209, 89)", "rgb(168, 140, 250)",
    "rgb(92, 224, 210)", "rgb(245, 158, 219)",
]
const toneOf = (id: number) => TONES[Math.abs(id) % TONES.length]!

type Phase = "idle" | "set" | "now" | "answered" | "early" | "shown"

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
    dropped: string | null
    tally: Record<number, number>
}

const EMPTY: Snapshot = {
    phase: "idle", connected: false, myId: 0, inRoom: 1, round: 0,
    roster: [], claims: [], outcome: null, myMs: null, best: null, dropped: null, tally: {},
}

function Quickdraw() {
    const rng = useRef(random()).current
    const stage = useStage()

    const phase = useRef<Phase>("idle")
    const roundNumber = useRef(0)
    const roster = useRef<number[]>([])
    const claims = useRef<Claim[]>([])
    const outcome = useRef<Outcome | null>(null)
    const tally = useRef<Record<number, number>>({})
    const myMs = useRef<number | null>(null)
    const best = useRef<number | null>(null)

    const pendingSignal = useRef<number | null>(null)
    const sinceSignal = useRef(0)

    const hostPhase = useRef<"rest" | "hold" | "window">("rest")
    const hostTimer = useRef(2)
    const wasHost = useRef(false)
    const quiet = useRef(0)

    const submitted = useRef(0)
    const dropped = useRef<string | null>(null)

    const [snap, setSnap] = useState<Snapshot>(EMPTY)
    const board = useLeaderboard({ limit: 4 })
    const submit = useRef(board.submit)
    submit.current = board.submit

    const room = useRoom("saloon", {
        onDropped: (reason, detail) => {
            dropped.current = `${reason}: ${detail}`
            console.warn(`[quickdraw] the relay dropped a message, ${reason}: ${detail}`)
            beat()
        },
        onOpen: () => beat(),
        onJoin: () => beat(),
        onLeave: () => beat(),
        onMessage: (from, raw) => {
            const data = raw as any
            if (data === null || typeof data !== "object") return

            if (data.k === "hit" || data.k === "early") {
                if (data.n !== roundNumber.current) return
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

            if (from !== room.hostId) return

            if (data.k === "set" && Array.isArray(data.s)) {
                if (data.n <= roundNumber.current) return
                arm(data.n, data.s)
                return
            }

            if (data.k === "now") {
                if (data.n !== roundNumber.current) return
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

    const arm = (n: number, list: number[]) => {
        roundNumber.current = n
        roster.current = list
        claims.current = []
        outcome.current = null
        myMs.current = null
        sinceSignal.current = 0
        pendingSignal.current = null
        quiet.current = 0
        phase.current = list.includes(room.id) ? "set" : "idle"
        beat()
    }

    const answer = (ms: number | null) => {
        const early = ms === null || classify(ms) === "early"
        // Rounded once, then used for the claim, the wire and the display, so no
        // two screens print the same answer differently.
        const said = early ? 0 : Math.round((ms as number) * 10) / 10
        myMs.current = early ? null : said
        phase.current = early ? "early" : "answered"
        claims.current = addClaim(claims.current, { id: room.id, ms: said, jumped: early })
        room.send(early
            ? { k: "early", n: roundNumber.current }
            : { k: "hit", n: roundNumber.current, ms: said })
        beat()
    }

    const closeRound = () => {
        const result = resolve(claims.current)
        outcome.current = result
        tally.current = credit(tally.current, result.winner)
        phase.current = "shown"
        quiet.current = 0

        const mine = myMs.current
        if (mine !== null && submittable(mine) && (best.current === null || mine < best.current)) best.current = mine
        if (mine !== null && submittable(mine) && scores.available && submitted.current !== roundNumber.current) {
            submitted.current = roundNumber.current
            submit.current(scoreOf(mine))
        }
        beat()
    }

    const runClock = (dt: number) => {
        if (!room.connected && isOnline()) return
        hostTimer.current -= dt
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
        if (phase.current === "now") sinceSignal.current += dt

        // Read before the signal is applied below: a key pressed on the frame the
        // word appears went down before the player could see it.
        let pressed = input.keyboard.anyKeyPressed || input.mouse.wasLeftPressed
        for (const touch of input.touches) if (touch.phase === "began") pressed = true

        if (pressed) {
            if (phase.current === "now") answer(sinceSignal.current * 1000)
            else if (phase.current === "set") answer(null)
        }

        if (pendingSignal.current !== null && pendingSignal.current === roundNumber.current) {
            pendingSignal.current = null
            phase.current = "now"
            sinceSignal.current = 0
            beat()
        }

        const host = room.isHost
        if (host) {
            if (!wasHost.current) {
                hostPhase.current = "rest"
                hostTimer.current = 1.5
            }
            runClock(dt)
        } else {
            quiet.current += dt
            if (quiet.current > STALE && phase.current !== "idle") {
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
            dropped: dropped.current,
            tally: tally.current,
        })
    }

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
                <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 11, color: "rgba(140, 168, 200, 0.7)" }}>
                        {snap.connected ? `round ${snap.round}, ${snap.inRoom} in the room` : "drawing alone, looking for the room"}
                    </Text>
                    {snap.dropped !== null && (
                        <Text style={{ fontSize: 11, marginTop: 2, color: "rgb(230, 130, 140)" }}>
                            {`the room refused a message (${snap.dropped})`}
                        </Text>
                    )}
                </View>
            </View>

            <View style={{
                // No transition here: an animated change delays the thing being timed.
                flexGrow: 1, marginTop: 14, marginBottom: 14, borderRadius: 14,
                backgroundColor: card.background, borderWidth: 1, borderColor: card.border,
                alignItems: "center", justifyContent: "center",
            }}>
                <Text style={{
                    width: "100%", unityTextAlign: "middle-center", whiteSpace: "nowrap",
                    fontSize: Math.round(Math.min(card.size, stage.width / 9)), color: card.color,
                }}>{card.word}</Text>
                <Text style={{
                    width: "100%", unityTextAlign: "middle-center",
                    fontSize: 13, marginTop: 10, color: card.sub,
                }}>{card.note}</Text>
            </View>

            <View style={{ flexDirection: "row", height: 124 }}>
                <Panel title="THIS ROUND" grow={1.3}>
                    {snap.roster.length === 0 && (
                        <Text style={{ fontSize: 12, color: "rgba(150, 175, 205, 0.55)" }}>Waiting for a round.</Text>
                    )}
                    {snap.roster.slice(0, 4).map((id) => {
                        const claim = snap.claims.find((entry) => entry.id === id)
                        const said = claim === undefined ? "..." : claim.jumped ? "too soon" : `${Math.round(claim.ms)} ms`
                        return (
                            <Row key={id} id={id} mine={id === snap.myId}
                                right={said} dim={claim !== undefined && claim.jumped} />
                        )
                    })}
                    {snap.roster.length > 4 && (
                        <Text style={{ fontSize: 11, color: "rgba(150, 175, 205, 0.55)" }}>
                            {`and ${snap.roster.length - 4} more`}
                        </Text>
                    )}
                </Panel>

                <Panel title="ROUNDS WON" grow={1}>
                    {ranking.length === 0 && (
                        <Text style={{ fontSize: 12, color: "rgba(150, 175, 205, 0.55)" }}>Nobody yet.</Text>
                    )}
                    {ranking.slice(0, 4).map((entry) => (
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
                            style={{ flexShrink: 0, flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
                            <Text style={{ fontSize: 12, color: "rgba(206, 224, 244, 0.85)" }}>{entry.name}</Text>
                            <Text style={{ fontSize: 12, color: "rgba(160, 185, 215, 0.8)" }}>{`${msOf(entry.score)} ms`}</Text>
                        </View>
                    ))}
                </Panel>
            </View>
        </View>
    )
}

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

function Row({ id, mine, right, dim }: { id: number; mine: boolean; right: string; dim?: boolean }) {
    return (
        <View style={{
            flexShrink: 0, flexDirection: "row", justifyContent: "space-between",
            alignItems: "center", marginBottom: 2,
        }}>
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
