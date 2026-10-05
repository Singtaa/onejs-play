// `find` answers where an element a player sees is, once it has been laid
// out, in the stage pixels `click` takes.
//
// A Ghost Hunt test read five nameplates' worldBound as they appeared and
// got 0, 0 for every one, because an element has no layout on the frame it
// mounts (5 Oct 2026). The button here has no layout for its first 400 ms,
// so a find that did not wait would answer a rectangle with no size at the
// corner, and the click below would miss.
export default async function (cart) {
    const b = await cart.find("Late")
    if (Math.abs(b.x - 300) > 2 || Math.abs(b.y - 200) > 2 || Math.abs(b.width - 120) > 2 || Math.abs(b.height - 40) > 2) {
        throw new Error(`find("Late") answered ${JSON.stringify(b)}; the button is at 300, 200, 120 by 40`)
    }
    await cart.click(b.x + b.width / 2, b.y + b.height / 2)
    await cart.until(async () => (await cart.read()).includes("Clicked"), { timeoutMs: 5000, what: "the click on the found button" })

    const byPattern = await cart.find(/^La/)
    if (byPattern.x !== b.x) throw new Error(`find(/^La/) answered ${JSON.stringify(byPattern)}`)
    const missing = await cart.find("Nowhere", { timeoutMs: 300 }).then(() => null, (error) => error.message)
    if (!/"Nowhere" on screen/.test(missing ?? "")) throw new Error(`find("Nowhere") should throw naming it; got ${missing}`)
}
