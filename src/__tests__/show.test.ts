import { describe, it, expect } from "vitest"
import { createShow, snapshot, show, type ShowBatch } from "../show"
import * as oj from "../index"
import { Vector2 } from "../vec"

/** A micrograd Value in the documented graph shape: inputs, op, label. */
class Value {
    grad = 0
    inputs: Value[]
    constructor(public data: number, public label = "", inputs: Value[] = [], public op = "") {
        this.inputs = inputs
    }
    add(o: Value) { return new Value(this.data + o.data, "", [this, o], "+") }
    mul(o: Value) { return new Value(this.data * o.data, "", [this, o], "*") }
}

/** A host whose frames and clock are stepped by hand, recording what reached the editor or the log. */
function host(withSink = true) {
    const batches: ShowBatch[] = []
    const lines: string[] = []
    let pending: (() => void) | null = null
    let scheduled = 0
    let now = 1000
    const timers: Array<{ at: number, fn: () => void }> = []
    const recorder = createShow({
        sink: () => (withSink ? (batch) => { batches.push(batch) } : null),
        schedule: (flush) => { scheduled++; pending = flush },
        log: (line) => { lines.push(line) },
        now: () => now,
        later: (fn, ms) => { timers.push({ at: now + ms, fn }) },
    })
    const frame = () => { const f = pending; pending = null; f?.() }
    /** Moves the clock on, running each timer that comes due, in order. */
    const advance = (ms: number) => {
        const until = now + ms
        for (;;) {
            timers.sort((a, b) => a.at - b.at)
            if (timers.length === 0 || timers[0]!.at > until) break
            const t = timers.shift()!
            now = t.at
            t.fn()
        }
        now = until
    }
    return { recorder, batches, lines, frame, advance, scheduled: () => scheduled }
}

describe("show: what a value looks like", () => {
    it("prints numbers as a console would, to six significant figures", () => {
        expect(snapshot([20]).text).toBe("20")
        expect(snapshot([(3 * 3.0001 ** 2 - 4 * 3.0001 + 5 - 20) / 0.0001]).text).toBe("14.0003")
        expect(snapshot([0.7071067811865476]).text).toBe("0.707107")
        expect(snapshot([-0]).text).toBe("0")
        expect(snapshot([1e-7]).text).toBe("1e-7")
    })

    it("puts several values on one line", () => {
        expect(snapshot([4, 3.97, -3]).text).toBe("4  3.97  -3")
        expect(snapshot(["slope", 14.03, true, null, undefined]).text).toBe("slope  14.03  true  null  undefined")
        expect(snapshot([]).text).toBe("")
    })

    it("draws a flat object as a one-row table", () => {
        const shown = snapshot([{ x1: -1.5, w1: 1, x2: 0.5, w2: 0 }])
        expect(shown.table).toEqual({ columns: ["x1", "w1", "x2", "w2"], rows: [["-1.5", "1", "0.5", "0"]], moreRows: 0, moreColumns: 0 })
        expect(shown.text).toBe("{ x1: -1.5, w1: 1, x2: 0.5, w2: 0 }")
    })

    it("draws an array of records as rows", () => {
        const shown = snapshot([[{ name: "a", hp: 3 }, { name: "b", hp: 7, xp: 2 }]])
        expect(shown.table).toEqual({
            columns: ["name", "hp", "xp"],
            rows: [["a", "3", ""], ["b", "7", "2"]],
            moreRows: 0, moreColumns: 0,
        })
    })

    it("uses a value's own toString when it has one", () => {
        const shown = snapshot([new Vector2(1, 2)])
        expect(shown.text).toBe("(1, 2)")
        expect(shown.table).toBeUndefined()
    })

    it("draws anything with inputs as a graph, each node once", () => {
        const a = new Value(2, "a"), b = new Value(-3, "b"), c = new Value(10, "c")
        const e = a.mul(b); e.label = "e"
        const d = e.add(c); d.label = "d"
        const twice = d.add(d); twice.label = "twice"
        const shown = snapshot([twice])
        const graph = shown.graph!
        expect(graph.more).toBe(0)
        expect(graph.nodes.map((n) => n.label)).toEqual(["twice", "d", "e", "c", "a", "b"])
        expect(graph.nodes[0]).toEqual({ label: "twice", op: "+", fields: [["grad", "0"], ["data", "8"]], inputs: [1, 1] })
        expect(graph.nodes[2]!.inputs).toEqual([4, 5])
        expect(shown.text).toBe("twice  grad=0  data=8")
    })

    it("stops a big object at a cap and says how much more there was", () => {
        let v = new Value(0, "v0")
        for (let i = 1; i < 100; i++) { v = v.add(new Value(i)); v.label = "v" + i }
        expect(snapshot([v]).graph!.nodes.length).toBe(60)
        expect(snapshot([v]).graph!.more).toBe(199 - 60)

        const rows = Array.from({ length: 80 }, (_, i) => ({ i }))
        expect(snapshot([rows]).table!.rows.length).toBe(50)
        expect(snapshot([rows]).table!.moreRows).toBe(30)

        const wide = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["k" + i, i]))
        expect(snapshot([wide]).table!.columns.length).toBe(20)
        expect(snapshot([wide]).table!.moreColumns).toBe(10)
    })

    it("survives a cycle and a value that throws when read", () => {
        const loop: { label: string, inputs: unknown[] } = { label: "loop", inputs: [] }
        loop.inputs.push(loop)
        expect(snapshot([loop]).graph!.nodes).toHaveLength(1)
        const hostile = new Proxy({}, { ownKeys() { throw new Error("no") } })
        expect(() => snapshot([hostile])).not.toThrow()
    })
})

describe("show: when it reaches the editor", () => {
    type Sink = { __ojShow?: (batch: ShowBatch) => void }

    it("sends a task's values as that task ends, not on the next frame", async () => {
        const batches: ShowBatch[] = []
        ;(globalThis as Sink).__ojShow = (batch) => { batches.push(batch) }
        try {
            // A drag step running the cart again: every show of the run, then the step ends.
            const tagged = (show as unknown as { $: (site: string, ...values: unknown[]) => void }).$
            for (let i = 0; i < 3; i++) tagged("flush.ts:4", i)
            tagged("flush.ts:5", "h")
            expect(batches).toEqual([])
            await Promise.resolve()
            expect(batches).toEqual([[["flush.ts:4", { text: "2" }], ["flush.ts:5", { text: "h" }]]])
        } finally {
            delete (globalThis as Sink).__ojShow
        }
    })
})

describe("show: where it goes", () => {
    it("sends the latest value per line, once a frame", () => {
        const { recorder, batches, frame, scheduled } = host()
        for (let i = 0; i < 60; i++) recorder.record("A.ts:9", [i])
        recorder.record("A.ts:18", [4, 3.97])
        expect(batches).toEqual([])
        expect(scheduled()).toBe(1)
        frame()
        expect(batches).toEqual([[["A.ts:9", { text: "59" }], ["A.ts:18", { text: "4  3.97" }]]])
        frame()
        expect(batches).toHaveLength(1)
    })

    it("keeps what a value was when show was called, not what it became", () => {
        const { recorder, batches, frame } = host()
        const grads = { x: 0 }
        recorder.record("A.ts:3", [grads])
        grads.x = 5
        frame()
        expect(batches[0]![0]![1].table!.rows).toEqual([["0"]])
    })

    it("with no editor, logs a line when what it shows changes", () => {
        const { recorder, lines, frame, advance } = host(false)
        recorder.record("A.ts:9", [1])
        recorder.record("A.ts:9", [1])
        recorder.record(undefined, [3])
        frame()
        advance(1000)
        recorder.record("A.ts:9", [1])
        recorder.record("A.ts:9", [2])
        expect(lines).toEqual(["A.ts:9 1", "3", "A.ts:9 2"])
    })

    /*
     * A show left in a frame loop on a value that changes every frame. In
     * Unity each line is a Debug.Log, which is the expensive part of a frame,
     * so a line logs at most once a second, and always ends on its latest.
     */
    it("with no editor, logs a changing line at most once a second, ending on its latest", () => {
        const { recorder, lines, advance } = host(false)
        for (let i = 0; i < 120; i++) {
            recorder.record("A.ts:9", [i])
            recorder.record("A.ts:10", ["steady"])
            advance(20)
        }
        advance(2000)
        expect(lines).toEqual(["A.ts:9 0", "A.ts:10 steady", "A.ts:9 49", "A.ts:9 99", "A.ts:9 119"])
    })
})

describe("show: on oj", () => {
    it("is exported from oj, and its line entry point stays off the types", () => {
        expect(oj.show).toBe(show)
        expect(typeof (show as unknown as { $: unknown }).$).toBe("function")
        expect(Object.keys(show)).toEqual([])
    })
})
