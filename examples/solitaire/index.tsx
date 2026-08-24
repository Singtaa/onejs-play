import { useMemo, useRef, useState } from "react"
import { View, Text, Button, mount, useFrame, input, random } from "oj"
import {
    deal, draw, toTableau, toFoundation, sendUp, lift, canLift,
    won, canFinish, nextFinishingMove, RANKS,
    type Card, type Game, type Source,
} from "./cards"
import { pipFor, SUIT_COLOUR } from "./pips"

const W = 760
const H = 700
const CARD_W = 80
const CARD_H = 112
const GAP = 16
const LEFT = (W - (7 * CARD_W + 6 * GAP)) / 2
const TOP_Y = 24
const TABLE_Y = 168
/** How far each card in a column peeks out from under the one on top of it. */
const FAN_DOWN = 13
const FAN_UP = 24

const columnX = (column: number) => LEFT + column * (CARD_W + GAP)

/** The foundations sit in the last four columns of the top row. */
const foundationColumn = (index: number) => 3 + index

const FELT = "rgb(21, 48, 42)"
const SLOT = "rgba(255, 255, 255, 0.06)"
const BACK = "rgb(46, 78, 120)"

/** Where each face-up card in a column starts, measured from the column top. */
function offsets(game: Game, column: number): number[] {
    const out: number[] = []
    let y = 0
    for (const slot of game.tableau[column]!) {
        out.push(y)
        y += slot.faceUp ? FAN_UP : FAN_DOWN
    }
    return out
}

const inside = (x: number, y: number, left: number, top: number, w = CARD_W, h = CARD_H) =>
    x >= left && x <= left + w && y >= top && y <= top + h

type Target =
    | { kind: "stock" }
    | { kind: "source"; source: Source }
    | { kind: "tableau"; pile: number }
    | { kind: "foundation"; index: number }
    | null

function hit(game: Game, x: number, y: number): Target {
    if (inside(x, y, columnX(0), TOP_Y)) return { kind: "stock" }
    if (inside(x, y, columnX(1), TOP_Y)) {
        return game.waste.length > 0 ? { kind: "source", source: { from: "waste" } } : null
    }
    for (let index = 0; index < 4; index++) {
        if (inside(x, y, columnX(foundationColumn(index)), TOP_Y)) return { kind: "foundation", index }
    }

    for (let column = 0; column < 7; column++) {
        const left = columnX(column)
        if (x < left || x > left + CARD_W) continue
        const pile = game.tableau[column]!
        if (pile.length === 0) {
            return inside(x, y, left, TABLE_Y) ? { kind: "tableau", pile: column } : null
        }
        // Backwards: the last card is drawn on top, so it is the one a pointer over the overlap lands on.
        const tops = offsets(game, column)
        for (let depth = pile.length - 1; depth >= 0; depth--) {
            if (!inside(x, y, left, TABLE_Y + tops[depth]!)) continue
            if (!pile[depth]!.faceUp) return null
            return canLift(pile, depth)
                ? { kind: "source", source: { from: "tableau", pile: column, depth } }
                : null
        }
        return null
    }
    return null
}

function Face({ card, dimmed }: { card: Card; dimmed?: boolean }) {
    const colour = SUIT_COLOUR[card.suit]!
    return (
        <View style={{
            width: CARD_W, height: CARD_H, borderRadius: 8,
            backgroundColor: dimmed === true ? "rgb(228, 232, 238)" : "rgb(248, 250, 253)",
            borderWidth: 1, borderColor: "rgba(12, 20, 30, 0.25)",
        }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 5, marginLeft: 7 }}>
                <Text style={{
                    fontSize: card.rank === 10 ? 15 : 17, color: colour,
                    unityFontStyleAndWeight: "bold", width: 22,
                }}>
                    {RANKS[card.rank]}
                </Text>
                <View style={{ width: 13, height: 13 }} onGenerateVisualContent={pipFor(card.suit, 13)} />
            </View>
            <View style={{
                position: "absolute", left: (CARD_W - 38) / 2, top: (CARD_H - 38) / 2 + 8,
                width: 38, height: 38,
            }} onGenerateVisualContent={pipFor(card.suit, 38)} />
        </View>
    )
}

function Back() {
    return (
        <View style={{
            width: CARD_W, height: CARD_H, borderRadius: 8, backgroundColor: BACK,
            borderWidth: 1, borderColor: "rgba(8, 14, 24, 0.4)",
            alignItems: "center", justifyContent: "center",
        }}>
            <View style={{
                width: CARD_W - 18, height: CARD_H - 18, borderRadius: 5,
                borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.16)",
            }} />
        </View>
    )
}

function Slot({ x, y, hint }: { x: number; y: number; hint?: string }) {
    return (
        <View style={{
            position: "absolute", left: x, top: y, width: CARD_W, height: CARD_H,
            borderRadius: 8, borderWidth: 1, borderColor: SLOT,
            alignItems: "center", justifyContent: "center",
        }} pickingMode="Ignore">
            {hint !== undefined && (
                <Text style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.22)" }}>{hint}</Text>
            )}
        </View>
    )
}

interface Drag {
    source: Source
    cards: Card[]
    /** Where in the dragged stack the pointer grabbed it. */
    grabX: number
    grabY: number
}

function Solitaire() {
    const rng = useRef(random()).current
    const [game, setGame] = useState<Game>(() => deal((cards) => rng.shuffle(cards)))
    const drag = useRef<Drag | null>(null)
    const dragLayer = useRef<any>(null)
    // The position is state as well, because the ref does not exist yet on the frame a drag starts.
    const [dragging, setDragging] = useState<{ cards: Card[]; x: number; y: number } | null>(null)

    const restart = () => {
        drag.current = null
        setDragging(null)
        setGame(deal((cards) => rng.shuffle(cards)))
    }

    const finish = () => {
        setGame((current) => {
            let next = current
            for (let guard = 0; guard < 60 && !won(next); guard++) {
                const move = nextFinishingMove(next)
                if (move === null) break
                next = sendUp(next, move)
            }
            return next
        })
    }

    // useFrame subscribes once, so the callback it captured needs a ref to see the current game.
    const live = useRef(game)
    live.current = game

    const onDown = (x: number, y: number) => {
        const game = live.current
        const target = hit(game, x, y)
        if (target === null) return
        if (target.kind === "stock") {
            setGame(draw(game))
            return
        }
        if (target.kind !== "source") return

        const cards = lift(game, target.source)
        if (cards.length === 0) return

        let originX = 0
        let originY = 0
        if (target.source.from === "waste") {
            originX = columnX(1)
            originY = TOP_Y
        } else if (target.source.from === "tableau") {
            originX = columnX(target.source.pile)
            originY = TABLE_Y + offsets(game, target.source.pile)[target.source.depth]!
        } else {
            originX = columnX(foundationColumn(target.source.index))
            originY = TOP_Y
        }

        drag.current = {
            source: target.source,
            cards,
            grabX: x - originX,
            grabY: y - originY,
        }
        setDragging({ cards, x: originX, y: originY })
    }

    const place = (x: number, y: number) => {
        const current = drag.current
        const layer = dragLayer.current
        if (current === null || layer === null) return
        layer.style.left = x - current.grabX
        layer.style.top = y - current.grabY
    }

    const onUp = (x: number, y: number) => {
        const game = live.current
        const current = drag.current
        if (current === null) return
        drag.current = null
        setDragging(null)

        const target = hit(game, x, y)
        let next = game

        if (target !== null && target.kind === "foundation") {
            next = toFoundation(game, current.source, target.index)
        } else if (target !== null && target.kind === "tableau") {
            next = toTableau(game, current.source, target.pile)
        } else if (target !== null && target.kind === "source" && target.source.from === "tableau") {
            next = toTableau(game, current.source, target.source.pile)
        } else if (target !== null && target.kind === "source" && target.source.from === "foundation") {
            next = toFoundation(game, current.source, target.source.index)
        }

        // A drop that went nowhere counts as a tap, which sends a single card up if anywhere takes it.
        if (next === game && current.cards.length === 1) {
            next = sendUp(game, current.source)
        }
        setGame(next)
    }

    // input reports stage units for mouse and touch alike. A React pointer event would give panel coordinates.
    useFrame(() => {
        const mouse = input.mouse
        let x = mouse.position.x
        let y = mouse.position.y
        let pressed = mouse.wasLeftPressed
        let released = mouse.wasLeftReleased
        let held = mouse.leftButton

        for (const touch of input.touches) {
            x = touch.position.x
            y = touch.position.y
            if (touch.phase === "began") pressed = true
            else if (touch.phase === "ended" || touch.phase === "canceled") released = true
            else held = true
        }

        if (pressed) onDown(x, y)
        else if (held) place(x, y)
        if (released) onUp(x, y)
    }, [])

    const complete = won(game)
    const finishable = canFinish(game)

    const wasteTop = game.waste[game.waste.length - 1]
    const wasteUnder = game.waste[game.waste.length - 2]

    const isDragged = useMemo(() => {
        const ids = new Set((dragging?.cards ?? []).map((c) => c.id))
        return (card: Card) => ids.has(card.id)
    }, [dragging])

    return (
        <View style={{ width: W, height: H, backgroundColor: FELT }}>
            {game.stock.length > 0
                ? <View style={{ position: "absolute", left: columnX(0), top: TOP_Y }}><Back /></View>
                : <Slot x={columnX(0)} y={TOP_Y} hint={game.waste.length > 0 ? "again" : ""} />}

            {/* The card under the top one shows a sliver, so the pile does not look empty mid drag. */}
            {wasteUnder !== undefined && !isDragged(wasteUnder) && (
                <View style={{ position: "absolute", left: columnX(1), top: TOP_Y }} pickingMode="Ignore">
                    <Face card={wasteUnder} dimmed />
                </View>
            )}
            {wasteTop === undefined
                ? <Slot x={columnX(1)} y={TOP_Y} />
                : !isDragged(wasteTop) && (
                    <View style={{ position: "absolute", left: columnX(1), top: TOP_Y }} pickingMode="Ignore">
                        <Face card={wasteTop} />
                    </View>
                )}

            {game.foundations.map((pile, index) => {
                const top = pile[pile.length - 1]
                const x = columnX(foundationColumn(index))
                return top === undefined || isDragged(top)
                    ? <Slot key={`f${index}`} x={x} y={TOP_Y} hint="A" />
                    : (
                        <View key={`f${index}`} style={{ position: "absolute", left: x, top: TOP_Y }}
                            pickingMode="Ignore">
                            <Face card={top} />
                        </View>
                    )
            })}

            {game.tableau.map((pile, column) => {
                const tops = offsets(game, column)
                const x = columnX(column)
                return (
                    <View key={`t${column}`}>
                        {pile.length === 0 && <Slot x={x} y={TABLE_Y} hint="K" />}
                        {pile.map((slot, depth) => (
                            isDragged(slot.card) ? null : (
                                <View key={slot.card.id}
                                    style={{ position: "absolute", left: x, top: TABLE_Y + tops[depth]! }}
                                    pickingMode="Ignore">
                                    {slot.faceUp ? <Face card={slot.card} /> : <Back />}
                                </View>
                            )
                        ))}
                    </View>
                )
            })}

            {/* The floating stack, last in the tree so it draws over everything. */}
            {dragging !== null && (
                <View ref={dragLayer} style={{ position: "absolute", left: dragging.x, top: dragging.y }}
                    pickingMode="Ignore">
                    {dragging.cards.map((card, i) => (
                        <View key={card.id} style={{ position: "absolute", left: 0, top: i * FAN_UP }}>
                            <Face card={card} />
                        </View>
                    ))}
                </View>
            )}

            <View style={{ position: "absolute", left: LEFT, top: H - 44, flexDirection: "row", alignItems: "center" }}>
                <Text style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.45)", width: 220 }}>
                    {complete ? "Out. Well played."
                        : `${game.moves} moves, ${game.passes} time${game.passes === 1 ? "" : "s"} through the stock`}
                </Text>
                {finishable && <Button text="Finish" onClick={finish} style={{ marginLeft: 10 }} />}
                <Button text="New deal" onClick={restart} style={{ marginLeft: 10 }} />
            </View>

            {complete && (
                <View style={{
                    position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: "rgba(12, 30, 26, 0.86)",
                }} pickingMode="Ignore">
                    <Text style={{ fontSize: 38, color: "rgb(238, 246, 240)" }}>All four, home</Text>
                    <Text style={{ fontSize: 14, marginTop: 8, color: "rgba(238, 246, 240, 0.6)" }}>
                        {`${game.moves} moves`}
                    </Text>
                </View>
            )}
        </View>
    )
}

mount(<Solitaire />)
