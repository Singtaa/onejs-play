// Drives the game the way a player would: `npm test`, or `npx oj test playtest.mjs`.
// `game` reads the screen, clicks and presses in stage units, and takes
// screenshots; a thrown error fails the run, and so does a console error.
export default async function (game) {
    const screen = await game.read()
    if (!screen.includes("0")) throw new Error(`expected a score of 0 on screen, saw ${JSON.stringify(screen)}`)
    await game.click(300, 300)
    await game.wait(300)
    await game.shot(".oj/playtest.png")
}
