/**
 * Which runtime line a cart needs, from its oj.json's `runtime`: the oldest
 * runtime it runs on, as a line ("1.2") or a version ("1.2.0", whose line is
 * 1.2). A runtime is MAJOR.MINOR.PATCH and MAJOR.MINOR is its line, as on the
 * site (PlaySite/src/runtime-lines.ts).
 *
 * The example sweep asks this so an example written for the next line, whose
 * API the live runtime does not have yet, waits for it rather than failing
 * against the old one, and runs by itself once that line is live.
 */

/** [major, minor] of a line or a version, or null when it is neither. */
function lineParts(value) {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(value))
    return m === null ? null : [Number(m[1]), Number(m[2])]
}

/**
 * The line a cart needs and `live` is older than, as "1.2", or null when
 * `live` has it (or the cart names none). Throws on a `runtime` that is not a
 * line or a version, and on a `live` that is not a version, so a typo cannot
 * read as "runs anywhere".
 */
export function waitsFor(manifest, live) {
    const now = lineParts(live)
    if (now === null || !/^\d+\.\d+\.\d+$/.test(String(live))) throw new Error(`the live runtime ${JSON.stringify(live)} is not a version like 1.1.2`)
    const wanted = manifest?.runtime
    if (wanted === undefined) return null
    const need = lineParts(wanted)
    if (need === null) throw new Error(`oj.json's "runtime" is ${JSON.stringify(wanted)}; it should be the oldest runtime line the cart runs on, like "1.2"`)
    const older = now[0] < need[0] || (now[0] === need[0] && now[1] < need[1])
    return older ? `${need[0]}.${need[1]}` : null
}
