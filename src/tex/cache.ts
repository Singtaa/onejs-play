/**
 * A cache across loads for what `.texture()` bakes (proposal 4.5): the second
 * load of a cart hands back the picture the first one drew, with no passes.
 *
 * **The key is the recipe.** A node's id hashes its op, size, tiling,
 * resolved parameters and its inputs' ids, so with the kernels' version it
 * cannot name a stale picture: one changed seed is another key, and a runtime
 * whose kernels draw other pixels asks with another version. A graph reading
 * `tex.pixels` has no key, since its bytes are not in its id.
 *
 * **What is stored** is the kept texture's bytes, 8-bit sRGB RGBA, row 0 at
 * the top, as base64 (what OneJS's `KeptTexture.StoredBytes` hands over and
 * `KeptTexture.Upload` takes back), so a picture crosses between JS and C#
 * as one string either way. About 1.4 MB at 512.
 *
 * **Where.** IndexedDB on the game's own origin where there is one (the
 * web), else files under the player's `persistentDataPath`. The least
 * recently used past `CACHE_CAP` is dropped. An index record holds each
 * picture's size and when it was last used, so nothing is read to evict.
 *
 * A storage that fails (a full quota, a private window) is an empty one:
 * nothing here throws, and a miss costs only the draw that would have
 * happened anyway.
 */
import type { Node } from "./graph"
import { topological } from "./graph"
import { TEX_KERNELS } from "./kernels"

declare const CS: any

/** Stored characters past which the least recently used picture is dropped: 64 MB. */
export const CACHE_CAP = 64 * 1024 * 1024

/** Where pictures are kept: named strings, as IndexedDB or a folder of files holds them. */
export interface CacheBackend {
    get(name: string): Promise<string | undefined>
    put(name: string, value: string): Promise<void>
    delete(name: string): Promise<void>
    /** Everything this cache stored, index included. */
    clear(): Promise<void>
}

/** The key a node's picture is kept under, or none when the graph reads `tex.pixels`. */
export function cacheKey(node: Node, kernels: number = TEX_KERNELS): string | undefined {
    if (topological(node).some((n) => n.texture !== undefined)) return undefined
    return `${kernels}:${node.id}`
}

const INDEX = "index"
const INDEX_VERSION = 1
const record = (key: string) => `p:${key}`

interface Index {
    /** Each key's stored size and the clock when it was last used. */
    entries: Record<string, [size: number, used: number]>
    clock: number
}

export interface TexCacheOptions {
    /** Stored characters to keep at most. Default `CACHE_CAP`. */
    cap?: number
}

export class TexCache {
    private readonly backend: CacheBackend
    private readonly cap: number
    private index: Index = { entries: {}, clock: 0 }
    private loaded: Promise<void> | undefined
    /** Every operation in turn, so two bakes finishing together cannot write the index over each other. */
    private queue: Promise<unknown> = Promise.resolve()

    constructor(backend: CacheBackend, { cap = CACHE_CAP }: TexCacheOptions = {}) {
        this.backend = backend
        this.cap = cap
    }

    /** Stored characters the index counts, once it has been read. */
    get size(): number {
        let total = 0
        for (const [size] of Object.values(this.index.entries)) total += size
        return total
    }

    /** The picture kept under `key`, or undefined. */
    get(key: string): Promise<string | undefined> {
        return this.serial(async () => {
            const entry = this.index.entries[key]
            if (entry === undefined) return undefined
            const value = await this.backend.get(record(key))
            if (value === undefined) {
                // The record went without the index: forget it.
                delete this.index.entries[key]
            } else {
                entry[1] = ++this.index.clock
            }
            await this.save()
            return value
        }, undefined)
    }

    /** Keeps `value` under `key`, dropping the least recently used to fit. A value past the cap is not kept. */
    put(key: string, value: string): Promise<void> {
        return this.serial(async () => {
            if (value.length > this.cap) return
            const entries = this.index.entries
            delete entries[key]
            let total = this.size
            const oldest = Object.entries(entries).sort((a, b) => a[1][1] - b[1][1])
            while (total + value.length > this.cap && oldest.length > 0) {
                const [k, [size]] = oldest.shift()!
                await this.backend.delete(record(k))
                delete entries[k]
                total -= size
            }
            await this.backend.put(record(key), value)
            entries[key] = [value.length, ++this.index.clock]
            await this.save()
        }, undefined)
    }

    /** Drops every kept picture. */
    clear(): Promise<void> {
        return this.serial(async () => {
            this.index = { entries: {}, clock: 0 }
            await this.backend.clear()
        }, undefined)
    }

    private serial<T>(work: () => Promise<T>, failed: T): Promise<T> {
        const run = this.queue.then(async () => {
            try {
                await this.load()
                return await work()
            } catch {
                return failed
            }
        })
        this.queue = run
        return run
    }

    private load(): Promise<void> {
        this.loaded ??= (async () => {
            let text: string | undefined
            try { text = await this.backend.get(INDEX) } catch { /* read as none */ }
            const parsed = parseIndex(text)
            if (parsed !== undefined) {
                this.index = parsed
                return
            }
            // No index, or one this version cannot read: whatever is stored is
            // uncounted, so start empty rather than grow past the cap.
            try { await this.backend.clear() } catch { /* nothing to drop */ }
        })()
        return this.loaded
    }

    private save(): Promise<void> {
        return this.backend.put(INDEX, JSON.stringify({ v: INDEX_VERSION, ...this.index }))
    }
}

function parseIndex(text: string | undefined): Index | undefined {
    if (text === undefined) return undefined
    try {
        const v = JSON.parse(text)
        if (v?.v !== INDEX_VERSION || typeof v.clock !== "number" || typeof v.entries !== "object" || v.entries === null) return undefined
        return { entries: v.entries, clock: v.clock }
    } catch {
        return undefined
    }
}

/** IndexedDB on this origin: one database, one store of named strings. */
export function indexedDBBackend(idb: any, database = "oj-tex-cache"): CacheBackend {
    const STORE = "pictures"
    let opened: Promise<any> | undefined
    const db = () => opened ??= new Promise<any>((resolve, reject) => {
        const req = idb.open(database, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
    const run = async <T>(mode: "readonly" | "readwrite", act: (store: any) => any): Promise<T> => {
        const d = await db()
        return new Promise<T>((resolve, reject) => {
            const tx = d.transaction(STORE, mode)
            const req = act(tx.objectStore(STORE))
            tx.oncomplete = () => resolve(req.result)
            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error)
        })
    }
    return {
        get: (name) => run<string | undefined>("readonly", (s) => s.get(name)),
        put: async (name, value) => { await run("readwrite", (s) => s.put(value, name)) },
        delete: async (name) => { await run("readwrite", (s) => s.delete(name)) },
        clear: async () => { await run("readwrite", (s) => s.clear()) },
    }
}

/** A folder of files, for a native player: `<dir>/<name>.txt`. */
export function filesBackend(dir: string): CacheBackend {
    const IO = CS.System.IO
    const path = (name: string) => `${dir}/${name.replace(/[^0-9A-Za-z]/g, "_")}.txt`
    return {
        async get(name) {
            const p = path(name)
            return IO.File.Exists(p) ? IO.File.ReadAllText(p) as string : undefined
        },
        async put(name, value) {
            IO.Directory.CreateDirectory(dir)
            IO.File.WriteAllText(path(name), value)
        },
        async delete(name) {
            const p = path(name)
            if (IO.File.Exists(p)) IO.File.Delete(p)
        },
        async clear() {
            if (IO.Directory.Exists(dir)) IO.Directory.Delete(dir, true)
        },
    }
}

/** This host's storage: IndexedDB on the web, the player's folder elsewhere, or none. */
export function hostBackend(): CacheBackend | undefined {
    const idb = (globalThis as any).indexedDB
    if (idb !== undefined && idb !== null) return indexedDBBackend(idb)
    const root = typeof CS === "undefined" ? undefined : CS.UnityEngine?.Application?.persistentDataPath
    if (typeof root === "string" && root !== "" && CS.System?.IO?.File !== undefined) return filesBackend(`${root}/oj-tex-cache`)
    return undefined
}
