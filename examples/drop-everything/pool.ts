/**
 * Which of a fixed set of bodies to use next.
 *
 * The physics world is built once, with every body it will ever have, because
 * bodies are created in C# when the world is and there is no way to add one
 * later without throwing the simulation away and starting again. So a sandbox
 * where things are dropped in has to work the other way round: make them all up
 * front, switch them off, and switch one on each time something is dropped.
 *
 * That turns "add a shape" into "which one is free", which is this file. It
 * matters more than it looks, because the interesting case is what happens when
 * nothing is free: taking the oldest is what makes a sandbox feel bottomless
 * instead of quietly refusing to drop anything more.
 */

export class Pool {
    /** Bodies in the order they were taken, oldest first. */
    private readonly live: number[] = []
    private readonly free: number[] = []

    constructor(readonly size: number) {
        for (let i = 0; i < size; i++) this.free.push(i)
    }

    get inUse(): number {
        return this.live.length
    }

    /**
     * Hands out a body, and says which one had to be given up for it.
     *
     * Returning both rather than quietly recycling: the caller has to move the
     * element and reset the body either way, and it also has to know when
     * something vanished from under the player.
     */
    take(): { body: number; recycled: number | null } {
        const free = this.free.shift()
        if (free !== undefined) {
            this.live.push(free)
            return { body: free, recycled: null }
        }
        // Nothing free, so the oldest thing on screen makes way. Shifting off
        // the front is what makes it the oldest rather than an arbitrary one.
        const oldest = this.live.shift()
        if (oldest === undefined) throw new Error("a pool with no bodies cannot hand one out")
        this.live.push(oldest)
        return { body: oldest, recycled: oldest }
    }

    /** Gives everything back, in one go. */
    clear(): number[] {
        const released = [...this.live]
        this.live.length = 0
        this.free.length = 0
        for (let i = 0; i < this.size; i++) this.free.push(i)
        return released
    }

    /** Every body currently handed out, oldest first. */
    snapshot(): number[] {
        return [...this.live]
    }
}
