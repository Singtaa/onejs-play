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
 * NAMES, SEATS AND A HIDDEN HOST (6 Nov 2026)
 *
 * Every player has a name the room gives it (`room.name`, `room.nameOf(id)`):
 * the handle of whoever is signed in, otherwise a guest name like "Brisk
 * Otter". A connection that drops and comes back from the same page gets its
 * own id and name back for a minute, and `onJoin` says `back`, so a game keeps
 * its score. A page that is hidden (a locked phone) stops being host, so the
 * round clock moves to somebody who is still playing.
 *
 * QUICK PLAY
 *
 * `useRoom({ max: 12 })` asks the site for a room rather than naming one: the
 * newest room of this cart's pool that has a seat and whose host has not said
 * `room.setJoinable(false)`, or a new one. `room.roomName` says which, and a
 * reconnect goes back to that room rather than being matched again. `pool`
 * keeps modes apart (`{ pool: "teams", max: 8 }`).
 *
 * `room.inviteUrl` is the cart's page with that room on it (`?room=`):
 * whoever opens it is sent to the same room while it has a seat and is
 * joinable, and matched as usual when it has not. The editor's runs have
 * rooms of their own, apart from the cart's players.
 *
 *     const room = useRoom("lobby", {
 *         onMessage: (from, data) => others.set(from, data),
 *         onLeave: (id) => others.delete(id),
 *     })
 *     room.send({ x, y })
 */

import { useEffect, useRef, useState } from "react"
import { EMPTY_ROOM, applyWire, invitedRoom, inviteLink, isHost as roomIsHost } from "./wire"
import type { RoomState, Wire } from "./wire"
import { getPlayContext, socketUrl, isPageHidden, onPageHidden } from "./play"

/** Anything JSON can carry. Messages are serialised, so functions are not. */
export type RoomMessage = unknown

/** Quick play: let the site pick a room with a seat (see the header). */
export interface QuickPlay {
    /** How many players a room is filled to, 2 to 24. Default 24. */
    max?: number
    /** Which queue: games with modes keep each apart. 1 to 16 of a-z, 0-9 and "-". Default "quick". */
    pool?: string
}

/** How often a client says it is still there. Well under the room's timeout. */
const HEARTBEAT_MS = 25_000

/**
 * The protocol this client speaks. 2 reads batch frames and names; the room
 * sends a client that does not say so one message per frame, as before.
 */
const PROTOCOL = 2

export interface RoomOptions {
    /** Someone said something. `from` is their peer id. */
    onMessage?: (from: number, data: RoomMessage) => void
    /**
     * Someone arrived. Not called for the peers already present at join.
     * `back` is true for a player whose connection dropped and who returned
     * to the same seat, same id and name, within a minute.
     */
    onJoin?: (id: number, name: string, back: boolean) => void
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
    /** What the room calls you: your handle when signed in, else a guest name. "" before the welcome. */
    readonly name: string
    /** What the room calls a peer, or "" for an id it has not named. */
    nameOf(id: number): string
    /** The room you are in: the name you gave, or the one quick play chose. "" before the welcome. */
    readonly roomName: string
    /**
     * A link that brings a friend into this room: the cart's page, with the
     * room on it for quick play. "" before the welcome, and with no site
     * behind the game.
     */
    readonly inviteUrl: string
    /**
     * Whether quick play may send more players here. The host's call (a match
     * under way, say), ignored from anybody else; an empty room starts open.
     */
    setJoinable(on: boolean): void
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

/**
 * Joins a room for as long as the component is mounted.
 *
 * The returned object is stable across renders and its fields are live, so a
 * frame loop can read `room.peers` without the hook re-subscribing sixty times
 * a second. `connected` and `peers` are also mirrored into state, so a
 * component that wants to render a player list re-renders when one changes.
 */
export function useRoom(where: string | QuickPlay, options: RoomOptions = {}): Room {
    // A string is a room's name; an object is quick play in a pool. Keyed as
    // one string, so the effect below reconnects only when it changes.
    const quick = typeof where === "string" ? null : { pool: where.pool ?? "quick", max: Math.floor(where.max ?? 24) }
    const name = typeof where === "string" ? where : quick!.pool
    const key = quick === null ? `room:${name}` : `quick:${quick.pool}:${quick.max}`

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
    const live = useRef<RoomState>(EMPTY_ROOM)

    const facade = useRef<Room | null>(null)
    if (facade.current === null) {
        facade.current = {
            get connected() { return live.current.connected },
            get id() { return live.current.id },
            get peers() { return live.current.peers },
            get hostId() { return live.current.hostId },
            get name() { return live.current.name },
            get roomName() { return live.current.room !== "" ? live.current.room : live.current.connected ? name : "" },
            get inviteUrl() { return inviteLink(getPlayContext()?.page, quick !== null, this.roomName) },
            setJoinable(on: boolean) {
                const ws = socket.current
                if (ws === null || ws.readyState !== 1) return
                try {
                    ws.send(JSON.stringify({ t: "joinable", on }))
                } catch (error) {
                    console.warn("[oj] could not tell the room:", error)
                }
            },
            nameOf(id: number) { return id === live.current.id ? live.current.name : live.current.names[id] ?? "" },
            /**
             * True when alone, so a single player game still runs.
             *
             * Before the welcome arrives id is 0 and hostId is null, and this
             * reads true: a game that lays out a level on the first frame
             * should do it rather than wait for a room it may never reach.
             */
            get isHost() {
                return roomIsHost(live.current)
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
        if (quick === null ? !validRoomName(name) : !/^[a-z0-9-]{1,16}$/.test(name)) {
            console.warn(`[oj] "${name}" is not a usable ${quick === null ? "room name" : "quick play pool"}`)
            return
        }
        const context = getPlayContext()
        if (socketUrl("/rooms") === null || context === null) {
            // No site behind the game, which is the ejected case. Everything
            // stays offline and send() is a no-op rather than a crash.
            return
        }
        // This hook's seat, kept across its own reconnects so a dropped
        // connection comes back as the same player (same id and name).
        const seat = Math.random().toString(36).slice(2, 12) || "s"
        const query = `v=${PROTOCOL}&seat=${seat}${context.token === undefined ? "" : `&token=${encodeURIComponent(context.token)}`}`
        /**
         * The room quick play put this hook in, once a welcome has said.
         * Reconnects go there, so a dropped player returns to its own match
         * and its own seat instead of being matched into another.
         */
        let joined = ""
        // The room an invite link named, asked for until a welcome says where this hook is.
        const invited = quick === null ? "" : invitedRoom(context.room, quick.pool)
        const address = () => joined !== ""
            ? `${socketUrl(`/rooms/${encodeURIComponent(joined)}`)}?${query}`
            : `${socketUrl(`/rooms/${encodeURIComponent(name)}`)}?${query}${quick === null ? ""
                : `&quick=${quick.max}${invited === "" ? "" : `&at=${encodeURIComponent(invited)}`}`}`

        closed.current = false
        let retry = RETRY_MIN_MS
        let timer: ReturnType<typeof setTimeout> | null = null
        let heartbeat: ReturnType<typeof setInterval> | null = null

        /** Tells the room whether this page is showing, so a hidden one is not left holding the host. */
        const sayVisibility = (hidden: boolean) => {
            const ws = socket.current
            if (ws === null || ws.readyState !== 1) return
            try {
                ws.send(JSON.stringify({ t: "vis", hidden }))
            } catch {
                // The close handler deals with a socket that has gone.
            }
        }
        const stopWatchingPage = onPageHidden(sayVisibility)

        const apply = (next: Partial<RoomState>) => {
            live.current = { ...live.current, ...next }
        }

        const open = () => {
            let ws: WebSocket
            try {
                ws = new WebSocket(address())
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
                // "ping" rather than a JSON heartbeat: the room answers it
                // without waking (an auto-response), and still counts it as
                // the socket being alive.
                heartbeat = setInterval(() => {
                    if (ws.readyState !== 1) return
                    try {
                        ws.send("ping")
                    } catch {
                        // The close handler deals with a socket that has gone.
                    }
                }, HEARTBEAT_MS)
                // A room assumes a page is showing; say so only when it is not.
                if (isPageHidden()) sayVisibility(true)
            }

            // Typed by what is read: OneJS's WebSocket (its global.d.ts) and the
            // DOM's hand over different event types, and both carry these.
            ws.onmessage = (event: { data: unknown }) => {
                let wire: Wire
                try {
                    wire = JSON.parse(String(event.data))
                } catch {
                    return
                }
                const { state: next, events } = applyWire(live.current, wire)
                if (quick !== null && next.room !== "") joined = next.room
                if (next !== live.current) {
                    apply(next)
                    render()
                }
                for (const event of events) {
                    if (event.t === "open") handlers.current.onOpen?.(event.id, event.peers)
                    else if (event.t === "join") handlers.current.onJoin?.(event.id, event.name, event.back)
                    else if (event.t === "leave") handlers.current.onLeave?.(event.id)
                    else if (event.t === "host") handlers.current.onHost?.(event.isHost, event.hostId)
                    else if (event.t === "message") handlers.current.onMessage?.(event.from, event.data)
                    else if (event.t === "dropped") {
                        // Not silent. A game quietly missing events because it
                        // was over budget is the exact failure this reports.
                        console.warn(`[oj] the room dropped a message (${event.reason}): ${event.detail}`)
                        handlers.current.onDropped?.(event.reason, event.detail)
                    }
                }
            }

            const gone = (reason: string) => {
                if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null }
                if (socket.current !== ws) return
                socket.current = null
                apply(EMPTY_ROOM)
                render()
                handlers.current.onClose?.(reason)
                if (closed.current) return
                // Backed off, because a room that is full or a site that is
                // down should not be hammered by every tab that wanted in.
                timer = setTimeout(open, retry)
                retry = Math.min(RETRY_MAX_MS, retry * 2)
            }

            ws.onerror = () => gone("error")
            ws.onclose = (event: { reason?: string }) => gone(event?.reason || "closed")
        }

        open()

        return () => {
            closed.current = true
            stopWatchingPage()
            if (timer !== null) clearTimeout(timer)
            if (heartbeat !== null) clearInterval(heartbeat)
            const ws = socket.current
            socket.current = null
            ws?.close()
        }
        // Deliberately keyed on the room alone: the handlers live in a ref, so
        // a parent re-rendering does not disconnect everyone. `key` is `name`
        // and `quick` as one string, since a QuickPlay object is new each render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    return facade.current
}
