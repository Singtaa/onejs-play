/**
 * What the container knows about the site a game is being played on.
 *
 * A game bundle has no idea where it is running. It cannot read its own id
 * (that is a DNS label on an origin it is not allowed to inspect through
 * anything but `location`), it has no session, and it must not be handed one.
 * So the host tells it: the container receives an endpoint and a short-lived
 * play token in the manifest and installs them here.
 *
 * Everything that talks to the site (leaderboards, rooms) goes through this,
 * and all of it degrades to "not available" rather than throwing when there is
 * no host: an ejected game runs in a Unity project with no site behind it, and
 * a score that cannot be submitted should not be a crash.
 */

export interface PlayContext {
    /** Absolute base for the site's API, without a trailing slash. */
    api: string
    /** This game's opaque id. */
    sid: string
    /**
     * Proof that this is a real play session rather than a script.
     *
     * Short-lived and minted by the host when it serves the game's document.
     * It is not a secret worth much: it stops casual submission by anyone with
     * curl, and nothing stops a determined player reading it out of their own
     * page. Leaderboards here are for fun, and are described that way.
     */
    token?: string
    /** The quick play room an invite link named, which useRoom asks for first. */
    room?: string
    /** The cart's page on the site, which `room.inviteUrl` is made from. */
    page?: string
}

let context: PlayContext | null = null

/** Called by the host. Games have no reason to touch this. */
export function setPlayContext(next: PlayContext | null): void {
    context = next === null ? null : { ...next, api: next.api.replace(/\/+$/, "") }
}

export function getPlayContext(): PlayContext | null {
    return context
}

/** True when there is a site to talk to at all. */
export function isOnline(): boolean {
    return context !== null && context.api !== ""
}

/** Builds an API URL for this game, or null when there is no host. */
export function apiUrl(path: string): string | null {
    if (context === null || context.api === "") return null
    const clean = path.startsWith("/") ? path : `/${path}`
    return `${context.api}/api/games/${encodeURIComponent(context.sid)}${clean}`
}

/** The same, as a WebSocket address. */
export function socketUrl(path: string): string | null {
    const url = apiUrl(path)
    if (url === null) return null
    return url.replace(/^http:/, "ws:").replace(/^https:/, "wss:")
}

/**
 * The address of this cart's world socket, with the page's play token in it:
 * `wss://<site>/api/games/<sid>/world?token=<token>`. A world is a server that
 * every player of the cart shares, run by its author somewhere else, which the
 * site passes the socket to whole. Null when there is no site, or no token to
 * prove the page was served by it (the editor, an ejected Unity project).
 *
 * The runtime cannot tell whether a cart has a world, so a cart without one
 * gets an address that answers 404. The token is short-lived: ask again for each
 * connection rather than keeping the address.
 */
export function worldUrl(): string | null {
    const base = socketUrl("/world")
    const token = context?.token
    if (base === null || token === undefined || token === "") return null
    return `${base}?token=${encodeURIComponent(token)}`
}

/**
 * Whether the page the game is on is hidden: a locked phone, a tab in the
 * background. Reported by the container's DOM adapter (adapter.ts, the one file
 * here that touches the DOM) and read by rooms, which hand the host to a page
 * that is showing (room.ts). False wherever nobody reports it, such as the
 * editor, which is the right answer there.
 */
let pageHidden = false
const pageListeners = new Set<(hidden: boolean) => void>()

/** Called by the adapter. Games have no reason to touch this. */
export function setPageHidden(hidden: boolean): void {
    if (hidden === pageHidden) return
    pageHidden = hidden
    for (const listener of pageListeners) listener(hidden)
}

export function isPageHidden(): boolean {
    return pageHidden
}

/** Calls `listener` whenever the page is hidden or shown. Returns the unsubscribe. */
export function onPageHidden(listener: (hidden: boolean) => void): () => void {
    pageListeners.add(listener)
    return () => { pageListeners.delete(listener) }
}
