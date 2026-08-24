export const ARENA_W = 960
export const ARENA_H = 640
export const CENTER_X = ARENA_W / 2
export const CENTER_Y = ARENA_H / 2

export const BLOB_RADIUS = 22
export const START_RADIUS = 250
export const MIN_RADIUS = 70

export const GRACE = 4
export const SHRINK_PER_SECOND = 11

export const ROUND_CAP = 45

/** A fall already in flight has to land before the round is decided. */
export const SETTLE = 0.35

export const REST = 3.5

/** A body's mass is 1, so an impulse is a change of speed in units per second. */
export const THRUST = 900
export const DRAG = 2.4
export const DASH_SPEED = 520
export const DASH_COOLDOWN = 1.4

export const BOUNCE = 0.55

export const SYNC_HZ = 15

const CHASE_SECONDS = 0.1
const CHASE_MAX_SPEED = 900
const COAST_SECONDS = 0.45
const CLOCK_PULL = 0.35

export const SNAP_DISTANCE = 160

export const MAX_BLOBS = 24

export function platformRadius(elapsed: number): number {
    if (!(elapsed > GRACE)) return START_RADIUS
    return Math.max(MIN_RADIUS, START_RADIUS - (elapsed - GRACE) * SHRINK_PER_SECOND)
}

export function isOff(x: number, y: number, radius: number): boolean {
    const dx = x - CENTER_X
    const dy = y - CENTER_Y
    return dx * dx + dy * dy > radius * radius
}

export function spawnAt(index: number, count: number): { x: number; y: number } {
    const slots = Math.max(1, count)
    const angle = (Math.PI * 2 * index) / slots - Math.PI / 2
    const ring = START_RADIUS * 0.62
    return { x: CENTER_X + Math.cos(angle) * ring, y: CENTER_Y + Math.sin(angle) * ring }
}

export function steer(x: number, y: number): { x: number; y: number } {
    const length = Math.hypot(x, y)
    if (!(length > 0.0001)) return { x: 0, y: 0 }
    return { x: x / length, y: y / length }
}

export interface Track {
    x: number
    y: number
    vx: number
    vy: number
    sinceReport: number
}

export function advance(track: Track, dt: number): void {
    track.x += track.vx * dt
    track.y += track.vy * dt
    const decay = Math.exp(-dt / COAST_SECONDS)
    track.vx *= decay
    track.vy *= decay
    track.sinceReport += dt
}

export function leashVelocity(
    x: number, y: number, track: Track,
): { x: number; y: number } {
    const vx = track.vx + (track.x - x) / CHASE_SECONDS
    const vy = track.vy + (track.y - y) / CHASE_SECONDS
    const speed = Math.hypot(vx, vy)
    if (!(speed > CHASE_MAX_SPEED)) return { x: vx, y: vy }
    return { x: (vx / speed) * CHASE_MAX_SPEED, y: (vy / speed) * CHASE_MAX_SPEED }
}

export function leashDelta(x: number, y: number, track: Track): number {
    return Math.hypot(track.x - x, track.y - y)
}

export interface Round {
    n: number
    starters: readonly number[]
    fallen: readonly number[]
}

export function beginRound(n: number, starters: readonly number[]): Round {
    return { n, starters: [...starters], fallen: [] }
}

/** Only the sender falls. An id inside the claim would let anyone push anyone off. */
export function applyFall(round: Round, from: number, claim: { n?: number }): Round {
    if (claim?.n !== round.n) return round
    if (!round.starters.includes(from)) return round
    if (round.fallen.includes(from)) return round
    return { ...round, fallen: [...round.fallen, from] }
}

export function standing(round: Round): number[] {
    return round.starters.filter((id) => !round.fallen.includes(id))
}

/** Alone, the round ends when that one falls, not when one is left. */
export function isOver(round: Round, elapsed: number): boolean {
    if (elapsed >= ROUND_CAP) return true
    const left = standing(round).length
    return round.starters.length > 1 ? left <= 1 : left === 0
}

export function winnerOf(round: Round): number | null {
    if (round.starters.length < 2) return null
    const left = standing(round)
    return left.length === 1 ? left[0]! : null
}

export function credit(tally: Readonly<Record<number, number>>, id: number | null): Record<number, number> {
    if (id === null) return { ...tally }
    return { ...tally, [id]: (tally[id] ?? 0) + 1 }
}

export function syncClock(local: number, remote: number): number {
    return local + (remote - local) * CLOCK_PULL
}

/** Body 0 is always this client, so slots start at 1. */
export class Slots {
    private readonly byPeer = new Map<number, number>()
    private readonly free: number[] = []

    constructor(count: number = MAX_BLOBS) {
        for (let i = count - 1; i >= 1; i--) this.free.push(i)
    }

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

    release(peer: number): number | null {
        const slot = this.byPeer.get(peer)
        if (slot === undefined) return null
        this.byPeer.delete(peer)
        this.free.push(slot)
        return slot
    }

    entries(): [number, number][] {
        return [...this.byPeer.entries()]
    }

    get inUse(): number {
        return this.byPeer.size
    }
}
