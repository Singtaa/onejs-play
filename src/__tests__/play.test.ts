import { describe, it, expect, beforeEach } from "vitest"
import { setPlayContext, getPlayContext, isOnline, apiUrl, socketUrl } from "../play"
import { validRoomName } from "../room"

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
