import { describe, it, expect } from "vitest"
import { EMPTY_ROOM, applyWire, isHost, type RoomState } from "../wire"

/**
 * The rules a relay client follows, tested without a socket.
 *
 * These exist because of a bug no test could have caught: `leave` carries the
 * room's new host, the client dropped it, and promotion waited on the relay's
 * next sweep instead. A two-browser playtest measured the gap at 38 seconds.
 * Everything below is a rule that was previously only checkable by playing.
 */

/** Runs a sequence of messages, the way a session actually arrives. */
function session(...wires: Parameters<typeof applyWire>[1][]) {
    let state = EMPTY_ROOM
    const events: ReturnType<typeof applyWire>["events"] = []
    for (const wire of wires) {
        const step = applyWire(state, wire)
        state = step.state
        events.push(...step.events)
    }
    return { state, events }
}

describe("applyWire", () => {
    it("takes an id, a peer list and a host from the welcome", () => {
        const { state } = session({ t: "welcome", id: 7, peers: [3, 4], host: 3 })
        expect(state).toEqual({ id: 7, peers: [3, 4], connected: true, hostId: 3 })
    })

    it("reports open before host, so a game knows who it is first", () => {
        const { events } = session({ t: "welcome", id: 7, peers: [3], host: 3 })
        expect(events.map((e) => e.t)).toEqual(["open", "host"])
    })

    it("adds an arrival to the peer list", () => {
        const { state } = session(
            { t: "welcome", id: 1, peers: [], host: 1 },
            { t: "join", id: 2, host: 1 },
        )
        expect(state.peers).toEqual([2])
    })

    it("does not add the same peer twice", () => {
        const { state } = session(
            { t: "welcome", id: 1, peers: [2], host: 1 },
            { t: "join", id: 2, host: 1 },
        )
        expect(state.peers).toEqual([2])
    })

    it("removes a peer that left", () => {
        const { state } = session(
            { t: "welcome", id: 1, peers: [2, 3], host: 1 },
            { t: "leave", id: 2, host: 1 },
        )
        expect(state.peers).toEqual([3])
    })

    /** The bug. A game must be promoted by the departure, not by a later sweep. */
    it("promotes on the leave that caused it, not on a later host message", () => {
        const joined = applyWire(EMPTY_ROOM, { t: "welcome", id: 9, peers: [4], host: 4 }).state
        expect(isHost(joined)).toBe(false)

        // The departure alone, with no host message following it.
        const { state, events } = applyWire(joined, { t: "leave", id: 4, host: 9 })
        expect(state.hostId).toBe(9)
        expect(isHost(state)).toBe(true)
        expect(events).toEqual([
            { t: "leave", id: 4 },
            { t: "host", isHost: true, hostId: 9 },
        ])
    })

    it("hands the host over on a join, when the relay says so", () => {
        const { state } = session(
            { t: "welcome", id: 9, peers: [], host: 9 },
            { t: "join", id: 10, host: 9 },
        )
        expect(state.hostId).toBe(9)
    })

    it("says nothing about the host when an arrival did not change it", () => {
        const { events } = session(
            { t: "welcome", id: 1, peers: [], host: 1 },
            { t: "join", id: 2, host: 1 },
            { t: "join", id: 3, host: 1 },
        )
        // One for the welcome, and none for either arrival.
        expect(events.filter((e) => e.t === "host")).toHaveLength(1)
    })

    it("reports a host change once, however it arrived", () => {
        const { events } = session(
            { t: "welcome", id: 2, peers: [1], host: 1 },
            { t: "host", host: 2 },
        )
        const hosts = events.filter((e) => e.t === "host")
        expect(hosts).toHaveLength(2)
        expect(hosts[1]).toEqual({ t: "host", isHost: true, hostId: 2 })
    })

    it("passes a message through with its sender", () => {
        const { events } = session({ t: "msg", from: 5, d: { x: 1 } })
        expect(events).toEqual([{ t: "message", from: 5, data: { x: 1 } }])
    })

    it("reports a refusal rather than swallowing it", () => {
        const { events } = session({ t: "dropped", reason: "too-fast", detail: "60 a second" })
        expect(events).toEqual([{ t: "dropped", reason: "too-fast", detail: "60 a second" }])
    })

    it("ignores a message with no id where one is required", () => {
        const before: RoomState = { id: 1, peers: [2], connected: true, hostId: 1 }
        expect(applyWire(before, { t: "join" }).state).toBe(before)
        expect(applyWire(before, { t: "leave" }).state).toBe(before)
    })

    /**
     * A newer relay saying something an older game has never heard of is not an
     * error, and a game that treated it as one could not be deployed alongside
     * a newer site.
     */
    it("carries on past a message it does not know", () => {
        const before: RoomState = { id: 1, peers: [], connected: true, hostId: 1 }
        const { state, events } = applyWire(before, { t: "something-new" })
        expect(state).toBe(before)
        expect(events).toEqual([])
    })
})

describe("isHost", () => {
    it("is true when the room has named you", () => {
        expect(isHost({ id: 4, peers: [], connected: true, hostId: 4 })).toBe(true)
    })

    it("is false when the room has named somebody else", () => {
        expect(isHost({ id: 4, peers: [7], connected: true, hostId: 7 })).toBe(false)
    })

    /**
     * True before the welcome and true alone, so a solo player still runs the
     * clock and a game needs no separate single player path.
     */
    it("is true when the room has said nothing yet", () => {
        expect(isHost(EMPTY_ROOM)).toBe(true)
    })
})
