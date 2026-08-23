/**
 * Leaderboards.
 *
 * A score is a number and a name, and the interesting part is what the site is
 * willing to believe. Submitting needs the play token the host minted when it
 * served this game's document, which stops a stranger with curl filling a board
 * without ever loading the game. It does not stop a player reading that token
 * out of their own page and posting whatever they like, and nothing short of
 * running the game on a server would.
 *
 * That is a deliberate line rather than an oversight. These boards are for
 * bragging, the site says so, and the alternative is moving every game's rules
 * off the player's machine, which is not what this platform is.
 *
 *     await scores.submit(points)
 *     const board = await scores.top({ window: "day" })
 */

import { useCallback, useEffect, useState } from "react"
import { apiUrl, getPlayContext, isOnline } from "./play"

export interface ScoreEntry {
    name: string
    score: number
    /** Seconds since the epoch. */
    at: number
    /** Set on the entry this player just made, so a board can point at it. */
    mine?: boolean
}

export type ScoreWindow = "all" | "week" | "day"

export interface TopOptions {
    window?: ScoreWindow
    /** 1 to 100. Default 10. */
    limit?: number
}

export interface SubmitOptions {
    /**
     * What to call the player. A signed-in author gets their handle whatever
     * this says; everyone else gets this, trimmed, or "anon".
     */
    name?: string
}

async function readJson(response: Response): Promise<any> {
    const text = await response.text()
    try {
        return JSON.parse(text)
    } catch {
        throw new Error(`the site answered with something that was not JSON (${response.status})`)
    }
}

export const scores = {
    /** False in an ejected project, or anywhere with no site behind the game. */
    get available(): boolean {
        return isOnline()
    },

    /**
     * Posts a score and hands back the board it produced.
     *
     * Resolves to null rather than throwing when there is no site: a game
     * should be able to call this unconditionally at the end of a run.
     */
    async submit(score: number, options: SubmitOptions = {}): Promise<ScoreEntry[] | null> {
        const url = apiUrl("/scores")
        const context = getPlayContext()
        if (url === null || context === null) return null
        if (!Number.isFinite(score)) throw new Error("[oj] a score has to be a number")

        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                score: Math.round(score),
                name: options.name,
                token: context.token,
            }),
        })
        const body = await readJson(response)
        if (!response.ok) throw new Error(body?.error ?? `could not submit that score (${response.status})`)
        return body.entries ?? []
    },

    /** The board. Empty rather than an error when there is no site. */
    async top(options: TopOptions = {}): Promise<ScoreEntry[]> {
        const query = new URLSearchParams()
        if (options.window !== undefined) query.set("window", options.window)
        if (options.limit !== undefined) query.set("limit", String(options.limit))
        const suffix = query.toString()
        const url = apiUrl(`/scores${suffix === "" ? "" : `?${suffix}`}`)
        if (url === null) return []

        const response = await fetch(url)
        const body = await readJson(response)
        if (!response.ok) throw new Error(body?.error ?? `could not read the board (${response.status})`)
        return body.entries ?? []
    },
}

export interface Leaderboard {
    entries: ScoreEntry[]
    loading: boolean
    /** The last thing that went wrong, or null. Never thrown at the caller. */
    error: string | null
    refresh(): void
    /** Submits, then refreshes from what the server said. */
    submit(score: number, options?: SubmitOptions): Promise<void>
}

/**
 * The board as a hook, for the panel most games want at the end of a run.
 *
 * Errors are held rather than thrown, because a leaderboard that cannot be
 * reached is a reason to show less, not a reason to take the game down.
 */
export function useLeaderboard(options: TopOptions = {}): Leaderboard {
    const [entries, setEntries] = useState<ScoreEntry[]>([])
    const [loading, setLoading] = useState(scores.available)
    const [error, setError] = useState<string | null>(null)
    const [tick, setTick] = useState(0)

    const window = options.window
    const limit = options.limit

    useEffect(() => {
        if (!scores.available) {
            setLoading(false)
            return
        }
        let live = true
        setLoading(true)
        scores.top({ window, limit }).then(
            (list) => { if (live) { setEntries(list); setError(null); setLoading(false) } },
            (e: unknown) => { if (live) { setError(String((e as Error)?.message ?? e)); setLoading(false) } },
        )
        return () => { live = false }
    }, [window, limit, tick])

    const refresh = useCallback(() => setTick((n) => n + 1), [])

    const submit = useCallback(async (score: number, submitOptions?: SubmitOptions) => {
        try {
            const board = await scores.submit(score, submitOptions)
            // The response already carries the board the score landed in, so
            // showing it costs no second request and cannot disagree with what
            // the server just recorded.
            if (board !== null) setEntries(board)
            setError(null)
        } catch (e: unknown) {
            setError(String((e as Error)?.message ?? e))
        }
    }, [])

    return { entries, loading, error, refresh, submit }
}
