/**
 * Rows whose children do not line up.
 *
 * `align-items: center` centres each child's box, not what a player sees in it.
 * A control whose visible part sits off its box's centre (a slider's track, a
 * toggle's box, a text field's input) therefore looks misaligned in a row that
 * is, by its own measure, perfectly centred. Arcane Portal shipped with its
 * speed slider's track 8px below the labels beside it, and nothing failed.
 *
 * So this measures what is seen: for each horizontal row centred on the cross
 * axis, the vertical centre of every child's visible part, from resolved layout
 * (worldBound), compared with the centre of the row's content box, which is
 * the line align-items: center puts every child's box on. It is an expression for
 * the game's page, where `__root` and `CS` are, so `oj test` and the site's
 * playtest harness (Tools/playtest) run the same check.
 */

/** UI Toolkit's FlexDirection.Row and Align.Center, as the proxy reports them. */
const ROW = 2
const CENTER = 2

/**
 * The expression. Resolves to a JSON array of misaligned rows, each
 * `{ row, spread, parts: [{ child, part, offset }] }`, empty when every row
 * lines up within `tolerance` pixels.
 */
export function misalignedRowsExpression(tolerance = 1) {
    return `(() => {
        const TOL = ${Number(tolerance)}
        // The part of a control a player reads as the control. Anything not
        // listed is its own box, which is right for text and plain views.
        const VISIBLE = {
            Slider: ["unity-base-slider__tracker", "unity-base-slider__dragger"],
            SliderInt: ["unity-base-slider__tracker", "unity-base-slider__dragger"],
            Toggle: ["unity-toggle__checkmark"],
            TextField: ["unity-base-text-field__input"],
        }
        const kids = (e) => { const out = []; const n = e.hierarchy.childCount; for (let i = 0; i < n; i++) out.push(e.hierarchy.ElementAt(i)); return out }
        const find = (e, cls) => { if (e.ClassListContains(cls)) return e; for (const c of kids(e)) { const f = find(c, cls); if (f) return f } return null }
        const name = (e) => String(e.GetType().Name) + (e.name ? "#" + e.name : "")
        const shown = (e) => e.resolvedStyle.display !== 1 && e.worldBound.height > 0
        const bad = []
        const walk = (e, path) => {
            const r = e.resolvedStyle
            if (r.flexDirection === ${ROW} && r.alignItems === ${CENTER} && shown(e)) {
                const parts = []
                for (const c of kids(e)) {
                    if (!shown(c)) continue
                    const classes = VISIBLE[String(c.GetType().Name)]
                    if (!classes) { parts.push({ child: name(c), part: "box", y: c.worldBound.center.y }); continue }
                    for (const cls of classes) {
                        const p = find(c, cls)
                        if (p && shown(p)) parts.push({ child: name(c), part: cls.split("__")[1], y: p.worldBound.center.y })
                    }
                }
                if (parts.length > 1) {
                    const b = e.worldBound
                    const top = b.y + r.borderTopWidth + r.paddingTop
                    const centre = top + (b.height - r.borderTopWidth - r.paddingTop - r.borderBottomWidth - r.paddingBottom) / 2
                    const ys = parts.map((p) => p.y).sort((a, b) => a - b)
                    const off = parts.map((p) => ({ child: p.child, part: p.part, offset: Math.round((p.y - centre) * 10) / 10 }))
                    if (off.some((p) => Math.abs(p.offset) > TOL)) {
                        bad.push({ row: path, spread: Math.round((ys[ys.length - 1] - ys[0]) * 10) / 10, parts: off })
                    }
                }
            }
            kids(e).forEach((c, i) => walk(c, path + "/" + i))
        }
        walk(globalThis.__root, "root")
        return JSON.stringify(bad)
    })()`
}

/** One line per misaligned row, for a failure message. */
export function describeMisalignedRows(rows) {
    return rows.map((r) => `row ${r.row} spread ${r.spread}px: ` +
        r.parts.filter((p) => p.offset !== 0).map((p) => `${p.child} ${p.part} ${p.offset > 0 ? "+" : ""}${p.offset}px`).join(", "))
}
