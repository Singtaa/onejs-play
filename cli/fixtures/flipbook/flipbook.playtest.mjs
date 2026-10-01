// A flipbook animates: the sidecar is served beside its sheet, read, and the
// cell on show moves over time. For months the sidecar was never served
// (json was not an asset), every flipbook showed its whole sheet, and the
// only sign was a 404 in a console nobody read.
//
// Waits for each change rather than sampling a fixed window: the sheet shows
// whole until its sidecar arrives, and a machine running every example at
// once can hold that fetch back for a while.
export default async function (game) {
    const cell = async () => JSON.parse(await game.eval(
        "JSON.stringify((() => { const uv = globalThis.__flip?.current?.uv; return uv ? [uv.x, uv.width] : null })())"))
    let last = null
    await game.until(async () => (last = await cell())?.[1] === 0.25, {
        what: "a cell a quarter of the sheet wide (the sidecar applied)",
    }).catch(() => { throw new Error(`a cell is ${last?.[1] ?? "nothing"} of the sheet wide, not 0.25: the sidecar was not applied`) })
    const first = last[0]
    await game.until(async () => (await cell())[0] !== first, { what: `the flipbook to move off the cell at x=${first}` })
}
