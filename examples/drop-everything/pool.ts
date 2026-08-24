export class Pool {
    private readonly live: number[] = []
    private readonly free: number[] = []

    constructor(readonly size: number) {
        for (let i = 0; i < size; i++) this.free.push(i)
    }

    get inUse(): number {
        return this.live.length
    }

    take(): { body: number; recycled: number | null } {
        const free = this.free.shift()
        if (free !== undefined) {
            this.live.push(free)
            return { body: free, recycled: null }
        }
        const oldest = this.live.shift()
        if (oldest === undefined) throw new Error("a pool with no bodies cannot hand one out")
        this.live.push(oldest)
        return { body: oldest, recycled: oldest }
    }

    clear(): number[] {
        const released = [...this.live]
        this.live.length = 0
        this.free.length = 0
        for (let i = 0; i < this.size; i++) this.free.push(i)
        return released
    }

    snapshot(): number[] {
        return [...this.live]
    }
}
