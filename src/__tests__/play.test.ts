import { describe, it, expect, beforeEach } from "vitest"
import { setPlayContext, getPlayContext, isOnline, apiUrl, socketUrl, worldUrl, playContextFrom } from "../play"
import { validRoomName } from "../room"
import { scores } from "../scores"

describe("the play context", () => {
    beforeEach(() => setPlayContext(null))

    it("is offline until a host installs one", () => {
        expect(isOnline()).toBe(false)
        expect(apiUrl("/scores")).toBeNull()
        expect(socketUrl("/rooms/lobby")).toBeNull()
    })

    it("builds an API URL under the game's own id", () => {
        setPlayContext({ api: "https://play.onejs.com", sid: "abc123" })
        expect(apiUrl("/scores")).toBe("https://play.onejs.com/api/games/abc123/scores")
    })

    it("tolerates a path with or without its leading slash", () => {
        setPlayContext({ api: "https://play.onejs.com", sid: "abc123" })
        expect(apiUrl("scores")).toBe(apiUrl("/scores"))
    })

    it("trims a trailing slash off the base rather than doubling it", () => {
        setPlayContext({ api: "https://play.onejs.com/", sid: "abc123" })
        expect(apiUrl("/scores")).toBe("https://play.onejs.com/api/games/abc123/scores")
    })

    it("escapes an id rather than pasting it into a URL", () => {
        setPlayContext({ api: "https://play.onejs.com", sid: "a/b?c" })
        expect(apiUrl("/scores")).toBe("https://play.onejs.com/api/games/a%2Fb%3Fc/scores")
    })

    it("turns https into wss for a socket, and http into ws", () => {
        setPlayContext({ api: "https://play.onejs.com", sid: "abc123" })
        expect(socketUrl("/rooms/lobby")).toBe("wss://play.onejs.com/api/games/abc123/rooms/lobby")
        setPlayContext({ api: "http://127.0.0.1:8787", sid: "abc123" })
        expect(socketUrl("/rooms/lobby")).toBe("ws://127.0.0.1:8787/api/games/abc123/rooms/lobby")
    })

    it("keeps the token the host gave it", () => {
        setPlayContext({ api: "https://x", sid: "s", token: "t0ken" })
        expect(getPlayContext()?.token).toBe("t0ken")
    })

    it("gives the world socket's address with the play token, and null without a site, a token or a world", () => {
        expect(worldUrl()).toBeNull()
        setPlayContext({ api: "https://play.onejs.com", sid: "abc123", token: "a+b/c=", world: true })
        expect(worldUrl()).toBe("wss://play.onejs.com/api/games/abc123/world?token=a%2Bb%2Fc%3D")
        setPlayContext({ api: "http://127.0.0.1:8787", sid: "abc123", token: "t", world: true })
        expect(worldUrl()).toBe("ws://127.0.0.1:8787/api/games/abc123/world?token=t")
        setPlayContext({ api: "https://play.onejs.com", sid: "abc123", world: true })
        expect(worldUrl()).toBeNull()
        setPlayContext({ api: "https://play.onejs.com", sid: "abc123", token: "", world: true })
        expect(worldUrl()).toBeNull()
        setPlayContext({ api: "", sid: "abc123", token: "t", world: true })
        expect(worldUrl()).toBeNull()
        setPlayContext({ api: "https://play.onejs.com", sid: "abc123", token: "t", world: false })
        expect(worldUrl()).toBeNull()
    })

    // A container from before runtime 1.9 copies api, sid, token, room and page out of the
    // manifest and drops the rest, so a site that says a cart has a world is not heard there.
    it("gives no world address where the container dropped the flag", () => {
        const manifest = { api: "https://play.onejs.com", sid: "abc123", token: "t", room: undefined, page: "https://play.onejs.com/x", world: true }
        const { api, sid, token, room, page } = manifest
        setPlayContext({ api, sid, token, room, page })
        expect(worldUrl()).toBeNull()
        setPlayContext(manifest)
        expect(worldUrl()).toBe("wss://play.onejs.com/api/games/abc123/world?token=t")
    })

    it("is read from a manifest's play block, its own fields alone, the world only when it is true", () => {
        const block = { api: "https://x", sid: "s", token: "t", room: "q.lobby.1", page: "https://x/p", world: true, cookie: "c" }
        expect(playContextFrom(block)).toEqual({ api: "https://x", sid: "s", token: "t", room: "q.lobby.1", page: "https://x/p", world: true })
        expect(playContextFrom({ ...block, world: "yes" })).not.toHaveProperty("world")
        expect(playContextFrom({ api: "https://x", sid: "s", token: 3 })).toEqual({ api: "https://x", sid: "s", token: undefined, room: undefined, page: undefined })
        expect(playContextFrom({ sid: "s" })).toBeNull()
        expect(playContextFrom({ api: "https://x" })).toBeNull()
        expect(playContextFrom(undefined)).toBeNull()
        setPlayContext(playContextFrom(block))
        expect(worldUrl()).toBe("wss://x/api/games/s/world?token=t")
    })

    it("goes offline again when the host clears it, which a swap does", () => {
        setPlayContext({ api: "https://x", sid: "s" })
        setPlayContext(null)
        expect(isOnline()).toBe(false)
    })
})

describe("room names", () => {
    it("accepts the ordinary ones", () => {
        for (const name of ["lobby", "room-2", "A1", "a.b_c"]) expect(validRoomName(name)).toBe(true)
    })

    /** A name becomes a URL segment, so anything that could end it is out. */
    it("refuses anything that could escape a path segment", () => {
        for (const name of ["", "a/b", "../x", "a?b", "a b", "a#b", ".hidden", "-lead"]) {
            expect(validRoomName(name)).toBe(false)
        }
    })

    it("refuses an absurdly long one", () => {
        expect(validRoomName("a".repeat(64))).toBe(false)
    })

    it("refuses something that is not a string", () => {
        expect(validRoomName(undefined as never)).toBe(false)
        expect(validRoomName(7 as never)).toBe(false)
    })
})

describe("a score that is not a number", () => {
    // Refused only online, so a NaN from a bug in the run reached nobody until
    // the cart was live.
    it("is refused the same with no site behind the game", async () => {
        await expect(scores.submit(NaN)).rejects.toThrow(/a score has to be a number/)
    })
})

describe("reading the board", () => {
    beforeEach(() => setPlayContext(null))

    /** The site keeps an editor run's scores apart and finds them by this token (PlaySite play-api.ts readBoard). */
    it("says which play session is asking, so an editor run reads its own board", async () => {
        const asked: string[] = []
        const real = globalThis.fetch
        globalThis.fetch = (async (url: string) => {
            asked.push(url)
            return { ok: true, status: 200, text: async () => "{\"entries\":[]}" }
        }) as never
        try {
            setPlayContext({ api: "https://play.onejs.com", sid: "abc123", token: "a.b/c" })
            await scores.top({ limit: 5 })
            setPlayContext({ api: "https://play.onejs.com", sid: "abc123" })
            await scores.top()
        } finally {
            globalThis.fetch = real
        }
        expect(asked).toEqual([
            "https://play.onejs.com/api/games/abc123/scores?limit=5&token=a.b%2Fc",
            "https://play.onejs.com/api/games/abc123/scores",
        ])
    })
})

