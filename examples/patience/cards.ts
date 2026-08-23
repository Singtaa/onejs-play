/**
 * Klondike, with no screen in it.
 *
 * The rules are old and everybody half knows them, which is exactly why they
 * are worth writing down precisely and testing: the half everybody knows is
 * "red on black, descending", and the half that decides whether a game is
 * winnable is all the rest. What may move as a group, what an empty column
 * accepts, what happens when the stock runs out, and whether a card may come
 * back off a foundation.
 *
 * Nothing here imports oj or React. A deal is a value, a move produces a new
 * value, and the screen is somebody else's problem.
 */

/** Spades, hearts, diamonds, clubs. The two in the middle are the red ones. */
export const SUITS = ["S", "H", "D", "C"] as const
export type Suit = 0 | 1 | 2 | 3

export const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const

export interface Card {
    /** Stable for the life of a deal, so the screen can animate one card. */
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
    /** Face up. Only the last one is playable. */
    waste: Card[]
    /** One per suit, aces upward. */
    foundations: Card[][]
    /** Seven columns, dealt one to seven cards deep. */
    tableau: Slot[][]
    /** How many times the stock has been turned over. */
    passes: number
    moves: number
}

export const isRed = (card: Card) => card.suit === 1 || card.suit === 2

export const label = (card: Card) => `${RANKS[card.rank]}${SUITS[card.suit]}`

/** A full deck in order, which the deal then shuffles. */
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

/**
 * A fresh game.
 *
 * Seven columns of one to seven cards, only the last of each face up, and
 * everything left over as the stock. Twenty eight cards go on the table and
 * twenty four do not, which is where the whole tension of the game comes from.
 */
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

/**
 * Whether one card may sit on another in a column.
 *
 * Descending rank, alternating colour. An empty column takes a king and nothing
 * else, which is the rule that makes emptying a column worth doing rather than
 * free.
 */
export function canStack(moving: Card, onto: Card | undefined): boolean {
    if (onto === undefined) return moving.rank === 13
    return moving.rank === onto.rank - 1 && isRed(moving) !== isRed(onto)
}

/**
 * Whether a card may go up onto a foundation.
 *
 * Same suit, ascending from the ace, one at a time. Never a group: a foundation
 * is built card by card even when a whole run is sitting ready.
 */
export function canFound(card: Card, foundation: Card[]): boolean {
    const top = foundation[foundation.length - 1]
    if (top === undefined) return card.rank === 1
    return card.suit === top.suit && card.rank === top.rank + 1
}

/**
 * How many cards from the top of a column may be picked up together.
 *
 * A run that is already face up, descending and alternating in colour. Anything
 * below a break stays where it is, and a face-down card stops the run outright.
 */
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

/** Whether the card at a given depth may be picked up along with the rest. */
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

/**
 * Turns the top card of the stock over onto the waste.
 *
 * With the stock empty, the waste goes back under it face down and the pass
 * count goes up. Unlimited passes, which is the forgiving version and the one
 * almost every digital Klondike uses.
 */
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

/** Where a card is coming from. */
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

/**
 * Turns over the card a move exposed.
 *
 * Automatic, in every version of this game worth playing, and done here rather
 * than by the screen so that a game state is never left in a position a player
 * could not have reached.
 */
function flipExposed(game: Game): void {
    for (const pile of game.tableau) {
        const top = pile[pile.length - 1]
        if (top !== undefined && !top.faceUp) top.faceUp = true
    }
}

/** Moves cards onto a column, or returns the game unchanged if it is not legal. */
export function toTableau(game: Game, source: Source, pile: number): Game {
    const moving = lift(game, source)
    if (moving.length === 0) return game
    const target = game.tableau[pile]
    if (target === undefined) return game
    // Moving a stack onto its own column is not a move, and without this check
    // it would delete the cards: they are removed before being added back.
    if (source.from === "tableau" && source.pile === pile) return game
    if (!canStack(moving[0]!, target[target.length - 1]?.card)) return game

    const next = clone(game)
    remove(next, source)
    for (const card of moving) next.tableau[pile]!.push({ card, faceUp: true })
    flipExposed(next)
    next.moves++
    return next
}

/** Moves one card up to a foundation, or returns the game unchanged. */
export function toFoundation(game: Game, source: Source, index: number): Game {
    const moving = lift(game, source)
    // Exactly one card, always. A run of four does not go up together even
    // when every card in it would be legal on its own.
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

/** The foundation a card belongs on, whether or not it may go there yet. */
export function foundationFor(card: Card): number {
    return card.suit
}

/** Sends a card up if anywhere will take it. Returns the game unchanged if not. */
export function sendUp(game: Game, source: Source): Game {
    const moving = lift(game, source)
    if (moving.length !== 1) return game
    return toFoundation(game, source, foundationFor(moving[0]!))
}

export function won(game: Game): boolean {
    return game.foundations.every((f) => f.length === 13)
}

/**
 * Whether every remaining card could simply be sent up.
 *
 * True once nothing is face down and the stock and waste are empty, at which
 * point the rest of the game is mechanical and worth offering to finish.
 */
export function canFinish(game: Game): boolean {
    if (won(game)) return false
    if (game.stock.length > 0 || game.waste.length > 0) return false
    return game.tableau.every((pile) => pile.every((slot) => slot.faceUp))
}

/**
 * One step of finishing: the lowest card that will go up.
 *
 * Lowest first, so the foundations fill evenly and a step is never blocked by
 * having chosen greedily a moment earlier.
 */
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
