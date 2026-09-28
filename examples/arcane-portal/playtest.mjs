// Arcane Portal, driven the way a player plays it: `npx oj test playtest.mjs`.
//
// A swatch has to become the selected one, and a drag on the slider has to move
// the speed. `oj test` then checks, as it does for every game, that each row's
// controls line up with the labels beside them.

// Each swatch's position and whether it wears the white ring that marks it.
const SWATCHES = `(() => {
    const out = []
    const walk = (e) => {
        const b = e.worldBound
        if (String(e.GetType().Name) === "VisualElement" && Math.round(b.width) === 32 && Math.round(b.height) === 32) {
            out.push({ x: b.center.x, y: b.center.y, ring: e.resolvedStyle.borderTopColor.a > 0.5 })
        }
        const n = e.hierarchy.childCount
        for (let i = 0; i < n; i++) walk(e.hierarchy.ElementAt(i))
    }
    walk(__root)
    return JSON.stringify(out)
})()`

const SLIDER = `(() => {
    const find = (e) => { if (String(e.GetType().Name) === "Slider") return e; const n = e.hierarchy.childCount; for (let i = 0; i < n; i++) { const f = find(e.hierarchy.ElementAt(i)); if (f) return f } return null }
    const b = find(__root).worldBound
    return JSON.stringify({ x: b.x, y: b.center.y, w: b.width })
})()`

export default async function (game) {
    const swatches = JSON.parse(await game.eval(SWATCHES))
    if (swatches.length !== 5) throw new Error(`expected 5 swatches, found ${swatches.length}`)
    if (!swatches[0].ring || swatches.filter((s) => s.ring).length !== 1) throw new Error("the first swatch should start selected, alone")

    await game.click(swatches[2].x, swatches[2].y)
    await game.until(async () => JSON.parse(await game.eval(SWATCHES))[2].ring, { what: "the third swatch to take the ring" })
    const after = JSON.parse(await game.eval(SWATCHES))
    if (after.filter((s) => s.ring).length !== 1) throw new Error("more than one swatch is marked selected")

    if (!(await game.read()).includes("1.00")) throw new Error("speed does not start at 1.00")
    const slider = JSON.parse(await game.eval(SLIDER))
    // The thumb sits a third of the way along at 1 of 0 to 3; drag it to the end.
    await game.drag(slider.x + slider.w / 3, slider.y, slider.x + slider.w + 40, slider.y)
    await game.until(async () => (await game.read()).includes("3.00"), { what: "the speed to read 3.00" })
    await game.shot(".oj/arcane-portal.png")
}
