/**
 * This package's name and how a person or an agent runs it, in every
 * sentence it prints. One place, so a rename is these lines and the docs.
 *
 * Sai, 1 Oct 2026: onejs-play became ojp, a command people install once
 * (`npm install -g ojp`) and type bare, `ojp add @singtaa/lightning`. Agents
 * are told `npx ojp`, which needs no install. So a sentence names the next
 * command the way this one was run: bare when it was typed bare, `npx ojp`
 * when npm started it (npx, or a package.json script), since that one works
 * everywhere, global install or not. On the site, where nothing was typed,
 * it is `npx ojp`.
 */
export const PACKAGE = "ojp"

/** The package this one was called before, kept working as a wrapper (compat/). */
export const FORMER_PACKAGE = "onejs-play"

const typedBare = typeof process !== "undefined" && process.env !== undefined && process.versions?.node !== undefined
    && process.env.npm_command === undefined

export const COMMAND = typedBare ? PACKAGE : `npx ${PACKAGE}`

/**
 * The spelling for the builder's own sentences, which the site prints too
 * (an import oj.json does not list): `npx ojp`, which works wherever it is read.
 */
export const ANYWHERE = `npx ${PACKAGE}`
