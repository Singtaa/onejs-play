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
