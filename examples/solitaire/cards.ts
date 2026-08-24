/** Spades, hearts, diamonds, clubs. The two in the middle are the red ones. */
export const SUITS = ["S", "H", "D", "C"] as const
export type Suit = 0 | 1 | 2 | 3

export const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const

export interface Card {
    id: number
    /** Ace is 1, king is 13. */
    rank: number
    suit: Suit
}

export interface Slot {
    card: Card
    faceUp: boolean
}

export interface Game {
    /** Face down, drawn from the top, which is the end of this array. */
    stock: Card[]
    waste: Card[]
    /** One per suit, aces upward. */
    foundations: Card[][]
    tableau: Slot[][]
    passes: number
    moves: number
}

export const isRed = (card: Card) => card.suit === 1 || card.suit === 2

export const label = (card: Card) => `${RANKS[card.rank]}${SUITS[card.suit]}`

export function deck(): Card[] {
    const cards: Card[] = []
    let id = 0
    for (let suit = 0; suit < 4; suit++) {
        for (let rank = 1; rank <= 13; rank++) {
            cards.push({ id: id++, rank, suit: suit as Suit })
        }
    }
    return cards
}

export function deal(shuffle: (cards: Card[]) => Card[]): Game {
    const cards = shuffle(deck())
    const tableau: Slot[][] = []
    let at = 0
    for (let column = 0; column < 7; column++) {
        const pile: Slot[] = []
        for (let depth = 0; depth <= column; depth++) {
            pile.push({ card: cards[at++]!, faceUp: depth === column })
        }
        tableau.push(pile)
    }
    return {
        stock: cards.slice(at),
        waste: [],
        foundations: [[], [], [], []],
        tableau,
        passes: 0,
        moves: 0,
    }
}

export function canStack(moving: Card, onto: Card | undefined): boolean {
    if (onto === undefined) return moving.rank === 13
    return moving.rank === onto.rank - 1 && isRed(moving) !== isRed(onto)
}

export function canFound(card: Card, foundation: Card[]): boolean {
    const top = foundation[foundation.length - 1]
    if (top === undefined) return card.rank === 1
    return card.suit === top.suit && card.rank === top.rank + 1
}

export function runLength(pile: Slot[]): number {
    let length = 0
    for (let i = pile.length - 1; i >= 0; i--) {
        const slot = pile[i]!
        if (!slot.faceUp) break
        if (length > 0) {
            const above = pile[i + 1]!.card
            if (!canStack(above, slot.card)) break
        }
        length++
    }
    return length
}

export function canLift(pile: Slot[], from: number): boolean {
    if (from < 0 || from >= pile.length) return false
    return pile.length - from <= runLength(pile)
}

/** A deep enough copy that a move never edits the game it came from. */
export function clone(game: Game): Game {
    return {
        stock: [...game.stock],
        waste: [...game.waste],
        foundations: game.foundations.map((f) => [...f]),
        tableau: game.tableau.map((pile) => pile.map((slot) => ({ ...slot }))),
        passes: game.passes,
        moves: game.moves,
    }
}

// With the stock empty, the waste goes back under it and the pass count goes up. Passes are unlimited.
export function draw(game: Game): Game {
    const next = clone(game)
    if (next.stock.length === 0) {
        if (next.waste.length === 0) return game
        next.stock = [...next.waste].reverse()
        next.waste = []
        next.passes++
        next.moves++
        return next
    }
    next.waste.push(next.stock.pop()!)
    next.moves++
    return next
}

export type Source =
    | { from: "waste" }
    | { from: "tableau"; pile: number; depth: number }
    | { from: "foundation"; index: number }

/** The cards a source is offering, top of the stack last. */
export function lift(game: Game, source: Source): Card[] {
    if (source.from === "waste") {
        const top = game.waste[game.waste.length - 1]
        return top === undefined ? [] : [top]
    }
    if (source.from === "foundation") {
        const top = game.foundations[source.index]?.[game.foundations[source.index]!.length - 1]
        return top === undefined ? [] : [top]
    }
    const pile = game.tableau[source.pile]
    if (pile === undefined || !canLift(pile, source.depth)) return []
    return pile.slice(source.depth).map((slot) => slot.card)
}

/** Takes the lifted cards off wherever they were. Assumes lift allowed it. */
function remove(game: Game, source: Source): void {
    if (source.from === "waste") {
        game.waste.pop()
        return
    }
    if (source.from === "foundation") {
        game.foundations[source.index]!.pop()
        return
    }
    game.tableau[source.pile]!.length = source.depth
}

function flipExposed(game: Game): void {
    for (const pile of game.tableau) {
        const top = pile[pile.length - 1]
        if (top !== undefined && !top.faceUp) top.faceUp = true
    }
}

export function toTableau(game: Game, source: Source, pile: number): Game {
    const moving = lift(game, source)
    if (moving.length === 0) return game
    const target = game.tableau[pile]
    if (target === undefined) return game
    // Without this, a stack dropped on its own column would be removed and never added back.
    if (source.from === "tableau" && source.pile === pile) return game
    if (!canStack(moving[0]!, target[target.length - 1]?.card)) return game

    const next = clone(game)
    remove(next, source)
    for (const card of moving) next.tableau[pile]!.push({ card, faceUp: true })
    flipExposed(next)
    next.moves++
    return next
}

export function toFoundation(game: Game, source: Source, index: number): Game {
    const moving = lift(game, source)
    // One card at a time, even when a whole run would be legal.
    if (moving.length !== 1) return game
    const foundation = game.foundations[index]
    if (foundation === undefined || !canFound(moving[0]!, foundation)) return game

    const next = clone(game)
    remove(next, source)
    next.foundations[index]!.push(moving[0]!)
    flipExposed(next)
    next.moves++
    return next
}

export function foundationFor(card: Card): number {
    return card.suit
}

export function sendUp(game: Game, source: Source): Game {
    const moving = lift(game, source)
    if (moving.length !== 1) return game
    return toFoundation(game, source, foundationFor(moving[0]!))
}

export function won(game: Game): boolean {
    return game.foundations.every((f) => f.length === 13)
}

export function canFinish(game: Game): boolean {
    if (won(game)) return false
    if (game.stock.length > 0 || game.waste.length > 0) return false
    return game.tableau.every((pile) => pile.every((slot) => slot.faceUp))
}

export function nextFinishingMove(game: Game): Source | null {
    let best: { source: Source; rank: number } | null = null
    for (let pile = 0; pile < game.tableau.length; pile++) {
        const column = game.tableau[pile]!
        const top = column[column.length - 1]
        if (top === undefined || !top.faceUp) continue
        const source: Source = { from: "tableau", pile, depth: column.length - 1 }
        if (!canFound(top.card, game.foundations[foundationFor(top.card)]!)) continue
        if (best === null || top.card.rank < best.rank) best = { source, rank: top.card.rank }
    }
    const wasteTop = game.waste[game.waste.length - 1]
    if (wasteTop !== undefined && canFound(wasteTop, game.foundations[foundationFor(wasteTop)]!)) {
        if (best === null || wasteTop.rank < best.rank) best = { source: { from: "waste" }, rank: wasteTop.rank }
    }
    return best === null ? null : best.source
}
