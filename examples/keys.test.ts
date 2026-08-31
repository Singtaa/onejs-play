import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { resolveKeyName } from "onejs-unity/input"

/**
 * Every key name any example asks for has to be a key.
 *
 * A game queries a key by name, and a name the backend does not recognise
 * resolves to null and then reports "not pressed" forever. There is no error
 * and no warning: the control is simply dead, and it looks like the game
 * ignoring you rather than a typo.
 *
 * That is not hypothetical. Tuner shipped to play.onejs.com asking for
 * "ArrowUp", which is what a browser calls that key and what the container
 * itself receives, but not what it stores it under. Its arrow keys did
 * nothing, its own tests passed, and nothing in the pipeline had an opinion.
 *
 * This reads the examples as text on purpose. Importing them would need a
 * container, and the question here is only whether a string is a key.
 */
const dir = join(import.meta.dirname)
const games = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "index.tsx")))
    .map((e) => e.name)

/** Matches a literal key name passed to any of the by-name query methods. */
const QUERY = /\b(?:wasKeyPressed|isKeyDown|wasKeyReleased)\(\s*"([^"]+)"\s*\)/g

describe("the key names the examples ask for", () => {
    it("finds games to check, so an empty pass cannot look like a green one", () => {
        expect(games.length).toBeGreaterThan(5)
    })

    for (const game of games) {
        const source = readFileSync(join(dir, game, "index.tsx"), "utf8")
        const names = [...source.matchAll(QUERY)].map((m) => m[1]!)
        if (names.length === 0) continue
        it(`${game} asks only for keys that exist`, () => {
            for (const name of names) {
                expect(resolveKeyName(name), `${game} queries "${name}"`).not.toBe(null)
            }
        })
    }
})
