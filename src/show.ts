/**
 * `show(x)`: a value, beside the line that made it.
 *
 * A notebook's one good idea, without its cells. In the OJPlay editor the
 * value appears at the end of the line that called show, a plain object or an
 * array of records is drawn as a table under it, and anything in the graph
 * shape below is drawn as a graph, the way micrograd's draw_dot draws one.
 * Each call also gets a row in the editor's console naming its line.
 *
 * Imported, never a global (`import { show } from "oj"`): a global `print`
 * would hide the browser's own window.print, and a name a cart never imports
 * is a name no existing cart can be calling.
 *
 * WHERE THE LINE COMES FROM. The site's build rewrites each call to oj's show
 * into a call to `show.$` with its file and line (build/show-sites.mjs).
 * Asking a stack at every call would also find the line, at a cost a 60 fps
 * loop pays on every frame and only V8 formats the same way. A call the build
 * did not tag (show passed as a value, or a build that does not tag) still
 * shows, with no line.
 *
 * WHAT IT COSTS. A call snapshots its values (so `show(o)` followed by
 * `o.backward()` shows o before the backward pass, as it would read in a
 * notebook) and keeps only the latest snapshot per line. The editor gets one
 * message a frame with one entry per line, however many times each line ran.
 *
 * OUTSIDE THE EDITOR (a published page, or the cart in Unity) nothing is
 * drawn: each line logs a console line when what it shows changes, at most
 * once a second and always ending on its latest, so a show left in a loop
 * does not flood the log. Measured before the cap: a bench changing its
 * values every frame wrote 72,057 lines in four seconds, and in Unity each
 * line is a Debug.Log, the expensive part of a frame.
 */

/** A value drawn as a table: rows of cells already formatted as text. */
export interface ShowTable { columns: string[], rows: string[][], moreRows: number, moreColumns: number }

/**
 * One node of a graph. `inputs` index into the graph's `nodes`; `fields` are
 * the node's own number properties, formatted.
 */
export interface ShowNode { label: string, op: string, fields: Array<[string, string]>, inputs: number[] }

/** The value shown is `nodes[0]`. `more` counts the nodes past the cap. */
export interface ShowGraph { nodes: ShowNode[], more: number }

/** What one show call looked like when it was made. `text` is always set. */
export interface Shown { text: string, table?: ShowTable, graph?: ShowGraph }

/** One frame's worth: each line that called show, with its latest value. */
export type ShowBatch = Array<[site: string, shown: Shown]>

/** Where show's output goes. The real one is `defaultHost`; tests step their own. */
export interface ShowHost {
    /** The editor's receiver, or null where there is no editor. */
    sink(): ((batch: ShowBatch) => void) | null
    /** Runs `flush` once, at the end of this frame. */
    schedule(flush: () => void): void
    log(line: string): void
    /** Milliseconds, for the log's once-a-second cap. */
    now(): number
    /** Runs `fn` once, `ms` from now. */
    later(fn: () => void, ms: number): void
}

// caps
//
// A show inside a loop runs every frame, so a snapshot is bounded whatever it
// is handed: a 10,000 node graph costs what a 60 node one does, plus a count.

const MAX_ROWS = 50
const MAX_COLUMNS = 20
const MAX_RECORD_COLUMNS = 12
const MAX_NODES = 60
/** How far past MAX_NODES the walk keeps counting for "+N more". */
const MAX_COUNTED = 5000
const MAX_FIELDS = 4
const MAX_INLINE = 8
const MAX_CELL = 40
/** The least time between two log lines from one line, where there is no editor. */
const LOG_EVERY_MS = 1000

// text

/** A number as a console would print it, to six significant figures. */
function formatNumber(n: number): string {
    if (Number.isInteger(n) || !Number.isFinite(n)) return String(n)
    return String(Number(n.toPrecision(6)))
}

const isObject = (v: unknown): v is object => typeof v === "object" && v !== null

/**
 * The graph shape: an object with an `inputs` array of objects. `label` and
 * `op` are read when they are strings; every other own number property is
 * shown on the node. Documented in the OJPlay docs (show), so show favours no
 * library: micrograd's Value takes this shape, rather than show learning
 * micrograd's `_prev` and `_op`.
 */
function isNode(v: unknown): v is { inputs: unknown[], label?: unknown, op?: unknown } {
    if (!isObject(v)) return false
    const inputs = (v as { inputs?: unknown }).inputs
    return Array.isArray(inputs) && inputs.every((i) => isObject(i) && !Array.isArray(i))
}

/** A class that says what it is, like Vector2's "(1, 2)". Plain objects do not. */
function ownText(v: object): string | null {
    const toString = (v as { toString?: unknown }).toString
    if (typeof toString !== "function" || toString === Object.prototype.toString || Array.isArray(v)) return null
    return String(v)
}

/** One table cell: a string as written, anything else as it reads inline. */
function cell(v: unknown): string {
    const text = typeof v === "string" ? v : inline(v, true)
    return text.length > MAX_CELL ? text.slice(0, MAX_CELL - 1) + "…" : text
}

/** The node's own number properties, in their own order. */
function fieldsOf(v: object): Array<[string, string]> {
    const out: Array<[string, string]> = []
    for (const key of Object.keys(v)) {
        if (key === "inputs" || key === "label" || key === "op") continue
        const value = (v as Record<string, unknown>)[key]
        if (typeof value === "number") out.push([key, formatNumber(value)])
        if (out.length === MAX_FIELDS) break
    }
    return out
}

function nodeText(v: object): string {
    const label = (v as { label?: unknown }).label
    const name = typeof label === "string" && label !== "" ? label : (v.constructor?.name || "node")
    return [name, ...fieldsOf(v).map(([k, n]) => `${k}=${n}`)].join("  ")
}

/**
 * One value on one line. `nested` is inside a container, where a string is
 * quoted and a container is only named, so a cell never grows a tree.
 */
function inline(v: unknown, nested = false): string {
    if (typeof v === "string") return nested ? JSON.stringify(v) : v
    if (typeof v === "number") return formatNumber(v)
    if (typeof v === "bigint") return `${v}n`
    if (typeof v === "function") return `ƒ ${v.name || "anonymous"}`
    if (!isObject(v)) return String(v)
    if (v instanceof Error) return `${v.name}: ${v.message}`
    if (isNode(v)) return nodeText(v)
    const own = ownText(v)
    if (own !== null) return own
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
        const items = Array.from(v as ArrayLike<unknown>)
        if (nested) return `[…${items.length}]`
        const shown = items.slice(0, MAX_INLINE).map((i) => inline(i, true))
        if (items.length > MAX_INLINE) shown.push(`…+${items.length - MAX_INLINE}`)
        return `[${shown.join(", ")}]`
    }
    const keys = Object.keys(v)
    if (nested) return keys.length === 0 ? "{}" : "{…}"
    if (keys.length === 0) return "{}"
    const shown = keys.slice(0, MAX_INLINE).map((k) => `${k}: ${inline((v as Record<string, unknown>)[k], true)}`)
    if (keys.length > MAX_INLINE) shown.push(`…+${keys.length - MAX_INLINE}`)
    return `{ ${shown.join(", ")} }`
}

// tables

/** The entries a table draws: an array's or a Set's items, a Map's or an object's keys. */
function entriesOf(v: object): Array<[string, unknown]> | null {
    if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v as ArrayLike<unknown>, (item, i) => [String(i), item])
    if (v instanceof Set) return Array.from(v, (item, i) => [String(i), item])
    if (v instanceof Map) return Array.from(v, ([k, item]) => [inline(k), item])
    if (v instanceof Error || v instanceof Date || v instanceof RegExp) return null
    return Object.keys(v).map((k) => [k, (v as Record<string, unknown>)[k]])
}

/**
 * Flat values make one row with a column each, the way the micrograd lesson
 * shows its four gradients. Records make a row each, with a column per key.
 */
function tableOf(v: object): ShowTable | null {
    const entries = entriesOf(v)
    if (entries === null || entries.length === 0) return null
    const keyed = !(Array.isArray(v) || ArrayBuffer.isView(v) || v instanceof Set)
    const records = entries.some(([, item]) => isObject(item) && !isNode(item) && ownText(item) === null)
    if (!records) {
        const shown = entries.slice(0, MAX_COLUMNS)
        return {
            columns: shown.map(([k]) => k),
            rows: [shown.map(([, item]) => cell(item))],
            moreRows: 0,
            moreColumns: entries.length - shown.length,
        }
    }
    const rowsShown = entries.slice(0, MAX_ROWS)
    const columns: string[] = []
    let moreColumns = 0
    for (const [, item] of rowsShown) {
        const names = isObject(item) && ownText(item) === null && !isNode(item) ? Object.keys(item) : ["value"]
        for (const name of names) {
            if (columns.includes(name)) continue
            if (columns.length < MAX_RECORD_COLUMNS) columns.push(name)
            else moreColumns++
        }
    }
    const rows = rowsShown.map(([key, item]) => {
        const cells = columns.map((name) => {
            if (!(isObject(item) && ownText(item) === null && !isNode(item))) return name === "value" ? cell(item) : ""
            return name in item ? cell((item as Record<string, unknown>)[name]) : ""
        })
        return keyed ? [key, ...cells] : cells
    })
    return {
        columns: keyed ? ["", ...columns] : columns,
        rows,
        moreRows: entries.length - rowsShown.length,
        moreColumns,
    }
}

// graphs

/** Each node once, the value first, its inputs after it in the order it names them. */
function graphOf(root: object): ShowGraph {
    const index = new Map<object, number>()
    const nodes: ShowNode[] = []
    const walk: object[] = [root]
    let counted = 0
    // Breadth first, so the nodes kept under the cap are the ones nearest the value.
    while (walk.length > 0 && counted < MAX_COUNTED) {
        const v = walk.shift()!
        if (index.has(v)) continue
        index.set(v, counted++)
        if (counted <= MAX_NODES) {
            const { label, op } = v as { label?: unknown, op?: unknown }
            nodes.push({ label: typeof label === "string" ? label : "", op: typeof op === "string" ? op : "", fields: fieldsOf(v), inputs: [] })
        }
        for (const input of (v as { inputs: unknown[] }).inputs) {
            if (isNode(input) && !index.has(input)) walk.push(input)
        }
    }
    for (const [v, i] of index) {
        if (i >= MAX_NODES) continue
        for (const input of (v as { inputs: unknown[] }).inputs) {
            const at = index.get(input as object)
            if (at !== undefined && at < MAX_NODES) nodes[i]!.inputs.push(at)
        }
    }
    return { nodes, more: counted - nodes.length }
}

// snapshot

/**
 * What a call's values look like now. Never throws: a value that refuses to
 * be read (a revoked proxy, a getter that throws) shows as whatever String
 * makes of it.
 */
export function snapshot(values: readonly unknown[]): Shown {
    try {
        if (values.length === 1 && isObject(values[0])) {
            const v = values[0]
            if (isNode(v)) return { text: nodeText(v), graph: graphOf(v) }
            if (ownText(v) === null && !(v instanceof Error)) {
                const table = tableOf(v)
                if (table !== null) return { text: inline(v), table }
            }
        }
        return { text: values.map((v) => inline(v)).join("  ") }
    } catch {
        try { return { text: values.map((v) => String(v)).join("  ") } } catch { return { text: "?" } }
    }
}

// delivery

export function createShow(host: ShowHost) {
    /** This frame's latest per line, for the editor. */
    const pending = new Map<string, Shown>()
    let scheduled = false
    /**
     * Where there is no editor: what each line last logged and when, and the
     * latest it was handed since, waiting for its second to come round.
     */
    const logged = new Map<string, { text: string, at: number, waiting: string | null }>()

    function logLine(site: string | undefined, text: string) {
        host.log(site === undefined ? text : `${site} ${text}`)
    }

    function logChange(site: string | undefined, text: string) {
        const key = site ?? ""
        const now = host.now()
        const last = logged.get(key)
        if (last === undefined || (last.waiting === null && now - last.at >= LOG_EVERY_MS)) {
            if (last !== undefined && last.text === text) return
            logged.set(key, { text, at: now, waiting: null })
            logLine(site, text)
            return
        }
        if (last.waiting === null && last.text === text) return
        // Within the second: keep the latest, and say it when the second is up.
        if (last.waiting === null) {
            host.later(() => {
                const said = last.waiting
                last.waiting = null
                if (said === null || said === last.text) return
                last.text = said
                last.at = host.now()
                logLine(site, said)
            }, LOG_EVERY_MS - (now - last.at))
        }
        last.waiting = text
    }

    function flush() {
        scheduled = false
        const sink = host.sink()
        if (sink === null || pending.size === 0) { pending.clear(); return }
        const batch: ShowBatch = Array.from(pending)
        pending.clear()
        sink(batch)
    }

    return {
        record(site: string | undefined, values: readonly unknown[]) {
            const shown = snapshot(values)
            const key = site ?? ""
            if (host.sink() === null) {
                logChange(site, shown.text)
                return
            }
            // Deleted first so the line moves to the end: the batch is in the
            // order lines last spoke, which is the order the console reads.
            pending.delete(key)
            pending.set(key, shown)
            if (!scheduled) {
                scheduled = true
                host.schedule(flush)
            }
        },
    }
}

/**
 * The editor's receiver is a global the sandbox document defines when, and
 * only when, an editor asked it for the cart's console (PlaySite
 * routes/sandbox.ts, consoleTap). Read per call, so a cart that starts before
 * it exists still finds it.
 */
const defaultHost: ShowHost = {
    sink() {
        const sink = (globalThis as { __ojShow?: unknown }).__ojShow
        return typeof sink === "function" ? sink as (batch: ShowBatch) => void : null
    },
    schedule(flush) {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => flush())
        else setTimeout(flush, 0)
    },
    log(line) { console.log(line) },
    now: () => Date.now(),
    later(fn, ms) { setTimeout(fn, ms) },
}

const shown = createShow(defaultHost)

/**
 * Shows values beside the line that called it, in the OJPlay editor.
 *
 * A number or a few values print at the end of the line. A plain object, a
 * Map or an array is drawn as a table under it. An object with an `inputs`
 * array of objects (each with an optional `label` and `op`) is drawn as a
 * graph, showing every number property on each node. Only the latest value
 * per line is kept, so a call in a loop is cheap.
 *
 * Outside the editor, and in Unity, it draws nothing: it logs a line when
 * what it shows changes, at most once a second per line.
 *
 *     import { show } from "oj"
 *     show(f(3.0))              // 20, at the end of this line
 *     show({ x1: x1.grad, w1: w1.grad })
 */
export function show(...values: unknown[]): void {
    shown.record(undefined, values)
}

// The build's tagged calls land here with their file and line. Not enumerable
// and not declared, so it is no part of what an author sees or types.
Object.defineProperty(show, "$", {
    value: (site: string, ...values: unknown[]) => shown.record(site, values),
})
