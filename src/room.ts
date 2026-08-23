/**
 * Rooms: several people in the same game at the same time.
 *
 * A room is a relay and nothing more. The site holds one small object per room
 * that keeps the sockets, hands each arrival an id, and passes messages
 * between them. It does not know what a message means, does not simulate
 * anything, and cannot be asked to: the whole point of this platform is that a
 * game is a JavaScript bundle, and a game whose rules lived on the server would
 * be two programs in two languages in two repositories.
 *
 * WHAT THAT MEANS FOR TRUST
 *
 * Every client is the authority on itself and on nothing else. It broadcasts
 * where it is; it decides when it has been eaten, hit or scored on. That rule
 * is worth stating because it is the one that keeps a relay honest: a player
 * can lie about their own position, which makes them look strange, but cannot
 * reach into anybody else's game and kill them.
 *
 * Games that need real authority want a server, and that is a different
 * product. These are for playing with friends.
 *
 * WHO IS THE HOST
 *
 * Some things need one owner: a food field, a round clock. `room.isHost` says
 * whether that is you, and the answer comes from the room rather than from a
 * rule each game evaluates for itself.
 *
 * That used to be "the lowest peer id present", copied into every multiplayer
 * game, and it was wrong in a way none of them could see. A socket whose
 * browser had gone stayed in the peer list, so clients elected a corpse: it
 * broadcast nothing, everybody fell back to their own clock, and the game
 * desynced completely. The room is the only party that knows who is actually
 * connected, so the room decides.
 *
 *     const room = useRoom("lobby", {
 *         onMessage: (from, data) => others.set(from, data),
 *         onLeave: (id) => others.delete(id),
 *     })
 *     room.send({ x, y })
 */

import { useEffect, useRef, useState } from "react"
import { getPlayContext, socketUrl } from "./play"

/** Anything JSON can carry. Messages are serialised, so functions are not. */
export type RoomMessage = unknown

/** How often a client says it is still there. Well under the room's timeout. */
const HEARTBEAT_MS = 25_000

export interface RoomOptions {
    /** Someone said something. `from` is their peer id. */
    onMessage?: (from: number, data: RoomMessage) => void
    /** Someone arrived. Not called for the peers already present at join. */
    onJoin?: (id: number) => void
    /** Someone left, or their connection did. */
    onLeave?: (id: number) => void
    /** The connection opened, and this is the room as it stood. */
    onOpen?: (id: number, peers: readonly number[]) => void
    /** The connection went away. A reconnect is already being attempted. */
    onClose?: (reason: string) => void
    /**
     * The room named a new owner for whatever needs one, possibly you.
     *
     * Also fired on join and when somebody leaves, since either can change it.
     */
    onHost?: (isHost: boolean, hostId: number | null) => void
    /**
     * Something you sent went nowhere: too large, or too fast. Worth logging
     * during development, because the alternative is a game quietly missing
     * events and nobody knowing why.
     */
    onDropped?: (reason: string, detail: string) => void
}

export interface Room {
    readonly connected: boolean
    /** This client's id in this room, or 0 before the welcome arrives. */
    readonly id: number
    /** Everybody else, most recent last. */
    readonly peers: readonly number[]
    /**
     * Whether this client owns whatever needs one owner.
     *
     * True when alone, so a game works with nobody else there. Decided by the
     * room, not by a rule you evaluate: see the header.
     */
    readonly isHost: boolean
    /** Who the host is, or null before the welcome arrives. */
    readonly hostId: number | null
    /**
     * Sends to everyone else, or to one peer when `to` is given.
     *
     * Silently dropped while offline, so a game can send unconditionally.
     */
    send(data: RoomMessage, to?: number): void
    /** Leaves for good. The hook does this on unmount. */
    close(): void
}

/** How long to wait before trying again, growing to a ceiling. */
const RETRY_MIN_MS = 400
const RETRY_MAX_MS = 8000

/** A room name has to survive being a URL segment. */
export function validRoomName(name: string): boolean {
    return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(name)
}

interface Wire {
    t: string
    id?: number
    from?: number
    peers?: number[]
    /** Who the room says owns shared state. Null when the room is empty. */
    host?: number | null
    d?: unknown
    reason?: string
    detail?: string
}

/**
 * Joins a room for as long as the component is mounted.
 *
 * The returned object is stable across renders and its fields are live, so a
 * frame loop can read `room.peers` without the hook re-subscribing sixty times
 * a second. `connected` and `peers` are also mirrored into state, so a
 * component that wants to render a player list re-renders when one changes.
 */
export function useRoom(name: string, options: RoomOptions = {}): Room {
    /**
     * Forces a render when the room's shape changes.
     *
     * A counter rather than mirrored copies of id, peers and connected: the
     * facade already reads those from a ref so a frame loop can touch them
     * without re-subscribing, and keeping a second copy in state would only be
     * a second thing to get out of step with the first.
     */
    const [, bump] = useState(0)
    const render = () => bump((n) => n + 1)

    // Held in a ref so a handler that closes over new state each render does
    // not tear the socket down and rebuild it.
    const handlers = useRef(options)
    handlers.current = options

    const socket = useRef<WebSocket | null>(null)
    const closed = useRef(false)
    const live = useRef({ id: 0, peers: [] as number[], connected: false, hostId: null as number | null })

    const facade = useRef<Room | null>(null)
    if (facade.current === null) {
        facade.current = {
            get connected() { return live.current.connected },
            get id() { return live.current.id },
            get peers() { return live.current.peers },
            get hostId() { return live.current.hostId },
            /**
             * True when alone, so a single player game still runs.
             *
             * Before the welcome arrives id is 0 and hostId is null, and this
             * reads true: a game that lays out a level on the first frame
             * should do it rather than wait for a room it may never reach.
             */
            get isHost() {
                const { id, hostId } = live.current
                return hostId === null || hostId === id
            },
            send(data: RoomMessage, to?: number) {
                const ws = socket.current
                if (ws === null || ws.readyState !== 1) return
                try {
                    ws.send(JSON.stringify(to === undefined
                        ? { t: "msg", d: data }
                        : { t: "msg", d: data, to }))
                } catch (error) {
                    console.warn("[oj] could not send to the room:", error)
                }
            },
            close() {
                closed.current = true
                socket.current?.close()
            },
        }
    }

    useEffect(() => {
        if (!validRoomName(name)) {
            console.warn(`[oj] "${name}" is not a usable room name`)
            return
        }
        const context = getPlayContext()
        const base = socketUrl(`/rooms/${encodeURIComponent(name)}`)
        if (base === null || context === null) {
            // No site behind the game, which is the ejected case. Everything
            // stays offline and send() is a no-op rather than a crash.
            return
        }
        const url = context.token === undefined ? base : `${base}?token=${encodeURIComponent(context.token)}`

        closed.current = false
        let retry = RETRY_MIN_MS
        let timer: ReturnType<typeof setTimeout> | null = null
        let heartbeat: ReturnType<typeof setInterval> | null = null

        const apply = (next: Partial<typeof live.current>) => {
            live.current = { ...live.current, ...next }
        }

        const open = () => {
            let ws: WebSocket
            try {
                ws = new WebSocket(url)
            } catch (error) {
                console.warn("[oj] could not reach the room:", error)
                return
            }
            socket.current = ws

            ws.onopen = () => {
                retry = RETRY_MIN_MS
                /**
                 * A heartbeat, because message traffic is not liveness.
                 *
                 * An arcade game sends fifteen times a second and a turn-based
                 * one can sit silent between rounds, and only one of those
                 * should be reaped. Without this the room cannot tell a quiet
                 * player from a closed browser, which is how rooms filled with
                 * ghosts and games elected a host that was never coming back.
                 */
                heartbeat = setInterval(() => {
                    if (ws.readyState !== 1) return
                    try {
                        ws.send(JSON.stringify({ t: "hb" }))
                    } catch {
                        // The close handler deals with a socket that has gone.
                    }
                }, HEARTBEAT_MS)
            }

            ws.onmessage = (event: MessageEvent) => {
                let wire: Wire
                try {
                    wire = JSON.parse(String(event.data))
                } catch {
                    return
                }
                if (wire.t === "welcome") {
                    const mine = wire.id ?? 0
                    const list = wire.peers ?? []
                    apply({ id: mine, peers: list, connected: true, hostId: wire.host ?? null })
                    render()
                    handlers.current.onOpen?.(mine, list)
                    handlers.current.onHost?.(facade.current!.isHost, live.current.hostId)
                    return
                }

                if (wire.t === "host") {
                    apply({ hostId: wire.host ?? null })
                    render()
                    handlers.current.onHost?.(facade.current!.isHost, live.current.hostId)
                    return
                }

                if (wire.t === "dropped") {
                    // Not silent. A game quietly missing events because it was
                    // over budget is the exact failure this reports.
                    console.warn(`[oj] the room dropped a message (${wire.reason}): ${wire.detail}`)
                    handlers.current.onDropped?.(String(wire.reason), String(wire.detail))
                    return
                }
                if (wire.t === "join" && wire.id !== undefined) {
                    const list = [...live.current.peers.filter((p) => p !== wire.id), wire.id]
                    apply({ peers: list })
                    render()
                    handlers.current.onJoin?.(wire.id)
                    return
                }
                if (wire.t === "leave" && wire.id !== undefined) {
                    const list = live.current.peers.filter((p) => p !== wire.id)
                    apply({ peers: list })
                    render()
                    handlers.current.onLeave?.(wire.id)
                    return
                }
                if (wire.t === "msg" && wire.from !== undefined) {
                    handlers.current.onMessage?.(wire.from, wire.d)
                }
            }

            const gone = (reason: string) => {
                if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null }
                if (socket.current !== ws) return
                socket.current = null
                apply({ connected: false, peers: [], id: 0, hostId: null })
                render()
                handlers.current.onClose?.(reason)
                if (closed.current) return
                // Backed off, because a room that is full or a site that is
                // down should not be hammered by every tab that wanted in.
                timer = setTimeout(open, retry)
                retry = Math.min(RETRY_MAX_MS, retry * 2)
            }

            ws.onerror = () => gone("error")
            ws.onclose = (event: CloseEvent) => gone(event?.reason || "closed")
        }

        open()

        return () => {
            closed.current = true
            if (timer !== null) clearTimeout(timer)
            if (heartbeat !== null) clearInterval(heartbeat)
            const ws = socket.current
            socket.current = null
            ws?.close()
        }
        // Deliberately keyed on the room alone: the handlers live in a ref, so
        // a parent re-rendering does not disconnect everyone.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name])

    return facade.current
}
