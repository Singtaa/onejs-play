/**
 * The geometry of `visibility`: what an eye sees across one plane, worked out
 * from the colliders in range as that plane cuts them. Plain numbers, with no
 * call into the engine per ray, so a look costs what a cart's own sight would.
 *
 * Each collider becomes parts: a convex outline (a box, a hull, a capsule's
 * middle), segments (a mesh cut by the plane, an outline), a circle (a ball,
 * an upright capsule), or a shape only an exact ray test can answer for (a
 * tilted capsule). The boundary of what is seen can only turn at a part's
 * corner or the tangent of a round one, or where a part crosses the edge of
 * range, so a ray goes to just either side of each of those and nowhere else
 * but round arcs. Between two neighbouring rays the first thing a ray meets
 * cannot change, so straight faces come out exact, round ones as close as
 * `ROUND` asks.
 *
 * Everything is in the plane's own two axes, x and z, in the engine's metres.
 */

/** A convex outline, a run of segments, a circle, or a shape with its own ray test. */
export type Part =
    | { kind: "convex", pts: number[] }
    | { kind: "segments", pts: number[] }
    | { kind: "circle", cx: number, cz: number, r: number }
    | { kind: "exact", cx: number, cz: number, r: number, hit: (ox: number, oz: number, dx: number, dz: number) => number }

/** Radians either side of a corner: 30 µm at 30 m. */
const EPS = 1e-6
/** How far a round face's chord may fall inside it, in metres. */
const ROUND = 0.005
const TAU = Math.PI * 2
/** Slices of the turn a ray looks in, to test only what lies in its direction. */
const BINS = 64
/** Most segments one piece of a cut mesh holds, so a ray tests the pieces near it and not the whole mesh. */
const CHUNK = 16

/** Turns a convex outline's points counterclockwise (x across, z up the page), in place. */
export function counterclockwise(pts: number[]): number[] {
    let area = 0
    for (let i = 0, n = pts.length; i < n; i += 2) {
        const j = (i + 2) % n
        area += pts[i]! * pts[j + 1]! - pts[j]! * pts[i + 1]!
    }
    if (area < 0) {
        for (let i = 0, j = pts.length - 2; i < j; i += 2, j -= 2) {
            const x = pts[i]!, z = pts[i + 1]!
            pts[i] = pts[j]!; pts[i + 1] = pts[j + 1]!
            pts[j] = x; pts[j + 1] = z
        }
    }
    return pts
}

/** The convex hull of points, counterclockwise: the cut of a tilted box. */
export function hull(pts: number[]): number[] {
    const n = pts.length / 2
    if (n < 3) return pts
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[2 * a]! - pts[2 * b]! || pts[2 * a + 1]! - pts[2 * b + 1]!)
    const cross = (o: number, a: number, b: number) =>
        (pts[2 * a]! - pts[2 * o]!) * (pts[2 * b + 1]! - pts[2 * o + 1]!) - (pts[2 * a + 1]! - pts[2 * o + 1]!) * (pts[2 * b]! - pts[2 * o]!)
    const lower: number[] = [], upper: number[] = []
    for (const i of idx) {
        while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, i) <= 1e-12) lower.pop()
        lower.push(i)
    }
    for (let k = idx.length - 1; k >= 0; k--) {
        const i = idx[k]!
        while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, i) <= 1e-12) upper.pop()
        upper.push(i)
    }
    const out: number[] = []
    for (const i of [...lower.slice(0, -1), ...upper.slice(0, -1)]) out.push(pts[2 * i]!, pts[2 * i + 1]!)
    return out
}

function convexHit(p: number[], ox: number, oz: number, dx: number, dz: number): number {
    let enter = -Infinity, leave = Infinity
    const n = p.length
    for (let i = 0; i < n; i += 2) {
        const ax = p[i]!, az = p[i + 1]!
        const j = (i + 2) % n
        // Counterclockwise, so outward is to the right of each edge.
        const nx = p[j + 1]! - az, nz = ax - p[j]!
        const num = nx * (ax - ox) + nz * (az - oz), den = nx * dx + nz * dz
        if (den > -1e-15 && den < 1e-15) {
            if (num < 0) return Infinity
            continue
        }
        const t = num / den
        if (den < 0) { if (t > enter) enter = t } else if (t < leave) leave = t
        if (enter > leave + 1e-12) return Infinity
    }
    if (leave < 0) return Infinity
    return enter > 0 ? enter : 0
}

function segmentsHit(p: number[], ox: number, oz: number, dx: number, dz: number): number {
    let best = Infinity
    for (let i = 0; i < p.length; i += 4) {
        const ax = p[i]!, az = p[i + 1]!, ex = p[i + 2]! - ax, ez = p[i + 3]! - az
        const den = dx * ez - dz * ex
        if (den > -1e-15 && den < 1e-15) continue
        const wx = ax - ox, wz = az - oz
        const t = (wx * ez - wz * ex) / den, u = (wx * dz - wz * dx) / den
        if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t
    }
    return best
}

function circleHit(cx: number, cz: number, r: number, ox: number, oz: number, dx: number, dz: number): number {
    const wx = cx - ox, wz = cz - oz
    const c = wx * wx + wz * wz - r * r
    if (c <= 0) return 0
    const b = wx * dx + wz * dz
    if (b <= 0) return Infinity
    const disc = b * b - c
    return disc < 0 ? Infinity : b - Math.sqrt(disc)
}

/** Where a ray from the eye first meets a part, or Infinity. */
export function partHit(part: Part, ox: number, oz: number, dx: number, dz: number): number {
    switch (part.kind) {
        case "convex": return convexHit(part.pts, ox, oz, dx, dz)
        case "segments": return segmentsHit(part.pts, ox, oz, dx, dz)
        case "circle": return circleHit(part.cx, part.cz, part.r, ox, oz, dx, dz)
        case "exact": return part.hit(ox, oz, dx, dz)
    }
}

/** Whether the eye is inside a solid part, where every ray stops at once, as the engine's do. */
function holds(part: Part, ox: number, oz: number): boolean {
    if (part.kind === "circle") return (part.cx - ox) ** 2 + (part.cz - oz) ** 2 <= part.r * part.r
    if (part.kind === "convex") return convexHit(part.pts, ox, oz, 1, 0) === 0 && convexHit(part.pts, ox, oz, -1, 0) === 0
    if (part.kind === "exact") return part.hit(ox, oz, 1, 0) === 0
    return false
}

/** The angles where a segment from (ax, az) to (bx, bz) crosses the circle of range, either side. */
function rangeCrossings(ax: number, az: number, bx: number, bz: number, ox: number, oz: number, within: number, out: number[]): void {
    const ex = bx - ax, ez = bz - az, wx = ax - ox, wz = az - oz
    const a = ex * ex + ez * ez
    if (a === 0) return
    const b = 2 * (wx * ex + wz * ez), c = wx * wx + wz * wz - within * within
    const disc = b * b - 4 * a * c
    if (disc < 0) return
    const s = Math.sqrt(disc)
    for (const u of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (u < 0 || u > 1) continue
        const ang = Math.atan2(az + ez * u - oz, ax + ex * u - ox)
        out.push(ang - EPS, ang + EPS)
    }
}

/** The angles a round part needs: either side of its two tangents, and along the arc between them that faces the eye. */
function roundAngles(cx: number, cz: number, r: number, ox: number, oz: number, within: number, out: number[]): void {
    const wx = cx - ox, wz = cz - oz
    const d = Math.hypot(wx, wz)
    if (d <= r || d - r > within) return
    const toward = Math.atan2(wz, wx), half = Math.asin(r / d)
    out.push(toward - half - EPS, toward - half + EPS, toward + half - EPS, toward + half + EPS)
    // The near arc, round the part's middle from one tangent point to the other.
    const span = Math.PI - 2 * half
    const step = r > ROUND ? 2 * Math.acos(1 - ROUND / r) : span
    const n = Math.min(64, Math.ceil(span / step))
    for (let k = 1; k < n; k++) {
        const phi = toward + Math.PI - span / 2 + (span * k) / n
        out.push(Math.atan2(cz + r * Math.sin(phi) - oz, cx + r * Math.cos(phi) - ox))
    }
    // Where it crosses the edge of range.
    if (d + r > within) {
        const a = (within * within - r * r + d * d) / (2 * d)
        const h2 = within * within - a * a
        if (h2 > 0) {
            const spread = Math.atan2(Math.sqrt(h2), a)
            out.push(toward - spread - EPS, toward - spread + EPS, toward + spread - EPS, toward + spread + EPS)
        }
    }
}

/** The angles a part's outline needs from this eye. */
function partAngles(part: Part, ox: number, oz: number, within: number, out: number[]): void {
    if (part.kind === "circle") { roundAngles(part.cx, part.cz, part.r, ox, oz, within, out); return }
    if (part.kind === "exact") {
        // Its tangents are not known in closed form: sample across it, and halve to each edge found.
        const wx = part.cx - ox, wz = part.cz - oz, d = Math.hypot(wx, wz)
        if (d - part.r > within) return
        const toward = Math.atan2(wz, wx), half = d > part.r ? Math.asin(part.r / d) : Math.PI
        const n = 16
        const at = (a: number) => part.hit(ox, oz, Math.cos(a), Math.sin(a)) <= within
        let prevA = toward - half, prevHit = at(prevA)
        for (let k = 1; k <= n; k++) {
            const a = toward - half + (2 * half * k) / n
            const hit = at(a)
            out.push(a)
            if (hit !== prevHit) {
                let lo = prevA, hi = a
                for (let i = 0; i < 24; i++) {
                    const mid = (lo + hi) / 2
                    if (at(mid) === prevHit) lo = mid; else hi = mid
                }
                out.push(lo, hi)
            }
            prevA = a; prevHit = hit
        }
        return
    }
    const p = part.pts, n = p.length
    if (part.kind === "segments") {
        for (let i = 0; i < n; i += 4) {
            const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!
            const a0 = Math.atan2(az - oz, ax - ox), a1 = Math.atan2(bz - oz, bx - ox)
            out.push(a0 - EPS, a0 + EPS, a1 - EPS, a1 + EPS)
            rangeCrossings(ax, az, bx, bz, ox, oz, within, out)
        }
        return
    }
    // Convex: one ray at a corner between two faces the eye sees, two either side of a corner
    // the view goes past, and none at a corner on the far side, which its own outline hides.
    const front = (i: number) => {
        const j = (i + 2) % n
        return (p[j]! - p[i]!) * (oz - p[i + 1]!) - (p[j + 1]! - p[i + 1]!) * (ox - p[i]!) < 0
    }
    for (let i = 0; i < n; i += 2) {
        const before = front((i - 2 + n) % n), after = front(i)
        if (!before && !after) continue
        const a = Math.atan2(p[i + 1]! - oz, p[i]! - ox)
        if (before && after) out.push(a); else out.push(a - EPS, a + EPS)
        if (after) { const j = (i + 2) % n; rangeCrossings(p[i]!, p[i + 1]!, p[j]!, p[j + 1]!, ox, oz, within, out) }
    }
}

/** A part, or a piece of a cut mesh, with a circle round it. */
interface Piece { part: Part, cx: number, cz: number, r: number }

/** Each part's pieces, worked out once: a static body's parts are kept from look to look. */
const piecesOf = new WeakMap<Part, Piece[]>()

function pieces(part: Part): Piece[] {
    const known = piecesOf.get(part)
    if (known !== undefined) return known
    const around = (p: Part, pts: number[]): Piece => {
        let cx = 0, cz = 0
        const n = pts.length / 2
        for (let i = 0; i < pts.length; i += 2) { cx += pts[i]!; cz += pts[i + 1]! }
        cx /= n; cz /= n
        let r = 0
        for (let i = 0; i < pts.length; i += 2) r = Math.max(r, Math.hypot(pts[i]! - cx, pts[i + 1]! - cz))
        return { part: p, cx, cz, r: r + 1e-9 }
    }
    let out: Piece[]
    if (part.kind === "circle" || part.kind === "exact") out = [{ part, cx: part.cx, cz: part.cz, r: part.r }]
    else if (part.kind === "convex") out = [around(part, part.pts)]
    else {
        out = []
        for (let i = 0; i < part.pts.length; i += 4 * CHUNK) {
            const piece: Part = { kind: "segments", pts: part.pts.slice(i, i + 4 * CHUNK) }
            out.push(around(piece, piece.pts))
        }
    }
    piecesOf.set(part, out)
    return out
}

// One look's working arrays, emptied each look: a look runs to the end before another starts.
const list: Piece[] = []
const near: number[] = []
const bins: number[][] = Array.from({ length: BINS }, () => [])

/**
 * The pieces each slice of the turn could hold, nearest first, as indices
 * into `list`. A piece's slices are the ones its circle spans as seen from
 * the eye, and how near it can be is the distance to that circle.
 */
function binned(parts: readonly Part[], ox: number, oz: number): void {
    list.length = 0
    near.length = 0
    for (const b of bins) b.length = 0
    const w = TAU / BINS
    for (const part of parts) {
        for (const piece of pieces(part)) {
            const i = list.length
            list.push(piece)
            const wx = piece.cx - ox, wz = piece.cz - oz, d = Math.hypot(wx, wz)
            near.push(Math.max(0, d - piece.r))
            if (d <= piece.r) { for (const b of bins) b.push(i); continue }
            const toward = Math.atan2(wz, wx), half = Math.asin(piece.r / d)
            const first = Math.floor((toward - half) / w), last = Math.floor((toward + half) / w)
            for (let k = first; k <= Math.min(last, first + BINS - 1); k++) bins[((k % BINS) + BINS) % BINS]!.push(i)
        }
    }
    for (const b of bins) if (b.length > 1) b.sort((x, y) => near[x]! - near[y]!)
}

/**
 * What an eye at (ox, oz) sees out to `within`, among `parts`: the outline of
 * it, round the eye counterclockwise, as x and z pairs appended to `out`. The
 * edge of range is drawn with `arc` points to the turn where nothing is in the
 * way. Nothing at all when the eye is inside something solid, as every ray
 * the engine casts from there stops where it starts. Returns how many rays it
 * took.
 */
export function sight(ox: number, oz: number, within: number, parts: readonly Part[], arc: number, out: number[]): number {
    for (const part of parts) if (holds(part, ox, oz)) { out.push(ox, oz); return 0 }
    const angles: number[] = []
    for (const part of parts) partAngles(part, ox, oz, within, angles)
    const sorted = new Float64Array(angles.length)
    for (let i = 0; i < angles.length; i++) sorted[i] = ((angles[i]! % TAU) + TAU) % TAU
    sorted.sort()
    const step = TAU / arc
    if (sorted.length === 0) {
        for (let k = 0; k < arc; k++) out.push(ox + Math.cos(k * step) * within, oz + Math.sin(k * step) * within)
        return 0
    }
    // Each angle once, and the first again a turn on, to close the outline.
    const rays: number[] = []
    let last = -Infinity
    for (const a of sorted) if (a - last > 1e-12) { rays.push(a); last = a }
    binned(parts, ox, oz)
    const ts: number[] = new Array(rays.length)
    for (let i = 0; i < rays.length; i++) {
        const dx = Math.cos(rays[i]!), dz = Math.sin(rays[i]!)
        let t = Infinity
        // Nearest first, so once a ray has met something nothing further is asked.
        for (const k of bins[Math.min(BINS - 1, Math.floor(rays[i]! / (TAU / BINS)))]!) {
            if (near[k]! >= t) break
            const h = partHit(list[k]!.part, ox, oz, dx, dz)
            if (h < t) t = h
        }
        ts[i] = t
    }
    for (let i = 0; i < rays.length; i++) {
        const a = rays[i]!, t = Math.min(ts[i]!, within)
        out.push(ox + Math.cos(a) * t, oz + Math.sin(a) * t)
        // Between two rays that reach nothing, nothing is in the way: the edge of range, as an arc.
        const j = (i + 1) % rays.length
        if (ts[i]! <= within || ts[j]! <= within) continue
        const b = j === 0 ? rays[0]! + TAU : rays[j]!
        for (let k = Math.floor(a / step) + 1; k * step < b; k++) {
            if (k * step - a < 1e-9 || b - k * step < 1e-9) continue
            out.push(ox + Math.cos(k * step) * within, oz + Math.sin(k * step) * within)
        }
    }
    return rays.length
}
