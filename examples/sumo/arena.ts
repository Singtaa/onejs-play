/**
 * The rules of the ring, with no screen and no network in them.
 *
 * SUMO IS A RELAY GAME PLUS A PHYSICS ENGINE, AND BOTH SHAPE THE RULES
 *
 * The site passes messages between players and knows nothing about what they
 * mean, so every client is the authority on itself and on nothing else. In a
 * game about shoving people off a ledge that rule takes one specific form:
 *
 *     You may only report your own fall.
 *
 * A player broadcasts where they are. When their own blob leaves the platform,
 * they say so, and everybody else marks them out on that word alone. Nobody
 * can push anybody out by sending a message, because "you are out" is not a
 * message anyone can send. applyFall below is written so that the claim's
 * contents cannot name a victim: the sender's id is the only id it can use.
 * A liar can therefore refuse to fall, which is visible to everyone as a blob
 * hanging in space off the edge, and cannot touch anybody else's game.
 *
 * WHO AGREES THE SHOVE, GIVEN THAT EVERY CLIENT SIMULATES ITS OWN PHYSICS
 *
 * Two clients running the same rigid body simulation from slightly different
 * inputs will not produce the same collision, so a shove cannot be a shared
 * fact. It is resolved twice instead, once on each screen, and each client
 * keeps only the half of the result that is about itself:
 *
 *   Your blob is fully simulated. It is the only body whose position you
 *   believe, and the one you broadcast.
 *
 *   Everybody else's blob is also a real body, so a collision exchanges
 *   momentum properly and you feel the correct share of the hit, but it is
 *   leashed every tick to the position its owner last reported. Your shove
 *   moves it for a few milliseconds and then its owner's own account of where
 *   it went replaces yours.
 *
 * So a shove you land is really a shove they land on themselves: their client
 * sees your blob arrive with the momentum you gave it, resolves the same
 * collision from its own point of view, and reports where that put them.
 *
 * WHAT THE COMPROMISE COSTS
 *
 * The two simulations disagree for as long as the round trip takes. For about
 * a tenth of a second after a hit, the shover sees the shoved blob move less
 * than the shoved player does, and then the leash pulls it to the truth. A
 * clean hit therefore looks slightly soft on the giving end and correct on the
 * receiving end, which is the right way round: the player being knocked off is
 * the one who cares exactly where they landed. Under heavy packet delay the
 * correction becomes a visible jump rather than a slide, and leashDelta says
 * when to stop sliding and teleport.
 *
 * The other cost is that a hit is never mutual bookkeeping. Nobody is ever
 * credited with a kill, because a kill would have to be a claim about somebody
 * else. The tally counts survivals, which each player reports about themselves
 * by staying quiet.
 */

/** The playfield, in stage units. The platform sits in the middle of it. */
export const ARENA_W = 960
export const ARENA_H = 640
export const CENTER_X = ARENA_W / 2
export const CENTER_Y = ARENA_H / 2

/** A blob, and the ring it stands on at the start and at its smallest. */
export const BLOB_RADIUS = 22
export const START_RADIUS = 250
export const MIN_RADIUS = 70

/** Seconds at full size before the ring starts going, then units per second. */
export const GRACE = 4
export const SHRINK_PER_SECOND = 11

/** A round cannot outlast this, whatever anybody claims about still being in. */
export const ROUND_CAP = 45

/**
 * How long a round that looks finished waits before it is.
 *
 * Two players sliding off a closing ring within a moment of each other is the
 * normal way a round of this ends, not an edge case, and it used to produce two
 * different answers. Each client learns about its own fall instantly and about
 * the other one a round trip later, so whoever resolved the moment one player
 * was left standing credited the win to the other player: A said B won, B said
 * A won, and the two tallies drifted apart while both screens showed the same
 * ring. Two browsers playing eight rounds finished 2 to 2 on one screen and 4
 * to 1 on the other.
 *
 * So the round waits after it looks over, long enough for a fall that was
 * already in flight to land. Both clients then hold both falls, both find
 * nobody standing, and both call it a draw, which is what it was. Long enough
 * to cover a relay round trip, short enough not to read as a pause.
 */
export const SETTLE = 0.35

/** The pause between rounds, long enough to read who won. */
export const REST = 3.5

/**
 * Movement, in stage units per second squared and per second.
 *
 * A body here has mass 1 (the physics bridge never touches Rigidbody2D.mass,
 * and Unity's default is 1), so an impulse in stage units is exactly a change
 * of speed in stage units per second. That is what makes these numbers
 * readable: THRUST is an acceleration, DASH_SPEED is the speed a dash adds,
 * and DRAG is the damping that turns the first into a top speed of
 * THRUST / DRAG, which is the only one of the three the player feels directly.
 */
export const THRUST = 900
export const DRAG = 2.4
export const DASH_SPEED = 520
export const DASH_COOLDOWN = 1.4

/** How bouncy two blobs are when they meet. Enough to read as a collision. */
export const BOUNCE = 0.55

/** Position updates a second. Everything else is an event. */
export const SYNC_HZ = 15

/** How hard the leash pulls a peer back onto its reported position. */
const CHASE_SECONDS = 0.1
const CHASE_MAX_SPEED = 900

/** How long a peer that has gone quiet takes to coast to a stop. */
const COAST_SECONDS = 0.45

/** How much of the host's round clock to take on each of its ticks. */
const CLOCK_PULL = 0.35

/** Past this much error, sliding a peer into place stops being honest. */
export const SNAP_DISTANCE = 160

/** Room for every socket the relay allows, so nobody is left without a body. */
export const MAX_BLOBS = 24

/**
 * The ring's radius at a given point in the round.
 *
 * The grace period exists so a round opens with room to move: without it the
 * ring is already closing while people are still working out where they are.
 * After that it is linear, because a player has to be able to look at the gap
 * and know how long it will be there, and an eased curve makes that a guess.
 */
export function platformRadius(elapsed: number): number {
    if (!(elapsed > GRACE)) return START_RADIUS
    return Math.max(MIN_RADIUS, START_RADIUS - (elapsed - GRACE) * SHRINK_PER_SECOND)
}

/** Whether a blob's centre has left the ring, which is what counts as out. */
export function isOff(x: number, y: number, radius: number): boolean {
    const dx = x - CENTER_X
    const dy = y - CENTER_Y
    return dx * dx + dy * dy > radius * radius
}

/**
 * Where the blob at a given place in the roster starts.
 *
 * Spread evenly around a circle inside the ring, so nobody spawns on top of
 * anybody. Everyone can work out their own angle from the roster the host
 * sent, which is why this takes an index rather than a random source: two
 * clients rolling their own spawn would sometimes roll the same one.
 */
export function spawnAt(index: number, count: number): { x: number; y: number } {
    const slots = Math.max(1, count)
    const angle = (Math.PI * 2 * index) / slots - Math.PI / 2
    const ring = START_RADIUS * 0.62
    return { x: CENTER_X + Math.cos(angle) * ring, y: CENTER_Y + Math.sin(angle) * ring }
}

/**
 * A direction to push in, from however the player asked for it.
 *
 * Normalised, because holding two keys must not be faster than holding one,
 * and a pointer a long way off must not push harder than a pointer nearby.
 */
export function steer(x: number, y: number): { x: number; y: number } {
    const length = Math.hypot(x, y)
    if (!(length > 0.0001)) return { x: 0, y: 0 }
    return { x: x / length, y: y / length }
}

/** Where a peer's blob is heading, extrapolated from their last report. */
export interface Track {
    x: number
    y: number
    vx: number
    vy: number
    /** Seconds since their last report, so a silent peer can be dropped. */
    quiet: number
}

/**
 * Carries a track forward between reports, at the speed it was last given.
 *
 * The speed decays as it goes, which only matters for somebody who has stopped
 * reporting: a tab that was closed without a clean disconnect would otherwise
 * leave a blob travelling in a straight line out of the world forever. A peer
 * still sending has its velocity replaced by every report, so the decay never
 * shows.
 */
export function advance(track: Track, dt: number): void {
    track.x += track.vx * dt
    track.y += track.vy * dt
    const decay = Math.exp(-dt / COAST_SECONDS)
    track.vx *= decay
    track.vy *= decay
    track.quiet += dt
}

/**
 * The velocity to give a peer's body so it converges on where its owner says.
 *
 * Their own velocity plus a correction for the error, rather than a correction
 * alone: a peer moving steadily then has zero error and needs no correction,
 * so a well behaved connection produces no leash artefacts at all. The clamp
 * is what stops a badly delayed correction turning somebody into a projectile
 * that shoves everyone it passes.
 */
export function leashVelocity(
    x: number, y: number, track: Track,
): { x: number; y: number } {
    const vx = track.vx + (track.x - x) / CHASE_SECONDS
    const vy = track.vy + (track.y - y) / CHASE_SECONDS
    const speed = Math.hypot(vx, vy)
    if (!(speed > CHASE_MAX_SPEED)) return { x: vx, y: vy }
    return { x: (vx / speed) * CHASE_MAX_SPEED, y: (vy / speed) * CHASE_MAX_SPEED }
}

/** How far a peer's body is from where its owner says it is. */
export function leashDelta(x: number, y: number, track: Track): number {
    return Math.hypot(track.x - x, track.y - y)
}

/**
 * A round in progress, as this client understands it.
 *
 * The clock is deliberately not in here. It is the one part of a round that
 * belongs to the host rather than to the players, it changes every frame, and
 * keeping it out means this whole object only ever changes when a message
 * arrives.
 */
export interface Round {
    n: number
    /** Everybody who was in the room when the host started it. */
    starters: readonly number[]
    /** Everybody who has reported their own fall, in the order they said so. */
    fallen: readonly number[]
}

export function beginRound(n: number, starters: readonly number[]): Round {
    return { n, starters: [...starters], fallen: [] }
}

/**
 * Records a fall, from the only person entitled to report one.
 *
 * The claim is deliberately not read. It arrives as a message with a sender the
 * relay stamped on it, and taking anything but that sender's id would be the
 * bug this whole design exists to avoid: a field saying "id: 7" would let peer
 * 3 push peer 7 out of the ring from across the room. The parameter is here so
 * that the round number can be checked, and so that a reader can see the claim
 * being ignored rather than assume it.
 */
export function applyFall(round: Round, from: number, claim: { n?: number }): Round {
    if (claim?.n !== round.n) return round
    if (!round.starters.includes(from)) return round
    if (round.fallen.includes(from)) return round
    return { ...round, fallen: [...round.fallen, from] }
}

/** Everybody still in the ring. */
export function standing(round: Round): number[] {
    return round.starters.filter((id) => !round.fallen.includes(id))
}

/**
 * Whether the round has finished.
 *
 * Two rules rather than one, because a player alone in the room is playing a
 * different game: with company the round ends when one is left, and alone it
 * ends when that one falls. Without the second case a solo round would be over
 * on the frame it started, which is what the first version of this did.
 */
export function isOver(round: Round, elapsed: number): boolean {
    if (elapsed >= ROUND_CAP) return true
    const left = standing(round).length
    return round.starters.length > 1 ? left <= 1 : left === 0
}

/**
 * Who won, or null when nobody did.
 *
 * A pure function of who reported falling, so every client computes the same
 * answer from the same messages and nobody has to be trusted to announce it.
 * A solo round has no winner: there was nobody to beat.
 */
export function winnerOf(round: Round): number | null {
    if (round.starters.length < 2) return null
    const left = standing(round)
    return left.length === 1 ? left[0]! : null
}

/** The running tally of rounds won, which is the only score this game keeps. */
export function credit(tally: Readonly<Record<number, number>>, id: number | null): Record<number, number> {
    if (id === null) return { ...tally }
    return { ...tally, [id]: (tally[id] ?? 0) + 1 }
}


/**
 * Moves this client's round clock toward the host's, a fraction at a time.
 *
 * The ring's size is a function of the clock, so two clients reading different
 * clocks would be standing on two different rings, and a blob that is safely
 * inside one is off the other. Snapping straight to the host's number would
 * fix that and make the ring jump every quarter of a second as the network
 * jitters; taking a third of the difference converges in about a second and
 * stays smooth. Nothing here needs a shared wall clock: only a shared answer
 * to "how far into the round are we", which is exactly what is sent.
 */
export function syncClock(local: number, remote: number): number {
    return local + (remote - local) * CLOCK_PULL
}

/**
 * Which body index a peer's blob uses.
 *
 * A physics world cannot grow after it is built, so every body that will ever
 * exist is created up front and handed out as people arrive. Body 0 is always
 * this client, which is the one body whose position it believes.
 */
export class Slots {
    private readonly byPeer = new Map<number, number>()
    private readonly free: number[] = []

    constructor(count: number = MAX_BLOBS) {
        for (let i = count - 1; i >= 1; i--) this.free.push(i)
    }

    /** The body for a peer, allocating one the first time it is asked for. */
    take(peer: number): number | null {
        const existing = this.byPeer.get(peer)
        if (existing !== undefined) return existing
        const slot = this.free.pop()
        if (slot === undefined) return null
        this.byPeer.set(peer, slot)
        return slot
    }

    slotOf(peer: number): number | null {
        return this.byPeer.get(peer) ?? null
    }

    /** Hands a body back. Returns it, or null if that peer never had one. */
    release(peer: number): number | null {
        const slot = this.byPeer.get(peer)
        if (slot === undefined) return null
        this.byPeer.delete(peer)
        this.free.push(slot)
        return slot
    }

    /** Every peer holding a body, with the body they hold. */
    entries(): [number, number][] {
        return [...this.byPeer.entries()]
    }

    get inUse(): number {
        return this.byPeer.size
    }
}
