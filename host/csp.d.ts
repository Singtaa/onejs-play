export interface GameCspOptions {
    /** Where a build's files are read from, on the site. */
    store?: string | null
    /** An analytics script the site's host injects, and where it reports. */
    beacon?: { script: string, report: string } | null
    /** Framable by any page: the embed case. Otherwise by the site only. */
    anywhere?: boolean
}

/** The Content Security Policy a game runs under, on its own origin and on `ojplay run`'s page alike. */
export function gameCsp(site: string, options?: GameCspOptions): string
