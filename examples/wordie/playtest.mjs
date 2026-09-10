// A round of Wordie, driven the way a player plays it: `npx oj test playtest.mjs`.
//
// Counting beats membership. Every letter of the guess is already on the
// keyboard once, so "the screen shows C" would pass with no tile filled; a
// letter appearing twice is a tile.
export default async function (game) {
    const before = await game.read()
    if (!before.some((t) => t.includes("WORDIE"))) throw new Error(`no title on screen: ${JSON.stringify(before)}`)

    await game.click(300, 300)          // take focus, the way a player does
    await game.type("crane")
    await game.wait(200)
    const typed = await game.read()
    const tiles = "CRANE".split("").filter((c) => typed.filter((t) => t === c).length >= 2)
    if (tiles.length !== 5) throw new Error(`typed CRANE, tiles filled: ${tiles.join("")}`)

    await game.press("Enter")
    await game.until(async () => (await game.read()).some((t) => t.includes("1/6")), { what: "the guess counter to reach 1/6" })
    await game.shot(".oj/after-guess.png")
}
