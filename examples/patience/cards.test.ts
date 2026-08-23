import { describe, it, expect } from "vitest"
import {
    deck, deal, canStack, canFound, runLength, canLift, draw, lift,
    toTableau, toFoundation, sendUp, won, canFinish, nextFinishingMove,
    isRed, label, foundationFor, clone,
    type Card, type Game, type Slot, type Suit,
} from "./cards"

const card = (rank: number, suit: number, id = rank * 10 + suit): Card =>
    ({ id, rank, suit: suit as Suit })

const SPADE = 0, HEART = 1, DIAMOND = 2, CLUB = 3

/** A game with nothing in it, to be filled in by each test. */
function empty(): Game {
    return { stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], passes: 0, moves: 0 }
}

const up = (c: Card): Slot => ({ card: c, faceUp: true })
const down = (c: Card): Slot => ({ card: c, faceUp: false })

describe("the deck", () => {
    it("has fifty two cards", () => {
        expect(deck()).toHaveLength(52)
    })

    it("has every rank in every suit, exactly once", () => {
        const seen = new Set(deck().map((c) => `${c.rank}-${c.suit}`))
        expect(seen.size).toBe(52)
    })

    it("gives every card its own id", () => {
        expect(new Set(deck().map((c) => c.id)).size).toBe(52)
    })

    it("knows which suits are red", () => {
        expect(isRed(card(1, HEART))).toBe(true)
        expect(isRed(card(1, DIAMOND))).toBe(true)
        expect(isRed(card(1, SPADE))).toBe(false)
        expect(isRed(card(1, CLUB))).toBe(false)
    })

    it("names a card the way a person would", () => {
        expect(label(card(1, SPADE))).toBe("AS")
        expect(label(card(10, HEART))).toBe("10H")
        expect(label(card(13, CLUB))).toBe("KC")
    })
})

describe("the deal", () => {
    const asDealt = (cards: Card[]) => cards
    const game = deal(asDealt)

    it("makes seven columns of one to seven cards", () => {
        expect(game.tableau.map((p) => p.length)).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    it("turns only the last card of each column face up", () => {
        for (const pile of game.tableau) {
            expect(pile[pile.length - 1]!.faceUp).toBe(true)
            expect(pile.slice(0, -1).every((s) => !s.faceUp)).toBe(true)
        }
    })

    it("leaves the other twenty four in the stock", () => {
        expect(game.stock).toHaveLength(24)
        expect(game.waste).toHaveLength(0)
    })

    it("deals every card exactly once", () => {
        const ids = [...game.stock.map((c) => c.id), ...game.tableau.flat().map((s) => s.card.id)]
        expect(new Set(ids).size).toBe(52)
    })

    it("starts with empty foundations", () => {
        expect(game.foundations.every((f) => f.length === 0)).toBe(true)
    })
})

describe("stacking on a column", () => {
    it("takes a lower rank of the other colour", () => {
        expect(canStack(card(6, HEART), card(7, SPADE))).toBe(true)
        expect(canStack(card(6, DIAMOND), card(7, CLUB))).toBe(true)
    })

    it("refuses the same colour", () => {
        expect(canStack(card(6, HEART), card(7, DIAMOND))).toBe(false)
        expect(canStack(card(6, SPADE), card(7, CLUB))).toBe(false)
    })

    it("refuses a rank that is not one lower", () => {
        expect(canStack(card(5, HEART), card(7, SPADE))).toBe(false)
        expect(canStack(card(8, HEART), card(7, SPADE))).toBe(false)
        expect(canStack(card(7, HEART), card(7, SPADE))).toBe(false)
    })

    it("takes a king onto an empty column and nothing else", () => {
        expect(canStack(card(13, SPADE), undefined)).toBe(true)
        expect(canStack(card(12, SPADE), undefined)).toBe(false)
        expect(canStack(card(1, SPADE), undefined)).toBe(false)
    })
})

describe("stacking on a foundation", () => {
    it("starts with an ace and nothing else", () => {
        expect(canFound(card(1, SPADE), [])).toBe(true)
        expect(canFound(card(2, SPADE), [])).toBe(false)
        expect(canFound(card(13, SPADE), [])).toBe(false)
    })

    it("goes up one at a time in the same suit", () => {
        expect(canFound(card(2, SPADE), [card(1, SPADE)])).toBe(true)
        expect(canFound(card(3, SPADE), [card(1, SPADE)])).toBe(false)
        expect(canFound(card(2, HEART), [card(1, SPADE)])).toBe(false)
    })
})

describe("what may be picked up", () => {
    it("counts a single face-up card", () => {
        expect(runLength([down(card(5, SPADE)), up(card(9, HEART))])).toBe(1)
    })

    it("counts a descending run of alternating colours", () => {
        const pile = [down(card(2, SPADE)), up(card(9, SPADE)), up(card(8, HEART)), up(card(7, CLUB))]
        expect(runLength(pile)).toBe(3)
    })

    it("stops at a break in colour", () => {
        const pile = [up(card(9, SPADE)), up(card(8, CLUB)), up(card(7, HEART))]
        expect(runLength(pile)).toBe(2)
    })

    it("stops at a break in rank", () => {
        const pile = [up(card(9, SPADE)), up(card(5, HEART)), up(card(4, CLUB))]
        expect(runLength(pile)).toBe(2)
    })

    it("stops at a face-down card", () => {
        expect(runLength([up(card(9, SPADE)), down(card(8, HEART)), up(card(7, CLUB))])).toBe(1)
    })

    it("is zero for an empty column", () => {
        expect(runLength([])).toBe(0)
    })

    it("allows lifting from anywhere inside the run", () => {
        const pile = [down(card(2, SPADE)), up(card(9, SPADE)), up(card(8, HEART)), up(card(7, CLUB))]
        expect(canLift(pile, 1)).toBe(true)
        expect(canLift(pile, 3)).toBe(true)
    })

    it("refuses to lift from below the run", () => {
        const pile = [up(card(9, SPADE)), up(card(4, HEART)), up(card(3, CLUB))]
        expect(canLift(pile, 0)).toBe(false)
    })

    it("refuses a depth that is not there", () => {
        expect(canLift([up(card(9, SPADE))], 4)).toBe(false)
        expect(canLift([up(card(9, SPADE))], -1)).toBe(false)
    })
})

describe("drawing", () => {
    it("moves one card from the stock to the waste", () => {
        const game = empty()
        game.stock = [card(3, SPADE), card(4, HEART)]
        const next = draw(game)
        expect(next.stock).toHaveLength(1)
        expect(next.waste.map((c) => c.id)).toEqual([card(4, HEART).id])
    })

    it("leaves the game it was given alone", () => {
        const game = empty()
        game.stock = [card(3, SPADE)]
        draw(game)
        expect(game.stock).toHaveLength(1)
        expect(game.waste).toHaveLength(0)
    })

    /**
     * The waste goes back under the stock in the order it was dealt out, so a
     * second pass shows the same cards in the same order. Forgetting the
     * reverse silently changes the game into a different, easier one.
     */
    it("turns the waste back into the stock in the original order", () => {
        const game = empty()
        game.stock = [card(3, SPADE), card(4, HEART), card(5, CLUB)]
        // The stock is drawn from its end, so the first pass turns up 5, 4, 3.
        let next = draw(draw(draw(game)))
        expect(next.stock).toHaveLength(0)
        expect(next.waste.map((c) => c.rank)).toEqual([5, 4, 3])

        next = draw(next)
        expect(next.waste).toHaveLength(0)
        expect(next.stock.map((c) => c.rank)).toEqual([3, 4, 5])
        expect(next.passes).toBe(1)

        // And the second pass turns them up in the same order as the first,
        // which is the property the reverse exists for. Forgetting it silently
        // turns Klondike into a different, easier game.
        let pass = next
        const order: number[] = []
        for (let i = 0; i < 3; i++) {
            pass = draw(pass)
            order.push(pass.waste[pass.waste.length - 1]!.rank)
        }
        expect(order).toEqual([5, 4, 3])
    })

    it("does nothing at all when both are empty", () => {
        const game = empty()
        expect(draw(game)).toBe(game)
    })
})

describe("moving onto a column", () => {
    it("moves a card from the waste", () => {
        const game = empty()
        game.waste = [card(6, HEART)]
        game.tableau[0] = [up(card(7, SPADE))]
        const next = toTableau(game, { from: "waste" }, 0)
        expect(next.waste).toHaveLength(0)
        expect(next.tableau[0]!.map((s) => s.card.rank)).toEqual([7, 6])
    })

    it("moves a whole run at once", () => {
        const game = empty()
        game.tableau[0] = [up(card(9, SPADE)), up(card(8, HEART)), up(card(7, CLUB))]
        game.tableau[1] = [up(card(10, HEART))]
        const next = toTableau(game, { from: "tableau", pile: 0, depth: 0 }, 1)
        expect(next.tableau[0]).toHaveLength(0)
        expect(next.tableau[1]!.map((s) => s.card.rank)).toEqual([10, 9, 8, 7])
    })

    it("refuses an illegal landing and changes nothing", () => {
        const game = empty()
        game.waste = [card(6, HEART)]
        game.tableau[0] = [up(card(7, DIAMOND))]
        expect(toTableau(game, { from: "waste" }, 0)).toBe(game)
    })

    it("refuses to move a run that is not a run", () => {
        const game = empty()
        game.tableau[0] = [up(card(9, SPADE)), up(card(4, HEART))]
        game.tableau[1] = [up(card(10, HEART))]
        expect(toTableau(game, { from: "tableau", pile: 0, depth: 0 }, 1)).toBe(game)
    })

    /**
     * Dropping a stack back where it came from. The cards are removed before
     * they are added, so without a guard this deletes them.
     */
    it("refuses to move a column onto itself", () => {
        const game = empty()
        game.tableau[0] = [up(card(9, SPADE)), up(card(8, HEART))]
        const next = toTableau(game, { from: "tableau", pile: 0, depth: 1 }, 0)
        expect(next).toBe(game)
        expect(next.tableau[0]).toHaveLength(2)
    })

    it("turns over the card a move exposed", () => {
        const game = empty()
        game.tableau[0] = [down(card(2, CLUB)), up(card(6, HEART))]
        game.tableau[1] = [up(card(7, SPADE))]
        const next = toTableau(game, { from: "tableau", pile: 0, depth: 1 }, 1)
        expect(next.tableau[0]![0]!.faceUp).toBe(true)
    })

    it("takes a king onto an empty column", () => {
        const game = empty()
        game.waste = [card(13, SPADE)]
        expect(toTableau(game, { from: "waste" }, 3).tableau[3]).toHaveLength(1)
    })

    it("brings a card back down off a foundation", () => {
        const game = empty()
        game.foundations[HEART] = [card(1, HEART), card(2, HEART)]
        game.tableau[0] = [up(card(3, SPADE))]
        const next = toTableau(game, { from: "foundation", index: HEART }, 0)
        expect(next.foundations[HEART]).toHaveLength(1)
        expect(next.tableau[0]!.map((s) => s.card.rank)).toEqual([3, 2])
    })
})

describe("moving up to a foundation", () => {
    it("sends an ace up", () => {
        const game = empty()
        game.waste = [card(1, SPADE)]
        expect(toFoundation(game, { from: "waste" }, SPADE).foundations[SPADE]).toHaveLength(1)
    })

    it("refuses a card that does not follow", () => {
        const game = empty()
        game.waste = [card(3, SPADE)]
        expect(toFoundation(game, { from: "waste" }, SPADE)).toBe(game)
    })

    /** Even when every card in it would be legal on its own. */
    it("refuses to send a run up together", () => {
        const game = empty()
        game.foundations[SPADE] = [card(1, SPADE)]
        game.tableau[0] = [up(card(3, HEART)), up(card(2, SPADE))]
        expect(toFoundation(game, { from: "tableau", pile: 0, depth: 0 }, SPADE)).toBe(game)
    })

    it("finds the right foundation on its own", () => {
        const game = empty()
        game.waste = [card(1, DIAMOND)]
        expect(sendUp(game, { from: "waste" }).foundations[DIAMOND]).toHaveLength(1)
        expect(foundationFor(card(1, DIAMOND))).toBe(DIAMOND)
    })

    it("leaves the game alone when nowhere will take the card", () => {
        const game = empty()
        game.waste = [card(9, DIAMOND)]
        expect(sendUp(game, { from: "waste" })).toBe(game)
    })

    it("turns over the card it exposed", () => {
        const game = empty()
        game.tableau[0] = [down(card(7, CLUB)), up(card(1, SPADE))]
        expect(sendUp(game, { from: "tableau", pile: 0, depth: 1 }).tableau[0]![0]!.faceUp).toBe(true)
    })
})

describe("lifting", () => {
    it("offers only the top card of the waste", () => {
        const game = empty()
        game.waste = [card(3, SPADE), card(4, HEART)]
        expect(lift(game, { from: "waste" }).map((c) => c.rank)).toEqual([4])
    })

    it("offers nothing from an empty waste", () => {
        expect(lift(empty(), { from: "waste" })).toEqual([])
    })

    it("offers the run from a column, in order", () => {
        const game = empty()
        game.tableau[0] = [up(card(9, SPADE)), up(card(8, HEART)), up(card(7, CLUB))]
        expect(lift(game, { from: "tableau", pile: 0, depth: 1 }).map((c) => c.rank)).toEqual([8, 7])
    })

    it("offers nothing when the run does not reach that deep", () => {
        const game = empty()
        game.tableau[0] = [up(card(9, SPADE)), up(card(4, HEART))]
        expect(lift(game, { from: "tableau", pile: 0, depth: 0 })).toEqual([])
    })
})

describe("finishing", () => {
    const complete = (): Game => {
        const game = empty()
        for (let suit = 0; suit < 4; suit++) {
            for (let rank = 1; rank <= 13; rank++) game.foundations[suit]!.push(card(rank, suit))
        }
        return game
    }

    it("knows a finished game", () => {
        expect(won(complete())).toBe(true)
        expect(won(empty())).toBe(false)
    })

    it("offers to finish once nothing is hidden and the stock is empty", () => {
        const game = empty()
        game.tableau[0] = [up(card(1, SPADE))]
        expect(canFinish(game)).toBe(true)
    })

    it("does not offer while a card is still face down", () => {
        const game = empty()
        game.tableau[0] = [down(card(5, CLUB)), up(card(1, SPADE))]
        expect(canFinish(game)).toBe(false)
    })

    it("does not offer while cards remain in the stock or waste", () => {
        const game = empty()
        game.tableau[0] = [up(card(1, SPADE))]
        game.stock = [card(2, HEART)]
        expect(canFinish(game)).toBe(false)
        game.stock = []
        game.waste = [card(2, HEART)]
        expect(canFinish(game)).toBe(false)
    })

    it("does not offer on a game already won", () => {
        expect(canFinish(complete())).toBe(false)
    })

    it("picks the lowest card that will go up", () => {
        const game = empty()
        game.tableau[0] = [up(card(5, SPADE))]
        game.tableau[1] = [up(card(1, HEART))]
        game.foundations[SPADE] = [card(1, SPADE), card(2, SPADE), card(3, SPADE), card(4, SPADE)]
        const move = nextFinishingMove(game)
        expect(move).toEqual({ from: "tableau", pile: 1, depth: 0 })
    })

    it("will take from the waste too", () => {
        const game = empty()
        game.waste = [card(1, CLUB)]
        expect(nextFinishingMove(game)).toEqual({ from: "waste" })
    })

    it("says so when nothing can go up", () => {
        const game = empty()
        game.tableau[0] = [up(card(9, SPADE))]
        expect(nextFinishingMove(game)).toBeNull()
    })

    /** Repeatedly taking the lowest available card must actually finish. */
    it("finishes a laid-out game by taking the lowest each time", () => {
        const game = empty()
        for (let suit = 0; suit < 4; suit++) {
            // Each suit spread across a column, kings at the bottom.
            const pile: Slot[] = []
            for (let rank = 13; rank >= 1; rank--) pile.push(up(card(rank, suit)))
            game.tableau[suit] = pile
        }
        let current = game
        for (let guard = 0; guard < 200 && !won(current); guard++) {
            const move = nextFinishingMove(current)
            if (move === null) break
            current = sendUp(current, move)
        }
        expect(won(current)).toBe(true)
    })
})

describe("clone", () => {
    it("copies deeply enough that a move never edits the original", () => {
        const game = empty()
        game.tableau[0] = [up(card(9, SPADE))]
        game.foundations[SPADE] = [card(1, SPADE)]
        const copy = clone(game)
        copy.tableau[0]![0]!.faceUp = false
        copy.foundations[SPADE]!.push(card(2, SPADE))
        expect(game.tableau[0]![0]!.faceUp).toBe(true)
        expect(game.foundations[SPADE]).toHaveLength(1)
    })
})
