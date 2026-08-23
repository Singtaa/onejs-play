import { describe, it, expect } from "vitest"
import {
    platformRadius, isOff, spawnAt, steer, advance, leashVelocity, leashDelta,
    beginRound, applyFall, standing, isOver, winnerOf, credit, syncClock, Slots,
    ARENA_W, CENTER_X, CENTER_Y, START_RADIUS, MIN_RADIUS, GRACE, SHRINK_PER_SECOND,
    ROUND_CAP, SNAP_DISTANCE, MAX_BLOBS, SETTLE, REST, type Track,
} from "./arena"

const track = (x: number, y: number, vx = 0, vy = 0): Track => ({ x, y, vx, vy, quiet: 0 })

describe("the ring", () => {
    it("holds its full size through the grace period", () => {
        expect(platformRadius(0)).toBe(START_RADIUS)
        expect(platformRadius(GRACE)).toBe(START_RADIUS)
    })

    it("never grows, whenever it is asked", () => {
        for (let i = 0; i < 500; i++) {
            const a = Math.random() * 90
            const b = a + Math.random() * 90
            expect(platformRadius(b)).toBeLessThanOrEqual(platformRadius(a))
        }
    })

    it("never shrinks past the smallest ring worth standing on", () => {
        for (let t = 0; t < 200; t += 0.37) expect(platformRadius(t)).toBeGreaterThanOrEqual(MIN_RADIUS)
    })

    it("closes fast enough to end a round well inside the cap", () => {
        const closed = GRACE + (START_RADIUS - MIN_RADIUS) / SHRINK_PER_SECOND
        expect(closed).toBeLessThan(ROUND_CAP)
        expect(platformRadius(closed)).toBeCloseTo(MIN_RADIUS, 6)
    })
})

describe("falling off", () => {
    it("counts the edge as still standing, and a hair past it as gone", () => {
        expect(isOff(CENTER_X + 100, CENTER_Y, 100)).toBe(false)
        expect(isOff(CENTER_X + 100.5, CENTER_Y, 100)).toBe(true)
    })

    it("agrees with the distance from the middle, from any angle", () => {
        for (let i = 0; i < 500; i++) {
            const angle = Math.random() * Math.PI * 2
            const distance = Math.random() * 400
            const radius = 60 + Math.random() * 240
            const x = CENTER_X + Math.cos(angle) * distance
            const y = CENTER_Y + Math.sin(angle) * distance
            expect(isOff(x, y, radius)).toBe(distance > radius)
        }
    })

    /** The ring closing under a blob that has not moved has to put it out. */
    it("catches somebody the ring shrank away from", () => {
        const x = CENTER_X + START_RADIUS - 10
        expect(isOff(x, CENTER_Y, platformRadius(0))).toBe(false)
        expect(isOff(x, CENTER_Y, platformRadius(ROUND_CAP))).toBe(true)
    })
})

describe("spawning", () => {
    it("puts everybody inside the ring", () => {
        for (let count = 1; count <= MAX_BLOBS; count++) {
            for (let i = 0; i < count; i++) {
                const at = spawnAt(i, count)
                expect(Math.hypot(at.x - CENTER_X, at.y - CENTER_Y)).toBeLessThan(START_RADIUS)
            }
        }
    })

    it("never puts two players in the same place", () => {
        for (let count = 2; count <= MAX_BLOBS; count++) {
            const seen = new Set<string>()
            for (let i = 0; i < count; i++) {
                const at = spawnAt(i, count)
                seen.add(`${at.x.toFixed(3)},${at.y.toFixed(3)}`)
            }
            expect(seen.size).toBe(count)
        }
    })

    it("spaces them evenly, so no two start closer than any other pair", () => {
        const gap = (count: number) => {
            const a = spawnAt(0, count)
            const b = spawnAt(1, count)
            return Math.hypot(a.x - b.x, a.y - b.y)
        }
        for (let count = 3; count <= MAX_BLOBS; count++) {
            const first = gap(count)
            const a = spawnAt(count - 1, count)
            const b = spawnAt(0, count)
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(first, 6)
        }
    })
})

describe("steering", () => {
    it("is a unit push in whatever direction was asked for", () => {
        for (let i = 0; i < 500; i++) {
            const x = (Math.random() - 0.5) * 2000
            const y = (Math.random() - 0.5) * 2000
            const push = steer(x, y)
            expect(Math.hypot(push.x, push.y)).toBeCloseTo(1, 10)
            // Same direction: the cross product of two parallel vectors is 0.
            expect(x * push.y - y * push.x).toBeCloseTo(0, 6)
        }
    })

    it("does not make two keys faster than one", () => {
        const one = steer(1, 0)
        const two = steer(1, 1)
        expect(Math.hypot(two.x, two.y)).toBeCloseTo(Math.hypot(one.x, one.y), 10)
    })

    it("is nothing at all when nothing is held", () => {
        expect(steer(0, 0)).toEqual({ x: 0, y: 0 })
    })
})

describe("the leash on somebody else's blob", () => {
    it("is exactly their own velocity when they are where they said", () => {
        const t = track(300, 300, 120, -80)
        const v = leashVelocity(300, 300, t)
        expect(v.x).toBeCloseTo(120, 10)
        expect(v.y).toBeCloseTo(-80, 10)
    })

    it("never turns a correction into a projectile, however far behind it is", () => {
        for (let i = 0; i < 500; i++) {
            const t = track(Math.random() * ARENA_W, Math.random() * ARENA_W,
                (Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800)
            const v = leashVelocity(Math.random() * ARENA_W, Math.random() * ARENA_W, t)
            expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(900.0001)
        }
    })

    it("closes the gap rather than orbiting it", () => {
        const t = track(500, 300, 0, 0)
        let x = 400
        let y = 300
        for (let step = 0; step < 30; step++) {
            const v = leashVelocity(x, y, t)
            x += v.x / 60
            y += v.y / 60
        }
        expect(leashDelta(x, y, t)).toBeLessThan(1)
    })

    it("reports a gap big enough to be worth teleporting", () => {
        const t = track(CENTER_X + SNAP_DISTANCE + 40, CENTER_Y)
        expect(leashDelta(CENTER_X, CENTER_Y, t)).toBeGreaterThan(SNAP_DISTANCE)
    })

    it("carries a track forward at the speed it was given", () => {
        const t = track(100, 100, 60, -30)
        advance(t, 0.001)
        expect(t.x).toBeCloseTo(100.06, 6)
        expect(t.y).toBeCloseTo(99.97, 6)
        expect(t.quiet).toBeCloseTo(0.001, 10)
    })

    /** A tab closed without a clean disconnect leaves a track running. */
    it("coasts a peer that has gone quiet to a stop instead of out of the world", () => {
        const t = track(100, 100, 400, 400)
        for (let i = 0; i < 60; i++) advance(t, 1 / 15)
        expect(Math.hypot(t.vx, t.vy)).toBeLessThan(1)
        expect(Math.hypot(t.x - 100, t.y - 100)).toBeLessThan(400)
        expect(t.quiet).toBeCloseTo(4, 6)
    })

    it("never coasts backwards, whatever the step", () => {
        for (let i = 0; i < 300; i++) {
            const t = track(0, 0, 200, 0)
            const dt = Math.random() * 0.2
            advance(t, dt)
            expect(t.x).toBeGreaterThanOrEqual(0)
            expect(t.vx).toBeGreaterThan(0)
            expect(t.vx).toBeLessThanOrEqual(200)
        }
    })
})

describe("who is out", () => {
    const round = () => beginRound(1, [1, 2, 3, 4])

    it("takes a fall from the player who fell", () => {
        expect(standing(applyFall(round(), 2, { n: 1 }))).toEqual([1, 3, 4])
    })

    /**
     * The rule the whole game rests on. A claim carrying somebody else's id has
     * to be worth nothing, whatever it says, or any player could clear the ring
     * from the sofa.
     */
    it("never lets a message put anybody but its sender out", () => {
        for (let i = 0; i < 500; i++) {
            const from = 1 + Math.floor(Math.random() * 4)
            const victim = 1 + Math.floor(Math.random() * 4)
            const claim = { n: 1, id: victim, who: victim, target: victim, by: victim }
            const after = applyFall(round(), from, claim)
            expect(after.fallen).toEqual([from])
        }
    })

    it("ignores a fall reported for a round that is not this one", () => {
        expect(applyFall(round(), 2, { n: 99 }).fallen).toEqual([])
        expect(applyFall(round(), 2, {}).fallen).toEqual([])
    })

    it("ignores somebody who was not in the round", () => {
        expect(applyFall(round(), 77, { n: 1 }).fallen).toEqual([])
    })

    it("counts a repeated report once", () => {
        let state = round()
        state = applyFall(state, 3, { n: 1 })
        state = applyFall(state, 3, { n: 1 })
        expect(state.fallen).toEqual([3])
    })

    it("leaves the round it was given alone", () => {
        const before = round()
        applyFall(before, 2, { n: 1 })
        expect(before.fallen).toEqual([])
    })
})

describe("ending a round", () => {
    const play = (starters: number[], falls: number[]) => {
        let state = beginRound(7, starters)
        for (const id of falls) state = applyFall(state, id, { n: 7 })
        return state
    }

    it("ends when one is left, and that one has won", () => {
        const state = play([1, 2, 3], [3, 1])
        expect(isOver(state, 10)).toBe(true)
        expect(winnerOf(state)).toBe(2)
    })

    it("is still going while two are up", () => {
        const state = play([1, 2, 3], [3])
        expect(isOver(state, 10)).toBe(false)
        expect(winnerOf(state)).toBe(null)
    })

    /**
     * Messages arrive in whatever order the relay hands them over, so the
     * outcome cannot depend on that order or two clients would disagree about
     * who won the round they both watched.
     */
    it("reaches the same answer whatever order the falls arrive in", () => {
        const starters = [3, 8, 11, 14, 21]
        for (let i = 0; i < 300; i++) {
            const falls = [3, 8, 11, 21].slice()
            for (let j = falls.length - 1; j > 0; j--) {
                const k = Math.floor(Math.random() * (j + 1))
                const swap = falls[j]!
                falls[j] = falls[k]!
                falls[k] = swap
            }
            const state = play(starters, falls)
            expect(isOver(state, 10)).toBe(true)
            expect(winnerOf(state)).toBe(14)
        }
    })

    it("gives a solo round no winner, and does not end it on the first frame", () => {
        const alone = play([5], [])
        expect(isOver(alone, 10)).toBe(false)
        expect(winnerOf(alone)).toBe(null)
        const fell = play([5], [5])
        expect(isOver(fell, 10)).toBe(true)
        expect(winnerOf(fell)).toBe(null)
    })

    /**
     * The round that used to be scored two different ways on two screens. Both
     * players slide off the closing ring within a moment of each other, and
     * each client learns of its own fall first. Whatever order the two arrive
     * in, once both are in there is nobody standing and nobody won.
     */
    it("gives a round where both fell to nobody, in either order", () => {
        expect(winnerOf(play([1, 2], [1, 2]))).toBe(null)
        expect(winnerOf(play([1, 2], [2, 1]))).toBe(null)
        expect(standing(play([1, 2], [2, 1]))).toEqual([])
    })

    /** The window that makes the above reachable rather than theoretical. */
    it("waits longer than a relay round trip and less than the gap between rounds", () => {
        expect(SETTLE).toBeGreaterThan(0.2)
        expect(SETTLE).toBeLessThan(REST)
    })

    it("ends at the cap however many claim to be standing", () => {
        const stubborn = play([1, 2, 3], [])
        expect(isOver(stubborn, ROUND_CAP - 0.1)).toBe(false)
        expect(isOver(stubborn, ROUND_CAP)).toBe(true)
        expect(winnerOf(stubborn)).toBe(null)
    })

    it("credits a win, and nothing at all for a round with no winner", () => {
        expect(credit({}, 4)).toEqual({ 4: 1 })
        expect(credit({ 4: 2 }, 4)).toEqual({ 4: 3 })
        expect(credit({ 4: 2 }, null)).toEqual({ 4: 2 })
    })
})

describe("handing out bodies", () => {
    it("keeps body 0 for this client", () => {
        const slots = new Slots(4)
        expect([slots.take(11), slots.take(12), slots.take(13)]).not.toContain(0)
    })

    it("gives a peer the same body every time it is asked", () => {
        const slots = new Slots()
        const first = slots.take(42)
        expect(slots.take(42)).toBe(first)
        expect(slots.slotOf(42)).toBe(first)
    })

    it("never hands one body to two peers", () => {
        const slots = new Slots()
        const held = new Set<number>()
        for (let peer = 1; peer < MAX_BLOBS; peer++) {
            const slot = slots.take(peer)
            expect(slot).not.toBe(null)
            expect(held.has(slot!)).toBe(false)
            held.add(slot!)
        }
    })

    it("has room for every socket the relay allows", () => {
        const slots = new Slots()
        // The room holds MAX_BLOBS sockets, one of which is this client.
        for (let peer = 1; peer < MAX_BLOBS; peer++) expect(slots.take(peer)).not.toBe(null)
        expect(slots.take(999)).toBe(null)
    })

    it("takes a body back when somebody leaves, and lends it out again", () => {
        const slots = new Slots(3)
        const a = slots.take(1)
        slots.take(2)
        expect(slots.take(3)).toBe(null)
        expect(slots.release(1)).toBe(a)
        expect(slots.take(3)).toBe(a)
        expect(slots.slotOf(1)).toBe(null)
        expect(slots.inUse).toBe(2)
    })

    it("shrugs at a peer that was never here", () => {
        expect(new Slots().release(5)).toBe(null)
    })

    /** Churn is the normal case: people join and leave for hours. */
    it("survives arrivals and departures without leaking a body", () => {
        const slots = new Slots()
        const present = new Set<number>()
        for (let i = 0; i < 2000; i++) {
            const peer = 1 + Math.floor(Math.random() * 40)
            if (present.has(peer)) {
                slots.release(peer)
                present.delete(peer)
            } else if (present.size < MAX_BLOBS - 1) {
                expect(slots.take(peer)).not.toBe(null)
                present.add(peer)
            }
        }
        expect(slots.inUse).toBe(present.size)
        const bodies = new Set(slots.entries().map(([, slot]) => slot))
        expect(bodies.size).toBe(present.size)
    })
})

describe("the round clock", () => {
    /**
     * Everybody has to be standing on the same ring, and the ring is a function
     * of this number, so the only property that matters is that a client which
     * keeps hearing from the host ends up agreeing with it.
     */
    it("converges on the host's clock from either side", () => {
        for (const start of [0, 3, 40]) {
            let local = start
            for (let i = 0; i < 30; i++) local = syncClock(local, 12)
            expect(local).toBeCloseTo(12, 3)
        }
    })

    it("never overshoots, so the ring cannot jump the wrong way", () => {
        for (let i = 0; i < 500; i++) {
            const local = Math.random() * 60
            const remote = Math.random() * 60
            const next = syncClock(local, remote)
            expect(next).toBeGreaterThanOrEqual(Math.min(local, remote) - 1e-9)
            expect(next).toBeLessThanOrEqual(Math.max(local, remote) + 1e-9)
        }
    })

    it("moves rather than snapping, so a jittery network is not a jittery ring", () => {
        expect(syncClock(10, 11)).toBeGreaterThan(10)
        expect(syncClock(10, 11)).toBeLessThan(11)
    })

})
