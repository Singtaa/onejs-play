/**
 * The Content Security Policy a game runs under.
 *
 * Two documents run a game, as with the boot script beside this file: the
 * sandbox document on a game's own origin, and the page `ojplay run` and
 * `ojplay test` serve on a developer's machine. They must not differ in what
 * the game may do, or a cart that passes locally is refused on the site with
 * nothing local to warn of it (the terrain lesson's blob: model, 6 Nov 2026).
 * So both send this policy: the site with its store and analytics beacon, the
 * local page with neither.
 *
 * On the site this is the second layer of the boundary; the separate
 * registrable domain is the first (PlaySite/src/routes/sandbox.ts).
 */

/**
 * @param {string} site The site's origin, e.g. https://play.onejs.com.
 * @param {{ store?: string | null, beacon?: { script: string, report: string } | null, anywhere?: boolean }} [options]
 */
export function gameCsp(site, { store = null, beacon = null, anywhere = false } = {}) {
    const extra = (...origins) => origins.filter((o) => typeof o === "string" && o !== "").map((o) => ` ${o}`).join("")
    return [
        "default-src 'none'",
        // 'unsafe-eval' is required, not sloppiness: OneJS boots its JS runtime
        // through indirect eval, and 'wasm-unsafe-eval' covers WebAssembly only.
        // Without it Unity starts, CS is never defined, and nothing reports why.
        //
        // It costs nothing here. The game origin exists to run untrusted
        // JavaScript on purpose, so script-src was never the boundary: the
        // separate registrable domain is. The directives that matter are the
        // ones below, and they are unaffected.
        //
        // Cloudflare injects its Web Analytics beacon into every HTML response
        // on the site's zone; refused, it logged a CSP error in every game's
        // console and counted as one in the harnesses.
        `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${site}${extra(beacon?.script)}`,
        // The site, over both schemes. A room is a WebSocket, and although CSP
        // treats an https source as covering wss, saying so costs nothing and
        // removes a thing to be wrong about. The beacon's own host is where it
        // reports to; the store is where a build's files are read from.
        //
        // blob: is for a model a cart made in memory, which Unity's loader
        // fetches by its blob address: a blob address names bytes this same
        // document made, so it reaches nothing new.
        `connect-src 'self' blob: ${site} ${site.replace(/^http/, "ws")}${extra(beacon?.report, store)}`,
        `img-src 'self' data: blob:${extra(store)}`,
        `media-src 'self' blob:${extra(store)}`,
        "style-src 'self' 'unsafe-inline'",
        `font-src 'self' data:${extra(store)}`,
        "worker-src 'self' blob:",
        `frame-ancestors ${anywhere ? "*" : site}`,
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ")
}
