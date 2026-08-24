import { describe, it, expect } from "vitest"
import {
    makeSnake, normalizeAngle, steer, radiusOf, nodeBudget, grow, advance, layTrail,
    resetTrail, hitsBody, insideWorld, canBoost, boostDrain, scatterOrbs, orbsEaten,
    corpseOrbs, spawnPoint,
    WORLD_W, WORLD_H, SPEED, BOOST_SPEED, TURN_RATE, START_LENGTH, MAX_LENGTH,
    NODE_GAP, MIN_RADIUS, MAX_RADIUS, GRAZE, BOOST_FLOOR, ORB_SIZE,
    type Snake,
} from "./snake"

function seeded(seed: number): () => number {
    let state = seed
    return () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

function wander(snake: Snake, steps: number, roll: () => number, dt = 1 / 60): Snake {
    for (let i = 0; i < steps; i++) {
        snake.angle = steer(snake.angle, roll() * Math.PI * 2, dt)
        advance(snake, dt, roll() < 0.2)
    }
    return snake
}

describe("the shape of a body", () => {
    it("keeps its points closer together than a body is wide", () => {
        expect(NODE_GAP).toBeLessThan(2 * MIN_RADIUS)
        expect(NODE_GAP).toBeLessThan(2 * radiusOf(START_LENGTH))
        expect(NODE_GAP).toBeLessThan(2 * radiusOf(MAX_LENGTH))
    })

    it("lays them at exactly that spacing however hard it is turning", () => {
        const roll = seeded(19)
        const snake = wander(makeSnake(1000, 1000, 0), 3000, roll)
        expect(snake.nodes.length).toBeGreaterThan(10)
        for (let i = 1; i < snake.nodes.length; i++) {
            const a = snake.nodes[i - 1]!
            const b = snake.nodes[i]!
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(NODE_GAP, 6)
        }
    })

    it("lays none at all when the head has barely moved", () => {
        const snake = makeSnake(500, 500, 0)
        const before = snake.nodes.length
        advance(snake, 0.001, false)
        expect(snake.nodes.length).toBe(before)
    })

    it("lays several when one frame covered several gaps", () => {
        const snake = makeSnake(500, 500, 0)
        snake.length = MAX_LENGTH
        advance(snake, 0.5, false)
        expect(snake.nodes.length).toBeGreaterThanOrEqual(Math.floor(SPEED * 0.5 / NODE_GAP))
    })

    it("carries the number of points its length pays for, and no more", () => {
        const roll = seeded(23)
        for (const length of [START_LENGTH, 400, 900, MAX_LENGTH]) {
            const snake = makeSnake(1600, 1200, 0)
            snake.length = length
            wander(snake, 4000, roll)
            expect(snake.nodes.length).toBe(nodeBudget(length))
        }
    })

    it("drops the tail when a snake shrinks", () => {
        const roll = seeded(31)
        const snake = makeSnake(1600, 1200, 0)
        snake.length = 900
        wander(snake, 2000, roll)
        snake.length = 300
        layTrail(snake)
        expect(snake.nodes.length).toBe(nodeBudget(300))
    })

    it("never puts a point further from the head than its own length", () => {
        const roll = seeded(37)
        for (let run = 0; run < 20; run++) {
            const snake = makeSnake(1600, 1200, roll() * 7)
            snake.length = START_LENGTH + roll() * (MAX_LENGTH - START_LENGTH)
            wander(snake, 1500, roll)
            for (const node of snake.nodes) {
                expect(Math.hypot(snake.x - node.x, snake.y - node.y))
                    .toBeLessThanOrEqual(snake.length + NODE_GAP)
            }
        }
    })

    it("starts again from under the head when the trail is thrown away", () => {
        const roll = seeded(41)
        const snake = wander(makeSnake(900, 900, 1), 500, roll)
        resetTrail(snake)
        expect(snake.nodes).toHaveLength(1)
        expect(snake.nodes[0]).toEqual({ x: snake.x, y: snake.y })
    })
})

describe("swimming", () => {
    it("covers exactly its speed, whichever speed that is", () => {
        const cruise = makeSnake(1000, 1000, 0)
        advance(cruise, 1, false)
        expect(cruise.x - 1000).toBeCloseTo(SPEED, 6)

        const fast = makeSnake(1000, 1000, 0)
        advance(fast, 1, true)
        expect(fast.x - 1000).toBeCloseTo(BOOST_SPEED, 6)
        expect(BOOST_SPEED).toBeGreaterThan(SPEED)
    })

    it("goes the way it is pointing, with positive vertical downward", () => {
        const snake = makeSnake(1000, 1000, Math.PI / 2)
        advance(snake, 1, false)
        expect(snake.y - 1000).toBeCloseTo(SPEED, 6)
        expect(snake.x).toBeCloseTo(1000, 6)
    })
})

describe("steering", () => {
    it("never turns faster than the rate, however far off it is aimed", () => {
        const roll = seeded(53)
        for (let i = 0; i < 2000; i++) {
            const from = (roll() - 0.5) * 20
            const to = (roll() - 0.5) * 20
            const dt = roll() * 0.05
            const turned = steer(from, to, dt)
            const moved = Math.abs(normalizeAngle(turned - from))
            expect(moved).toBeLessThanOrEqual(TURN_RATE * dt + 1e-9)
        }
    })

    it("takes the short way round rather than the long way", () => {
        const almost = Math.PI - 0.05
        const turned = steer(almost, -almost, 0.02)
        expect(normalizeAngle(turned - almost)).toBeGreaterThan(0)
    })

    it("arrives at the heading it was given and then holds it", () => {
        let angle = 0
        for (let i = 0; i < 200; i++) angle = steer(angle, 2, 1 / 60)
        expect(normalizeAngle(angle - 2)).toBeCloseTo(0, 6)
        expect(steer(angle, 2, 1 / 60)).toBeCloseTo(angle, 6)
    })

    it("keeps the angle in one turn rather than letting it wind up", () => {
        const roll = seeded(59)
        let angle = 0
        for (let i = 0; i < 5000; i++) angle = steer(angle, roll() * 100 - 50, 1 / 30)
        expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI + 1e-9)
    })
})

describe("how wide a snake is", () => {
    it("starts thin and ends thick, and never leaves those bounds", () => {
        expect(radiusOf(START_LENGTH)).toBeCloseTo(MIN_RADIUS, 6)
        expect(radiusOf(MAX_LENGTH)).toBeCloseTo(MAX_RADIUS, 6)
        for (let length = -500; length < MAX_LENGTH * 2; length += 37) {
            expect(radiusOf(length)).toBeGreaterThanOrEqual(MIN_RADIUS)
            expect(radiusOf(length)).toBeLessThanOrEqual(MAX_RADIUS)
        }
    })

    it("never gets thinner as a snake grows", () => {
        for (let length = 0; length < MAX_LENGTH; length += 13) {
            expect(radiusOf(length + 13)).toBeGreaterThanOrEqual(radiusOf(length))
        }
    })

    it("widens fastest at the start", () => {
        expect(radiusOf(400) - radiusOf(START_LENGTH))
            .toBeGreaterThan(radiusOf(MAX_LENGTH) - radiusOf(MAX_LENGTH - 270))
    })

    it("stops growing at the maximum length", () => {
        expect(grow(MAX_LENGTH - 1, 1e9)).toBe(MAX_LENGTH)
        expect(grow(200, -1e9)).toBe(0)
    })
})

describe("running into somebody", () => {
    const brute = (hx: number, hy: number, headRadius: number, other: Snake): boolean => {
        const reach = headRadius * GRAZE + radiusOf(other.length)
        return other.nodes.some((node) => Math.hypot(hx - node.x, hy - node.y) <= reach)
    }

    it("is true on the line and false away from it", () => {
        const roll = seeded(67)
        const other = wander(makeSnake(1600, 1200, 0.4), 900, roll)
        const node = other.nodes[10]!
        expect(hitsBody(node.x, node.y, MIN_RADIUS, other)).toBe(true)
        expect(hitsBody(node.x + 900, node.y + 900, MIN_RADIUS, other)).toBe(false)
    })

    it("agrees with the exhaustive answer everywhere", () => {
        const roll = seeded(71)
        for (let run = 0; run < 30; run++) {
            const other = makeSnake(1600, 1200, roll() * 7)
            other.length = START_LENGTH + roll() * (MAX_LENGTH - START_LENGTH)
            wander(other, 600 + Math.floor(roll() * 900), roll)
            for (let probe = 0; probe < 300; probe++) {
                const near = other.nodes[Math.floor(roll() * other.nodes.length)]!
                const hx = probe % 2 === 0 ? near.x + (roll() - 0.5) * 30 : roll() * WORLD_W
                const hy = probe % 2 === 0 ? near.y + (roll() - 0.5) * 30 : roll() * WORLD_H
                const radius = MIN_RADIUS + roll() * (MAX_RADIUS - MIN_RADIUS)
                expect(hitsBody(hx, hy, radius, other)).toBe(brute(hx, hy, radius, other))
            }
        }
    })

    it("says no about a body with nothing in it", () => {
        const bare = makeSnake(100, 100, 0)
        bare.nodes.length = 0
        expect(hitsBody(100, 100, MIN_RADIUS, bare)).toBe(false)
    })

    it("forgives a graze that a full body width would have killed", () => {
        const other = makeSnake(1000, 1000, 0)
        other.nodes = [{ x: 1000, y: 1000 }]
        const radius = MAX_RADIUS
        const generous = radius + radiusOf(other.length)
        const strict = radius * GRAZE + radiusOf(other.length)
        expect(strict).toBeLessThan(generous)
        expect(hitsBody(1000 + (strict + generous) / 2, 1000, radius, other)).toBe(false)
        expect(hitsBody(1000 + strict * 0.9, 1000, radius, other)).toBe(true)
    })
})

describe("the edge of the field", () => {
    it("is outside for a body that has crossed it, allowing for its width", () => {
        expect(insideWorld(1600, 1200, MAX_RADIUS)).toBe(true)
        expect(insideWorld(1, 1200, MIN_RADIUS)).toBe(false)
        expect(insideWorld(WORLD_W - 1, 1200, MIN_RADIUS)).toBe(false)
        expect(insideWorld(1600, WORLD_H - 1, MIN_RADIUS)).toBe(false)
    })

    it("holds exactly at the line rather than a pixel either side", () => {
        expect(insideWorld(MIN_RADIUS, MIN_RADIUS, MIN_RADIUS)).toBe(true)
        expect(insideWorld(MIN_RADIUS - 0.001, MIN_RADIUS, MIN_RADIUS)).toBe(false)
    })
})

describe("boosting", () => {
    it("is only offered to a snake with length to spare", () => {
        expect(canBoost(START_LENGTH)).toBe(false)
        expect(canBoost(BOOST_FLOOR)).toBe(false)
        expect(canBoost(MAX_LENGTH)).toBe(true)
    })

    it("costs length, and never spends past the floor", () => {
        expect(boostDrain(900, 1)).toBeLessThan(900)
        expect(boostDrain(BOOST_FLOOR + 1, 100)).toBe(BOOST_FLOOR)
        expect(boostDrain(START_LENGTH, 100)).toBe(BOOST_FLOOR)
    })

    it("converges on the floor however long it is held", () => {
        let length = MAX_LENGTH
        for (let i = 0; i < 10000; i++) length = boostDrain(length, 1 / 60)
        expect(length).toBe(BOOST_FLOOR)
    })
})

describe("orbs", () => {
    it("scatters the number asked for, inside the field", () => {
        const orbs = scatterOrbs(400, Math.random)
        expect(orbs).toHaveLength(400)
        for (const orb of orbs) {
            expect(orb.x).toBeGreaterThanOrEqual(ORB_SIZE)
            expect(orb.x).toBeLessThanOrEqual(WORLD_W - ORB_SIZE)
            expect(orb.y).toBeGreaterThanOrEqual(ORB_SIZE)
            expect(orb.y).toBeLessThanOrEqual(WORLD_H - ORB_SIZE)
            expect(orb.alive).toBe(true)
        }
    })

    it("lays exactly the same field from the same source", () => {
        expect(scatterOrbs(120, seeded(9))).toEqual(scatterOrbs(120, seeded(9)))
        expect(scatterOrbs(120, seeded(9))).not.toEqual(scatterOrbs(120, seeded(10)))
    })

    it("reports the orbs a head is on top of, by index", () => {
        const orbs = [
            { x: 100, y: 100, tone: 0, alive: true },
            { x: 2000, y: 2000, tone: 1, alive: true },
        ]
        expect(orbsEaten(100, 100, MIN_RADIUS, orbs)).toEqual([0])
        expect(orbsEaten(500, 500, MIN_RADIUS, orbs)).toEqual([])
    })

    it("ignores one that has already gone, so an index keeps meaning one orb", () => {
        expect(orbsEaten(100, 100, MIN_RADIUS, [{ x: 100, y: 100, tone: 0, alive: false }])).toEqual([])
    })

    it("swallows several at once when they are bunched", () => {
        const orbs = [
            { x: 100, y: 100, tone: 0, alive: true },
            { x: 104, y: 100, tone: 1, alive: true },
            { x: 98, y: 103, tone: 2, alive: true },
        ]
        expect(orbsEaten(100, 100, MIN_RADIUS, orbs)).toHaveLength(3)
    })

    it("gives a bigger snake a wider mouth", () => {
        const orbs = [{ x: 100 + MAX_RADIUS + ORB_SIZE, y: 100, tone: 0, alive: true }]
        expect(orbsEaten(100, 100, MAX_RADIUS, orbs)).toHaveLength(1)
        expect(orbsEaten(100, 100, MIN_RADIUS, orbs)).toHaveLength(0)
    })
})

describe("what a dead snake leaves behind", () => {
    it("hands back the number of orbs asked for, spread along the body", () => {
        const roll = seeded(83)
        const snake = wander(makeSnake(1600, 1200, 0), 2000, roll)
        const dropped = corpseOrbs(snake, 24)
        expect(dropped).toHaveLength(24)
        for (const point of dropped) {
            expect(snake.nodes.some((n) => n.x === point.x && n.y === point.y)).toBe(true)
        }
    })

    it("spreads them out rather than piling them on the head", () => {
        const roll = seeded(89)
        const snake = wander(makeSnake(1600, 1200, 0), 2000, roll)
        const dropped = corpseOrbs(snake, 20)
        const unique = new Set(dropped.map((p) => `${p.x},${p.y}`))
        expect(unique.size).toBeGreaterThan(10)
    })

    it("copes with a short snake and with being asked for nothing", () => {
        const stub = makeSnake(10, 10, 0)
        expect(corpseOrbs(stub, 30)).toHaveLength(30)
        expect(corpseOrbs(stub, 0)).toEqual([])
        expect(corpseOrbs(stub, -5)).toEqual([])
    })
})

describe("spawning", () => {
    it("keeps clear of the edges, where half the directions are fatal", () => {
        for (let i = 0; i < 400; i++) {
            const at = spawnPoint(Math.random)
            expect(at.x).toBeGreaterThan(WORLD_W * 0.15)
            expect(at.x).toBeLessThan(WORLD_W * 0.85)
            expect(at.y).toBeGreaterThan(WORLD_H * 0.15)
            expect(at.y).toBeLessThan(WORLD_H * 0.85)
            expect(Math.abs(at.angle)).toBeLessThanOrEqual(Math.PI)
        }
    })

    it("leaves a new snake room to swim before it reaches a wall", () => {
        for (let i = 0; i < 200; i++) {
            const at = spawnPoint(Math.random)
            expect(insideWorld(at.x, at.y, MAX_RADIUS)).toBe(true)
        }
    })
})
