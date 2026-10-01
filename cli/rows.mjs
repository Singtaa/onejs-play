/**
 * Rows that look wrong: out of line, or crowded.
 *
 * `align-items: center` centres each child's box, not what a player sees in it.
 * A control whose visible part sits off its box's centre (a slider's track, a
 * toggle's box, a text field's input) therefore looks misaligned in a row that
 * is, by its own measure, perfectly centred. Arcane Portal shipped with its
 * speed slider's track 8px below the labels beside it, and nothing failed.
 *
 * Boxes also hide how close things look. A text's box is wider than its ink,
 * and a slider's track fills its box, so two boxes that sit apart can still
 * put a value's first digit against the end of a track. Arcane Portal's speed
 * read "0.94" with no gap to the track, again with nothing failing.
 *
 * So this measures what is seen, from resolved layout (worldBound), for every
 * horizontal row:
 *
 *   misaligned: in a row centred on the cross axis, a child's visible part
 *   whose vertical centre is more than `tolerance` pixels off the centre of
 *   the row's content box, the line align-items: center puts every box on.
 *
 *   crowded: a control (slider, toggle, text field) whose visible parts come
 *   within `minGap` pixels of a neighbour's. Only pairs with a control count:
 *   text runs placed flush make a line (Ember's and Tuner's code listings),
 *   and tiles and keys that touch are a design choice.
 *
 * A text's visible part is its ink: its measured width, placed by its
 * alignment inside its content box. It is an expression for the game's page,
 * where `__root` and `CS` are, so `ojplay test` and the site's playtest harness
 * (Tools/playtest) run the same check.
 */

/** UI Toolkit's FlexDirection.Row and Align.Center, as the proxy reports them. */
const ROW = 2
const CENTER = 2

/**
 * The expression. Resolves to a JSON array of problems, empty when every row
 * is fine: `{ row, kind: "misaligned", spread, parts: [{ child, part, offset }] }`
 * or `{ row, kind: "crowded", gaps: [{ between: [a, b], gap }] }`.
 */
export function rowProblemsExpression({ tolerance = 1, minGap = 8 } = {}) {
    return `(() => {
        const TOL = ${Number(tolerance)}
        const MIN_GAP = ${Number(minGap)}
        // The part of a control a player reads as the control. Anything not
        // listed is its own box, or its ink when it is text.
        const VISIBLE = {
            Slider: ["unity-base-slider__tracker", "unity-base-slider__dragger"],
            SliderInt: ["unity-base-slider__tracker", "unity-base-slider__dragger"],
            Toggle: ["unity-toggle__checkmark"],
            TextField: ["unity-base-text-field__input"],
        }
        const TEXT = { TextElement: true, Label: true }
        const MEASURE = CS.UnityEngine.UIElements.VisualElement.MeasureMode.Undefined
        const kids = (e) => { const out = []; const n = e.hierarchy.childCount; for (let i = 0; i < n; i++) out.push(e.hierarchy.ElementAt(i)); return out }
        const find = (e, cls) => { if (e.ClassListContains(cls)) return e; for (const c of kids(e)) { const f = find(c, cls); if (f) return f } return null }
        const type = (e) => String(e.GetType().Name)
        const name = (e) => type(e) + (e.name ? "#" + e.name : "")
        const shown = (e) => e.resolvedStyle.display !== 1 && e.worldBound.height > 0
        const round = (v) => Math.round(v * 10) / 10

        // Where a text's ink runs horizontally: its measured width, clamped to
        // its content box and placed by the horizontal third of its alignment.
        const ink = (e) => {
            const b = e.worldBound, r = e.resolvedStyle
            const left = b.x + r.borderLeftWidth + r.paddingLeft
            const right = b.xMax - r.borderRightWidth - r.paddingRight
            const w = Math.min(right - left, e.MeasureTextSize(String(e.text ?? ""), 0, MEASURE, 0, MEASURE).x)
            const h = Number(r.unityTextAlign) % 3
            const x = h === 0 ? left : h === 2 ? right - w : left + (right - left - w) / 2
            return { x, xMax: x + w }
        }

        // A child's visible parts, each with its vertical centre and its
        // horizontal run, and whether the child is a control.
        const partsOf = (c) => {
            const classes = VISIBLE[type(c)]
            if (classes) {
                const out = []
                for (const cls of classes) {
                    const p = find(c, cls)
                    if (p && shown(p)) { const b = p.worldBound; out.push({ part: cls.split("__")[1], y: b.center.y, x: b.x, xMax: b.xMax }) }
                }
                return { control: true, parts: out }
            }
            const b = c.worldBound
            if (TEXT[type(c)]) { const i = ink(c); return { control: false, parts: [{ part: "ink", y: b.center.y, x: i.x, xMax: i.xMax }] } }
            return { control: false, parts: [{ part: "box", y: b.center.y, x: b.x, xMax: b.xMax }] }
        }

        const problems = []
        const walk = (e, path) => {
            const r = e.resolvedStyle
            if (r.flexDirection === ${ROW} && shown(e)) {
                const children = kids(e).filter(shown).map((c) => ({ child: name(c), ...partsOf(c) })).filter((c) => c.parts.length > 0)

                if (r.alignItems === ${CENTER}) {
                    const parts = children.flatMap((c) => c.parts.map((p) => ({ child: c.child, part: p.part, y: p.y })))
                    if (parts.length > 1) {
                        const b = e.worldBound
                        const top = b.y + r.borderTopWidth + r.paddingTop
                        const centre = top + (b.height - r.borderTopWidth - r.paddingTop - r.borderBottomWidth - r.paddingBottom) / 2
                        const ys = parts.map((p) => p.y).sort((a, b) => a - b)
                        const off = parts.map((p) => ({ child: p.child, part: p.part, offset: round(p.y - centre) }))
                        if (off.some((p) => Math.abs(p.offset) > TOL)) {
                            problems.push({ row: path, kind: "misaligned", spread: round(ys[ys.length - 1] - ys[0]), parts: off })
                        }
                    }
                }

                const runs = children.map((c) => ({ child: c.child, control: c.control,
                    x: Math.min(...c.parts.map((p) => p.x)), xMax: Math.max(...c.parts.map((p) => p.xMax)) }))
                    .sort((a, b) => a.x - b.x)
                const gaps = []
                for (let i = 1; i < runs.length; i++) {
                    const a = runs[i - 1], b = runs[i]
                    if (!a.control && !b.control) continue
                    const gap = round(b.x - a.xMax)
                    if (gap < MIN_GAP) gaps.push({ between: [a.child, b.child], gap })
                }
                if (gaps.length > 0) problems.push({ row: path, kind: "crowded", gaps })
            }
            kids(e).forEach((c, i) => walk(c, path + "/" + i))
        }
        walk(globalThis.__root, "root")
        return JSON.stringify(problems)
    })()`
}

/** One line per problem, for a failure message. */
export function describeRowProblems(problems) {
    return problems.map((p) => p.kind === "crowded"
        ? `row ${p.row} crowded: ` + p.gaps.map((g) => `${g.between[0]} to ${g.between[1]} ${g.gap}px`).join(", ")
        : `row ${p.row} spread ${p.spread}px: ` +
            p.parts.filter((q) => q.offset !== 0).map((q) => `${q.child} ${q.part} ${q.offset > 0 ? "+" : ""}${q.offset}px`).join(", "))
}
