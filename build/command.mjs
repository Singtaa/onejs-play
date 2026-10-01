/**
 * This package's name, its command, and how a person or an agent runs it, in
 * every sentence it prints. One place, so a rename is these lines, the
 * package.json name and the docs.
 *
 * Sai, 1 Oct 2026: onejs-play became a command people install once and type
 * bare, `ojp add @singtaa/lightning`. The command is BIN. The npm package is
 * PACKAGE, which npm may scope (it refused a bare "ojp" as too like other
 * names), so the two are kept apart: `npm install -g <PACKAGE>` puts BIN on
 * the PATH, and agents are told `npx <PACKAGE>`, which needs no install. A
 * sentence names the next command the way this one was run: BIN when it was
 * typed bare, `npx <PACKAGE>` when npm started it (npx, or a package.json
 * script), since that works everywhere. On the site, where nothing was typed,
 * it is `npx <PACKAGE>`.
 */
export const PACKAGE = "ojp"

/** The command `npm install -g` puts on the PATH: package.json's one bin. */
export const BIN = "ojp"

/** The package this one was called before, frozen at 0.8.9 for the OneJS projects that pin it. */
export const FORMER_PACKAGE = "onejs-play"

const typedBare = typeof process !== "undefined" && process.env !== undefined && process.versions?.node !== undefined
    && process.env.npm_command === undefined

/** How to run it without installing anything, which works wherever it is read. */
export const ANYWHERE = `npx ${PACKAGE}`

export const COMMAND = typedBare ? BIN : ANYWHERE

/** How a person installs the command. */
export const INSTALL = `npm install -g ${PACKAGE}`
