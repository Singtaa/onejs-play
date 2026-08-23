/**
 * What a room message does to a room's state.
 *
 * Kept apart from useRoom on purpose. The interesting part of a relay client is
 * not the socket, it is the handful of rules about what each message means, and
 * those rules were previously spelled out inside a useEffect where nothing
 * could reach them. The bug that prompted this split is a good example of the
 * cost: `leave` carries the room's new host, the client ignored it, and a game
 * went on naming a host it had already been told was gone until the relay's
 * sweep came round up to forty seconds later. No test could see it, so a
 * timed two-browser playtest was the only thing that could.
 *
 * A pure function of (state, message), returning the next state and what the
 * game should be told about it. The hook keeps the socket, the refs and the
 * callbacks; this keeps the protocol.
 */

/** Everything a room knows about itself. */
export interface RoomState {
    /** This peer's id, or 0 before the welcome arrives. */
    id: number
    /** Everybody else, in arrival order. */
    peers: readonly number[]
    connected: boolean
    /** Who owns shared state, or null when the room has said nothing yet. */
    hostId: number | null
}

/** A message off the wire. Every field optional: it came from the network. */
export interface Wire {
    t?: string
    id?: number
    from?: number
    peers?: number[]
    host?: number | null
    d?: unknown
    reason?: string
    detail?: string
}

/**
 * What the game should be told, in the order it should be told.
 *
 * Named rather than positional so a caller reads as a list of things that
 * happened, and so adding one later cannot silently reorder the others.
 */
export type RoomEvent =
    | { t: "open"; id: number; peers: readonly number[] }
    | { t: "join"; id: number }
    | { t: "leave"; id: number }
    | { t: "host"; isHost: boolean; hostId: number | null }
    | { t: "message"; from: number; data: unknown }
    | { t: "dropped"; reason: string; detail: string }

export const EMPTY_ROOM: RoomState = { id: 0, peers: [], connected: false, hostId: null }

/** True when this peer owns shared state, including when it is the only one. */
export function isHost(state: RoomState): boolean {
    return state.hostId === null || state.hostId === state.id
}

/**
 * Applies one message.
 *
 * Returns the same state object when a message changes nothing, so a caller can
 * skip a render on the strength of an identity check.
 */
export function applyWire(state: RoomState, wire: Wire): { state: RoomState; events: RoomEvent[] } {
    const events: RoomEvent[] = []

    /**
     * Adds a host event when, and only when, the host actually changed.
     *
     * join and leave carry the host on every message and most of them leave it
     * alone, so a game that redraws on host changes would otherwise redraw on
     * every arrival in the room.
     */
    const withHost = (next: RoomState): RoomState => {
        if (next.hostId === state.hostId && isHost(next) === isHost(state)) return next
        events.push({ t: "host", isHost: isHost(next), hostId: next.hostId })
        return next
    }

    switch (wire.t) {
        case "welcome": {
            const next = withHost({
                id: wire.id ?? 0,
                peers: wire.peers ?? [],
                connected: true,
                hostId: wire.host ?? null,
            })
            // Before the host event, because a game's first frame wants to know
            // who it is before it is told what it owns.
            events.unshift({ t: "open", id: next.id, peers: next.peers })
            return { state: next, events }
        }

        case "host":
            return { state: withHost({ ...state, hostId: wire.host ?? null }), events }

        case "join": {
            if (wire.id === undefined) return { state, events }
            const peers = [...state.peers.filter((p) => p !== wire.id), wire.id]
            const next = withHost({ ...state, peers, hostId: wire.host ?? null })
            events.unshift({ t: "join", id: wire.id })
            return { state: next, events }
        }

        case "leave": {
            if (wire.id === undefined) return { state, events }
            const peers = state.peers.filter((p) => p !== wire.id)
            // The host arrives WITH the departure, because the departure is
            // usually why it changed. Taking it here is what makes promotion
            // immediate rather than something a game waits out.
            const next = withHost({ ...state, peers, hostId: wire.host ?? null })
            events.unshift({ t: "leave", id: wire.id })
            return { state: next, events }
        }

        case "msg":
            if (wire.from === undefined) return { state, events }
            events.push({ t: "message", from: wire.from, data: wire.d })
            return { state, events }

        case "dropped":
            events.push({ t: "dropped", reason: String(wire.reason), detail: String(wire.detail) })
            return { state, events }

        default:
            // An unknown message is not an error: a newer relay may say things
            // an older game has never heard of, and the game should carry on.
            return { state, events }
    }
}
