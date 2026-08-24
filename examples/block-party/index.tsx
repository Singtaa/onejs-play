import { useEffect, useMemo, useRef, useState } from "react"
import {
    View, Text, mount, useFrame, useRoom, useLeaderboard, scores,
    input, random, Painter, batchedVisualContent,
} from "oj"
import {
    beginGesture, advanceGesture, releaseGesture, isSoftDropping, spendDrop, type Gesture,
} from "./gestures"
import {
    emptyBoard, spawn, moved, rotated, fits, merge, clearLines, hardDropped,
    scoreFor, levelFor, dropInterval, cellsOf, shapeOf, sevenBag, KINDS,
    COLS, ROWS, type Board, type Piece, type PieceKind,
} from "./blocks"
import {
    attackFor, offset, takeGarbage, queue, nextHole, buries, addGarbage,
    chooseTarget, encodeWell, decodeWell, stackHeight, MAX_PENDING,
} from "./versus"

const CELL = 25
const WELL_X = 186
const WELL_Y = 30
const PANEL_X = 18
const PANEL_W = 150
const MINI_X = 460
const MINI_Y = 30
const MINI_CELL = 5
const MINI_PITCH_X = 68
const MINI_PITCH_Y = 124
const MINI_COLS = 6

const TONES: [number, number, number][] = [
    [0, 0, 0],
    [0.36, 0.80, 0.93],
    [0.96, 0.83, 0.36],
    [0.74, 0.50, 0.94],
    [0.45, 0.86, 0.53],
    [0.95, 0.43, 0.49],
    [0.38, 0.57, 0.96],
    [0.97, 0.63, 0.33],
    [0.40, 0.44, 0.52],
]

const REPEAT_DELAY = 0.16
const REPEAT_RATE = 0.05
const DEATH_PAUSE = 1.8
const CREDIT_SECONDS = 10
const WELL_HZ = 10

interface Well {
    board: Board
    piece: Piece
    next: PieceKind
    score: number
    lines: number
    combo: number
    pending: number
    hole: number
    dying: number
    buriedBy: number
}

interface Rival {
    board: Board
    score: number
    lines: number
    kos: number
}

function BlockParty() {
    const host = useRef<any>(null)
    const rng = useRef(random()).current
    const bag = useRef(sevenBag(() => rng.next())).current

    const well = useRef<Well>({
        board: emptyBoard(),
        piece: spawn(bag()),
        next: bag(),
        score: 0,
        lines: 0,
        combo: 0,
        pending: 0,
        hole: -1,
        dying: 0,
        buriedBy: 0,
    }).current
    const rivals = useRef(new Map<number, Rival>()).current

    const timers = useRef({ drop: 0, left: 0, right: 0, well: 0 }).current
    const drag = useRef<{ id: number; g: Gesture } | null>(null)
    const lastHit = useRef({ from: 0, at: 0 })
    const flash = useRef(0)
    const strike = useRef({ to: 0, left: 0 })
    const dirty = useRef(true)
    const askers = useRef<number[]>([]).current
    const kos = useRef(0)

    const [panel, setPanel] = useState({
        score: 0, lines: 0, kos: 0, pending: 0,
        target: 0, players: 1, connected: false, dying: 0, buriedBy: 0,
    })
    const [dropped, setDropped] = useState<string | null>(null)
    const board = useLeaderboard({ limit: 4 })
    const submit = useRef(board.submit)
    submit.current = board.submit

    const refresh = () => setPanel({
        score: well.score,
        lines: well.lines,
        kos: kos.current,
        pending: well.pending,
        target: chooseTarget(room.id, [...rivals].map(([id, r]) => ({ id, score: r.score }))),
        players: room.peers.length + 1,
        connected: room.connected,
        dying: well.dying,
        buriedBy: well.buriedBy,
    })

    const num = (value: unknown, fallback = 0): number =>
        typeof value === "number" && Number.isFinite(value) ? value : fallback

    const room = useRoom("party", {
        onOpen: () => {
            room.send({ k: "hi" })
            dirty.current = true
            timers.well = 0
            refresh()
        },
        onLeave: (id) => {
            rivals.delete(id)
            refresh()
        },
        onMessage: (from, raw) => {
            const data = raw as any
            if (data === null || typeof data !== "object") return

            if (data.k === "w") {
                rivals.set(from, {
                    board: decodeWell(data.b),
                    score: num(data.s),
                    lines: num(data.l),
                    kos: num(data.o),
                })
                return
            }

            if (data.k === "hi") {
                if (!askers.includes(from)) askers.push(from)
                timers.well = 0
                return
            }

            if (data.k === "a") {
                well.pending = queue(well.pending, num(data.n))
                lastHit.current = { from, at: Date.now() }
                flash.current = 0.35
                refresh()
                return
            }

            if (data.k === "x") {
                if (num(data.by, -1) === room.id) {
                    kos.current++
                    refresh()
                }
            }
        },
        onDropped: (reason) => setDropped(reason),
        onClose: () => refresh(),
    })

    const targetId = () => chooseTarget(room.id, [...rivals].map(([id, r]) => ({ id, score: r.score })))

    const die = (toWhom: number) => {
        if (well.dying > 0) return
        well.dying = DEATH_PAUSE
        well.buriedBy = toWhom
        room.send({ k: "x", by: toWhom })
        if (scores.available && well.score > 0) submit.current(well.score)
        dirty.current = true
        refresh()
    }

    const blameFor = () =>
        Date.now() - lastHit.current.at < CREDIT_SECONDS * 1000 ? lastHit.current.from : 0

    const lock = (settled: Piece) => {
        const merged = merge(well.board, settled)
        const { board: cleared, cleared: rows } = clearLines(merged)
        well.board = cleared

        const attack = attackFor(rows, well.combo)
        well.combo = rows > 0 ? well.combo + 1 : 0
        well.score += scoreFor(rows, levelFor(well.lines))
        well.lines += rows

        const after = offset(well.pending, attack)
        well.pending = after.pending
        if (after.sent > 0) {
            const to = targetId()
            if (to !== 0) {
                room.send({ k: "a", n: after.sent }, to)
                strike.current = { to, left: 0.5 }
            }
        }

        const { taken, left } = takeGarbage(well.pending)
        if (taken > 0) {
            // Asked before the rows go in: cells pushed off the top are gone by then.
            if (buries(well.board, taken)) {
                die(blameFor())
                return
            }
            well.hole = nextHole(well.hole, rng.next())
            well.board = addGarbage(well.board, taken, well.hole)
            well.pending = left
        }

        well.piece = spawn(well.next)
        well.next = bag()
        dirty.current = true
        if (!fits(well.board, well.piece)) die(blameFor())
        else refresh()
    }

    const restart = () => {
        well.board = emptyBoard()
        well.piece = spawn(bag())
        well.next = bag()
        well.score = 0
        well.lines = 0
        well.combo = 0
        well.pending = 0
        well.hole = -1
        well.dying = 0
        well.buriedBy = 0
        lastHit.current = { from: 0, at: 0 }
        dirty.current = true
        refresh()
    }

    useFrame((dt) => {
        const step = Math.min(dt, 1 / 20)
        if (flash.current > 0) flash.current = Math.max(0, flash.current - step)
        if (strike.current.left > 0) strike.current.left -= step

        if (well.dying > 0) {
            well.dying -= step
            if (well.dying <= 0) restart()
        } else {
            const touch = input.touchCount > 0 ? input.touches[0] : null
            const began = touch !== null && touch.phase === "began"
            const lifted = touch !== null && (touch.phase === "ended" || touch.phase === "canceled")

            let piece = well.piece
            const shift = (dx: number, key: "left" | "right") => {
                const next = moved(piece, dx, 0)
                if (fits(well.board, next)) piece = next
                timers[key] = timers[key] === 0 ? REPEAT_DELAY : REPEAT_RATE
            }

            for (const [key, code, dx] of [["left", "LeftArrow", -1], ["right", "RightArrow", 1]] as const) {
                if (input.keyboard.isKeyDown(code)) {
                    if (input.keyboard.wasKeyPressed(code)) { timers[key] = 0; shift(dx, key) }
                    else if ((timers[key] -= step) <= 0) shift(dx, key)
                } else timers[key] = 0
            }

            if (input.keyboard.wasKeyPressed("UpArrow")) piece = rotated(well.board, piece)

            let flicked = false
            if (began) {
                drag.current = { id: touch!.fingerId, g: beginGesture(touch!.position.x, touch!.position.y) }
            } else if (touch !== null && drag.current !== null && touch.fingerId === drag.current.id) {
                const columns = advanceGesture(drag.current.g, touch.position.x, touch.position.y, step)
                for (let i = 0; i < Math.abs(columns); i++) {
                    const next = moved(piece, Math.sign(columns), 0)
                    if (!fits(well.board, next)) break
                    piece = next
                }
                if (lifted) {
                    const release = releaseGesture(drag.current.g)
                    if (release === "rotate") piece = rotated(well.board, piece)
                    else if (release === "drop") flicked = true
                    drag.current = null
                }
            }

            let settled = false
            if (input.keyboard.wasKeyPressed("Space") || flicked) {
                piece = hardDropped(well.board, piece)
                settled = true
            }

            const soft = input.keyboard.isKeyDown("DownArrow")
                || (drag.current !== null && isSoftDropping(drag.current.g))
            timers.drop += step
            const interval = soft ? 0.03 : dropInterval(levelFor(well.lines))
            if (!settled && timers.drop >= interval) {
                timers.drop = 0
                const down = moved(piece, 0, 1)
                if (fits(well.board, down)) piece = down
                else settled = true
            }

            well.piece = piece
            if (settled) {
                timers.drop = 0
                // Without this the next piece spawns under a finger still counted
                // as dragging down, and falls straight through.
                if (drag.current !== null) spendDrop(drag.current.g)
                lock(piece)
            }
        }

        timers.well -= step
        if (timers.well <= 0 && (dirty.current || askers.length > 0)) {
            timers.well = 1 / WELL_HZ
            const snapshot = { k: "w", b: encodeWell(well.board), s: well.score, l: well.lines, o: kos.current }
            if (dirty.current) {
                dirty.current = false
                room.send(snapshot)
            } else {
                for (const who of askers) room.send(snapshot, who)
            }
            askers.length = 0
        }

        host.current?.MarkDirtyRepaint()
    }, [])

    useEffect(() => {
        const timer = setInterval(refresh, 400)
        return () => clearInterval(timer)
    }, [])

    const standings = () =>
        [...rivals].map(([id, rival]) => ({ id, rival }))
            .sort((a, b) => b.rival.score - a.rival.score || a.id - b.id)

    const paint = useMemo(() => batchedVisualContent((p: Painter) => {
        p.fillColor(0.055, 0.06, 0.075, 1)
        p.beginPath()
        box(p, 0, 0, 900, 560)
        p.fill()

        const target = targetId()

        drawWell(p, well.board, WELL_X, WELL_Y, CELL)
        if (well.dying <= 0) {
            const ghost = hardDropped(well.board, well.piece)
            const tone = TONES[KINDS.indexOf(well.piece.kind) + 1]!
            drawPiece(p, ghost, WELL_X, WELL_Y, CELL, tone, 0.22)
            drawPiece(p, well.piece, WELL_X, WELL_Y, CELL, tone, 1)
        }
        drawFrame(p, WELL_X, WELL_Y, COLS * CELL, ROWS * CELL,
            flash.current > 0 ? [0.95, 0.35, 0.35] : [0.20, 0.23, 0.29],
            flash.current > 0 ? 3 : 1.5)

        if (well.pending > 0) {
            const full = ROWS * CELL
            const height = (Math.min(well.pending, MAX_PENDING) / MAX_PENDING) * full
            p.fillColor(0.95, 0.35, 0.35, 0.85)
            p.beginPath()
            box(p, WELL_X - 12, WELL_Y + full - height, 6, height)
            p.fill()
        }

        drawShape(p, well.next, PANEL_X + 6, 242, 13)

        const others = standings()
        for (let i = 0; i < others.length && i < MINI_COLS * 4; i++) {
            const { id, rival } = others[i]!
            const at = slotAt(i)
            drawWell(p, rival.board, at.x, at.y, MINI_CELL)
            const trouble = stackHeight(rival.board) >= ROWS - 4
            drawFrame(p, at.x, at.y, COLS * MINI_CELL, ROWS * MINI_CELL,
                id === target ? [0.98, 0.72, 0.30] : trouble ? [0.85, 0.35, 0.35] : [0.18, 0.21, 0.26],
                id === target ? 2 : 1)
            if (id === strike.current.to && strike.current.left > 0) {
                p.fillColor(0.98, 0.72, 0.30, 0.18 * strike.current.left)
                p.beginPath()
                box(p, at.x, at.y, COLS * MINI_CELL, ROWS * MINI_CELL)
                p.fill()
            }
        }
    }), [])

    const others = standings()
    const shown = others.slice(0, MINI_COLS * 4)

    return (
        <View style={{ width: 900, height: 560, backgroundColor: "rgb(14, 15, 19)" }}>
            <View ref={host} onGenerateVisualContent={paint}
                style={{ position: "absolute", left: 0, top: 0, width: 900, height: 560 }} />

            <View style={{ position: "absolute", left: PANEL_X, top: 20, width: PANEL_W }} pickingMode="Ignore">
                <Text style={{ fontSize: 19, color: "rgb(232, 238, 250)" }}>BLOCK PARTY</Text>
                <Text style={{ fontSize: 10, marginTop: 2, color: "rgba(140, 160, 190, 0.75)" }}>
                    {panel.connected
                        ? `${panel.players} in the room`
                        : "playing alone, looking for the room"}
                </Text>
            </View>

            <Stat y={70} label="SCORE" value={String(panel.score)} />
            <Stat y={110} label="LINES" value={String(panel.lines)} />
            <Stat y={150} label="KNOCKED OUT" value={String(panel.kos)} />
            <Stat y={190} label="INCOMING" value={String(panel.pending)}
                tone={panel.pending > 0 ? "rgb(245, 110, 110)" : "rgb(226, 233, 246)"} />

            {dropped !== null && (
                <Text style={{
                    position: "absolute", left: PANEL_X, top: 520, width: PANEL_W,
                    fontSize: 10, color: "rgb(240, 170, 90)",
                }} pickingMode="Ignore">
                    {`the room dropped a message (${dropped})`}
                </Text>
            )}

            <View style={{ position: "absolute", left: PANEL_X, top: 226, width: PANEL_W }} pickingMode="Ignore">
                <Text style={{ fontSize: 9, color: "rgba(130, 150, 180, 0.7)" }}>NEXT</Text>
            </View>

            <View style={{ position: "absolute", left: PANEL_X, top: 300, width: PANEL_W }} pickingMode="Ignore">
                <Text style={{ fontSize: 9, color: "rgba(130, 150, 180, 0.7)" }}>SENDING TO</Text>
                <Text style={{ fontSize: 15, color: "rgb(250, 190, 90)" }}>
                    {panel.target === 0 ? "nobody yet" : `player ${panel.target}`}
                </Text>
            </View>

            <Text style={{
                position: "absolute", left: PANEL_X, top: 348, width: PANEL_W,
                fontSize: 9, color: "rgba(110, 128, 155, 0.75)",
            }} pickingMode="Ignore">
                {"arrows move, up rotates\nspace drops\n\ndrag to move, tap to\nrotate, flick down to drop\n\nclear two rows or more\nto send junk"}
            </Text>

            {board.entries.length > 0 && (
                <View style={{ position: "absolute", left: PANEL_X, top: 440, width: PANEL_W }} pickingMode="Ignore">
                    <Text style={{ fontSize: 9, color: "rgba(130, 150, 180, 0.7)", marginBottom: 3 }}>BEST EVER</Text>
                    {board.entries.map((entry, i) => (
                        <View key={`${entry.name}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ fontSize: 11, color: "rgba(200, 214, 236, 0.85)" }}>{entry.name}</Text>
                            <Text style={{ fontSize: 11, color: "rgba(150, 172, 205, 0.8)" }}>{String(entry.score)}</Text>
                        </View>
                    ))}
                </View>
            )}

            {shown.map(({ id, rival }, i) => {
                const at = slotAt(i)
                return (
                    <View key={id} style={{
                        position: "absolute", left: at.x, top: at.y + ROWS * MINI_CELL + 3, width: COLS * MINI_CELL,
                        flexDirection: "row", justifyContent: "space-between",
                    }} pickingMode="Ignore">
                        <Text style={{
                            fontSize: 9,
                            color: id === panel.target ? "rgb(250, 190, 90)" : "rgba(150, 170, 200, 0.8)",
                        }}>
                            {rival.kos > 0 ? `p${id} x${rival.kos}` : `p${id}`}
                        </Text>
                        <Text style={{ fontSize: 9, color: "rgba(150, 170, 200, 0.6)" }}>{String(rival.score)}</Text>
                    </View>
                )
            })}

            {panel.dying > 0 && (
                <View style={{
                    position: "absolute", left: WELL_X, top: WELL_Y + 190, width: COLS * CELL,
                    alignItems: "center",
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 22, color: "rgb(245, 110, 110)" }}>BURIED</Text>
                    <Text style={{ fontSize: 12, marginTop: 4, color: "rgba(220, 230, 245, 0.85)" }}>
                        {panel.buriedBy === 0 ? "by your own stack" : `by player ${panel.buriedBy}`}
                    </Text>
                </View>
            )}
        </View>
    )
}

function Stat({ y, label, value, tone }: { y: number; label: string; value: string; tone?: string }) {
    return (
        <View style={{ position: "absolute", left: PANEL_X, top: y, width: PANEL_W }} pickingMode="Ignore">
            <Text style={{ fontSize: 9, color: "rgba(130, 150, 180, 0.7)" }}>{label}</Text>
            <Text style={{ fontSize: 20, color: tone ?? "rgb(226, 233, 246)" }}>{value}</Text>
        </View>
    )
}

function slotAt(index: number): { x: number; y: number } {
    return {
        x: MINI_X + (index % MINI_COLS) * MINI_PITCH_X,
        y: MINI_Y + Math.floor(index / MINI_COLS) * MINI_PITCH_Y,
    }
}

function box(p: Painter, x: number, y: number, w: number, h: number): void {
    p.moveTo(x, y)
    p.lineTo(x + w, y)
    p.lineTo(x + w, y + h)
    p.lineTo(x, y + h)
    p.closePath()
}

function drawWell(p: Painter, board: Board, ox: number, oy: number, cell: number): void {
    p.fillColor(0.085, 0.09, 0.11, 1)
    p.beginPath()
    box(p, ox, oy, COLS * cell, ROWS * cell)
    p.fill()

    const inset = cell >= 12 ? 1 : 0.5
    for (let tone = 1; tone < TONES.length; tone++) {
        let open = false
        for (let y = 0; y < ROWS; y++) {
            const row = board[y]!
            for (let x = 0; x < COLS; x++) {
                if (row[x] !== tone) continue
                if (!open) { p.beginPath(); open = true }
                box(p, ox + x * cell + inset, oy + y * cell + inset, cell - inset * 2, cell - inset * 2)
            }
        }
        if (open) {
            const colour = TONES[tone]!
            p.fillColor(colour[0], colour[1], colour[2], 1)
            p.fill()
        }
    }
}

function drawPiece(
    p: Painter, piece: Piece, ox: number, oy: number, cell: number,
    tone: [number, number, number], alpha: number,
): void {
    p.fillColor(tone[0], tone[1], tone[2], alpha)
    p.beginPath()
    for (const [x, y] of cellsOf(piece)) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) continue
        box(p, ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2)
    }
    p.fill()
}

function drawShape(p: Painter, kind: PieceKind, ox: number, oy: number, cell: number): void {
    const cells = shapeOf(kind)
    const minX = Math.min(...cells.map(([x]) => x))
    const minY = Math.min(...cells.map(([, y]) => y))
    const tone = TONES[KINDS.indexOf(kind) + 1]!
    p.fillColor(tone[0], tone[1], tone[2], 1)
    p.beginPath()
    for (const [x, y] of cells) {
        box(p, ox + (x - minX) * cell + 1, oy + (y - minY) * cell + 1, cell - 2, cell - 2)
    }
    p.fill()
}

function drawFrame(
    p: Painter, x: number, y: number, w: number, h: number,
    tone: [number, number, number], width: number,
): void {
    p.strokeColor(tone[0], tone[1], tone[2], 1)
    p.lineWidth(width)
    p.beginPath()
    box(p, x, y, w, h)
    p.stroke()
}

mount(<BlockParty />)
